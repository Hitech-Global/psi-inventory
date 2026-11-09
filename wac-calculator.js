/**
 * WAC Shared Calculator (Phase 1 Design Freeze)
 *
 * Single source of truth for WAC cost computation.
 * Used by both /api/wac/preview and /api/wac/confirm endpoints in server.js.
 * Fail-closed: any data integrity issue produces a blocker; blockers > 0 → no DB writes.
 */

const { query, queryOne } = require('./db');

const WAC_FX_RATE_TYPE = 'cost_settlement';
const WAC_MONETARY_TOLERANCE = 0.01;

// Query-count instrumentation for performance testing
let _wacQueryCount = 0;
function _q(sql, params) { _wacQueryCount++; return query(sql, params); }
function _q1(sql, params) { _wacQueryCount++; return queryOne(sql, params); }

const WAC_FX_POLICIES = {
  'inspection_fee/inspection': 'PAYMENT_DATE_FX',
};
const WAC_ALLOCATION_POLICIES = {
  'inspection_fee/inspection': 'BY_PRODUCT_COST',
};

// Exact-date FX resolver for WAC (purpose=INVENTORY_VALUATION).
// Does NOT expose payment settlement semantics. Only same-day direct or reverse-reciprocal.
// Returns null if no exact-date rate found — caller must produce a blocker.
function resolveExactFxRate(fromCurrency, toCurrency, date, cache) {
  if (!date) return null;
  if (fromCurrency === toCurrency) {
    return { rate: 1, rate_date: date, rate_type: 'identity', direction: 'identity' };
  }
  const cacheKey = `${fromCurrency}|${toCurrency}|${date}`;
  if (cache && cache.has(cacheKey)) return cache.get(cacheKey);
  const direct = _q1(
    `SELECT * FROM exchange_rates
     WHERE from_currency = ? AND to_currency = ? AND rate_date = ? AND rate_type = ?
     ORDER BY created_at DESC, id DESC LIMIT 1`,
    [fromCurrency, toCurrency, date, WAC_FX_RATE_TYPE]
  );
  if (direct && Number(direct.rate) > 0) {
    const result = { rate: Number(direct.rate), rate_date: direct.rate_date, rate_type: direct.rate_type || '', direction: 'direct' };
    if (cache) cache.set(cacheKey, result);
    return result;
  }
  const reverse = _q1(
    `SELECT * FROM exchange_rates
     WHERE from_currency = ? AND to_currency = ? AND rate_date = ? AND rate_type = ?
     ORDER BY created_at DESC, id DESC LIMIT 1`,
    [toCurrency, fromCurrency, date, WAC_FX_RATE_TYPE]
  );
  if (reverse && Number(reverse.rate) > 0) {
    const result = { rate: 1 / Number(reverse.rate), rate_date: reverse.rate_date, rate_type: reverse.rate_type || '', direction: 'reverse' };
    if (cache) cache.set(cacheKey, result);
    return result;
  }
  if (cache) cache.set(cacheKey, null);
  return null;
}

// Helper: allocate a total amount across SKUs by a given weight map, with remainder to max-weight SKU.
function transportBasisForMode(transportMode) {
  const mode = String(transportMode || '').trim().toLowerCase();
  if (mode === 'sea') return 'cbm';
  if (mode === 'air') return 'kg';
  return null;
}

function allocateByWeight(skuCodes, weightMap, totalAmount) {
  const totalWeight = skuCodes.reduce((s, sku) => s + (weightMap.get(sku) || 0), 0);
  if (!(totalWeight > 0)) return null;

  const rawAlloc = skuCodes.map(sku => {
    const weight = weightMap.get(sku) || 0;
    const ratio = weight / totalWeight;
    const theoretical = totalAmount * ratio;
    const rounded = Math.round(theoretical * 10000) / 10000;
    return { sku, theoretical, rounded, final: rounded, adjustment: 0 };
  });

  const anchor = rawAlloc.slice().sort((a, b) => b.theoretical - a.theoretical)[0];
  const roundedTotal = rawAlloc.reduce((s, r) => s + r.rounded, 0);
  const remainder = Math.round(totalAmount * 10000) / 10000 - roundedTotal;
  if (anchor) {
    anchor.adjustment = remainder;
    anchor.final = Math.round((anchor.rounded + anchor.adjustment) * 10000) / 10000;
  }

  return new Map(rawAlloc.map(r => [r.sku, r.final]));
}

// Main shared calculator
function computeWacCostFacts(logisticsBatchId) {
  const blockers = [];
  _wacQueryCount = 0;
  const fxCache = new Map();

  // ── 1. Load batch ──
  const batch = _q1('SELECT * FROM logistics_batches WHERE id = ?', [logisticsBatchId]);
  if (!batch) {
    blockers.push({ code: 'BATCH_NOT_FOUND', message: '物流批次不存在' });
    return { blockers, items: [], meta: {} };
  }

  // ── 2. Check PL count (exactly one) ──
  const linkedPLs = _q('SELECT * FROM packing_lists WHERE logistics_batch_id = ?', [batch.id]).rows;
  if (linkedPLs.length === 0) {
    blockers.push({ code: 'BATCH_PL_MISSING', message: '该物流批次未关联PL' });
  } else if (linkedPLs.length > 1) {
    blockers.push({ code: 'BATCH_PL_RELATION_CONFLICT', message: `该物流批次关联了${linkedPLs.length}个PL，Phase 1要求一对一关系` });
  }
  const pl = linkedPLs.length === 1 ? linkedPLs[0] : null;

  // ── 3. Load CI — strict batch→CI relation, no fallback ──
  const batchCiId = String(batch.related_ci_id || '').trim();
  const plCiId = pl ? String(pl.related_ci_id || '').trim() : '';

  if (!batchCiId) {
    blockers.push({ code: 'BATCH_CI_RELATION_CONFLICT', message: '物流批次缺少 related_ci_id', detail: { reason: 'batch_ci_missing' } });
  }
  if (pl && !plCiId) {
    blockers.push({ code: 'BATCH_CI_RELATION_CONFLICT', message: 'PL缺少 related_ci_id', detail: { reason: 'pl_ci_missing' } });
  }
  if (batchCiId && plCiId && batchCiId !== plCiId) {
    blockers.push({ code: 'BATCH_CI_RELATION_CONFLICT', message: `物流批次CI(${batchCiId}) ≠ PL CI(${plCiId})`, detail: { reason: 'ci_mismatch', batch_ci_id: batchCiId, pl_ci_id: plCiId } });
  }

  const ciId = batchCiId;
  const ci = ciId ? _q1('SELECT * FROM commercial_invoices WHERE id = ?', [ciId]) : null;
  if (!ci) {
    blockers.push({ code: 'CI_MISSING', message: '未找到关联CI' });
    return { blockers, items: [], meta: { batch } };
  }

  // ── 4. Load CI items → compute per-SKU weighted purchase unit price ──
  const ciItems = _q('SELECT * FROM commercial_invoice_items WHERE ci_id = ? ORDER BY created_at, id', [ci.id]).rows;
  if (ciItems.length === 0) {
    blockers.push({ code: 'CI_ITEMS_MISSING', message: 'CI无明细数据，无法计算加权采购单价' });
    return { blockers, items: [], meta: { batch, ci } };
  }

  const ciSkuMap = new Map();
  for (const item of ciItems) {
    const skuCode = String(item.sku_code || '').trim();
    if (!skuCode) continue;
    const qty = Number(item.shipped_qty) || 0;
    const unitPrice = Number(item.net_unit_price) > 0 ? Number(item.net_unit_price) : (Number(item.unit_price) || 0);
    const lineAmount = qty * unitPrice;
    const customsRate = (item.actual_customs_rate !== null && item.actual_customs_rate !== '' && item.actual_customs_rate !== undefined)
      ? Number(item.actual_customs_rate) : null;

    if (!ciSkuMap.has(skuCode)) {
      ciSkuMap.set(skuCode, { sku_code: skuCode, shipped_qty: 0, goods_amount: 0, weighted_purchase_unit_price: 0, customs_rate: null, line_count: 0 });
    }
    const entry = ciSkuMap.get(skuCode);
    entry.shipped_qty += qty;
    entry.goods_amount += lineAmount;
    entry.line_count++;
    if (entry.customs_rate === null && customsRate !== null && Number.isFinite(customsRate) && customsRate >= 0) {
      entry.customs_rate = customsRate;
    }
  }
  for (const entry of ciSkuMap.values()) {
    entry.weighted_purchase_unit_price = entry.shipped_qty > 0 ? entry.goods_amount / entry.shipped_qty : 0;
  }

  const ci_shipped_qty_total = [...ciSkuMap.values()].reduce((s, e) => s + e.shipped_qty, 0);
  const ci_goods_amount_total = [...ciSkuMap.values()].reduce((s, e) => s + e.goods_amount, 0);

  // ── 5. Load PL items → compute batch_qty per SKU ──
  const plItems = pl
    ? _q('SELECT * FROM packing_list_items WHERE pl_id = ? ORDER BY created_at, id', [pl.id]).rows
    : [];
  if (pl && plItems.length === 0) {
    blockers.push({ code: 'PL_ITEMS_MISSING', message: 'PL无明细数据' });
  }

  const batchSkuMap = new Map();
  for (const pli of plItems) {
    const skuCode = String(pli.sku_code || '').trim();
    if (!skuCode) continue;
    if (!batchSkuMap.has(skuCode)) {
      batchSkuMap.set(skuCode, { sku_code: skuCode, batch_qty: 0, cbm: 0, gross_weight: 0 });
    }
    const entry = batchSkuMap.get(skuCode);
    entry.batch_qty += Number(pli.total_qty) || 0;
    entry.cbm += Number(pli.cbm) || 0;
    entry.gross_weight += Number(pli.gross_weight) || 0;
  }

  // ── 6. Determine target (local) currency via warehouse master ──
  // Chain: batch.target_warehouse → warehouses → countries → default_currency
  // No fallback to PL/CI/batch.country fields.
  const warehouseName = String(batch.target_warehouse || '').trim();
  const requestedCountry = String(batch.target_country || '').trim();
  let targetCountry = '';
  let localCurrency = '';

  // Warehouse names are not globally sufficient to identify a destination:
  // 至速仓 may exist in both Malaysia and Thailand. Resolve by BOTH the batch's
  // target country and warehouse, never by whichever same-name row queryOne returns.
  const countryRows = _q('SELECT id, name, code, default_currency FROM countries').rows;
  const countryAliasKey = value => {
    const raw = String(value || '').trim().toLowerCase().replace(/\\s+/g, ' ');
    const aliases = {
      '印度尼西亚': '印尼', '印度尼西亚共和国': '印尼', 'indonesia': '印尼',
      'republic of indonesia': '印尼', '马来西亚': '马来', 'malaysia': '马来',
      '泰王国': '泰国', 'thailand': '泰国', 'kingdom of thailand': '泰国'
    };
    return aliases[raw] || raw;
  };
  const warehouseCountry = wh => {
    const byId = wh.country_id
      ? countryRows.find(country => String(country.id || '') === String(wh.country_id))
      : null;
    const byName = !byId && wh.country_name
      ? countryRows.find(country => countryAliasKey(country.name) === countryAliasKey(wh.country_name))
      : null;
    const country = byId || byName || null;
    return {
      row: country,
      name: String(country ? country.name : (wh.country_name || '')).trim(),
      code: String(country && country.code || '').trim()
    };
  };
  const warehouseCandidates = warehouseName
    ? _q('SELECT * FROM warehouses WHERE name = ? OR id = ?', [warehouseName, warehouseName]).rows
    : [];
  const matchingWarehouses = warehouseCandidates.filter(candidate => {
    if (!requestedCountry) return true;
    const resolved = warehouseCountry(candidate);
    return countryAliasKey(resolved.name) === countryAliasKey(requestedCountry) ||
      (!!resolved.code && resolved.code.toLowerCase() === requestedCountry.toLowerCase());
  });
  const wh = matchingWarehouses.length === 1 ? matchingWarehouses[0] : null;

  if (wh) {
    const resolved = warehouseCountry(wh);
    targetCountry = resolved.name || requestedCountry;
    localCurrency = String(resolved.row && resolved.row.default_currency || '').trim();
  }
  if (!localCurrency) {
    const reason = warehouseCandidates.length === 0
      ? '仓库主数据中不存在该仓库'
      : matchingWarehouses.length === 0
        ? `仓库名称存在，但与目标国家「${requestedCountry || '-'}」不匹配`
        : matchingWarehouses.length > 1
          ? '目标国家和仓库名称仍匹配到多条主数据'
          : '仓库未关联国家或国家未配置本国货币';
    blockers.push({
      code: 'WAC_TARGET_CURRENCY_UNRESOLVED',
      message: `无法唯一确定目标仓库「${warehouseName}」的本币：${reason}`,
      detail: {
        target_country: requestedCountry,
        target_warehouse: warehouseName,
        candidate_countries: warehouseCandidates.map(candidate => warehouseCountry(candidate).name)
      }
    });
  }

  // ── 7. Product FX policy ──
  // CI goods use the batch freight's actual applied payment settlement FX.
  // The payment record is the authoritative source for both the rate and paid date.
  const arrivalDate = String(batch.actual_arrival_date || '').trim();
  const ciCurrency = String(ci.currency || 'USD').trim().toUpperCase();
  let productFxDate = '';
  let productFxRate = null;

  // ── 8. Freight ──
  const freightBusinessAmount = Number(batch.total_freight) || 0;
  const freightCurrency = String(batch.freight_currency || 'USD').trim();
  let freightLocalAmount = 0;
  let freightEffectiveRate = null;
  let freightLastPaidDate = '';
  let freightPaymentBreakdown = [];

  if (freightBusinessAmount > 0) {
    // Batch-scoped query: ONLY this batch's freight cost items
    const freightCostItems = _q(
      `SELECT id, payment_request_id, cost_category, cost_subcategory, payable_amount, currency, logistics_batch_id
       FROM ci_cost_items
       WHERE ci_id = ? AND logistics_batch_id = ? AND include_in_landing_cost = 1 AND cost_category = 'warehouse_arrival' AND cost_subcategory = 'freight'`,
      [ci.id, batch.id]
    ).rows;

    if (freightCostItems.length === 0) {
      // No batch-scoped freight cost items — check if unscoped/other-batch items exist
      const anyFreightItems = _q(
        `SELECT id, logistics_batch_id FROM ci_cost_items
         WHERE ci_id = ? AND include_in_landing_cost = 1 AND cost_category = 'warehouse_arrival' AND cost_subcategory = 'freight'`,
        [ci.id]
      ).rows;
      if (anyFreightItems.length > 0) {
        blockers.push({ code: 'FREIGHT_PAYMENT_LINK_AMBIGUOUS', message: '运费成本项不属于当前批次', detail: { reason: 'wrong_batch_scope', expected_batch_id: batch.id } });
      } else {
        blockers.push({ code: 'FREIGHT_PAYMENT_FACT_MISSING', message: `运费${freightBusinessAmount}无关联付款记录` });
      }
    } else {
      // B. Check link ambiguity — batch-scoped cost items missing payment_request_id
      const itemsWithPr = freightCostItems.filter(i => i.payment_request_id);
      const itemsWithoutPr = freightCostItems.filter(i => !i.payment_request_id);
      if (itemsWithoutPr.length > 0) {
        blockers.push({ code: 'FREIGHT_PAYMENT_LINK_AMBIGUOUS', message: `运费成本项缺少 payment_request_id`, detail: { reason: 'missing_pr_link', count: itemsWithoutPr.length } });
      }

      // DISTINCT payment_request_id — only for fetching PR metadata, not for deduplicating payment events
      const freightPrIds = [...new Set(itemsWithPr.map(i => i.payment_request_id))];

      if (freightPrIds.length === 0) {
        blockers.push({ code: 'FREIGHT_PAYMENT_FACT_MISSING', message: `运费${freightBusinessAmount}无关联付款记录` });
      } else {
        const ph = freightPrIds.map(() => '?').join(',');
        const freightPrs = _q(`SELECT id, currency FROM payment_requests WHERE id IN (${ph})`, freightPrIds).rows;

        // C. Currency mismatch
        const currencyMismatch = freightPrs.some(pr => String(pr.currency || '').toUpperCase() !== freightCurrency.toUpperCase());
        if (currencyMismatch) {
          blockers.push({ code: 'FREIGHT_PAYMENT_CURRENCY_MISMATCH', message: `运费付款申请币种与freight_currency(${freightCurrency})不匹配` });
        }

        // Query ALL raw applied payment logs — no grouping, no deduplication
        const freightLogs = _q(
          `SELECT payment_request_id, amount, local_amount, local_rate, local_rate_date, local_currency, local_rate_type, local_rate_direction, paid_date
           FROM payment_settlement_logs
           WHERE payment_request_id IN (${ph})
             AND event_type = 'payment' AND status = 'applied'
           ORDER BY payment_request_id, paid_date`,
          freightPrIds
        ).rows;

        // A. 0 applied payments
        if (freightLogs.length === 0) {
          blockers.push({ code: 'FREIGHT_PAYMENT_FACT_MISSING', message: `运费付款无 applied payment logs` });
        } else {
          // E. Per-row FX validation — each raw payment event must have valid local fields
          const fxInvalid = [];
          for (const log of freightLogs) {
            if (!log.local_currency ||
                String(log.local_currency).trim().toUpperCase() !== String(localCurrency || '').trim().toUpperCase() ||
                !Number.isFinite(Number(log.local_rate)) || Number(log.local_rate) <= 0 ||
                !log.local_rate_date || !log.paid_date || String(log.local_rate_date).slice(0,10) !== String(log.paid_date).slice(0,10) ||
                !Number.isFinite(Number(log.local_amount)) || Number(log.local_amount) <= 0) {
              fxInvalid.push(log);
            }
          }
          if (fxInvalid.length > 0) {
            blockers.push({ code: 'FREIGHT_FX_RATE_MISSING', message: `运费付款缺少有效的 local_currency/local_rate/local_rate_date/local_amount`, detail: { payment_request_id: fxInvalid[0].payment_request_id, count: fxInvalid.length } });
          }

          // Only proceed if no freight blockers so far
          if (!blockers.some(b => b.code.startsWith('FREIGHT'))) {
            const freightPaidTotal = freightLogs.reduce((s, log) => s + (Number(log.amount) || 0), 0);
            const freightLocalTotal = freightLogs.reduce((s, log) => s + (Number(log.local_amount) || 0), 0);
            const lastPaidDate = freightLogs.reduce((max, log) => {
              return (log.paid_date && log.paid_date > max) ? log.paid_date : max;
            }, '');

            // D. Settlement reconciliation — partial or overpaid unified
            if (Math.abs(freightPaidTotal - freightBusinessAmount) > WAC_MONETARY_TOLERANCE) {
              const detail = freightPaidTotal < freightBusinessAmount
                ? { reason: 'partial', paid: freightPaidTotal, expected: freightBusinessAmount }
                : { reason: 'overpaid', paid: freightPaidTotal, expected: freightBusinessAmount };
              blockers.push({ code: 'FREIGHT_SETTLEMENT_NOT_RECONCILED', message: `运费付款总额${freightPaidTotal.toFixed(2)} ≠ 应付运费${freightBusinessAmount.toFixed(2)}`, detail });
            }

            // Only set freight values if ALL freight blockers pass
            if (!blockers.some(b => b.code.startsWith('FREIGHT'))) {
              freightLocalAmount = freightLocalTotal;
              freightLastPaidDate = lastPaidDate;
              freightPaymentBreakdown = freightLogs.map(log => ({
                payment_request_id: log.payment_request_id,
                amount: Number(log.amount) || 0,
                local_amount: Number(log.local_amount) || 0,
                local_rate: Number(log.local_rate) || 0,
                local_rate_date: log.local_rate_date || '',
                local_rate_type: log.local_rate_type || 'payment_settlement',
                local_rate_direction: log.local_rate_direction || '',
                local_currency: log.local_currency || '',
                paid_date: log.paid_date || ''
              }));
              // Amount-weight the actual applied settlement rates; do not derive the rate
              // from rounded local_amount values, and do not arbitrarily take the first payment.
              if (freightCurrency !== localCurrency && freightPaidTotal > 0) {
                freightEffectiveRate = freightLogs.reduce((sum, log) =>
                  sum + (Number(log.amount) || 0) * (Number(log.local_rate) || 0), 0) / freightPaidTotal;
              }
            }
          }
        }
      }
    }
  }

  // CI goods FX follows the actual freight payment settlement date/rate.
  // When freight is paid in the same currency as the CI, the effective rate is
  // the amount-weighted applied settlement rate (Σ local_amount / Σ paid_amount).
  if (ciCurrency === localCurrency) {
    productFxDate = freightLastPaidDate || '';
    productFxRate = { rate: 1, rate_date: productFxDate, rate_type: 'identity', direction: 'identity' };
  } else if (freightBusinessAmount > 0 && freightLocalAmount > 0 && freightLastPaidDate) {
    productFxDate = freightLastPaidDate;
    if (freightCurrency === ciCurrency && freightEffectiveRate > 0) {
      // Same source currency: use the amount-weighted applied rate from freight payment logs.
      productFxRate = {
        rate: freightEffectiveRate,
        rate_date: productFxDate,
        rate_type: 'payment_settlement',
        direction: 'payment_settlement'
      };
    } else {
      // Different source currencies: keep the same final freight-paid date as the FX anchor,
      // but resolve the CI currency's own cost-settlement rate for that exact date.
      productFxRate = resolveExactFxRate(ciCurrency, localCurrency, productFxDate, fxCache);
      if (!productFxRate) {
        blockers.push({
          code: 'PRODUCT_FX_RATE_MISSING',
          message: `缺少运费最后付款日 ${productFxDate} ${ciCurrency}→${localCurrency} 的 cost_settlement 汇率`,
          detail: { source_currency: ciCurrency, freight_currency: freightCurrency, target_currency: localCurrency, rate_date: productFxDate, rate_type: WAC_FX_RATE_TYPE }
        });
      }
    }
  } else if (ciCurrency !== localCurrency) {
    blockers.push({
      code: 'PRODUCT_FX_FREIGHT_PAYMENT_MISSING',
      message: '缺少已完成的运费付款及其本币结算汇率，无法确定 CI 商品成本汇率',
      detail: {
        source_currency: ciCurrency,
        freight_currency: freightCurrency,
        target_currency: localCurrency,
        rate_date: freightLastPaidDate || null
      }
    });
  }

  // ── 9. Freight allocation by logistics batch transport mode ──
  // The logistics batch is the source of truth: sea → CBM, air → gross weight (KG).
  // CI.transport_basis is legacy/manual data and must not block or override this rule.
  let freightAllocations = null;
  const transportBasis = transportBasisForMode(batch.transport_mode);
  if (freightLocalAmount > 0) {
    if (!transportBasis) {
      blockers.push({
        code: 'TRANSPORT_MODE_UNSUPPORTED',
        message: `物流批次运输方式「${batch.transport_mode || '-'}」无法确定运费分摊基准，仅支持海运(CBM)或空运(KG)`,
        detail: { transport_mode: batch.transport_mode || null }
      });
    } else {
      const basisField = transportBasis === 'cbm' ? 'cbm' : 'gross_weight';
      const basisLabel = transportBasis === 'cbm' ? 'CBM' : '毛重(KG)';
      const skuCodes = [...batchSkuMap.keys()];
      const weightMap = new Map();
      const missingBasisSkus = [];
      for (const sku of skuCodes) {
        const rawValue = batchSkuMap.get(sku)[basisField];
        const value = Number(rawValue);
        if (!Number.isFinite(value) || value <= 0) {
          missingBasisSkus.push(sku);
        }
        weightMap.set(sku, value);
      }
      if (missingBasisSkus.length > 0) {
        blockers.push({
          code: 'TRANSPORT_BASIS_DATA_MISSING',
          message: `以下SKU缺少有效的PL ${basisLabel}数据：${missingBasisSkus.join(', ')}`,
          detail: { transport_mode: batch.transport_mode, basis: transportBasis, sku_codes: missingBasisSkus }
        });
      } else {
        freightAllocations = allocateByWeight(skuCodes, weightMap, freightLocalAmount);
        if (!freightAllocations) {
          blockers.push({
            code: 'TRANSPORT_BASIS_TOTAL_ZERO',
            message: `PL ${basisLabel}合计为0，无法分摊运费`,
            detail: { transport_mode: batch.transport_mode, basis: transportBasis }
          });
        }
      }
    }
  }

  // Shared combined-batch delivery charge. One actual payment is apportioned to
  // batches BEFORE SKU WAC. Never treat the full common bill as each batch's freight.
  const sharedFreight = require('./shared-logistics-fee-server').sharedWacParts(batch.id, localCurrency);
  sharedFreight.errors.forEach(e => blockers.push(e));
  const sharedFreightBreakdown=[];
  for(const part of sharedFreight.parts){
    const basisField=part.basis==='cbm'?'cbm':part.basis==='kg'?'gross_weight':null;
    if(!basisField){blockers.push({code:'SHARED_FREIGHT_BASIS_INVALID',message:part.bill_no+' 运输依据无效'});continue;}
    const expectedSharedBasis=batch.transport_mode==='sea'?'cbm':batch.transport_mode==='air'?'gross_weight':null;
    if((part.basis==='kg'?'gross_weight':part.basis)!==expectedSharedBasis){blockers.push({code:'SHARED_FREIGHT_MODE_CHANGED',message:part.bill_no+' 物流批次运输方式已变化'});continue;}
    const w=new Map();
    for(const [sku,row] of batchSkuMap)w.set(sku,Number(row[basisField])||0);
    const currentBasis=[...w.values()].reduce((s,n)=>s+n,0);
    if(Math.abs(currentBasis-Number(part.basis_value))>Math.max(0.000001,Math.abs(Number(part.basis_value))*0.0000001)){
      blockers.push({code:'SHARED_FREIGHT_PL_BASIS_CHANGED',message:part.bill_no+' PL运费分摊依据已变化，禁止按旧账单确认WAC'});
      continue;
    }
    const distributed=allocateByWeight([...batchSkuMap.keys()],w,part.amount_minor/100);
    if(!distributed){blockers.push({code:'SHARED_FREIGHT_BASIS_ZERO',message:part.bill_no+' 缺少对应PL计费数据'});continue;}
    if(!freightAllocations)freightAllocations=new Map();
    for(const [sku,amt] of distributed)freightAllocations.set(sku,(freightAllocations.get(sku)||0)+amt);
    freightLocalAmount+=part.amount_minor/100;
    if(part.last_paid_date>freightLastPaidDate)freightLastPaidDate=part.last_paid_date;
    sharedFreightBreakdown.push({fee_id:part.fee_id,bill_no:part.bill_no,
      freight_cost_local:part.amount_minor/100,basis:part.basis});
  }

  // ── 10. Duty ──
  const dutyBusinessAmount = Number(batch.customs_duty) || 0;
  const dutyCurrency = freightCurrency;
  let dutyLocalAmount = 0;

  if (dutyBusinessAmount > 0) {
    if (dutyCurrency !== localCurrency) {
      if (productFxRate) {
        dutyLocalAmount = dutyBusinessAmount * productFxRate.rate;
      } else {
        if (!blockers.some(b => b.code === 'DUTY_FX_MISSING')) {
          blockers.push({ code: 'DUTY_FX_MISSING', message: `关税${dutyBusinessAmount}缺少 ${arrivalDate} ${dutyCurrency}→${localCurrency} 的汇率` });
        }
      }
    } else {
      dutyLocalAmount = dutyBusinessAmount;
    }

    const skuCodes = [...ciSkuMap.keys()];
    const missingCustomsRates = skuCodes.filter(sku => {
      const ciEntry = ciSkuMap.get(sku);
      return ciEntry.customs_rate === null || ciEntry.customs_rate === undefined;
    });
    if (missingCustomsRates.length > 0) {
      blockers.push({ code: 'CUSTOMS_RATE_MISSING', message: `以下SKU缺少实际关税税率: ${missingCustomsRates.join(', ')}` });
    }
  }

  let dutyAllocations = null;
  if (dutyLocalAmount > 0) {
    const skuCodes = [...ciSkuMap.keys()];
    const customsWeightMap = new Map();
    for (const sku of skuCodes) {
      const ciEntry = ciSkuMap.get(sku);
      const weight = (ciEntry.customs_rate !== null && ciEntry.customs_rate > 0)
        ? ciEntry.goods_amount * ciEntry.customs_rate : 0;
      customsWeightMap.set(sku, weight);
    }
    dutyAllocations = allocateByWeight(skuCodes, customsWeightMap, dutyLocalAmount);
    if (!dutyAllocations) {
      blockers.push({ code: 'CUSTOMS_WEIGHT_ZERO', message: '全部SKU的关税权重合计为0，无法分摊关税' });
    }
  }

  // ── 11. Inspection + Other costs (from ci_cost_items) ──
  const allCostItems = _q(
    `SELECT id, payment_request_id, cost_category, cost_subcategory, payable_amount, currency
     FROM ci_cost_items
     WHERE ci_id = ? AND include_in_landing_cost = 1`,
    [ci.id]
  ).rows;

  const otherCostItems = allCostItems.filter(i =>
    !(i.cost_category === 'warehouse_arrival' && i.cost_subcategory === 'freight') &&
    i.cost_category !== 'customs_duty'
  );

  const inspectionAllocations = new Map();
  const otherAllocations = new Map();
  let inspectionLocalTotal = 0;
  let otherLocalTotal = 0;

  const costCategoryGroups = new Map();
  for (const item of otherCostItems) {
    const key = `${item.cost_category}/${item.cost_subcategory}`;
    if (!costCategoryGroups.has(key)) {
      costCategoryGroups.set(key, []);
    }
    costCategoryGroups.get(key).push(item);
  }

  for (const [policyKey, items] of costCategoryGroups) {
    const totalPayable = items.reduce((s, i) => s + (Number(i.payable_amount) || 0), 0);
    if (totalPayable <= 0) continue;

    const fxPolicy = WAC_FX_POLICIES[policyKey];
    const allocPolicy = WAC_ALLOCATION_POLICIES[policyKey];

    if (!fxPolicy) {
      blockers.push({ code: 'COST_FX_POLICY_MISSING', message: `成本项 ${policyKey} 缺少FX策略定义` });
      continue;
    }
    if (!allocPolicy) {
      blockers.push({ code: 'COST_ALLOCATION_POLICY_MISSING', message: `成本项 ${policyKey} 缺少分摊策略定义` });
      continue;
    }

    let localTotal = 0;
    if (fxPolicy === 'PAYMENT_DATE_FX') {
      const prIds = [...new Set(items.filter(i => i.payment_request_id).map(i => i.payment_request_id))];
      if (prIds.length === 0) {
        blockers.push({ code: 'COST_PAYMENT_MISSING', message: `成本项 ${policyKey} 无关联付款记录` });
        continue;
      }
      const ph = prIds.map(() => '?').join(',');
      const logs = _q(
        `SELECT payment_request_id, amount, local_amount
         FROM payment_settlement_logs
         WHERE payment_request_id IN (${ph})
           AND event_type = 'payment' AND status = 'applied'`,
        prIds
      ).rows;
      localTotal = logs.reduce((s, l) => s + (Number(l.local_amount) || 0), 0);
      if (localTotal <= 0) {
        blockers.push({ code: 'COST_PAYMENT_NOT_SETTLED', message: `成本项 ${policyKey} 付款未结算` });
        continue;
      }
    } else {
      blockers.push({ code: 'COST_FX_POLICY_UNKNOWN', message: `成本项 ${policyKey} 的FX策略 ${fxPolicy} 未实现` });
      continue;
    }

    const skuCodes = [...ciSkuMap.keys()];
    let allocMap = null;
    if (allocPolicy === 'BY_PRODUCT_COST') {
      const weightMap = new Map();
      for (const sku of skuCodes) {
        weightMap.set(sku, ciSkuMap.get(sku).goods_amount);
      }
      allocMap = allocateByWeight(skuCodes, weightMap, localTotal);
    } else if (allocPolicy === 'BY_QTY') {
      const weightMap = new Map();
      for (const sku of skuCodes) {
        weightMap.set(sku, batchSkuMap.get(sku)?.batch_qty || 0);
      }
      allocMap = allocateByWeight(skuCodes, weightMap, localTotal);
    } else {
      blockers.push({ code: 'COST_ALLOCATION_POLICY_UNKNOWN', message: `成本项 ${policyKey} 的分摊策略 ${allocPolicy} 未实现` });
      continue;
    }

    if (!allocMap) {
      blockers.push({ code: 'COST_ALLOCATION_ZERO', message: `成本项 ${policyKey} 分摊权重合计为0` });
      continue;
    }

    if (policyKey.startsWith('inspection_fee')) {
      for (const [sku, amt] of allocMap) {
        inspectionAllocations.set(sku, (inspectionAllocations.get(sku) || 0) + amt);
      }
      inspectionLocalTotal += localTotal;
    } else {
      for (const [sku, amt] of allocMap) {
        otherAllocations.set(sku, (otherAllocations.get(sku) || 0) + amt);
      }
      otherLocalTotal += localTotal;
    }
  }

  // ── 12. Conservation check: PRODUCT_COST_ALLOCATION_NOT_CONSERVED ──
  // Batch-loaded: all per-SKU queries replaced with preloaded Maps
  let allFormalPlQtyBySku = new Map();
  let batchPlItemsByPlId = new Map();
  let allBatchIdsForCi = [];
  let batchPlByBatchId = new Map();

  if (pl && ciItems.length > 0) {
    // Preload 1: formal PL qty per SKU for this CI
    const formalPlQtys = _q(
      `SELECT pli.sku_code, COALESCE(SUM(pli.total_qty), 0) AS total
       FROM packing_list_items pli
       JOIN packing_lists pl ON pl.id = pli.pl_id
       WHERE pl.related_ci_id = ? AND COALESCE(pl.status, '') != 'draft'
       GROUP BY pli.sku_code`,
      [ci.id]
    ).rows;
    for (const r of formalPlQtys) {
      allFormalPlQtyBySku.set(r.sku_code, Number(r.total) || 0);
    }

    // Preload 2: all logistics batch IDs for this CI
    allBatchIdsForCi = _q(
      `SELECT lb.id FROM logistics_batches lb
       JOIN packing_lists pl ON pl.logistics_batch_id = lb.id
       WHERE lb.related_ci_id = ? AND COALESCE(pl.status, '') != 'draft'`,
      [ci.id]
    ).rows.map(r => r.id);

    // Preload 3: PL IDs for each batch
    if (allBatchIdsForCi.length > 0) {
      const batchPh = allBatchIdsForCi.map(() => '?').join(',');
      const batchPls = _q(
        `SELECT id, logistics_batch_id FROM packing_lists
         WHERE logistics_batch_id IN (${batchPh}) AND COALESCE(status, '') != 'draft'`,
        allBatchIdsForCi
      ).rows;
      for (const r of batchPls) {
        batchPlByBatchId.set(r.logistics_batch_id, r.id);
      }

      // Preload 4: all PL items for each batch PL
      const allBatchPlIds = [...batchPlByBatchId.values()];
      if (allBatchPlIds.length > 0) {
        const plPh = allBatchPlIds.map(() => '?').join(',');
        const allBatchPlItems = _q(
          `SELECT pl_id, sku_code, total_qty FROM packing_list_items WHERE pl_id IN (${plPh})`,
          allBatchPlIds
        ).rows;
        for (const r of allBatchPlItems) {
          if (!batchPlItemsByPlId.has(r.pl_id)) {
            batchPlItemsByPlId.set(r.pl_id, []);
          }
          batchPlItemsByPlId.get(r.pl_id).push(r);
        }
      }
    }
  }

  for (const [skuCode, ciEntry] of ciSkuMap) {
    if (!pl || ciItems.length === 0) break;
    const allFormalQty = allFormalPlQtyBySku.get(skuCode) || 0;

    if (allFormalQty === ciEntry.shipped_qty) {
      let totalBatchProductCost = 0;
      for (const lbId of allBatchIdsForCi) {
        const lbPlId = batchPlByBatchId.get(lbId);
        if (!lbPlId) continue;
        const lbItems = batchPlItemsByPlId.get(lbPlId) || [];
        const lbBatchQty = lbItems
          .filter(i => i.sku_code === skuCode)
          .reduce((s, i) => s + (Number(i.total_qty) || 0), 0);
        totalBatchProductCost += lbBatchQty * ciEntry.weighted_purchase_unit_price;
      }
      if (Math.abs(totalBatchProductCost - ciEntry.goods_amount) > WAC_MONETARY_TOLERANCE) {
        blockers.push({ code: 'PRODUCT_COST_ALLOCATION_NOT_CONSERVED', message: `SKU ${skuCode}: 各批次产品成本合计${totalBatchProductCost.toFixed(2)} ≠ CI货值${ciEntry.goods_amount.toFixed(2)}` });
      }
    }
  }

  // ── 13. Build per-SKU result items ──
  const skuCodes = [...new Set([...ciSkuMap.keys(), ...batchSkuMap.keys()])];
  const country2 = targetCountry;
  const warehouse = warehouseName;

  // Preload all inventory rows for every SKU in one query
  const inventoryRowsBySku = new Map();
  if (skuCodes.length > 0) {
    const invPh = skuCodes.map(() => '?').join(',');
    const invRows = _q(
      `SELECT id, available_qty, weighted_avg_cost, country, warehouse, sku_code FROM inventory WHERE sku_code IN (${invPh})`,
      skuCodes
    ).rows;
    for (const r of invRows) {
      if (!inventoryRowsBySku.has(r.sku_code)) {
        inventoryRowsBySku.set(r.sku_code, []);
      }
      inventoryRowsBySku.get(r.sku_code).push(r);
    }
  }

  // Load the immutable WAC snapshot for this batch when opening an already-confirmed batch.
  // Historical original_qty/original_avg_cost must come from wac_history, not the now-updated inventory row.
  const wacHistoryRows = _q(
    `SELECT sku_code, original_qty, original_avg_cost, original_inventory_value, new_avg_cost,
            confirmation_status, is_locked, version_no
     FROM wac_history WHERE logistics_batch_id = ? ORDER BY version_no DESC, confirmed_at DESC`,
    [batch.id]
  ).rows;
  const wacHistoryBySku = new Map();
  for (const row of wacHistoryRows) {
    if (String(row.confirmation_status || 'confirmed') !== 'confirmed' || Number(row.is_locked) !== 1) continue;
    if (!wacHistoryBySku.has(row.sku_code)) wacHistoryBySku.set(row.sku_code, row);
  }

  // Preload all SKU master data in one query
  const skuMasterByCode = new Map();
  if (skuCodes.length > 0) {
    const skuPh = skuCodes.map(() => '?').join(',');
    const skuRows = _q(
      `SELECT product_name, model, brand, sku_code FROM skus WHERE sku_code IN (${skuPh})`,
      skuCodes
    ).rows;
    for (const r of skuRows) {
      skuMasterByCode.set(r.sku_code, r);
    }
  }

  const items = skuCodes.map(skuCode => {
    const ciEntry = ciSkuMap.get(skuCode);
    const batchEntry = batchSkuMap.get(skuCode);
    const batchQty = batchEntry ? batchEntry.batch_qty : 0;
    const weightedPrice = ciEntry ? ciEntry.weighted_purchase_unit_price : 0;
    const productCostOriginal = batchQty * weightedPrice;

    let productCostLocal = productCostOriginal;
    if (ciCurrency !== localCurrency && productFxRate) {
      productCostLocal = productCostOriginal * productFxRate.rate;
    } else if (ciCurrency === localCurrency) {
      productCostLocal = productCostOriginal;
    }

    const freightAllocated = freightAllocations ? (freightAllocations.get(skuCode) || 0) : 0;
    const dutyAllocated = dutyAllocations ? (dutyAllocations.get(skuCode) || 0) : 0;
    const inspectionAllocated = inspectionAllocations.get(skuCode) || 0;
    const otherAllocated = otherAllocations.get(skuCode) || 0;

    const totalLandingCostLocal = productCostLocal + freightAllocated + dutyAllocated + inspectionAllocated + otherAllocated;
    const unitLandingCost = batchQty > 0 ? totalLandingCostLocal / batchQty : 0;

    // Lookup from preloaded inventory Map
    const allInvRows = inventoryRowsBySku.get(skuCode) || [];
    const matchingInv = allInvRows.find(r =>
      countryAliasKey(r.country) === countryAliasKey(country2) &&
      String(r.warehouse || '').trim().replace(/\\s+/g, ' ').toLowerCase() ===
        String(warehouse || '').trim().replace(/\\s+/g, ' ').toLowerCase()
    );

    // C. WAC_INVENTORY_ROW_MISSING: SKU has no inventory rows at all — Confirm cannot create rows
    if (allInvRows.length === 0) {
      blockers.push({ code: 'WAC_INVENTORY_ROW_MISSING', message: `SKU ${skuCode} 在库存中无任何记录，Confirm 无法创建库存行`, detail: { sku_code: skuCode, country: country2, warehouse } });
    }

    // B. WAC_INVENTORY_CONTEXT_MISMATCH: SKU exists in inventory but in different context
    if (allInvRows.length > 0 && !matchingInv) {
      blockers.push({ code: 'WAC_INVENTORY_CONTEXT_MISMATCH', message: `SKU ${skuCode} 库存记录不在目标国家/仓库(${country2}/${warehouse})下`, detail: { sku_code: skuCode, expected_country: country2, expected_warehouse: warehouse, actual_contexts: allInvRows.map(r => `${r.country}/${r.warehouse}`) } });
    }

    // For pending batches, old quantity comes only from the user's per-confirmation upload,
    // never inventory.available_qty. For confirmed batches, restore the immutable snapshot
    // that was saved in wac_history at confirmation time.
    const historicalWac = wacHistoryBySku.get(skuCode) || null;
    const currentWac = historicalWac
      ? (Number(historicalWac.original_avg_cost) || 0)
      : (matchingInv ? (Number(matchingInv.weighted_avg_cost) || 0) : 0);

    // CURRENT_WAC_INVALID: weighted_avg_cost not finite or < 0
    if (matchingInv) {
      const wacNum = Number(matchingInv.weighted_avg_cost);
      if (!Number.isFinite(wacNum) || wacNum < 0) {
        blockers.push({ code: 'CURRENT_WAC_INVALID', message: `SKU ${skuCode} 的 weighted_avg_cost 无效: ${matchingInv.weighted_avg_cost}`, detail: { sku_code: skuCode, weighted_avg_cost: matchingInv.weighted_avg_cost } });
      }
    }

    // Lookup from preloaded SKU master Map
    const skuInfo = skuMasterByCode.get(skuCode);

    return {
      sku_code: skuCode,
      product_name: skuInfo ? (skuInfo.product_name || '') : '',
      model: skuInfo ? (skuInfo.model || '') : '',
      batch_qty: batchQty,
      cbm: batchEntry ? Math.round((Number(batchEntry.cbm)||0)*10000)/10000 : 0,
      gross_weight: batchEntry ? Math.round((Number(batchEntry.gross_weight)||0)*10000)/10000 : 0,
      weighted_purchase_unit_price: Math.round(weightedPrice * 10000) / 10000,
      customs_rate: ciEntry ? ciEntry.customs_rate : null,
      ci_shipped_qty: ciEntry ? ciEntry.shipped_qty : 0,
      ci_goods_amount: Math.round((ciEntry ? ciEntry.goods_amount : 0) * 10000) / 10000,
      product_cost_original: Math.round(productCostOriginal * 10000) / 10000,
      product_cost_local: Math.round(productCostLocal * 10000) / 10000,
      product_fx_rate: productFxRate ? productFxRate.rate : (ciCurrency === localCurrency ? 1 : null),
      product_fx_rate_date: productFxRate ? productFxRate.rate_date : (ciCurrency === localCurrency ? productFxDate : null),
      product_fx_rate_type: productFxRate ? productFxRate.rate_type : null,
      product_fx_rate_source: productFxRate ? (productFxRate.rate_type === 'identity' ? 'same_currency' : 'freight_payment_settlement') : null,
      product_fx_direction: productFxRate ? productFxRate.direction : null,
      freight_cost_local: Math.round(freightAllocated * 10000) / 10000,
      customs_cost_local: Math.round(dutyAllocated * 10000) / 10000,
      inspection_cost_local: Math.round(inspectionAllocated * 10000) / 10000,
      other_cost_local: Math.round(otherAllocated * 10000) / 10000,
      total_landing_cost_local: Math.round(totalLandingCostLocal * 10000) / 10000,
      unit_landing_cost: Math.round(unitLandingCost * 10000) / 10000,
      // Pending batches have no old_qty until the user uploads it. Confirmed batches
      // expose the exact historical snapshot saved during confirmation.
      old_qty: historicalWac ? Number(historicalWac.original_qty) : null,
      current_wac: currentWac,
      original_avg_cost: historicalWac ? Number(historicalWac.original_avg_cost) : null,
      original_inventory_value: historicalWac ? Number(historicalWac.original_inventory_value) : null,
      new_wac: historicalWac ? Number(historicalWac.new_avg_cost) : null,
      country: country2,
      warehouse: warehouse,
    };
  });

  // ── 14. Build meta ──
  const existingWac = wacHistoryRows.length > 0;
  const meta = {
    batch_id: batch.id,
    batch_no: batch.batch_no,
    ci_no: ci ? ci.ci_no : '',
    ci_id: ci ? ci.id : '',
    ci_currency: ciCurrency,
    freight_currency: freightCurrency,
    local_currency: localCurrency,
    actual_arrival_date: arrivalDate,
    transport_basis: transportBasis,
    country: targetCountry,
    warehouse: warehouse,
    logistics_status: batch.logistics_status,
    already_confirmed: existingWac,
    pl_id: pl ? pl.id : '',
    pl_no: pl ? pl.pl_no : '',
    pl_count: linkedPLs.length,
    freight_business_amount: freightBusinessAmount,
    freight_local_amount: Math.round(freightLocalAmount * 10000) / 10000,
    freight_effective_rate: freightEffectiveRate !== null ? Math.round(freightEffectiveRate * 10000) / 10000 : null,
    freight_last_paid_date: freightLastPaidDate,
    product_fx_rate_date: productFxDate,
    product_fx_rate: productFxRate ? productFxRate.rate : null,
    product_fx_rate_type: productFxRate ? productFxRate.rate_type : null,
    freight_payment_breakdown: freightPaymentBreakdown,
    shared_freight_breakdown: sharedFreightBreakdown,
    duty_business_amount: dutyBusinessAmount,
    duty_local_amount: Math.round(dutyLocalAmount * 10000) / 10000,
    inspection_local_total: Math.round(inspectionLocalTotal * 10000) / 10000,
    other_local_total: Math.round(otherLocalTotal * 10000) / 10000,
    ci_shipped_qty_total: ci_shipped_qty_total,
    ci_goods_amount_total: Math.round(ci_goods_amount_total * 10000) / 10000,
  };

  return { blockers, items, meta };
}

module.exports = { transportBasisForMode, computeWacCostFacts, resolveExactFxRate, allocateByWeight, WAC_MONETARY_TOLERANCE, WAC_FX_POLICIES, WAC_ALLOCATION_POLICIES, _getQueryCount: () => _wacQueryCount, _resetQueryCount: () => { _wacQueryCount = 0; } };
