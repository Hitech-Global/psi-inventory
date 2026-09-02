'use strict';

/**
 * PAY-SOURCE-TRACE — 付款申请来源追溯链路 回归测试
 *
 * PAY-SOURCE-TRACE-01（付款管理 列表 / 详情）覆盖：
 *   1. 单 CI 付款（payable_items.source_type='ci'）
 *   2. 多 CI 的 PAY-MULTI（payment_mode='multi' + 多条 payment_request_items）
 *   3. CI + 费用单混合付款（pi/尾款 + logistics/运费 混合）
 *   4. historical_ci 来源（source_ci_id 为空，靠 source_id / source_no 关联历史 CI）
 *   5. 多个费用单（同一 PR 下多条 payable_items）
 *   6. 来源缺失时安全降级（无 items 且主表字段为空 / 来源单据已被删除）→ 不报错
 *   7. 列表与详情使用同一套来源解析口径（同一 resolver 产出完全一致）
 *   8. PAY-MULTI-2026-409982 生产等价夹具：来源组成 + 金额（结算结果不受影响）
 *
 * PAY-SOURCE-TRACE-02（审批中心 → 财务类审批列表）覆盖：
 *   9.  PAY-MULTI（logistics 费用单来源，主表字段全空）在待审列表可追溯
 *   10. 多 CI PAY-MULTI 待审：紧凑展示 A、B +N，不只取第一条
 *   11. PI 定金待审：关联 CI 允许为 —（定金本就没有 CI），来源单号照常显示
 *   12. historical_ci 待审：与付款管理列表解析结果完全一致
 *   13. 来源缺失待审：安全降级，不报错
 *   14. 三处同口径：付款管理列表 / 付款申请详情 / 审批中心待审列表 产出完全一致
 *
 * 只读断言：不修改任何金额/状态/结算逻辑。
 */

const { test, describe, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_DRIVER = 'sqlite';
process.env.DB_PATH = ':memory:';

const { query, queryOne, run, genId, initDatabase, getDB } = require('./db');
const serverMod = require('./server');
const {
  resolvePaymentSourcesForRequests,
  attachPaymentSourceTrace,
  summarizePaymentSources,
  compactSourceNos,
  formatPaymentTermsDisplay
} = serverMod;

// ── Helpers ──────────────────────────────────────────────────────────────────

function resetDB() {
  const d = getDB();
  d.pragma('foreign_keys = OFF');
  d.exec(`
    DELETE FROM payment_request_items;
    DELETE FROM payment_requests;
    DELETE FROM payable_items;
    DELETE FROM logistics_batches;
    DELETE FROM historical_commercial_invoices;
    DELETE FROM commercial_invoices;
    DELETE FROM proforma_invoices;
  `);
  d.pragma('foreign_keys = ON');
}

function seedCI(id, ciNo, opts) {
  opts = opts || {};
  run(
    `INSERT INTO commercial_invoices (id, ci_no, ci_date, currency, goods_amount, ci_status, country,
                                      related_pi_no, payment_terms, credit_days)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, ciNo, '2026-01-01', opts.currency || 'RMB', opts.goodsAmount || 100000,
     'shipped', opts.country || 'Indonesia', opts.relatedPiNo || '',
     opts.paymentTerms || '', opts.creditDays || 0]
  );
}

function seedHCI(id, hciNo, opts) {
  opts = opts || {};
  run(
    `INSERT INTO historical_commercial_invoices
     (id, historical_ci_no, supplier_name, supplier_identity, brand_name, country, ci_date,
      currency, gross_goods_amount, payment_terms, credit_days, source_mode, idempotency_key, payload_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'historical', ?, ?)`,
    [id, hciNo, opts.supplierName || 'Redragon', opts.supplierIdentity || 'REDRA',
     opts.brandName || 'Redragon', opts.country || 'ID', opts.ciDate || '2025-11-18',
     opts.currency || 'RMB', opts.grossAmount || 272539.09,
     opts.paymentTerms || 'Credit', opts.creditDays || 0,
     opts.idempotencyKey || (id + '-idem'), opts.payloadHash || (id + '-hash')]
  );
}

function seedPI(id, piNo, opts) {
  opts = opts || {};
  run(
    `INSERT INTO proforma_invoices (id, pi_no, pi_date, currency, total_amount, supplier_name, country, payment_terms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, piNo, '2026-01-01', opts.currency || 'RMB', opts.totalAmount || 50000,
     opts.supplierName || 'Netac', opts.country || 'Indonesia', opts.paymentTerms || '']
  );
}

function seedBatch(id, batchNo, ciId, ciNo) {
  run(
    `INSERT INTO logistics_batches (id, batch_no, related_ci_id, related_ci_no, forwarder_name, fee_status)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, batchNo, ciId || '', ciNo || '', 'TestForwarder', 'cost_generated']
  );
}

function seedPayable(id, feeNo, sourceType, sourceId, opts) {
  opts = opts || {};
  run(
    `INSERT INTO payable_items
     (id, fee_no, source_type, source_id, source_no, source_ci_id,
      fee_type, category_code, subcategory_code, payee_type, payee_key, payee_name_snapshot,
      payer_entity_key, currency, payable_amount_minor, is_active, lifecycle_status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, feeNo, sourceType, sourceId, opts.sourceNo || '', opts.sourceCiId || '',
     opts.feeType || 'balance', opts.categoryCode || 'goods', opts.subcategoryCode || 'balance',
     opts.payeeType || 'factory', opts.payeeKey || 'supplier:S1',
     opts.payeeNameSnapshot || 'Redragon', 'self', opts.currency || 'RMB',
     opts.amountMinor || 27253909, 1, opts.lifecycleStatus || 'active', 'test']
  );
}

function seedPR(id, requestNo, opts) {
  opts = opts || {};
  run(
    `INSERT INTO payment_requests
     (id, request_no, payment_category, payment_subcategory, payment_mode,
      source_type, source_id, source_no, related_ci_id, related_ci_no,
      payee_type, payee_key, payee_name_snapshot, supplier_name,
      payable_amount, paid_amount, unpaid_amount, currency, payment_terms,
      payment_status, approval_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, requestNo, opts.paymentCategory || 'goods', opts.paymentSubcategory || 'balance',
     opts.paymentMode || 'multi',
     opts.sourceType || '', opts.sourceId || '', opts.sourceNo || '',
     opts.relatedCiId || '', opts.relatedCiNo || '',
     'factory', 'supplier:S1', opts.supplierName || 'Redragon', opts.supplierName || 'Redragon',
     opts.payableAmount || 0, opts.paidAmount || 0, opts.unpaidAmount || 0,
     opts.currency || 'RMB', opts.paymentTerms || '',
     opts.paymentStatus || 'approved', opts.approvalStatus || 'approved']
  );
}

function linkItem(prId, payableId, requestedMinor) {
  run(
    `INSERT INTO payment_request_items (id, payment_request_id, payable_item_id, requested_amount_minor)
     VALUES (?, ?, ?, ?)`,
    [genId('pri'), prId, payableId, requestedMinor]
  );
}

function sourcesOf(prId) {
  const pr = queryOne('SELECT * FROM payment_requests WHERE id = ?', [prId]);
  return resolvePaymentSourcesForRequests([pr]).get(prId) || [];
}

// ── Setup ────────────────────────────────────────────────────────────────────

before(() => { initDatabase(); });

describe('PAY-SOURCE-TRACE-01 付款申请来源追溯', () => {

  beforeEach(() => resetDB());

  test('T1 — 单 CI 付款：来源单号/关联CI/付款条件全部可追溯', () => {
    seedCI('ci_t1', 'HIT20260717-1A', { paymentTerms: 'Credit', creditDays: 120, relatedPiNo: 'HIT20260717-1A' });
    seedPayable('pay_t1', 'PAY-ITEM-T1', 'ci', 'ci_t1', {
      sourceNo: 'HIT20260717-1A', feeType: 'balance', amountMinor: 52803172
    });
    seedPR('pr_t1', 'PAY-SINGLE-T1', { paymentMode: 'single', payableAmount: 528031.72 });
    linkItem('pr_t1', 'pay_t1', 52803172);

    const s = sourcesOf('pr_t1');
    assert.equal(s.length, 1, '应解析出 1 条来源');
    assert.equal(s[0].source_type, 'ci');
    assert.equal(s[0].source_type_label, 'CI');
    assert.equal(s[0].source_no, 'HIT20260717-1A');
    assert.equal(s[0].related_ci_no, 'HIT20260717-1A');
    assert.equal(s[0].payment_terms, 'Credit');
    assert.equal(s[0].credit_days, 120);
    assert.equal(s[0].payment_terms_display, 'Credit · 120天');
    assert.equal(s[0].source_amount, 528031.72);
    assert.equal(s[0].requested_amount, 528031.72);
    assert.equal(s[0].fee_no, 'PAY-ITEM-T1');

    const sum = summarizePaymentSources(s);
    assert.equal(sum.count, 1);
    assert.equal(sum.source_nos_display, 'HIT20260717-1A');
    assert.equal(sum.related_ci_nos_display, 'HIT20260717-1A');
    assert.equal(sum.payment_terms_display, 'Credit · 120天');
  });

  test('T2 — 多 CI 的 PAY-MULTI：不只取第一条，紧凑展示 A、B +N', () => {
    seedCI('ci_t2a', 'HIT20260105-1A', { paymentTerms: 'Credit', creditDays: 30 });
    seedCI('ci_t2b', 'HIT20260108-2A', { paymentTerms: 'Credit', creditDays: 45 });
    seedCI('ci_t2c', 'HIT20260121-1A', { paymentTerms: 'Credit', creditDays: 60 });
    seedPayable('pay_t2a', 'PAY-ITEM-T2A', 'ci', 'ci_t2a', { sourceNo: 'HIT20260105-1A', amountMinor: 11403182 });
    seedPayable('pay_t2b', 'PAY-ITEM-T2B', 'ci', 'ci_t2b', { sourceNo: 'HIT20260108-2A', amountMinor: 64713123 });
    seedPayable('pay_t2c', 'PAY-ITEM-T2C', 'ci', 'ci_t2c', { sourceNo: 'HIT20260121-1A', amountMinor: 50902670 });
    seedPR('pr_t2', 'PAY-MULTI-T2', { payableAmount: 1270189.75 });
    linkItem('pr_t2', 'pay_t2a', 11403182);
    linkItem('pr_t2', 'pay_t2b', 64713123);
    linkItem('pr_t2', 'pay_t2c', 50902670);

    const s = sourcesOf('pr_t2');
    assert.equal(s.length, 3, '多来源必须全部返回，不能只取第一条');

    const pr = queryOne('SELECT * FROM payment_requests WHERE id = ?', ['pr_t2']);
    attachPaymentSourceTrace([pr]);
    const sum = pr.source_summary;
    assert.equal(sum.count, 3);
    // 主表字段恒为空，但汇总必须能反映来源
    assert.equal(pr.source_no, '');
    assert.equal(sum.source_nos_display, 'HIT20260105-1A、HIT20260108-2A +1');
    assert.equal(sum.related_ci_nos_display, 'HIT20260105-1A、HIT20260108-2A +1');
    assert.equal(sum.source_nos.length, 3);
    assert.equal(sum.fee_nos.length, 3);
    // 付款条件按去重后紧凑展示
    assert.equal(sum.payment_terms_display, 'Credit · 30天、Credit · 45天 +1');
  });

  test('T3 — CI + 费用单混合付款：CI 尾款与物流运费同表可区分', () => {
    seedCI('ci_t3', 'NHT260514A', { paymentTerms: 'Credit 45 days', creditDays: 45 });
    seedPI('pi_t3', 'NHT260417A');
    seedBatch('log_t3', 'SZIAF014533', 'ci_t3', 'NHT260514A');
    // 费用单①：PI 尾款（来源 PI，关联 CI = NHT260514A）
    seedPayable('pay_t3a', 'PAY-ITEM-T3A', 'pi', 'pi_t3', {
      sourceNo: 'NHT260417A', sourceCiId: 'ci_t3', feeType: 'balance', amountMinor: 20846996
    });
    // 费用单②：物流运费（来源物流批次，关联 CI = NHT260514A）
    seedPayable('pay_t3b', 'PAY-ITEM-T3B', 'logistics', 'log_t3', {
      sourceNo: 'SZIAF014533', sourceCiId: 'ci_t3', feeType: 'freight',
      categoryCode: 'warehouse_arrival', subcategoryCode: 'freight', amountMinor: 1360100
    });
    seedPR('pr_t3', 'PAY-MULTI-T3', { payableAmount: 222070.96 });
    linkItem('pr_t3', 'pay_t3a', 20846996);
    linkItem('pr_t3', 'pay_t3b', 1360100);

    const s = sourcesOf('pr_t3');
    assert.equal(s.length, 2);
    const byType = {};
    s.forEach(x => { byType[x.source_type] = x; });

    assert.equal(byType.pi.source_type_label, 'PI');
    assert.equal(byType.pi.source_no, 'NHT260417A');
    assert.equal(byType.pi.related_ci_no, 'NHT260514A');
    assert.equal(byType.pi.payment_terms_display, 'Credit 45 days');
    assert.equal(byType.pi.fee_type_label, '尾款');
    assert.equal(byType.pi.source_amount, 208469.96);
    assert.equal(byType.pi.requested_amount, 208469.96);

    assert.equal(byType.logistics.source_type_label, '物流');
    assert.equal(byType.logistics.source_no, 'SZIAF014533');
    assert.equal(byType.logistics.related_ci_no, 'NHT260514A');
    assert.equal(byType.logistics.fee_type_label, '运费');
    assert.equal(byType.logistics.requested_amount, 13601);

    const sum = summarizePaymentSources(s);
    assert.equal(sum.source_nos_display, 'NHT260417A、SZIAF014533');
    assert.equal(sum.related_ci_nos_display, 'NHT260514A');
    assert.equal(sum.source_types.length, 2);
  });

  test('T4 — historical_ci 来源（source_ci_id 为空）：靠 source_id / source_no 关联历史 CI', () => {
    seedHCI('hci_t4', 'HIT20251118-1A', { paymentTerms: 'Credit', creditDays: 0, grossAmount: 272539.09 });
    seedPayable('pay_t4', 'PAY-ITEM-T4', 'historical_ci', 'hci_t4', {
      sourceNo: 'HIT20251118-1A', feeType: 'balance', amountMinor: 27253909
    });
    seedPR('pr_t4', 'PAY-MULTI-T4', { payableAmount: 272539.09 });
    linkItem('pr_t4', 'pay_t4', 27253909);

    const s = sourcesOf('pr_t4');
    assert.equal(s.length, 1);
    assert.equal(s[0].source_type, 'historical_ci');
    assert.equal(s[0].source_type_label, '历史CI');
    assert.equal(s[0].source_no, 'HIT20251118-1A');
    // 历史 CI 的 source_ci_id 为空，但关联 CI 必须能解析出来
    assert.equal(s[0].related_ci_no, 'HIT20251118-1A');
    assert.equal(s[0].payment_terms, 'Credit');
    assert.equal(s[0].payment_terms_display, 'Credit');
    assert.equal(s[0].source_amount, 272539.09);
    assert.equal(s[0].requested_amount, 272539.09);

    // 仅靠 source_no 也能命中（source_id 指向已不存在的记录）
    run(`UPDATE payable_items SET source_id = 'hci_deleted' WHERE id = 'pay_t4'`);
    const s2 = sourcesOf('pr_t4');
    assert.equal(s2.length, 1);
    assert.equal(s2[0].related_ci_no, 'HIT20251118-1A', 'source_id 失效时必须按 source_no 回退');
  });

  test('T5 — 多个费用单：同一 PR 下多条 payable_items 全部列出', () => {
    seedHCI('hci_t5a', 'HIT20251205-1A', { paymentTerms: 'Credit' });
    seedHCI('hci_t5b', 'HIT20251212-1A', { paymentTerms: 'Credit' });
    seedPayable('pay_t5a', 'PAY-ITEM-T5A', 'historical_ci', 'hci_t5a', { sourceNo: 'HIT20251205-1A', amountMinor: 29961344 });
    seedPayable('pay_t5b', 'PAY-ITEM-T5B', 'historical_ci', 'hci_t5b', { sourceNo: 'HIT20251212-1A', amountMinor: 82373718 });
    seedPR('pr_t5', 'PAY-MULTI-T5', { payableAmount: 1123350.62 });
    linkItem('pr_t5', 'pay_t5a', 29961344);
    linkItem('pr_t5', 'pay_t5b', 82373718);

    const s = sourcesOf('pr_t5');
    assert.equal(s.length, 2, '两个费用单必须都出现');
    assert.deepEqual(s.map(x => x.fee_no).sort(), ['PAY-ITEM-T5A', 'PAY-ITEM-T5B']);
    assert.deepEqual(s.map(x => x.source_no).sort(), ['HIT20251205-1A', 'HIT20251212-1A']);
    const sum = summarizePaymentSources(s);
    assert.equal(sum.fee_nos.length, 2);
    assert.equal(sum.source_nos_display, 'HIT20251205-1A、HIT20251212-1A');
  });

  test('T6 — 来源缺失时安全降级：不报错、返回空来源与空汇总', () => {
    // 6a：PR 无任何 payment_request_items，且主表来源字段全空
    seedPR('pr_t6a', 'PAY-MULTI-T6A', { payableAmount: 1000 });
    const s6a = sourcesOf('pr_t6a');
    assert.deepEqual(s6a, [], '无来源关系时必须返回空数组，不得臆造');
    const sum6a = summarizePaymentSources(s6a);
    assert.equal(sum6a.count, 0);
    assert.equal(sum6a.source_nos_display, '');
    assert.equal(sum6a.related_ci_nos_display, '');
    assert.equal(sum6a.payment_terms_display, '');

    // 6b：有 items，但来源单据已被删除（悬空引用）→ 保留 payable_items 自身字段，不报错
    seedPayable('pay_t6b', 'PAY-ITEM-T6B', 'ci', 'ci_gone', { sourceNo: 'CI-GONE', amountMinor: 500000 });
    seedPR('pr_t6b', 'PAY-MULTI-T6B', { payableAmount: 5000 });
    linkItem('pr_t6b', 'pay_t6b', 500000);
    let s6b;
    assert.doesNotThrow(() => { s6b = sourcesOf('pr_t6b'); });
    assert.equal(s6b.length, 1);
    assert.equal(s6b[0].source_no, 'CI-GONE', '悬空引用仍保留 payable_items 已存单号');
    assert.equal(s6b[0].related_ci_no, '');
    assert.equal(s6b[0].payment_terms_display, '');
    assert.equal(s6b[0].source_amount, 5000);

    // 6c：空入参不报错
    assert.deepEqual(resolvePaymentSourcesForRequests([]).size, 0);
    assert.deepEqual(resolvePaymentSourcesForRequests(null).size, 0);
    assert.doesNotThrow(() => attachPaymentSourceTrace([]));
    assert.doesNotThrow(() => attachPaymentSourceTrace(null));

    // 6d：列表整批解析时，任一行异常不得影响其它行
    seedCI('ci_t6d', 'HIT-T6D', { paymentTerms: 'Credit', creditDays: 15 });
    seedPayable('pay_t6d', 'PAY-ITEM-T6D', 'ci', 'ci_t6d', { sourceNo: 'HIT-T6D', amountMinor: 10000 });
    seedPR('pr_t6d', 'PAY-MULTI-T6D', { payableAmount: 100 });
    linkItem('pr_t6d', 'pay_t6d', 10000);
    const rows = query('SELECT * FROM payment_requests ORDER BY request_no').rows;
    assert.ok(rows.length >= 3);
    assert.doesNotThrow(() => attachPaymentSourceTrace(rows));
    const bad = rows.find(r => r.id === 'pr_t6a');
    const good = rows.find(r => r.id === 'pr_t6d');
    assert.deepEqual(bad.sources, []);
    assert.equal(good.sources.length, 1);
    assert.equal(good.source_summary.related_ci_nos_display, 'HIT-T6D');
  });

  test('T7 — 列表与详情使用同一套来源解析口径', () => {
    seedCI('ci_t7', 'HIT20260717-1A', { paymentTerms: 'Credit', creditDays: 120 });
    seedPayable('pay_t7', 'PAY-ITEM-T7', 'ci', 'ci_t7', { sourceNo: 'HIT20260717-1A', amountMinor: 52803172 });
    seedPR('pr_t7', 'PAY-MULTI-T7', { payableAmount: 528031.72 });
    linkItem('pr_t7', 'pay_t7', 52803172);

    // 列表路径：attachPaymentSourceTrace（GET /api/payment-requests 使用）
    const listRows = query('SELECT * FROM payment_requests WHERE id = ?', ['pr_t7']).rows;
    attachPaymentSourceTrace(listRows);
    const listSources = listRows[0].sources;
    const listSummary = listRows[0].source_summary;

    // 详情路径：resolvePaymentSourcesForRequests（GET /api/payment-requests/:id 使用）
    const detailRow = queryOne('SELECT * FROM payment_requests WHERE id = ?', ['pr_t7']);
    const detailSources = resolvePaymentSourcesForRequests([detailRow]).get('pr_t7');
    const detailSummary = summarizePaymentSources(detailSources);

    assert.deepEqual(detailSources, listSources, '详情 sources 必须与列表 sources 完全一致');
    assert.deepEqual(detailSummary, listSummary, '详情 source_summary 必须与列表完全一致');
    assert.equal(listSummary.related_ci_nos_display, 'HIT20260717-1A');
    assert.equal(listSummary.payment_terms_display, 'Credit · 120天');
  });

  test('T8 — 旧单（single 模式无 items）回退主表字段，行为与改造前一致', () => {
    seedHCI('hci_t8', 'HIT20260108-1A', { paymentTerms: 'Credit', creditDays: 0 });
    seedPR('pr_t8', 'PAY-HCI-T8', {
      paymentMode: 'single', sourceType: 'historical_ci', sourceId: 'hci_t8',
      sourceNo: 'HIT20260108-1A', paymentTerms: 'Credit', payableAmount: 451044.38
    });
    const s = sourcesOf('pr_t8');
    assert.equal(s.length, 1);
    assert.equal(s[0].source_no, 'HIT20260108-1A');
    assert.equal(s[0].related_ci_no, 'HIT20260108-1A');
    assert.equal(s[0].payment_terms_display, 'Credit');
    assert.equal(s[0].source_amount, null, '旧单无 payable_items，来源金额不得臆造');
    assert.equal(s[0].requested_amount, 451044.38);
    assert.equal(s[0].fee_no, '');

    const sum = summarizePaymentSources(s);
    assert.equal(sum.source_nos_display, 'HIT20260108-1A');
  });

  test('T9 — 生产等价夹具 PAY-MULTI-2026-409982：来源组成与金额', () => {
    // 生产真实值（只读核验所得，非臆造）：
    //   payment_request_items → payable_items PAY-ITEM-2026-000846-ym9
    //   source_type = historical_ci / source_id = hci_1785853312118_6a7rzp
    //   source_no = HIT20251118-1A / source_ci_id = ''
    //   requested_amount_minor = 27253909
    seedHCI('hci_1785853312118_6a7rzp', 'HIT20251118-1A', {
      supplierName: 'Redragon', country: 'ID', ciDate: '2025-11-18', currency: 'RMB',
      grossAmount: 272539.09, paymentTerms: 'Credit', creditDays: 0
    });
    seedPayable('payitem_1785944000846_luqy4w', 'PAY-ITEM-2026-000846-ym9',
      'historical_ci', 'hci_1785853312118_6a7rzp',
      { sourceNo: 'HIT20251118-1A', feeType: 'balance', amountMinor: 27253909, lifecycleStatus: 'paid' });
    // 主表：来源字段恒空（multi 模式），金额/抵扣/已付/未付维持生产现状
    seedPR('pay_1786243409982_5eqebp', 'PAY-MULTI-2026-409982', {
      paymentCategory: 'goods', paymentSubcategory: 'balance', paymentMode: 'multi',
      supplierName: 'Redragon', payableAmount: 272539.09, paidAmount: 190000,
      unpaidAmount: 11948.09, currency: 'RMB',
      paymentStatus: 'partial_payment_partial_deduction'
    });
    linkItem('pay_1786243409982_5eqebp', 'payitem_1785944000846_luqy4w', 27253909);

    const pr = queryOne('SELECT * FROM payment_requests WHERE id = ?', ['pay_1786243409982_5eqebp']);
    attachPaymentSourceTrace([pr]);
    const s = pr.sources;
    const sum = pr.source_summary;

    assert.equal(s.length, 1, 'PAY-MULTI-2026-409982 真实来源为 1 条费用单');
    assert.equal(s[0].source_type, 'historical_ci');
    assert.equal(s[0].source_type_label, '历史CI');
    assert.equal(s[0].source_no, 'HIT20251118-1A');
    assert.equal(s[0].fee_no, 'PAY-ITEM-2026-000846-ym9');
    assert.equal(s[0].related_ci_no, 'HIT20251118-1A', '历史 CI 自身的 CI 号即关联 CI');
    assert.equal(s[0].payment_terms, 'Credit');
    assert.equal(s[0].payment_terms_display, 'Credit');
    assert.equal(s[0].source_amount, 272539.09);
    assert.equal(s[0].requested_amount, 272539.09);

    assert.equal(sum.count, 1);
    assert.equal(sum.source_nos_display, 'HIT20251118-1A');
    assert.equal(sum.related_ci_nos_display, 'HIT20251118-1A');
    assert.equal(sum.payment_terms_display, 'Credit');

    // 结算红线：本次修改为只读派生，主表金额字段不得被改写
    const after = queryOne('SELECT * FROM payment_requests WHERE id = ?', ['pay_1786243409982_5eqebp']);
    assert.equal(Number(after.payable_amount).toFixed(2), '272539.09');
    assert.equal(Number(after.paid_amount).toFixed(2), '190000.00');
    assert.equal(Number(after.unpaid_amount).toFixed(2), '11948.09');
    assert.equal(after.source_type, '');
    assert.equal(after.source_no, '');
    assert.equal(after.related_ci_no, '');
    // 272539.09 - 70591 抵扣 - 190000 已付 = 11948.09（抵扣为独立事实，不参与来源解析）
    assert.equal(Number((272539.09 - 70591 - 190000).toFixed(2)), 11948.09);
  });
});

// ==================== PAY-SOURCE-TRACE-02：审批中心 → 财务类审批列表 ====================

// 复刻 GET /api/payment-requests/pending 的 SELECT 列与过滤条件（与 server.js 保持一致）。
// 列集合变化会由下方 T14 的静态守卫拦截，避免测试与实现悄悄分叉。
const PENDING_SELECT_COLUMNS = `id, request_no, payment_category, payment_subcategory, source_type, source_id, source_no,
             payee_type, supplier_name, payable_amount, currency, related_ci_no, related_po_no,
             payment_terms, related_ci_id,
             approval_status, payment_status, remark, created_at`;

function pendingRows() {
  const q = query(
    `SELECT ${PENDING_SELECT_COLUMNS}
     FROM payment_requests
     WHERE approval_status = 'pending'
        OR (approval_status = 'approved' AND payment_status IN ('pending_approval','approved','partial_deduction'))
     ORDER BY created_at DESC`
  ).rows;
  attachPaymentSourceTrace(q);
  return q;
}

describe('PAY-SOURCE-TRACE-02 审批中心财务审批列表来源追溯', () => {

  beforeEach(() => resetDB());

  test('T10 — PAY-MULTI（logistics 费用单，主表字段全空）在待审列表可追溯', () => {
    seedCI('ci_1787537587118_o8h68m', 'NHT260807A', { paymentTerms: 'Credit 45 days', creditDays: 45 });
    seedBatch('log_1787622553724_o7p9mn', 'R50968TRG', 'ci_1787537587118_o8h68m', 'NHT260807A');
    seedPayable('payitem_1788248172017_pwybjp', 'PAY-ITEM-2026-172017-btm',
      'logistics', 'log_1787622553724_o7p9mn', {
        sourceNo: 'R50968TRG', sourceCiId: 'ci_1787537587118_o8h68m', feeType: 'freight',
        categoryCode: 'warehouse_arrival', subcategoryCode: 'freight', amountMinor: 1057325
      });
    // 生产真实待审单 PAY-MULTI-2026-644983：主表来源字段全部为空
    seedPR('pay_1788312644983_brx5kr', 'PAY-MULTI-2026-644983', {
      paymentMode: 'multi', payableAmount: 10573.25, currency: 'RMB',
      paymentStatus: 'pending_approval', approvalStatus: 'pending'
    });
    linkItem('pay_1788312644983_brx5kr', 'payitem_1788248172017_pwybjp', 1057325);

    const rows = pendingRows();
    assert.equal(rows.length, 1, '该单应命中待审过滤条件');
    const p = rows[0];
    assert.equal(p.source_no, '', '主表来源字段仍为空（未改动主表）');
    assert.equal(p.related_ci_no, '');

    assert.equal(p.source_summary.count, 1);
    assert.equal(p.source_summary.source_nos_display, 'R50968TRG', '待审列表来源单号不得再显示 —');
    assert.equal(p.source_summary.related_ci_nos_display, 'NHT260807A');
    assert.equal(p.source_summary.payment_terms_display, 'Credit 45 days');
    assert.equal(p.sources[0].source_type, 'logistics');
    assert.equal(p.sources[0].source_type_label, '物流');
    assert.equal(p.sources[0].fee_no, 'PAY-ITEM-2026-172017-btm');
    assert.equal(p.sources[0].source_amount, 10573.25);
    assert.equal(p.sources[0].requested_amount, 10573.25);
  });

  test('T11 — 多 CI PAY-MULTI 待审：紧凑展示 A、B +N，不只取第一条', () => {
    seedHCI('hci_a', 'HIT20251212-1A', { paymentTerms: 'Credit' });
    seedHCI('hci_b', 'HIT20251205-1A', { paymentTerms: 'Credit' });
    seedHCI('hci_c', 'HIT20251118-1A', { paymentTerms: 'Credit' });
    seedPayable('pay_a', 'PAY-ITEM-A', 'historical_ci', 'hci_a', { sourceNo: 'HIT20251212-1A', amountMinor: 82373718 });
    seedPayable('pay_b', 'PAY-ITEM-B', 'historical_ci', 'hci_b', { sourceNo: 'HIT20251205-1A', amountMinor: 29961344 });
    seedPayable('pay_c', 'PAY-ITEM-C', 'historical_ci', 'hci_c', { sourceNo: 'HIT20251118-1A', amountMinor: 1194809 });
    seedPR('pr_multi3', 'PAY-MULTI-MULTI3', { payableAmount: 1135298.71, approvalStatus: 'pending', paymentStatus: 'pending_approval' });
    linkItem('pr_multi3', 'pay_a', 82373718);
    linkItem('pr_multi3', 'pay_b', 29961344);
    linkItem('pr_multi3', 'pay_c', 1194809);

    const p = pendingRows()[0];
    assert.equal(p.sources.length, 3, '多来源必须全部返回');
    assert.equal(p.source_summary.count, 3);
    assert.equal(p.source_summary.source_nos_display, 'HIT20251212-1A、HIT20251205-1A +1');
    assert.equal(p.source_summary.related_ci_nos_display, 'HIT20251212-1A、HIT20251205-1A +1');
    assert.equal(p.source_summary.source_nos.length, 3, 'source_nos 保留全部单号，供 title 展示');
    assert.equal(p.source_summary.fee_nos.length, 3, '三个费用单号都要能追溯');
  });

  test('T12 — PI 定金待审：关联 CI 允许为 —，来源单号照常显示', () => {
    seedPI('pi_t12', 'NHT260807A', { paymentTerms: 'Credit 45 days （45天）' });
    seedPayable('pay_t12', 'PAY-ITEM-T12', 'pi', 'pi_t12', {
      sourceNo: 'NHT260807A', feeType: 'deposit',
      categoryCode: 'goods', subcategoryCode: 'deposit', amountMinor: 5743571
    });
    seedPR('pr_t12', 'PAY-MULTI-599132', {
      paymentMode: 'multi', payableAmount: 57435.71,
      approvalStatus: 'pending', paymentStatus: 'pending_approval'
    });
    linkItem('pr_t12', 'pay_t12', 5743571);

    const p = pendingRows()[0];
    assert.equal(p.sources[0].source_type, 'pi');
    assert.equal(p.sources[0].source_type_label, 'PI');
    assert.equal(p.sources[0].fee_type_label, '定金');
    assert.equal(p.source_summary.source_nos_display, 'NHT260807A', '定金来源单号必须显示');
    assert.equal(p.source_summary.related_ci_nos_display, '', '定金本就没有关联 CI，空是正确结果而非 bug');
    assert.equal(p.source_summary.payment_terms_display, 'Credit 45 days （45天）');
    assert.equal(p.sources[0].related_ci_no, '');
  });

  test('T13 — historical_ci 待审：与付款管理列表解析结果完全一致', () => {
    seedHCI('hci_1785853312118_6a7rzp', 'HIT20251118-1A', {
      supplierName: 'Redragon', country: 'ID', currency: 'RMB',
      grossAmount: 272539.09, paymentTerms: 'Credit', creditDays: 0
    });
    seedPayable('payitem_1785944000846_luqy4w', 'PAY-ITEM-2026-000846-ym9',
      'historical_ci', 'hci_1785853312118_6a7rzp',
      { sourceNo: 'HIT20251118-1A', feeType: 'balance', amountMinor: 27253909 });
    seedPR('pay_1786243409982_5eqebp', 'PAY-MULTI-2026-409982', {
      paymentMode: 'multi', payableAmount: 272539.09, currency: 'RMB',
      approvalStatus: 'pending', paymentStatus: 'pending_approval'
    });
    linkItem('pay_1786243409982_5eqebp', 'payitem_1785944000846_luqy4w', 27253909);

    const p = pendingRows()[0];
    assert.equal(p.sources[0].source_type, 'historical_ci');
    assert.equal(p.sources[0].source_no, 'HIT20251118-1A');
    assert.equal(p.sources[0].related_ci_no, 'HIT20251118-1A');
    assert.equal(p.sources[0].payment_terms_display, 'Credit');
    assert.equal(p.source_summary.source_nos_display, 'HIT20251118-1A');
    assert.equal(p.source_summary.related_ci_nos_display, 'HIT20251118-1A');
  });

  test('T14 — 来源缺失待审：安全降级，不报错', () => {
    // 14a：待审单无任何来源（主表字段空、无 items）
    seedPR('pr_t14a', 'PAY-MULTI-T14A', { payableAmount: 1000, approvalStatus: 'pending', paymentStatus: 'pending_approval' });
    // 14b：有 items 但来源单据已被删除（悬空引用）
    seedPayable('pay_t14b', 'PAY-ITEM-T14B', 'ci', 'ci_gone', { sourceNo: 'CI-GONE', amountMinor: 500000 });
    seedPR('pr_t14b', 'PAY-MULTI-T14B', { payableAmount: 5000, approvalStatus: 'pending', paymentStatus: 'pending_approval' });
    linkItem('pr_t14b', 'pay_t14b', 500000);
    // 14c：旧 single 单，主表有来源字段但无 items（回退路径）
    seedHCI('hci_t14c', 'HITOLD-1', { paymentTerms: 'Credit' });
    seedPR('pr_t14c', 'PAY-HCI-T14C', {
      paymentMode: 'single', sourceType: 'historical_ci', sourceId: 'hci_t14c',
      sourceNo: 'HITOLD-1', relatedCiId: 'hci_t14c', paymentTerms: 'Credit',
      payableAmount: 2000, approvalStatus: 'pending', paymentStatus: 'pending_approval'
    });

    let rows;
    assert.doesNotThrow(() => { rows = pendingRows(); });
    assert.equal(rows.length, 3);
    const byNo = {};
    rows.forEach(r => { byNo[r.request_no] = r; });

    assert.deepEqual(byNo['PAY-MULTI-T14A'].sources, [], '无来源关系时返回空数组，不臆造');
    assert.equal(byNo['PAY-MULTI-T14A'].source_summary.source_nos_display, '');

    assert.equal(byNo['PAY-MULTI-T14B'].sources.length, 1, '悬空引用仍保留 payable_items 已存单号');
    assert.equal(byNo['PAY-MULTI-T14B'].source_summary.source_nos_display, 'CI-GONE');
    assert.equal(byNo['PAY-MULTI-T14B'].source_summary.related_ci_nos_display, '');

    // 回退路径依赖 SELECT 中的 related_ci_id / payment_terms
    assert.equal(byNo['PAY-HCI-T14C'].source_summary.source_nos_display, 'HITOLD-1');
    assert.equal(byNo['PAY-HCI-T14C'].source_summary.related_ci_nos_display, 'HITOLD-1');
    assert.equal(byNo['PAY-HCI-T14C'].source_summary.payment_terms_display, 'Credit');
  });

  test('T15 — 三处同口径：付款管理列表 / 付款申请详情 / 审批中心待审列表 完全一致', () => {
    seedCI('ci_t15', 'NHT260514A', { paymentTerms: 'Credit 45 days', creditDays: 45, relatedPiNo: 'NHT260417A' });
    seedPI('pi_t15', 'NHT260417A');
    seedBatch('log_t15', 'SZIAF014533', 'ci_t15', 'NHT260514A');
    seedPayable('pay_t15a', 'PAY-ITEM-T15A', 'pi', 'pi_t15', {
      sourceNo: 'NHT260417A', sourceCiId: 'ci_t15', feeType: 'balance', amountMinor: 20846996
    });
    seedPayable('pay_t15b', 'PAY-ITEM-T15B', 'logistics', 'log_t15', {
      sourceNo: 'SZIAF014533', sourceCiId: 'ci_t15', feeType: 'freight',
      categoryCode: 'warehouse_arrival', subcategoryCode: 'freight', amountMinor: 1360100
    });
    seedPR('pr_t15', 'PAY-MULTI-T15', {
      paymentMode: 'multi', payableAmount: 222070.96,
      approvalStatus: 'pending', paymentStatus: 'pending_approval'
    });
    linkItem('pr_t15', 'pay_t15a', 20846996);
    linkItem('pr_t15', 'pay_t15b', 1360100);

    // ① 付款管理列表路径（SELECT * + attachPaymentSourceTrace）
    const listRow = query('SELECT * FROM payment_requests WHERE id = ?', ['pr_t15']).rows;
    attachPaymentSourceTrace(listRow);

    // ② 付款申请详情路径（resolvePaymentSourcesForRequests + summarizePaymentSources）
    const detailRow = queryOne('SELECT * FROM payment_requests WHERE id = ?', ['pr_t15']);
    const detailSources = resolvePaymentSourcesForRequests([detailRow]).get('pr_t15');
    const detailSummary = summarizePaymentSources(detailSources);

    // ③ 审批中心待审列表路径（pending 固定列 SELECT + attachPaymentSourceTrace）
    const approvalRow = pendingRows()[0];

    assert.deepEqual(approvalRow.sources, listRow[0].sources, '审批中心 sources 必须等于付款管理列表 sources');
    assert.deepEqual(approvalRow.source_summary, listRow[0].source_summary, '审批中心 source_summary 必须等于付款管理列表');
    assert.deepEqual(detailSources, listRow[0].sources, '详情 sources 必须等于付款管理列表 sources');
    assert.deepEqual(detailSummary, listRow[0].source_summary, '详情 source_summary 必须等于付款管理列表');

    // 关键口径断言：CI + 费用单混合，且多来源不能只取第一条
    assert.equal(approvalRow.source_summary.count, 2);
    assert.equal(approvalRow.source_summary.source_nos_display, 'NHT260417A、SZIAF014533');
    assert.equal(approvalRow.source_summary.related_ci_nos_display, 'NHT260514A');
    assert.equal(approvalRow.source_summary.source_types.length, 2);
    assert.equal(approvalRow.source_summary.fee_nos.length, 2);
  });

  test('T16 — 静态守卫：pending API 必须接入统一解析器且 SELECT 含回退所需列', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, 'server.js'), 'utf8');
    const start = src.indexOf("app.get('/api/payment-requests/pending'");
    assert.ok(start > 0, '未找到 pending 路由');
    const body = src.slice(start, start + 1400);

    assert.ok(/attachPaymentSourceTrace\(rows\)/.test(body),
      'pending 路由必须调用 attachPaymentSourceTrace（与列表/详情同一解析器）');
    assert.ok(/payment_terms/.test(body), 'pending SELECT 必须含 payment_terms（resolver 回退路径需要）');
    assert.ok(/related_ci_id/.test(body), 'pending SELECT 必须含 related_ci_id（resolver 回退路径需要）');
    assert.ok(!/resolvePaymentSourcesForRequests\s*\(/.test(body),
      'pending 路由不得自行另写解析逻辑，必须复用 attachPaymentSourceTrace');
  });
});

describe('PAY-SOURCE-TRACE 展示工具函数', () => {
  test('compactSourceNos — 去重 / 空值 / 折叠计数', () => {
    assert.equal(compactSourceNos([]), '');
    assert.equal(compactSourceNos(null), '');
    assert.equal(compactSourceNos(['', '  ', null]), '');
    assert.equal(compactSourceNos(['HIT-A']), 'HIT-A');
    assert.equal(compactSourceNos(['HIT-A', 'HIT-B']), 'HIT-A、HIT-B');
    assert.equal(compactSourceNos(['HIT-A', 'HIT-A', 'HIT-B']), 'HIT-A、HIT-B', '必须去重');
    assert.equal(compactSourceNos(['HIT-A', 'HIT-B', 'HIT-C']), 'HIT-A、HIT-B +1');
    assert.equal(compactSourceNos(['A', 'B', 'C', 'D']), 'A、B +2');
    assert.equal(compactSourceNos(['A', 'B', 'C'], 3), 'A、B、C');
  });

  test('formatPaymentTermsDisplay — 付款条件组合展示', () => {
    assert.equal(formatPaymentTermsDisplay('', 0), '');
    assert.equal(formatPaymentTermsDisplay(null, null), '');
    assert.equal(formatPaymentTermsDisplay('Credit', 0), 'Credit');
    assert.equal(formatPaymentTermsDisplay('Credit', 45), 'Credit · 45天');
    assert.equal(formatPaymentTermsDisplay('Credit 45 days', 45), 'Credit 45 days', '原文已含天数不重复拼接');
    assert.equal(formatPaymentTermsDisplay('', 30), '30天');
  });
});
