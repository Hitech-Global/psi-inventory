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

const { resolveCiCustomsDutyCost, normalizeCurrency } = require('./ci-customs-duty-fx');

function dutyMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return NaN;
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

// Mirror the payment ledger's SSOT: reconciled transactions + legacy applied
// payment logs. Raw payment logs remain the FX evidence passed to the resolver.
function loadWacDutyPaymentFacts(payment) {
  const logs = _q(
    'SELECT * FROM payment_settlement_logs WHERE payment_request_id = ? ORDER BY created_at, id',
    [payment.id]
  ).rows;
  const paymentLogs = logs.filter(log => log.event_type === 'payment');
  const activePayments = paymentLogs.filter(log =>
    log.status === 'applied' && !String(log.reversed_at || '').trim()
  );
  const deductionLogs = logs.filter(log => log.event_type === 'deduction');
  const activeDeductions = deductionLogs.filter(log =>
    log.status === 'applied' && !String(log.reversed_at || '').trim()
  );
  const roundingLogs = logs.filter(log => log.event_type === 'rounding');
  const activeRoundings = roundingLogs.filter(log =>
    log.status === 'applied' && !String(log.reversed_at || '').trim()
  );
  const transactions = _q(
    "SELECT paid_amount_minor FROM payment_transactions WHERE payment_request_id = ? AND trans_status = 'reconciled'",
    [payment.id]
  ).rows;
  const transactionPaid = transactions.reduce((sum, row) =>
    sum + (Number(row.paid_amount_minor) || 0), 0) / 100;
  const legacyPaid = activePayments.filter(log => Number(log.is_legacy) === 1)
    .reduce((sum, log) => sum + (Number(log.amount) || 0), 0);
  const effectivePaid = dutyMoney(transactionPaid + legacyPaid);
  const effectiveDeduction = dutyMoney(deductionLogs.length
    ? activeDeductions.reduce((sum, log) => sum + (Number(log.amount) || 0), 0)
    : Number(payment.deduction_amount || 0));
  const effectiveRounding = dutyMoney(roundingLogs.length
    ? activeRoundings.reduce((sum, log) => sum + (Number(log.amount) || 0), 0)
    : Number(payment.rounding_amount || 0));
  const outstanding = dutyMoney(
    Number(payment.payable_amount || 0) - effectivePaid - effectiveDeduction - effectiveRounding
  );
  const latestPaymentDate = activePayments.reduce((latest, log) => {
    const paidDate = String(log.paid_date || '').slice(0, 10);
    return paidDate > latest ? paidDate : latest;
  }, '');
  return {
    logs,
    activePayments,
    effectivePaid,
    effectiveDeduction,
    effectiveRounding,
    outstanding,
    latestPaymentDate,
    hasReversal: logs.some(log =>
      log.status === 'reversed' || log.event_type === 'rounding_reversal'
    )
  };
}

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


function buildWacAllocationTrace(skuCodes, weightMap, totalAmount, allocationMap) {
  if (!allocationMap || !Array.isArray(skuCodes) || skuCodes.length === 0) return new Map();
  const totalWeight = skuCodes.reduce((sum, sku) => sum + (Number(weightMap.get(sku)) || 0), 0);
  if (!(totalWeight > 0)) return new Map();

  let anchorSku = null;
  let anchorTheoretical = -Infinity;
  for (const sku of skuCodes) {
    const weight = Number(weightMap.get(sku)) || 0;
    const theoretical = Number(totalAmount || 0) * (weight / totalWeight);
    if (theoretical > anchorTheoretical) {
      anchorTheoretical = theoretical;
      anchorSku = sku;
    }
  }

  const trace = new Map();
  for (const sku of skuCodes) {
    const weight = Number(weightMap.get(sku)) || 0;
    const ratio = weight / totalWeight;
    const theoretical = Number(totalAmount || 0) * ratio;
    const rounded = Math.round(theoretical * 10000) / 10000;
    const allocated = Number(allocationMap.get(sku)) || 0;
    trace.set(sku, {
      weight,
      total_weight: totalWeight,
      ratio,
      theoretical_amount: theoretical,
      rounded_amount: rounded,
      rounding_adjustment: Math.round((allocated - rounded) * 10000) / 10000,
      allocated_amount: allocated,
      remainder_anchor: sku === anchorSku
    });
  }
  return trace;
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
  let rmbToLocalEffectiveRate = null;
  let rmbToLocalRateDate = '';

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
          `SELECT payment_request_id, amount, original_currency, local_amount, local_rate, local_rate_date, local_currency, local_rate_type, local_rate_direction, paid_date,
                  rmb_rate, rmb_rate_date, rmb_rate_type, rmb_rate_direction, rmb_amount
           FROM payment_settlement_logs
           WHERE payment_request_id IN (${ph})
             AND event_type = 'payment' AND status = 'applied' AND COALESCE(reversed_at,'')=''
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
                original_currency: String(log.original_currency || '').trim().toUpperCase(),
                local_amount: Number(log.local_amount) || 0,
                local_rate: Number(log.local_rate) || 0,
                local_rate_date: log.local_rate_date || '',
                local_rate_type: log.local_rate_type || 'payment_settlement',
                local_rate_direction: log.local_rate_direction || '',
                local_currency: log.local_currency || '',
                paid_date: log.paid_date || '',
                rmb_rate: Number(log.rmb_rate) || 0,
                rmb_rate_date: log.rmb_rate_date || '',
                rmb_rate_type: log.rmb_rate_type || '',
                rmb_rate_direction: log.rmb_rate_direction || '',
                rmb_amount: Number(log.rmb_amount) || 0
              }));
              // Build the effective RMB→local snapshot from the same applied payment events.
              // Ratio of original-currency→local to original-currency→RMB rates avoids
              // using rounded settlement amounts and remains valid across source currencies.
              const completeRmbFx = freightLogs.every(log =>
                Number(log.amount) > 0 && Number(log.local_rate) > 0 && Number(log.rmb_rate) > 0 &&
                String(log.rmb_rate_date || '').slice(0, 10) === String(log.paid_date || '').slice(0, 10)
              );
              if (completeRmbFx) {
                const rmbEquivalentTotal = freightLogs.reduce((sum, log) =>
                  sum + (Number(log.amount) || 0) * (Number(log.rmb_rate) || 0), 0);
                const localEquivalentTotal = freightLogs.reduce((sum, log) =>
                  sum + (Number(log.amount) || 0) * (Number(log.local_rate) || 0), 0);
                if (rmbEquivalentTotal > 0 && localEquivalentTotal > 0) {
                  rmbToLocalEffectiveRate = localEquivalentTotal / rmbEquivalentTotal;
                  rmbToLocalRateDate = lastPaidDate;
                }
              }
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

  // ── 9. Freight allocation by logistics batch transport mode ──
  // The logistics batch is the source of truth: sea → CBM, air → gross weight (KG).
  // CI.transport_basis is legacy/manual data and must not block or override this rule.
  let freightAllocations = null;
  const freightAllocationDetailsBySku = new Map();
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
        if (freightAllocations) {
          const traceMap = buildWacAllocationTrace(skuCodes, weightMap, freightLocalAmount, freightAllocations);
          for (const [sku, trace] of traceMap) {
            freightAllocationDetailsBySku.set(sku, [{
              source_type: 'batch_freight',
              source_label: '本批次运费',
              basis: transportBasis,
              total_amount: freightLocalAmount,
              ...trace
            }]);
          }
        }
      }
    }
  }

  // Shared combined-batch delivery charge. One actual payment is apportioned to
  // batches BEFORE SKU WAC. Never treat the full common bill as each batch's freight.
  const sharedFreight = require('./shared-logistics-fee-server').sharedWacParts(batch.id, localCurrency);
  sharedFreight.errors.forEach(e => blockers.push(e));
  const sharedFreightBreakdown=[];
  const sharedFreightPaymentEvents=[];
  for(const part of sharedFreight.parts){
    sharedFreightPaymentEvents.push(...(part.payment_events||[]));
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
    const sharedTraceMap=buildWacAllocationTrace([...batchSkuMap.keys()],w,part.amount_minor/100,distributed);
    for(const [sku,trace] of sharedTraceMap){
      const current=freightAllocationDetailsBySku.get(sku)||[];
      current.push({
        source_type:'shared_freight',
        source_label:part.bill_no||'合并运费',
        basis:part.basis,
        total_amount:part.amount_minor/100,
        ...trace
      });
      freightAllocationDetailsBySku.set(sku,current);
    }
    if(!freightAllocations)freightAllocations=new Map();
    for(const [sku,amt] of distributed)freightAllocations.set(sku,(freightAllocations.get(sku)||0)+amt);
    freightLocalAmount+=part.amount_minor/100;
    if(part.last_paid_date>freightLastPaidDate)freightLastPaidDate=part.last_paid_date;
    sharedFreightBreakdown.push({fee_id:part.fee_id,bill_no:part.bill_no,
      freight_cost_local:part.amount_minor/100,basis:part.basis,basis_value:part.basis_value,
      payment_events:part.payment_events||[]});
  }

  // CI goods FX is anchored to the latest actual freight-payment completion date.
  // Include both batch-scoped freight payments and separately-paid shared delivery
  // bills; the latter are stored in shared_logistics_fees, not ci_cost_items.
  const freightSettlementEvents = [
    ...freightPaymentBreakdown,
    ...sharedFreightPaymentEvents
  ];
  productFxDate = String(freightLastPaidDate || '').slice(0, 10);
  if (ciCurrency === localCurrency) {
    productFxRate = { rate: 1, rate_date: productFxDate, rate_type: 'identity', direction: 'identity' };
  } else if (freightLocalAmount > 0 && productFxDate) {
    const latestEvents = freightSettlementEvents.filter(event =>
      String(event.paid_date || '').slice(0, 10) === productFxDate
    );
    let paymentSettlementRate = null;

    // RMB is the common reference currency in payment snapshots. For RMB-denominated
    // CI goods, derive RMB→warehouse currency from the immutable same-day settlement
    // amounts, even when the final freight payment itself was made in local currency.
    if (ciCurrency === 'RMB') {
      const rmbSnapshots = latestEvents.filter(event =>
        String(event.local_currency || '').trim().toUpperCase() === localCurrency &&
        String(event.local_rate_date || '').slice(0, 10) === productFxDate &&
        String(event.rmb_rate_date || '').slice(0, 10) === productFxDate &&
        Number(event.local_rate) > 0 && Number(event.rmb_rate) > 0 &&
        Number(event.local_amount) > 0 && Number(event.rmb_amount) > 0
      );
      // Use the immutable locked rate snapshots, not rounded settlement amounts.
      // Weight by each event's RMB-equivalent principal so the result matches the
      // established WAC cross-rate calculation (local_rate / rmb_rate).
      const localEquivalentTotal = rmbSnapshots.reduce((sum, event) =>
        sum + Number(event.amount) * Number(event.local_rate), 0);
      const rmbEquivalentTotal = rmbSnapshots.reduce((sum, event) =>
        sum + Number(event.amount) * Number(event.rmb_rate), 0);
      if (localEquivalentTotal > 0 && rmbEquivalentTotal > 0) {
        paymentSettlementRate = localEquivalentTotal / rmbEquivalentTotal;
        rmbToLocalEffectiveRate = paymentSettlementRate;
        rmbToLocalRateDate = productFxDate;
      }
    }

    // If the latest paid event was made in the CI currency, use its locked
    // local settlement amount/rate rather than looking up a mutable market quote.
    if (!(paymentSettlementRate > 0)) {
      const sameCurrencySnapshots = latestEvents.filter(event =>
        String(event.original_currency || '').trim().toUpperCase() === ciCurrency &&
        String(event.local_currency || '').trim().toUpperCase() === localCurrency &&
        String(event.local_rate_date || '').slice(0, 10) === productFxDate &&
        Number(event.amount) > 0 && Number(event.local_rate) > 0 && Number(event.local_amount) > 0
      );
      const paidTotal = sameCurrencySnapshots.reduce((sum, event) => sum + Number(event.amount), 0);
      const localTotal = sameCurrencySnapshots.reduce((sum, event) => sum + Number(event.local_amount), 0);
      if (paidTotal > 0 && localTotal > 0) paymentSettlementRate = localTotal / paidTotal;
    }

    // Legacy direct freight logs may predate the original_currency snapshot. Keep
    // their existing amount-weighted behavior as a compatibility fallback.
    if (!(paymentSettlementRate > 0) && freightCurrency === ciCurrency && freightEffectiveRate > 0) {
      paymentSettlementRate = freightEffectiveRate;
    }

    if (paymentSettlementRate > 0) {
      productFxRate = {
        rate: paymentSettlementRate,
        rate_date: productFxDate,
        rate_type: 'payment_settlement',
        direction: 'payment_settlement'
      };
    } else {
      // When no same-day settlement snapshot can express CI→local directly,
      // require an exact cost-settlement rate for the actual payment date.
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
        rate_date: productFxDate || null
      }
    });
  }

  // ── 10. Duty ──
  let dutyAllocations = null;
  const dutyAllocationDetailsBySku = new Map();
  let dutyCiLocalAmount = 0;
  let dutyLegacyFxRate = null;
  // New source of truth: CI Import Duty + its paid cost item/payment FX snapshot.
  // Legacy batch.customs_duty remains supported only when no CI-level duty exists.
  const legacyDutyBusinessAmount = Number(batch.customs_duty) || 0;
  const ciDutyBusinessTotal = Number(ci.import_duty_total) || 0;
  let dutyBusinessAmount = legacyDutyBusinessAmount;
  let dutyCurrency = freightCurrency;
  let dutyLocalAmount = 0;
  let dutyPaymentDate = '';
  let dutyFxBreakdown = [];
  let dutyConversionSource = legacyDutyBusinessAmount > 0 ? 'legacy_batch' : 'none';
  let dutyAllocationBasis = legacyDutyBusinessAmount > 0 ? 'batch_customs_duty' : 'none';
  let dutyBatchGoodsValue = 0;
  let dutyBatchGoodsRatio = 0;

  if (ciDutyBusinessTotal > 0) {
    if (legacyDutyBusinessAmount > 0) {
      blockers.push({
        code: 'DUTY_SOURCE_CONFLICT',
        message: 'CI关税与物流批次关税同时存在，可能重复计入；请先核对并保留一个关税来源',
        detail: { ci_duty: ciDutyBusinessTotal, batch_duty: legacyDutyBusinessAmount }
      });
    }

    const dutyItems = _q(
      `SELECT id, payment_request_id, cost_category, cost_subcategory, payable_amount, currency
       FROM ci_cost_items
       WHERE ci_id = ? AND include_in_landing_cost = 1
         AND cost_category = 'customs_duty' AND cost_subcategory = 'duty'
         AND COALESCE(payable_amount, 0) > 0
       ORDER BY created_at, id`,
      [ci.id]
    ).rows;

    let dutyConversion = null;
    if (dutyItems.length !== 1) {
      blockers.push({
        code: 'DUTY_COST_ITEM_MISSING_OR_AMBIGUOUS',
        message: 'CI有关税金额，但计入落地成本的 Import Duty 费用明细必须且只能有一笔',
        detail: { ci_duty: ciDutyBusinessTotal, matching_cost_items: dutyItems.length }
      });
    } else {
      const dutyItem = dutyItems[0];
      dutyCurrency = normalizeCurrency(dutyItem.currency || '');
      if (Math.abs(dutyMoney(dutyItem.payable_amount) - dutyMoney(ciDutyBusinessTotal)) > WAC_MONETARY_TOLERANCE) {
        blockers.push({
          code: 'DUTY_COST_AMOUNT_MISMATCH',
          message: 'CI关税汇总金额与关税成本明细金额不一致',
          detail: { ci_duty: ciDutyBusinessTotal, cost_item_amount: Number(dutyItem.payable_amount) || 0 }
        });
      } else if (!dutyItem.payment_request_id) {
        blockers.push({
          code: 'DUTY_PAYMENT_LINK_MISSING',
          message: 'CI关税成本明细缺少付款申请关联，不能用当前汇率代替实际付款汇率'
        });
      } else {
        const dutyPayment = _q1('SELECT * FROM payment_requests WHERE id = ?', [dutyItem.payment_request_id]);
        if (!dutyPayment) {
          blockers.push({ code: 'DUTY_PAYMENT_NOT_FOUND', message: '找不到CI关税关联的付款申请' });
        } else {
          const paymentCiId = String(dutyPayment.related_ci_id ||
            (dutyPayment.source_type === 'ci' ? dutyPayment.source_id : '') || '').trim();
          if (paymentCiId !== String(ci.id)) {
            blockers.push({
              code: 'DUTY_PAYMENT_CI_MISMATCH',
              message: '关税付款申请关联的CI与当前物流批次CI不一致'
            });
          } else if (normalizeCurrency(dutyItem.currency || dutyPayment.currency) !== normalizeCurrency(dutyPayment.currency)) {
            blockers.push({
              code: 'DUTY_PAYMENT_CURRENCY_MISMATCH',
              message: 'CI关税成本明细币种与付款申请币种不一致'
            });
          } else {
            const dutyPaymentFacts = loadWacDutyPaymentFacts(dutyPayment);
            dutyPaymentDate = dutyPaymentFacts.latestPaymentDate;
            try {
              dutyConversion = resolveCiCustomsDutyCost({
                ciCurrency,
                targetCurrency: localCurrency,
                dutyCurrency: dutyItem.currency || dutyPayment.currency,
                dutyAmount: ciDutyBusinessTotal,
                payment: dutyPayment,
                paymentFacts: dutyPaymentFacts
              });
              dutyCurrency = dutyConversion.original_currency;
              dutyFxBreakdown = dutyConversion.fx || [];
              dutyConversionSource = dutyConversion.conversion_source;
            } catch (error) {
              blockers.push({
                code: 'DUTY_PAYMENT_FACT_INVALID',
                message: error.message || '关税付款及汇率证据无效，无法计入WAC',
                detail: { payment_request_id: dutyPayment.id, paid_date: dutyPaymentFacts.latestPaymentDate || null }
              });
            }
          }
        }
      }
    }

    dutyCiLocalAmount = dutyConversion ? Number(dutyConversion.amount || 0) : 0;

    // CI-level duty is split across partial/multiple logistics batches by the
    // current batch's CI goods value. Unshipped CI value stays for later batches.
    const currentBatchSkuCodes = [...batchSkuMap.keys()];
    const batchCustomsWeightMap = new Map();
    const missingCustomsRates = [];
    for (const sku of currentBatchSkuCodes) {
      const ciEntry = ciSkuMap.get(sku);
      const batchEntry = batchSkuMap.get(sku);
      if (!ciEntry) {
        blockers.push({
          code: 'DUTY_BATCH_SKU_NOT_IN_CI',
          message: `物流批次SKU ${sku} 不存在于关联CI明细，无法分摊关税`,
          detail: { sku_code: sku }
        });
        continue;
      }
      const batchGoodsAmount = (Number(batchEntry.batch_qty) || 0) * (Number(ciEntry.weighted_purchase_unit_price) || 0);
      dutyBatchGoodsValue += batchGoodsAmount;
      if (ciEntry.customs_rate === null || ciEntry.customs_rate === undefined ||
          !Number.isFinite(Number(ciEntry.customs_rate)) || Number(ciEntry.customs_rate) < 0) {
        missingCustomsRates.push(sku);
      }
      batchCustomsWeightMap.set(
        sku,
        ciEntry.customs_rate !== null && ciEntry.customs_rate !== undefined && Number(ciEntry.customs_rate) > 0
          ? batchGoodsAmount * Number(ciEntry.customs_rate)
          : 0
      );
    }

    if (missingCustomsRates.length > 0) {
      blockers.push({
        code: 'CUSTOMS_RATE_MISSING',
        message: `以下SKU缺少本票实际关税税率: ${missingCustomsRates.join(', ')}`,
        detail: { sku_codes: missingCustomsRates }
      });
    }
    if (!(ci_goods_amount_total > 0)) {
      blockers.push({ code: 'DUTY_CI_GOODS_VALUE_ZERO', message: 'CI商品货值合计为0，无法按货值分摊关税' });
    } else if (!(dutyBatchGoodsValue > 0)) {
      blockers.push({ code: 'DUTY_BATCH_GOODS_VALUE_ZERO', message: '当前物流批次商品货值为0，无法分摊CI关税' });
    } else if (dutyBatchGoodsValue - ci_goods_amount_total > WAC_MONETARY_TOLERANCE) {
      blockers.push({
        code: 'DUTY_BATCH_GOODS_VALUE_EXCEEDS_CI',
        message: '当前物流批次商品货值超过CI总货值，请检查PL数量是否重复',
        detail: { batch_goods_value: dutyBatchGoodsValue, ci_goods_value: ci_goods_amount_total }
      });
    } else {
      dutyBatchGoodsRatio = Math.min(1, dutyBatchGoodsValue / ci_goods_amount_total);
      dutyBusinessAmount = dutyMoney(ciDutyBusinessTotal * dutyBatchGoodsRatio);
      dutyLocalAmount = dutyConversion
        ? dutyMoney(Number(dutyConversion.amount || 0) * dutyBatchGoodsRatio)
        : 0;
      dutyAllocationBasis = 'ci_goods_value';
      if (dutyConversion && dutyLocalAmount > 0 && missingCustomsRates.length === 0) {
        dutyAllocations = allocateByWeight(currentBatchSkuCodes, batchCustomsWeightMap, dutyLocalAmount);
        if (!dutyAllocations) {
          blockers.push({
            code: 'CUSTOMS_WEIGHT_ZERO',
            message: '当前物流批次SKU的实际关税税率权重合计为0，无法分摊关税'
          });
        }
        if (dutyAllocations) {
          const traceMap = buildWacAllocationTrace(currentBatchSkuCodes, batchCustomsWeightMap, dutyLocalAmount, dutyAllocations);
          for (const [sku, trace] of traceMap) {
            const ciEntry = ciSkuMap.get(sku);
            const batchEntry = batchSkuMap.get(sku);
            const skuGoodsValue = (Number(batchEntry && batchEntry.batch_qty) || 0) *
              (Number(ciEntry && ciEntry.weighted_purchase_unit_price) || 0);
            dutyAllocationDetailsBySku.set(sku, {
              source_type: 'ci_import_duty',
              source_currency: dutyCurrency,
              ci_duty_business_amount: ciDutyBusinessTotal,
              ci_duty_local_amount: dutyCiLocalAmount,
              ci_goods_amount_total,
              batch_goods_value: dutyBatchGoodsValue,
              batch_goods_ratio: dutyBatchGoodsRatio,
              batch_duty_local_amount: dutyLocalAmount,
              sku_goods_value: skuGoodsValue,
              customs_rate: ciEntry ? ciEntry.customs_rate : null,
              qty: batchEntry ? Number(batchEntry.batch_qty) || 0 : 0,
              ...trace
            });
          }
        }
      }
    }
  } else if (legacyDutyBusinessAmount > 0) {
    // Backward compatibility for old batches whose duty is recorded directly
    // on logistics_batches instead of CI cost items.
    dutyCurrency = freightCurrency;
    if (dutyCurrency !== localCurrency) {
      const dutyFxRate = resolveExactFxRate(dutyCurrency, localCurrency, arrivalDate, fxCache);
      if (dutyFxRate) {
        dutyLegacyFxRate = dutyFxRate.rate;
        dutyLocalAmount = legacyDutyBusinessAmount * dutyFxRate.rate;
      } else {
        blockers.push({
          code: 'DUTY_FX_MISSING',
          message: `关税${legacyDutyBusinessAmount}缺少 ${arrivalDate} ${dutyCurrency}→${localCurrency} 的汇率`
        });
      }
    } else {
      dutyLegacyFxRate = 1;
      dutyLocalAmount = legacyDutyBusinessAmount;
    }
    dutyCiLocalAmount = dutyLocalAmount;

    const skuCodes = [...ciSkuMap.keys()];
    const missingCustomsRates = skuCodes.filter(sku => {
      const ciEntry = ciSkuMap.get(sku);
      return ciEntry.customs_rate === null || ciEntry.customs_rate === undefined;
    });
    if (missingCustomsRates.length > 0) {
      blockers.push({
        code: 'CUSTOMS_RATE_MISSING',
        message: `以下SKU缺少实际关税税率: ${missingCustomsRates.join(', ')}`
      });
    }
    if (dutyLocalAmount > 0 && missingCustomsRates.length === 0) {
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
      if (dutyAllocations) {
        const traceMap = buildWacAllocationTrace(skuCodes, customsWeightMap, dutyLocalAmount, dutyAllocations);
        for (const [sku, trace] of traceMap) {
          const ciEntry = ciSkuMap.get(sku);
          dutyAllocationDetailsBySku.set(sku, {
            source_type: 'legacy_batch_duty',
            source_currency: dutyCurrency,
            source_business_amount: legacyDutyBusinessAmount,
            source_local_amount: dutyLocalAmount,
            legacy_fx_rate: dutyLegacyFxRate,
            ci_goods_amount_total,
            sku_goods_value: ciEntry ? ciEntry.goods_amount : 0,
            customs_rate: ciEntry ? ciEntry.customs_rate : null,
            qty: Number(batchSkuMap.get(sku)?.batch_qty) || 0,
            ...trace
          });
        }
      }
    }
  } else if (Number(ci.has_customs_duty) === 1) {
    blockers.push({
      code: 'DUTY_COST_MISSING',
      message: 'CI已标记有关税，但尚未录入有效的Import Duty金额，不能确认WAC'
    });
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
  const inspectionAllocationDetailsBySku = new Map();
  const otherAllocationDetailsBySku = new Map();
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
    let allocationWeightMap = null;
    if (allocPolicy === 'BY_PRODUCT_COST') {
      const weightMap = new Map();
      for (const sku of skuCodes) {
        weightMap.set(sku, ciSkuMap.get(sku).goods_amount);
      }
      allocationWeightMap = weightMap;
      allocMap = allocateByWeight(skuCodes, weightMap, localTotal);
    } else if (allocPolicy === 'BY_QTY') {
      const weightMap = new Map();
      for (const sku of skuCodes) {
        weightMap.set(sku, batchSkuMap.get(sku)?.batch_qty || 0);
      }
      allocationWeightMap = weightMap;
      allocMap = allocateByWeight(skuCodes, weightMap, localTotal);
    } else {
      blockers.push({ code: 'COST_ALLOCATION_POLICY_UNKNOWN', message: `成本项 ${policyKey} 的分摊策略 ${allocPolicy} 未实现` });
      continue;
    }

    if (!allocMap) {
      blockers.push({ code: 'COST_ALLOCATION_ZERO', message: `成本项 ${policyKey} 分摊权重合计为0` });
      continue;
    }
    
    const traceMap = buildWacAllocationTrace(skuCodes, allocationWeightMap, localTotal, allocMap);
    const isInspectionPolicy = policyKey.startsWith('inspection_fee');
    const detailTarget = isInspectionPolicy ? inspectionAllocationDetailsBySku : otherAllocationDetailsBySku;
    for (const [sku, trace] of traceMap) {
      const current = detailTarget.get(sku) || [];
      current.push({
        policy_key: policyKey,
        allocation_policy: allocPolicy,
        weight_basis: allocPolicy === 'BY_PRODUCT_COST' ? 'ci_goods_amount' : 'batch_qty',
        fee_total_local: localTotal,
        ...trace
      });
      detailTarget.set(sku, current);
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
  // Inventory/WAC validation is batch-scoped. Other CI SKUs may belong to a different PL/batch.
  const skuCodes = [...batchSkuMap.keys()];
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
      allocation_details: {
        freight: freightAllocationDetailsBySku.get(skuCode) || [],
        duty: dutyAllocationDetailsBySku.get(skuCode) || null,
        inspection: inspectionAllocationDetailsBySku.get(skuCode) || [],
        other: otherAllocationDetailsBySku.get(skuCode) || []
      },
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
    rmb_to_local_rate: rmbToLocalEffectiveRate !== null ? Math.round(rmbToLocalEffectiveRate * 100000000) / 100000000 : null,
    rmb_to_local_rate_date: rmbToLocalRateDate,
    product_fx_rate_date: productFxDate,
    product_fx_rate: productFxRate ? productFxRate.rate : null,
    product_fx_rate_type: productFxRate ? productFxRate.rate_type : null,
    freight_payment_breakdown: freightPaymentBreakdown,
    shared_freight_breakdown: sharedFreightBreakdown,
    duty_business_amount: dutyBusinessAmount,
    duty_ci_business_total: Math.round(ciDutyBusinessTotal * 10000) / 10000,
    duty_ci_local_amount: Math.round(dutyCiLocalAmount * 10000) / 10000,
    duty_legacy_fx_rate: dutyLegacyFxRate !== null ? dutyLegacyFxRate : null,
    duty_currency: dutyCurrency,
    duty_local_amount: Math.round(dutyLocalAmount * 10000) / 10000,
    duty_payment_date: dutyPaymentDate,
    duty_fx_breakdown: dutyFxBreakdown,
    duty_conversion_source: dutyConversionSource,
    duty_allocation_basis: dutyAllocationBasis,
    duty_batch_goods_value: Math.round(dutyBatchGoodsValue * 10000) / 10000,
    duty_batch_goods_ratio: Math.round(dutyBatchGoodsRatio * 1000000) / 1000000,
    inspection_local_total: Math.round(inspectionLocalTotal * 10000) / 10000,
    other_local_total: Math.round(otherLocalTotal * 10000) / 10000,
    ci_shipped_qty_total: ci_shipped_qty_total,
    ci_goods_amount_total: Math.round(ci_goods_amount_total * 10000) / 10000,
  };

  return { blockers, items, meta };
}

module.exports = { transportBasisForMode, computeWacCostFacts, resolveExactFxRate, allocateByWeight, buildWacAllocationTrace, WAC_MONETARY_TOLERANCE, WAC_FX_POLICIES, WAC_ALLOCATION_POLICIES, _getQueryCount: () => _wacQueryCount, _resetQueryCount: () => { _wacQueryCount = 0; } };
