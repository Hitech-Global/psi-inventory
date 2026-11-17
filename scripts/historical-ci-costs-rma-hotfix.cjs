'use strict';
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const ROOT = path.join(__dirname, '..');
const SERVER = path.join(ROOT, 'server.js');
const APP = path.join(ROOT, 'app.js');
const I18N = path.join(ROOT, 'i18n.js');
const INDEX = path.join(ROOT, 'index.html');
const SERVER_MARKER = '// HCI-COSTS-RMA-SERVER-V1';
const APP_MARKER = '// HCI-COSTS-RMA-UI-V1';
const I18N_MARKER = '// HCI-COSTS-RMA-I18N-V1';
const INDEX_MARKER = '<!-- HCI-COSTS-RMA-CACHE-V1 -->';
const TICK = String.fromCharCode(96);

function replaceOnce(src, oldText, newText, label) {
  const first = src.indexOf(oldText);
  if (first < 0) throw new Error('[HCI-COSTS-RMA] missing anchor: ' + label);
  if (src.indexOf(oldText, first + oldText.length) >= 0) throw new Error('[HCI-COSTS-RMA] ambiguous anchor: ' + label);
  return src.slice(0, first) + newText + src.slice(first + oldText.length);
}
function replaceRange(src, startText, endText, replacement, label) {
  const start = src.indexOf(startText);
  if (start < 0) throw new Error('[HCI-COSTS-RMA] missing start: ' + label);
  const end = src.indexOf(endText, start + startText.length);
  if (end < 0) throw new Error('[HCI-COSTS-RMA] missing end: ' + label);
  return src.slice(0, start) + replacement + src.slice(end);
}

function patchServer(src) {
  if (src.includes(SERVER_MARKER)) return src;
  src = replaceOnce(src, '  initDatabase();', [
    '  initDatabase();',
    '  // HCI-COSTS-RMA-V1：历史 CI 运费/关税/RMA 字段幂等迁移；不触碰运营 CI、WAC 或库存。',
    '  try {',
    "    const migration = require('./migrations/historical-ci-costs-rma').ensureHistoricalCICostsRmaColumns(",
    "      run, query, (process.env.DB_DRIVER || 'sqlite').toLowerCase() === 'pg'",
    '    );',
    "    console.log('[STARTUP] historical CI cost/RMA fields ready: ' + migration.added.join(', '));",
    '  } catch (e) {',
    "    console.error('[FATAL] historical CI cost/RMA migration failed:', e.message);",
    '    process.exit(1);',
    '  }'
  ].join('\n'), 'startup migration');

  src = replaceOnce(src,
    "const HCI_AMOUNT_FIELDS = ['gross_goods_amount','historical_paid_amount','subsequent_paid_amount','deduction_amount','rounding_amount','unpaid_amount'];",
    "const HCI_AMOUNT_FIELDS = ['gross_goods_amount','historical_paid_amount','subsequent_paid_amount','deduction_amount','rounding_amount','unpaid_amount','historical_freight_amount','historical_customs_duty_amount','historical_customs_duty_rmb_amount','historical_customs_duty_exchange_rate'];",
    'historical amount redaction fields');

  src = replaceOnce(src,
    "  const historicalCiNo = String(historicalCIField(body, 'historical_ci_no', '历史CI编号', 'CI编号') || '').trim();\n  if (!historicalCiNo) throw new SettlementError(400, '历史 CI 编号不能为空');",
    "  const historicalCiNo = String(historicalCIField(body, 'historical_ci_no', '历史CI编号', 'CI编号') || '').trim();\n  if (!historicalCiNo) throw new SettlementError(400, '历史 CI 编号不能为空');\n  const rawRma = historicalCIField(body, 'is_rma', '是否RMA', 'RMA');\n  const isRma = rawRma === true || rawRma === 1 || String(rawRma || '').trim().toLowerCase() === 'true' || /^HWQDRMA/i.test(historicalCiNo);",
    'RMA flag normalization');

  src = replaceOnce(src,
    "  const actualShipDate = historicalCIDate(historicalCIField(body, 'actual_ship_date', '实际出货日期'), '实际出货日期', true);",
    "  const actualShipDate = historicalCIDate(historicalCIField(body, 'actual_ship_date', '实际出货日期'), '实际出货日期', !isRma);",
    'RMA actual ship date validation');

  src = replaceOnce(src,
    "  const grossGoodsAmount = settlementMoney(historicalCIField(body, 'gross_goods_amount', '历史货款总金额', '总货款'));\n  const historicalPaidAmount = settlementMoney(historicalCIField(body, 'historical_paid_amount', '历史已付款', '已付款') || 0);\n  if (!(grossGoodsAmount > 0)) throw new SettlementError(400, '历史货款总金额必须大于0');",
    [
      "  const grossGoodsAmount = settlementMoney(historicalCIField(body, 'gross_goods_amount', '历史货款总金额', '总货款'));",
      "  const historicalPaidAmount = settlementMoney(historicalCIField(body, 'historical_paid_amount', '历史已付款', '已付款') || 0);",
      "  const rawFreightAmount = historicalCIField(body, 'historical_freight_amount', '历史总运费', 'freight_amount');",
      "  const historicalFreightAmount = rawFreightAmount === '' || rawFreightAmount === null || rawFreightAmount === undefined ? null : settlementMoney(rawFreightAmount);",
      "  const historicalFreightCurrency = String(historicalCIField(body, 'historical_freight_currency', '历史运费币种', 'freight_currency') || '').trim().toUpperCase();",
      "  const rawDutyAmount = historicalCIField(body, 'historical_customs_duty_amount', '历史关税金额', 'customs_duty_amount');",
      "  const historicalCustomsDutyAmount = rawDutyAmount === '' || rawDutyAmount === null || rawDutyAmount === undefined ? null : settlementMoney(rawDutyAmount);",
      "  const historicalCustomsDutyCurrency = String(historicalCIField(body, 'historical_customs_duty_currency', '历史关税币种', 'customs_duty_currency') || '').trim().toUpperCase();",
      "  const rawDutyRmb = historicalCIField(body, 'historical_customs_duty_rmb_amount', '关税人民币参考金额', 'customs_duty_rmb_amount');",
      "  const historicalCustomsDutyRmbAmount = rawDutyRmb === '' || rawDutyRmb === null || rawDutyRmb === undefined ? null : settlementMoney(rawDutyRmb);",
      "  const rawDutyRate = historicalCIField(body, 'historical_customs_duty_exchange_rate', '关税结算汇率', 'customs_duty_exchange_rate');",
      "  const historicalCustomsDutyExchangeRate = rawDutyRate === '' || rawDutyRate === null || rawDutyRate === undefined ? null : Number(rawDutyRate);",
      "  const clearanceType = String(historicalCIField(body, 'clearance_type', '清关方式') || '').trim();",
      "  if (!(grossGoodsAmount > 0) && !(isRma && grossGoodsAmount === 0)) throw new SettlementError(400, '历史货款总金额必须大于0；零货值仅允许 RMA');",
      "  if (isRma && grossGoodsAmount < 0) throw new SettlementError(400, 'RMA 货值不能小于0');",
      "  if (historicalFreightAmount !== null && (!Number.isFinite(historicalFreightAmount) || historicalFreightAmount < 0)) throw new SettlementError(400, '历史总运费不能小于0');",
      "  if (historicalFreightAmount !== null && historicalFreightAmount > 0) {",
      "    const freightCurrencyRow = queryOne(\"SELECT code FROM currencies WHERE code = ? AND status = 'active'\", [historicalFreightCurrency]);",
      "    if (!freightCurrencyRow) throw new SettlementError(400, '历史运费币种不存在或已停用');",
      "  }",
      "  if (historicalCustomsDutyAmount !== null && (!Number.isFinite(historicalCustomsDutyAmount) || historicalCustomsDutyAmount < 0)) throw new SettlementError(400, '历史关税不能小于0');",
      "  if (historicalCustomsDutyAmount !== null && historicalCustomsDutyAmount > 0) {",
      "    const dutyCurrencyRow = queryOne(\"SELECT code FROM currencies WHERE code = ? AND status = 'active'\", [historicalCustomsDutyCurrency]);",
      "    if (!dutyCurrencyRow) throw new SettlementError(400, '历史关税币种不存在或已停用');",
      "  }",
      "  if (historicalCustomsDutyRmbAmount !== null && (!Number.isFinite(historicalCustomsDutyRmbAmount) || historicalCustomsDutyRmbAmount < 0)) throw new SettlementError(400, '关税人民币参考金额不能小于0');",
      "  if (historicalCustomsDutyExchangeRate !== null && (!Number.isFinite(historicalCustomsDutyExchangeRate) || historicalCustomsDutyExchangeRate <= 0)) throw new SettlementError(400, '关税结算汇率必须大于0');",
      "  if (!['', 'formal', 'non_formal'].includes(clearanceType)) throw new SettlementError(400, '历史 CI 清关方式只能为正清或非正清');"
    ].join('\n'),
    'historical costs and zero-value RMA validation');

  src = replaceOnce(src,
    "  const normalized = {\n    historical_ci_no: historicalCiNo,\n    supplier_id: supplierId,\n    supplier_name: supplierName,\n    supplier_identity: supplierName.trim().toLowerCase(),\n    brand_id: brandId,\n    brand_name: brandName || brandId,\n    country,\n    ci_date: ciDate,\n    actual_ship_date: actualShipDate,\n    currency,\n    gross_goods_amount: grossGoodsAmount,\n    historical_paid_amount: historicalPaidAmount,\n    historical_paid_date: historicalPaidDate,\n    payment_terms: String(historicalCIField(body, 'payment_terms', '付款条件') || '').trim(),\n    due_date: dueDate || '',\n    payment_term_id: explicitPaymentTermId,\n    credit_days: creditDays,\n    source_note: String(historicalCIField(body, 'source_note', '原始凭证或备注', '备注') || '').trim(),\n    source_mode: 'historical'\n  };",
    [
      '  const normalized = {',
      '    historical_ci_no: historicalCiNo,',
      '    supplier_id: supplierId,',
      '    supplier_name: supplierName,',
      '    supplier_identity: supplierName.trim().toLowerCase(),',
      '    brand_id: brandId,',
      '    brand_name: brandName || brandId,',
      '    country,',
      '    ci_date: ciDate,',
      "    actual_ship_date: actualShipDate || '',",
      '    currency,',
      '    gross_goods_amount: grossGoodsAmount,',
      '    historical_paid_amount: historicalPaidAmount,',
      '    historical_paid_date: historicalPaidDate,',
      "    payment_terms: String(historicalCIField(body, 'payment_terms', '付款条件') || '').trim(),",
      "    due_date: dueDate || '',",
      '    payment_term_id: explicitPaymentTermId,',
      '    credit_days: creditDays,',
      "    source_note: String(historicalCIField(body, 'source_note', '原始凭证或备注', '备注') || '').trim(),",
      '    clearance_type: clearanceType,',
      '    is_rma: isRma,',
      '    historical_freight_amount: historicalFreightAmount,',
      '    historical_freight_currency: historicalFreightCurrency,',
      '    historical_customs_duty_amount: historicalCustomsDutyAmount,',
      '    historical_customs_duty_currency: historicalCustomsDutyCurrency,',
      '    historical_customs_duty_rmb_amount: historicalCustomsDutyRmbAmount,',
      '    historical_customs_duty_exchange_rate: historicalCustomsDutyExchangeRate,',
      "    source_mode: 'historical'",
      '  };'
    ].join('\n'),
    'normalized historical CI payload');

  src = replaceOnce(src,
    "    const paymentRequestId = genId('pay');",
    "    const isZeroValueRma = normalized.is_rma && normalized.gross_goods_amount === 0;\n    const paymentRequestId = isZeroValueRma ? '' : genId('pay');",
    'RMA payment request identity');

  src = replaceOnce(src,
    "    const hciLinkedPiIds = [...new Set([\n      ...(Array.isArray(body.related_pi_ids) ? body.related_pi_ids : []),\n      ...(Array.isArray(body.items) ? body.items : []).map(i => i && i.pi_id).filter(Boolean)\n    ])];",
    "    const hciLinkedPiIds = normalized.is_rma ? [] : [...new Set([\n      ...(Array.isArray(body.related_pi_ids) ? body.related_pi_ids : []),\n      ...(Array.isArray(body.items) ? body.items : []).map(i => i && i.pi_id).filter(Boolean)\n    ])];",
    'RMA PI isolation');

  const oldHeaderInsert = [
    '    run(' + TICK + 'INSERT INTO historical_commercial_invoices',
    '         (id, historical_ci_no, supplier_id, supplier_name, supplier_identity, brand_id, brand_name,',
    '          country, ci_date, actual_ship_date, payment_term_id, credit_days, currency, gross_goods_amount, historical_paid_amount, historical_paid_date,',
    '          payment_terms, due_date, source_note, source_mode, idempotency_key, payload_hash,',
    '          created_by, created_by_name)',
    '         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ' + "'historical'" + ', ?, ?, ?, ?)' + TICK + ',',
    '      [historicalId, normalized.historical_ci_no, normalized.supplier_id, normalized.supplier_name,',
    '        normalized.supplier_identity, normalized.brand_id, normalized.brand_name, normalized.country,',
    '        normalized.ci_date, normalized.actual_ship_date, normalized.payment_term_id, normalized.credit_days, normalized.currency, normalized.gross_goods_amount, normalized.historical_paid_amount,',
    '        normalized.historical_paid_date, normalized.payment_terms, normalized.due_date, normalized.source_note,',
    '        normalized.idempotency_key, normalized.payload_hash, operator.id, operator.name]);'
  ].join('\n');
  const newHeaderInsert = [
    "    run('INSERT INTO historical_commercial_invoices ' +",
    "        '(id, historical_ci_no, supplier_id, supplier_name, supplier_identity, brand_id, brand_name, ' +",
    "        'country, ci_date, actual_ship_date, payment_term_id, credit_days, currency, gross_goods_amount, historical_paid_amount, historical_paid_date, ' +",
    "        'payment_terms, due_date, source_note, source_mode, clearance_type, is_rma, historical_freight_amount, historical_freight_currency, ' +",
    "        'historical_customs_duty_amount, historical_customs_duty_currency, historical_customs_duty_rmb_amount, historical_customs_duty_exchange_rate, ' +",
    "        'idempotency_key, payload_hash, created_by, created_by_name) ' +",
    "        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, \\'historical\\', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',",
    '      [historicalId, normalized.historical_ci_no, normalized.supplier_id, normalized.supplier_name,',
    '        normalized.supplier_identity, normalized.brand_id, normalized.brand_name, normalized.country,',
    '        normalized.ci_date, normalized.actual_ship_date, normalized.payment_term_id, normalized.credit_days, normalized.currency, normalized.gross_goods_amount, normalized.historical_paid_amount,',
    '        normalized.historical_paid_date, normalized.payment_terms, normalized.due_date, normalized.source_note,',
    '        normalized.clearance_type || null, normalized.is_rma, normalized.historical_freight_amount, normalized.historical_freight_currency,',
    '        normalized.historical_customs_duty_amount, normalized.historical_customs_duty_currency, normalized.historical_customs_duty_rmb_amount, normalized.historical_customs_duty_exchange_rate,',
    '        normalized.idempotency_key, normalized.payload_hash, operator.id, operator.name]);'
  ].join('\n');
  src = replaceOnce(src, oldHeaderInsert, newHeaderInsert, 'historical CI header insert');

  src = replaceOnce(src,
    "    const historicalPayeeKey = `supplier:${normalized.supplier_id || normalized.supplier_name}`;",
    "    if (!isZeroValueRma) {" + String.fromCharCode(10) + "    const historicalPayeeKey = `supplier:${normalized.supplier_id || normalized.supplier_name}`;",
    'skip RMA payment creation');
  src = replaceOnce(src,
    '    // Historical CI with PI linkage: update PI shipped/unshipped quantities and ship status',
    '    }\n\n    // Historical CI with PI linkage: update PI shipped/unshipped quantities and ship status',
    'close RMA payment branch');

  src = replaceOnce(src,
    '      const piIds = [...new Set(hciItems.map(i => i.pi_id))];',
    "      const piIds = [...new Set(hciItems.map(i => String(i && i.pi_id || '').trim()).filter(Boolean))];",
    'ignore manual snapshot rows for PI updates');

  const oldSnapshotBlock = [
    '    // 保存 SKU 级成交价格快照（后端计算，不信任前端传值）',
    '    if (hciItems.length > 0) {',
    '      for (const item of hciItems) {',
    '        const qty = item.shipped_qty || 0;',
    '        if (qty <= 0) continue;',
    "        const priceRow = queryOne('SELECT unit_price, discount FROM proforma_invoice_items WHERE pi_id = ? AND sku_code = ?', [item.pi_id, item.sku_code]);",
    '        if (!priceRow) continue;',
    '        const up = priceRow.unit_price || 0;',
    '        const disc = priceRow.discount || 0;',
    '        const netUp = up * (1 - disc);',
    '        const ciAmt = qty * netUp;',
    "        const piRow = queryOne('SELECT pi_no FROM proforma_invoices WHERE id = ?', [item.pi_id]);",
    '        run(',
    '          ' + TICK + 'INSERT INTO historical_commercial_invoice_items',
    '           (id, hci_id, hci_no, pi_id, pi_no, sku_code, shipped_qty, unit_price, discount, net_unit_price, ci_amount)',
    '           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)' + TICK + ',',
    "          [genId('hcii'), historicalId, normalized.historical_ci_no,",
    "           item.pi_id || '', piRow ? piRow.pi_no : '', item.sku_code,",
    '           qty, up, disc, netUp, ciAmt]',
    '        );',
    '      }',
    '    }'
  ].join('\n');
  const newSnapshotBlock = [
    '    // 保存 SKU 成交价格快照。有关联 PI 时沿用 PI 原始快照；无 PI 时保存 Excel/手工提供的历史行，不回写 PI。',
    '    if (hciItems.length > 0) {',
    '      for (const item of hciItems) {',
    "        const piId = String(item && item.pi_id || '').trim();",
    "        const skuCode = String(item && item.sku_code || '').trim();",
    '        const qty = Math.max(0, parseInt(item && item.shipped_qty, 10) || 0);',
    "        if (!skuCode) throw new SettlementError(400, '历史 CI SKU 不能为空');",
    '        if (piId) {',
    '          if (qty <= 0) continue;',
    "          const priceRow = queryOne('SELECT unit_price, discount FROM proforma_invoice_items WHERE pi_id = ? AND sku_code = ?', [piId, skuCode]);",
    '          if (!priceRow) continue;',
    '          const up = priceRow.unit_price || 0;',
    '          const disc = priceRow.discount || 0;',
    '          const netUp = up * (1 - disc);',
    '          const ciAmt = qty * netUp;',
    "          const piRow = queryOne('SELECT pi_no FROM proforma_invoices WHERE id = ?', [piId]);",
    '          run(',
    "            'INSERT INTO historical_commercial_invoice_items (id, hci_id, hci_no, pi_id, pi_no, sku_code, shipped_qty, unit_price, discount, net_unit_price, ci_amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',",
    "            [genId('hcii'), historicalId, normalized.historical_ci_no, piId, piRow ? piRow.pi_no : '', skuCode, qty, up, disc, netUp, ciAmt]",
    '          );',
    '        } else {',
    '          const up = Number(item.unit_price || 0);',
    '          const disc = Number(item.discount || 0);',
    "          const netUp = item.net_unit_price === null || item.net_unit_price === undefined || item.net_unit_price === '' ? up * (1 - disc) : Number(item.net_unit_price);",
    "          const ciAmt = item.ci_amount === null || item.ci_amount === undefined || item.ci_amount === '' ? qty * netUp : Number(item.ci_amount);",
    '          if (![up, disc, netUp, ciAmt].every(Number.isFinite) || up < 0 || disc < 0 || disc > 1 || netUp < 0 || ciAmt < 0) {',
    "            throw new SettlementError(400, '历史 CI SKU 金额或折扣数据无效：' + skuCode);",
    '          }',
    "          const piNo = String(item.pi_no || '').trim();",
    '          run(',
    "            'INSERT INTO historical_commercial_invoice_items (id, hci_id, hci_no, pi_id, pi_no, sku_code, shipped_qty, unit_price, discount, net_unit_price, ci_amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',",
    "            [genId('hcii'), historicalId, normalized.historical_ci_no, '', piNo, skuCode, qty, up, disc, netUp, ciAmt]",
    '          );',
    '        }',
    '      }',
    '    }'
  ].join('\n');
  src = replaceOnce(src, oldSnapshotBlock, newSnapshotBlock, 'manual SKU snapshot insert');

  src = replaceOnce(src,
    '    const settlement = recalculatePaymentSettlement(paymentRequestId);',
    '    const settlement = isZeroValueRma ? null : recalculatePaymentSettlement(paymentRequestId);',
    'RMA settlement skip');
  src = replaceOnce(src,
    '      outstanding: settlement.outstanding,\n      payment_status: settlement.payment_status',
    "      outstanding: settlement ? settlement.outstanding : 0,\n      payment_status: settlement ? settlement.payment_status : 'not_applicable'",
    'RMA payment result');
  src = replaceOnce(src,
    "  updateInventoryTransitDataAsync().catch(err => console.warn('[createHistoricalCI] 在途数据刷新失败（事务已提交）:', err && err.message));",
    "  const hasLinkedPi = (Array.isArray(body.related_pi_ids) && body.related_pi_ids.length > 0) || (Array.isArray(body.items) && body.items.some(i => i && String(i.pi_id || '').trim()));\n  if (hasLinkedPi) updateInventoryTransitDataAsync().catch(err => console.warn('[createHistoricalCI] 在途数据刷新失败（事务已提交）:', err && err.message));",
    'avoid recalculation for unlinked historical snapshots');

  src = replaceOnce(src,
    "historical.items = query('SELECT sku_code, shipped_qty, unit_price, discount, net_unit_price, ci_amount FROM historical_commercial_invoice_items WHERE hci_id = ? ORDER BY created_at, id', [req.params.id]).rows;",
    "historical.items = query('SELECT sku_code, pi_no, shipped_qty, unit_price, discount, net_unit_price, ci_amount FROM historical_commercial_invoice_items WHERE hci_id = ? ORDER BY created_at, id', [req.params.id]).rows;",
    'historical detail PI source snapshot');

  src = replaceOnce(src,
    "  const hci = queryOne('SELECT id, historical_ci_no, historical_paid_amount, gross_goods_amount FROM historical_commercial_invoices WHERE id = ?', [hciId]);\n  if (!hci) return null;",
    "  const hci = queryOne('SELECT id, historical_ci_no, historical_paid_amount, gross_goods_amount, is_rma FROM historical_commercial_invoices WHERE id = ?', [hciId]);\n  if (!hci) return null;\n  if ((hci.is_rma === true || Number(hci.is_rma) === 1) && Number(hci.gross_goods_amount || 0) <= 0) {\n    return { subsequent_paid_amount: 0, deduction_amount: 0, rounding_amount: 0, unpaid_amount: 0, payment_status: 'not_applicable' };\n  }",
    'single RMA payment facts');

  const phToken = '$' + '{ph}';
  const oldBulkQuery = TICK + 'SELECT id, historical_paid_amount, gross_goods_amount FROM historical_commercial_invoices WHERE id IN (' + phToken + ')' + TICK;
  const newBulkQuery = TICK + 'SELECT id, historical_paid_amount, gross_goods_amount, is_rma FROM historical_commercial_invoices WHERE id IN (' + phToken + ')' + TICK;
  src = replaceOnce(src, oldBulkQuery, newBulkQuery, 'bulk RMA payment facts query');
  src = replaceOnce(src,
    "    const hci = hciById.get(hciId);\n    if (!hci) continue; // 单条版对不存在返回 null；批量 Map 直接不含该 key\n    const items = itemsByHci.get(hciId) || [];",
    "    const hci = hciById.get(hciId);\n    if (!hci) continue; // 单条版对不存在返回 null；批量 Map 直接不含该 key\n    if ((hci.is_rma === true || Number(hci.is_rma) === 1) && Number(hci.gross_goods_amount || 0) <= 0) {\n      map.set(hciId, { subsequent_paid_amount: 0, deduction_amount: 0, rounding_amount: 0, unpaid_amount: 0, payment_status: 'not_applicable' });\n      continue;\n    }\n    const items = itemsByHci.get(hciId) || [];",
    'bulk RMA payment facts branch');

  return src.replace(/\s*$/, '') + '\n' + SERVER_MARKER + '\n';
}

function patchApp(src) {
  if (src.includes(APP_MARKER)) return src;
  src = replaceOnce(src,
    "const st=h.payment_status==='paid'?'status-paid':String(h.payment_status||'').includes('partial')?'status-pending':'status-unpaid';",
    "const st=h.is_rma?'':h.payment_status==='paid'?'status-paid':String(h.payment_status||'').includes('partial')?'status-pending':'status-unpaid';",
    'RMA neutral payment status');
  src = replaceOnce(src,
    "ciTypeBadge('historical')+'</td><td>'+esc(h.brand_name)",
    "ciTypeBadge('historical')+(h.is_rma?'<span class=\"ci-type-badge ci-type-hist\">RMA</span>':'')+'</td><td>'+esc(h.brand_name)",
    'RMA type badge');
  const histStart = src.indexOf('function renderHistoricalCITable(data){');
  const histEnd = src.indexOf('\nfunction toggleHistoricalCIDetail', histStart);
  if (histStart < 0 || histEnd < 0) throw new Error('[HCI-COSTS-RMA] historical list wrapper anchor missing');
  let histSection = src.slice(histStart, histEnd);
  histSection = replaceOnce(histSection,
    "(hasPermission('payment_view')?'<button class=\"action-btn\"",
    "(hasPermission('payment_view')&&h.payment_request_id?'<button class=\"action-btn\"",
    'hide RMA payment action');
  for (const pair of [['fmtMoney(h.gross_goods_amount)','fmtMoney(h.gross_goods_amount,h.currency)'],['fmtMoney(h.historical_paid_amount)','fmtMoney(h.historical_paid_amount,h.currency)'],['fmtMoney(h.subsequent_paid_amount)','fmtMoney(h.subsequent_paid_amount,h.currency)'],['fmtMoney(h.deduction_amount)','fmtMoney(h.deduction_amount,h.currency)'],['fmtMoney(h.rounding_amount)','fmtMoney(h.rounding_amount,h.currency)'],['fmtMoney(h.unpaid_amount)','fmtMoney(h.unpaid_amount,h.currency)']]) {
    histSection = replaceOnce(histSection, pair[0], pair[1], 'historical list currency ' + pair[0]);
  }
  src = src.slice(0, histStart) + histSection + src.slice(histEnd);

  const histRowStart = src.indexOf('  function addHistoricalRow(srcTable,sourceRow,h){');
  const histRowEnd = src.indexOf('  if(operationalData.length)', histRowStart);
  if (histRowStart < 0 || histRowEnd < 0) throw new Error('[HCI-COSTS-RMA] unified historical row anchor missing');
  let histRowSection = src.slice(histRowStart, histRowEnd);
  histRowSection = replaceOnce(histRowSection,
    "var typeCell=document.createElement('td');typeCell.innerHTML=ciTypeBadge('historical');tr.appendChild(typeCell);",
    "var typeCell=document.createElement('td');typeCell.innerHTML=ciTypeBadge('historical')+(h.is_rma?'<span class=\"ci-type-badge ci-type-hist\">RMA</span>':'');tr.appendChild(typeCell);",
    'RMA badge in unified historical row');
  histRowSection = replaceOnce(histRowSection,
    "tr.appendChild(textCell(h.brand_name));tr.appendChild(textCell(unifiedCICountryLabel(h.country)));\n    tr.appendChild(textCell('—'));tr.appendChild(textCell('—'));",
    "tr.appendChild(textCell(h.brand_name));tr.appendChild(textCell(unifiedCICountryLabel(h.country)));\n    tr.appendChild(textCell('—'));tr.appendChild(textCell(h.clearance_type==='formal'?t('hci.clearance_formal','正清'):h.clearance_type==='non_formal'?t('hci.clearance_non_formal','非正清'):'—'));",
    'historical clearance type in unified list');
  histRowSection = replaceOnce(histRowSection,
    "tr.appendChild(textCell(fmtDate(h.ci_date)));tr.appendChild(textCell(fmtMoney(h.gross_goods_amount,h.currency)));\n    tr.appendChild(textCell('—'));tr.appendChild(textCell('—'));",
    "tr.appendChild(textCell(fmtDate(h.ci_date)));tr.appendChild(textCell(fmtMoney(h.gross_goods_amount,h.currency)));\n    tr.appendChild(textCell(h.historical_freight_amount==null?'—':fmtMoney(h.historical_freight_amount,h.historical_freight_currency)));tr.appendChild(textCell('—'));",
    'historical freight in unified list');
  histRowSection = replaceOnce(histRowSection,
    "tr.appendChild(textCell(fmtMoney(Number(h.historical_paid_amount||0)+Number(h.subsequent_paid_amount||0),h.currency)));",
    "tr.appendChild(h.is_rma?textCell('—'):textCell(fmtMoney(Number(h.historical_paid_amount||0)+Number(h.subsequent_paid_amount||0),h.currency)));",
    'RMA paid amount display');
  histRowSection = replaceOnce(histRowSection,
    "tr.appendChild(textCell(fmtMoney(h.unpaid_amount,h.currency)));",
    "tr.appendChild(h.is_rma?textCell('—'):textCell(fmtMoney(h.unpaid_amount,h.currency)));",
    'RMA unpaid amount display');
  histRowSection = replaceOnce(histRowSection,
    "tr.appendChild(textCell(ciPaymentStatusLabel(h.payment_status)));",
    "tr.appendChild(textCell(h.is_rma?t('hci.payment_not_applicable','不适用'):ciPaymentStatusLabel(h.payment_status)));",
    'RMA payment status display');
  src = src.slice(0, histRowStart) + histRowSection + src.slice(histRowEnd);

  src = replaceOnce(src,
    "    const canEdit=hasPermission('ci_edit');\n    const attachSection=",
    "    const canEdit=hasPermission('ci_edit');\n    const historicalCostsSection='<div class=\"detail-section\"><h3>'+t('hci.costs_title','历史物流费用')+'</h3><div class=\"detail-grid\">'+\n      '<div class=\"detail-item\"><span class=\"detail-label\">'+t('hci.freight_total','历史总运费')+'</span><span class=\"detail-value\">'+(h.historical_freight_amount==null?'—':esc(fmtMoney(h.historical_freight_amount,h.historical_freight_currency)))+'</span></div>'+\n      '<div class=\"detail-item\"><span class=\"detail-label\">'+t('hci.customs_duty','历史关税')+'</span><span class=\"detail-value\">'+(h.historical_customs_duty_amount==null?'—':esc(fmtMoney(h.historical_customs_duty_amount,h.historical_customs_duty_currency||'IDR')))+'</span></div>'+\n      '<div class=\"detail-item\"><span class=\"detail-label\">'+t('hci.customs_duty_rmb','关税人民币参考金额')+'</span><span class=\"detail-value\">'+(h.historical_customs_duty_rmb_amount==null?'—':esc(fmtMoney(h.historical_customs_duty_rmb_amount,'RMB')))+'</span></div>'+\n      '<div class=\"detail-item\"><span class=\"detail-label\">'+t('hci.customs_duty_rate','关税结算汇率（原表）')+'</span><span class=\"detail-value\">'+(h.historical_customs_duty_exchange_rate==null?'—':Number(h.historical_customs_duty_exchange_rate).toFixed(6))+'</span></div>'+\n      '<div class=\"detail-item\"><span class=\"detail-label\">'+t('hci.clearance_type','清关方式')+'</span><span class=\"detail-value\">'+(h.clearance_type==='formal'?t('hci.clearance_formal','正清'):h.clearance_type==='non_formal'?t('hci.clearance_non_formal','非正清'):'—')+'</span></div></div></div>';\n    const attachSection=",
    'historical CI detail cost section');
  src = replaceOnce(src,
    "v1: [[t('gen.L5822.1','历史CI编号'),h.historical_ci_no]",
    "v1: [[t('hci.document_type','单据类型'),h.is_rma?t('hci.is_rma','RMA'):t('ci.type.historical','历史CI')],[t('gen.L5822.1','历史CI编号'),h.historical_ci_no]",
    'historical CI detail document type');
  src = replaceOnce(src, 'v5: itemsSection+attachSection', 'v5: historicalCostsSection+itemsSection+attachSection', 'historical CI detail cost section placement');
  const detailStart = src.indexOf('async function viewHistoricalCI(');
  const detailEnd = src.indexOf('\nfunction parseHistoricalAttachments', detailStart);
  if (detailStart < 0 || detailEnd < 0) throw new Error('[HCI-COSTS-RMA] historical detail wrapper anchor missing');
  let detailSection = src.slice(detailStart, detailEnd);
  detailSection = replaceOnce(detailSection,
    "v2: hasPermission('payment_view')?",
    "v2: hasPermission('payment_view')&&h.payment_request_id?",
    'hide RMA payment footer action');
  detailSection = replaceOnce(detailSection, 'fmtMoney(it.unit_price)', 'fmtMoney(it.unit_price,h.currency)', 'historical item unit price currency');
  detailSection = replaceOnce(detailSection, 'fmtMoney(it.net_unit_price)', 'fmtMoney(it.net_unit_price,h.currency)', 'historical item net unit price currency');
  detailSection = replaceOnce(detailSection, 'fmtMoney(it.ci_amount)', 'fmtMoney(it.ci_amount,h.currency)', 'historical item amount currency');
  src = src.slice(0, detailStart) + detailSection + src.slice(detailEnd);
  src = replaceOnce(src,
    'const PAY_STATUS_MAP={',
    "const PAY_STATUS_MAP={not_applicable:t('hci.payment_not_applicable','不适用'),",
    'RMA payment status label');
  return src.replace(/\s*$/, '') + '\n' + APP_MARKER + '\n';
}

function patchI18n(src) {
  if (src.includes(I18N_MARKER)) return src;
  const end = src.lastIndexOf('})();');
  if (end < 0) throw new Error('[HCI-COSTS-RMA] i18n closure anchor missing');
  const block = [
    '  ' + I18N_MARKER,
    '  I18N.dict.zh["hci.document_type"]="单据类型"; I18N.dict.en["hci.document_type"]="Document Type"; I18N.dict.id["hci.document_type"]="Jenis Dokumen";',
    '  I18N.dict.zh["hci.is_rma"]="RMA"; I18N.dict.en["hci.is_rma"]="RMA"; I18N.dict.id["hci.is_rma"]="RMA";',
    '  I18N.dict.zh["hci.payment_not_applicable"]="不适用"; I18N.dict.en["hci.payment_not_applicable"]="Not applicable"; I18N.dict.id["hci.payment_not_applicable"]="Tidak berlaku";',
    '  I18N.dict.zh["hci.costs_title"]="历史物流费用"; I18N.dict.en["hci.costs_title"]="Historical Logistics Costs"; I18N.dict.id["hci.costs_title"]="Biaya Logistik Historis";',
    '  I18N.dict.zh["hci.freight_total"]="历史总运费"; I18N.dict.en["hci.freight_total"]="Historical Total Freight"; I18N.dict.id["hci.freight_total"]="Total Ongkos Kirim Historis";',
    '  I18N.dict.zh["hci.customs_duty"]="历史关税"; I18N.dict.en["hci.customs_duty"]="Historical Customs Duty"; I18N.dict.id["hci.customs_duty"]="Bea Masuk Historis";',
    '  I18N.dict.zh["hci.customs_duty_rmb"]="关税人民币参考金额"; I18N.dict.en["hci.customs_duty_rmb"]="Customs Duty (RMB Reference)"; I18N.dict.id["hci.customs_duty_rmb"]="Bea Masuk (Referensi RMB)";',
    '  I18N.dict.zh["hci.customs_duty_rate"]="关税结算汇率（原表）"; I18N.dict.en["hci.customs_duty_rate"]="Customs Duty FX Rate (Source)"; I18N.dict.id["hci.customs_duty_rate"]="Kurs Bea Masuk (Sumber)";',
    '  I18N.dict.zh["hci.clearance_type"]="清关方式"; I18N.dict.en["hci.clearance_type"]="Clearance Type"; I18N.dict.id["hci.clearance_type"]="Jenis Bea Cukai";',
    '  I18N.dict.zh["hci.clearance_formal"]="正清"; I18N.dict.en["hci.clearance_formal"]="Formal"; I18N.dict.id["hci.clearance_formal"]="Resmi";',
    '  I18N.dict.zh["hci.clearance_non_formal"]="非正清"; I18N.dict.en["hci.clearance_non_formal"]="Non-formal"; I18N.dict.id["hci.clearance_non_formal"]="Non-resmi";',
    ''
  ].join('\n');
  return src.slice(0, end) + block + src.slice(end);
}

function patchIndex(src) {
  if (src.includes(INDEX_MARKER)) return src;
  let out = src;
  out = out.replace(/i18n\.js\?v=[^"']+/g, 'i18n.js?v=20261117-2');
  out = out.replace(/app\.js\?v=[^"']+/g, 'app.js?v=20261117-2');
  if (!out.includes('app.js?v=20261117-2')) throw new Error('[HCI-COSTS-RMA] app.js cache version anchor missing');
  return out.replace(/\s*$/, '') + '\n' + INDEX_MARKER + '\n';
}

function apply() {
  const s0 = fs.readFileSync(SERVER, 'utf8');
  const s1 = patchServer(s0);
  if (s1 !== s0) fs.writeFileSync(SERVER, s1, 'utf8');
  const a0 = fs.readFileSync(APP, 'utf8');
  const a1 = patchApp(a0);
  if (a1 !== a0) fs.writeFileSync(APP, a1, 'utf8');
  const i0 = fs.readFileSync(I18N, 'utf8');
  const i1 = patchI18n(i0);
  if (i1 !== i0) fs.writeFileSync(I18N, i1, 'utf8');
  const h0 = fs.readFileSync(INDEX, 'utf8');
  const h1 = patchIndex(h0);
  if (h1 !== h0) fs.writeFileSync(INDEX, h1, 'utf8');
  for (const file of [SERVER, APP, I18N]) cp.execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  console.log('[HCI-COSTS-RMA] historical freight/customs snapshots + zero-value RMA support applied');
}
if (require.main === module) apply();
module.exports = { SERVER_MARKER, APP_MARKER, I18N_MARKER, INDEX_MARKER, patchServer, patchApp, patchI18n, patchIndex };
