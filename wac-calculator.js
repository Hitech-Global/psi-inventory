/**
 * WAC Shared Calculator (Phase 1 Design Freeze)
 *
 * Single source of truth for WAC cost computation.
 * Used by both /api/wac/preview and /api/wac/confirm endpoints in server.js.
 * Fail-closed: any data integrity issue produces a blocker; blockers > 0 → no DB writes.
 */

const { query, queryOne } = require('./db');

const WAC_FX_RATE_TYPE = 'realtime';
const WAC_MONETARY_TOLERANCE = 0.01;

const WAC_FX_POLICIES = {
  'inspection_fee/inspection': 'PAYMENT_DATE_FX',
};
const WAC_ALLOCATION_POLICIES = {
  'inspection_fee/inspection': 'BY_PRODUCT_COST',
};

// Exact-date FX resolver for WAC (purpose=INVENTORY_VALUATION).
// Does NOT expose payment settlement semantics. Only same-day direct or reverse-reciprocal.
// Returns null if no exact-date rate found — caller must produce a blocker.
function resolveExactFxRate(fromCurrency, toCurrency, date) {
  if (!date) return null;
  if (fromCurrency === toCurrency) {
    return { rate: 1, rate_date: date, rate_type: 'identity', direction: 'identity' };
  }
  const direct = queryOne(
    `SELECT * FROM exchange_rates
     WHERE from_currency = ? AND to_currency = ? AND rate_date = ? AND rate_type = ?
     ORDER BY created_at DESC, id DESC LIMIT 1`,
    [fromCurrency, toCurrency, date, WAC_FX_RATE_TYPE]
  );
  if (direct && Number(direct.rate) > 0) {
    return { rate: Number(direct.rate), rate_date: direct.rate_date, rate_type: direct.rate_type || '', direction: 'direct' };
  }
  const reverse = queryOne(
    `SELECT * FROM exchange_rates
     WHERE from_currency = ? AND to_currency = ? AND rate_date = ? AND rate_type = ?
     ORDER BY created_at DESC, id DESC LIMIT 1`,
    [toCurrency, fromCurrency, date, WAC_FX_RATE_TYPE]
  );
  if (reverse && Number(reverse.rate) > 0) {
    return { rate: 1 / Number(reverse.rate), rate_date: reverse.rate_date, rate_type: reverse.rate_type || '', direction: 'reverse' };
  }
  return null;
}

// Helper: allocate a total amount across SKUs by a given weight map, with remainder to max-weight SKU.
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

  // ── 1. Load batch ──
  const batch = queryOne('SELECT * FROM logistics_batches WHERE id = ?', [logisticsBatchId]);
  if (!batch) {
    blockers.push({ code: 'BATCH_NOT_FOUND', message: '物流批次不存在' });
    return { blockers, items: [], meta: {} };
  }

  // ── 2. Check PL count (exactly one) ──
  const linkedPLs = query('SELECT * FROM packing_lists WHERE logistics_batch_id = ?', [batch.id]).rows;
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
  const ci = ciId ? queryOne('SELECT * FROM commercial_invoices WHERE id = ?', [ciId]) : null;
  if (!ci) {
    blockers.push({ code: 'CI_MISSING', message: '未找到关联CI' });
    return { blockers, items: [], meta: { batch } };
  }

  // ── 4. Load CI items → compute per-SKU weighted purchase unit price ──
  const ciItems = query('SELECT * FROM commercial_invoice_items WHERE ci_id = ? ORDER BY created_at, id', [ci.id]).rows;
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
    ? query('SELECT * FROM packing_list_items WHERE pl_id = ? ORDER BY created_at, id', [pl.id]).rows
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
  let targetCountry = '';
  let localCurrency = '';
  const wh = warehouseName ? queryOne('SELECT * FROM warehouses WHERE name = ? OR id = ?', [warehouseName, warehouseName]) : null;
  if (wh) {
    if (wh.country_id) {
      const c = queryOne('SELECT * FROM countries WHERE id = ?', [wh.country_id]);
      if (c) {
        targetCountry = c.name || '';
        localCurrency = String(c.default_currency || '').trim();
      }
    }
    if (!localCurrency && wh.country_name) {
      const c = queryOne('SELECT * FROM countries WHERE name = ?', [wh.country_name]);
      if (c) {
        targetCountry = c.name || '';
        localCurrency = String(c.default_currency || '').trim();
      }
    }
  }
  if (!localCurrency) {
    blockers.push({ code: 'WAC_TARGET_CURRENCY_UNRESOLVED', message: `仓库「${warehouseName}」未关联国家或国家未配置本国货币` });
  }

  // ── 7. Arrival date + Product FX ──
  const arrivalDate = String(batch.actual_arrival_date || '').trim();
  if (!arrivalDate) {
    blockers.push({ code: 'PRODUCT_FX_DATE_MISSING', message: '物流批次缺少实际到货日期' });
  }

  const ciCurrency = String(ci.currency || 'USD').trim();
  let productFxRate = null;
  if (arrivalDate && localCurrency) {
    productFxRate = resolveExactFxRate(ciCurrency, localCurrency, arrivalDate);
    if (!productFxRate && ciCurrency !== localCurrency) {
      blockers.push({ code: 'PRODUCT_FX_RATE_MISSING', message: `缺少 ${arrivalDate} ${ciCurrency}→${localCurrency} 的 realtime 汇率` });
    }
  }

  // ── 8. Freight ──
  const freightBusinessAmount = Number(batch.total_freight) || 0;
  const freightCurrency = String(batch.freight_currency || 'USD').trim();
  let freightLocalAmount = 0;
  let freightEffectiveRate = null;
  let freightLastPaidDate = '';
  let freightPaymentBreakdown = [];

  if (freightBusinessAmount > 0) {
    // Batch-scoped query: ONLY this batch's freight cost items
    const freightCostItems = query(
      `SELECT id, payment_request_id, cost_category, cost_subcategory, payable_amount, currency, logistics_batch_id
       FROM ci_cost_items
       WHERE ci_id = ? AND logistics_batch_id = ? AND include_in_landing_cost = 1 AND cost_category = 'warehouse_arrival' AND cost_subcategory = 'freight'`,
      [ci.id, batch.id]
    ).rows;

    if (freightCostItems.length === 0) {
      // No batch-scoped freight cost items — check if unscoped/other-batch items exist
      const anyFreightItems = query(
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
        const freightPrs = query(`SELECT id, currency FROM payment_requests WHERE id IN (${ph})`, freightPrIds).rows;

        // C. Currency mismatch
        const currencyMismatch = freightPrs.some(pr => String(pr.currency || '').toUpperCase() !== freightCurrency.toUpperCase());
        if (currencyMismatch) {
          blockers.push({ code: 'FREIGHT_PAYMENT_CURRENCY_MISMATCH', message: `运费付款申请币种与freight_currency(${freightCurrency})不匹配` });
        }

        // Query ALL raw applied payment logs — no grouping, no deduplication
        const freightLogs = query(
          `SELECT payment_request_id, amount, local_amount, local_rate, local_rate_date, local_currency, paid_date
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
                !Number.isFinite(Number(log.local_rate)) || Number(log.local_rate) <= 0 ||
                !log.local_rate_date ||
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
                local_currency: log.local_currency || '',
                paid_date: log.paid_date || ''
              }));
              // Effective rate for display only — NOT first payment's rate
              if (freightCurrency !== localCurrency && freightBusinessAmount > 0) {
                freightEffectiveRate = freightLocalTotal / freightBusinessAmount;
              }
            }
          }
        }
      }
    }
  }

  // ── 9. Freight allocation by transport_basis ──
  let freightAllocations = null;
  const transportBasis = ci.transport_basis ? String(ci.transport_basis).trim() : '';
  if (freightLocalAmount > 0) {
    if (!['cbm', 'kg'].includes(transportBasis)) {
      blockers.push({ code: 'TRANSPORT_BASIS_MISSING', message: 'CI未设置运输计费基础(CBM或KG)' });
    } else {
      const basisField = transportBasis === 'cbm' ? 'cbm' : 'gross_weight';
      const basisLabel = transportBasis === 'cbm' ? 'CBM' : '毛重';
      const skuCodes = [...batchSkuMap.keys()];
      const weightMap = new Map();
      let hasMissingBasis = false;
      for (const sku of skuCodes) {
        const val = batchSkuMap.get(sku)[basisField];
        if (!Number.isFinite(val) || val < 0) {
          hasMissingBasis = true;
        }
        weightMap.set(sku, val);
      }
      if (hasMissingBasis) {
        blockers.push({ code: 'TRANSPORT_BASIS_DATA_MISSING', message: `以下SKU缺少PL ${basisLabel}数据` });
      } else {
        freightAllocations = allocateByWeight(skuCodes, weightMap, freightLocalAmount);
        if (!freightAllocations) {
          blockers.push({ code: 'TRANSPORT_BASIS_TOTAL_ZERO', message: `PL ${basisLabel}合计为0，无法分摊运费` });
        }
      }
    }
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
  const allCostItems = query(
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
      const logs = query(
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
  if (pl && ciItems.length > 0) {
    for (const [skuCode, ciEntry] of ciSkuMap) {
      const allFormalPlQty = queryOne(
        `SELECT COALESCE(SUM(pli.total_qty), 0) AS total
         FROM packing_list_items pli
         JOIN packing_lists pl ON pl.id = pli.pl_id
         WHERE pl.related_ci_id = ? AND pli.sku_code = ? AND COALESCE(pl.status, '') != 'draft'`,
        [ci.id, skuCode]
      );
      const allFormalQty = Number(allFormalPlQty?.total) || 0;

      if (allFormalQty === ciEntry.shipped_qty) {
        const allBatches = query(
          `SELECT lb.id FROM logistics_batches lb
           JOIN packing_lists pl ON pl.logistics_batch_id = lb.id
           WHERE lb.related_ci_id = ? AND COALESCE(pl.status, '') != 'draft'`,
          [ci.id]
        ).rows;
        let totalBatchProductCost = 0;
        for (const lbRow of allBatches) {
          const lbPl = queryOne(`SELECT id FROM packing_lists WHERE logistics_batch_id = ? AND COALESCE(status, '') != 'draft'`, [lbRow.id]);
          if (!lbPl) continue;
          const lbPlItems = query('SELECT sku_code, total_qty FROM packing_list_items WHERE pl_id = ? AND sku_code = ?', [lbPl.id, skuCode]).rows;
          const lbBatchQty = lbPlItems.reduce((s, i) => s + (Number(i.total_qty) || 0), 0);
          totalBatchProductCost += lbBatchQty * ciEntry.weighted_purchase_unit_price;
        }
        if (Math.abs(totalBatchProductCost - ciEntry.goods_amount) > WAC_MONETARY_TOLERANCE) {
          blockers.push({ code: 'PRODUCT_COST_ALLOCATION_NOT_CONSERVED', message: `SKU ${skuCode}: 各批次产品成本合计${totalBatchProductCost.toFixed(2)} ≠ CI货值${ciEntry.goods_amount.toFixed(2)}` });
        }
      }
    }
  }

  // ── 13. Build per-SKU result items ──
  const skuCodes = [...new Set([...ciSkuMap.keys(), ...batchSkuMap.keys()])];
  const country2 = targetCountry;
  const warehouse = warehouseName;

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

    // Query all inventory rows for this SKU to check context match
    const allInvRows = query('SELECT id, available_qty, weighted_avg_cost, country, warehouse FROM inventory WHERE sku_code = ?',
      [skuCode]).rows;
    const matchingInv = allInvRows.find(r =>
      String(r.country || '') === String(country2 || '') && String(r.warehouse || '') === String(warehouse || '')
    );

    // C. WAC_INVENTORY_ROW_MISSING: SKU has no inventory rows at all — Confirm cannot create rows
    if (allInvRows.length === 0) {
      blockers.push({ code: 'WAC_INVENTORY_ROW_MISSING', message: `SKU ${skuCode} 在库存中无任何记录，Confirm 无法创建库存行`, detail: { sku_code: skuCode, country: country2, warehouse } });
    }

    // B. WAC_INVENTORY_CONTEXT_MISMATCH: SKU exists in inventory but in different context
    if (allInvRows.length > 0 && !matchingInv) {
      blockers.push({ code: 'WAC_INVENTORY_CONTEXT_MISMATCH', message: `SKU ${skuCode} 库存记录不在目标国家/仓库(${country2}/${warehouse})下`, detail: { sku_code: skuCode, expected_country: country2, expected_warehouse: warehouse, actual_contexts: allInvRows.map(r => `${r.country}/${r.warehouse}`) } });
    }

    const currentWac = matchingInv ? (Number(matchingInv.weighted_avg_cost) || 0) : 0;
    const availableQty = matchingInv ? (Number(matchingInv.available_qty) || 0) : 0;

    // CURRENT_WAC_INVALID: weighted_avg_cost not finite or < 0
    if (matchingInv) {
      const wacNum = Number(matchingInv.weighted_avg_cost);
      if (!Number.isFinite(wacNum) || wacNum < 0) {
        blockers.push({ code: 'CURRENT_WAC_INVALID', message: `SKU ${skuCode} 的 weighted_avg_cost 无效: ${matchingInv.weighted_avg_cost}`, detail: { sku_code: skuCode, weighted_avg_cost: matchingInv.weighted_avg_cost } });
      }
    }

    const skuInfo = queryOne('SELECT product_name, model, brand FROM skus WHERE sku_code = ?', [skuCode]);

    return {
      sku_code: skuCode,
      product_name: skuInfo ? (skuInfo.product_name || '') : '',
      model: skuInfo ? (skuInfo.model || '') : '',
      batch_qty: batchQty,
      weighted_purchase_unit_price: Math.round(weightedPrice * 10000) / 10000,
      customs_rate: ciEntry ? ciEntry.customs_rate : null,
      ci_shipped_qty: ciEntry ? ciEntry.shipped_qty : 0,
      ci_goods_amount: Math.round((ciEntry ? ciEntry.goods_amount : 0) * 10000) / 10000,
      product_cost_original: Math.round(productCostOriginal * 10000) / 10000,
      product_cost_local: Math.round(productCostLocal * 10000) / 10000,
      product_fx_rate: productFxRate ? productFxRate.rate : (ciCurrency === localCurrency ? 1 : null),
      product_fx_direction: productFxRate ? productFxRate.direction : (ciCurrency === localCurrency ? 'identity' : null),
      freight_cost_local: Math.round(freightAllocated * 10000) / 10000,
      customs_cost_local: Math.round(dutyAllocated * 10000) / 10000,
      inspection_cost_local: Math.round(inspectionAllocated * 10000) / 10000,
      other_cost_local: Math.round(otherAllocated * 10000) / 10000,
      total_landing_cost_local: Math.round(totalLandingCostLocal * 10000) / 10000,
      unit_landing_cost: Math.round(unitLandingCost * 10000) / 10000,
      available_qty: availableQty,
      old_qty: availableQty,
      current_wac: currentWac,
      new_wac: (availableQty + batchQty) > 0
        ? Math.round(((availableQty * currentWac + batchQty * unitLandingCost) / (availableQty + batchQty)) * 10000) / 10000
        : Math.round(unitLandingCost * 10000) / 10000,
      country: country2,
      warehouse: warehouse,
    };
  });

  // ── 14. Build meta ──
  const existingWac = queryOne('SELECT 1 FROM wac_history WHERE logistics_batch_id = ? LIMIT 1', [batch.id]);
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
    already_confirmed: !!existingWac,
    pl_id: pl ? pl.id : '',
    pl_no: pl ? pl.pl_no : '',
    pl_count: linkedPLs.length,
    freight_business_amount: freightBusinessAmount,
    freight_local_amount: Math.round(freightLocalAmount * 10000) / 10000,
    freight_effective_rate: freightEffectiveRate !== null ? Math.round(freightEffectiveRate * 10000) / 10000 : null,
    freight_last_paid_date: freightLastPaidDate,
    freight_payment_breakdown: freightPaymentBreakdown,
    duty_business_amount: dutyBusinessAmount,
    duty_local_amount: Math.round(dutyLocalAmount * 10000) / 10000,
    inspection_local_total: Math.round(inspectionLocalTotal * 10000) / 10000,
    other_local_total: Math.round(otherLocalTotal * 10000) / 10000,
    ci_shipped_qty_total: ci_shipped_qty_total,
    ci_goods_amount_total: Math.round(ci_goods_amount_total * 10000) / 10000,
  };

  return { blockers, items, meta };
}

module.exports = { computeWacCostFacts, resolveExactFxRate, allocateByWeight, WAC_MONETARY_TOLERANCE, WAC_FX_POLICIES, WAC_ALLOCATION_POLICIES };
