'use strict';

/**
 * 完整费用台账回归测试（应付费用列表 PAY-CORE ledger）
 * ============================================================================
 * 需求：应付费用列表 = 完整费用历史台账（未付款 / 部分付款 / 已付清，cancelled 排除）。
 * 覆盖用户拍板的 20 条验收场景 + 补充口径场景。
 *
 * 驱动方式（忠实于生产代码）：HTTP 驱动真实端点
 *   GET /api/payable-items        （列表 + 新筛参）
 *   GET /api/payable-items/facets （品牌/国家动态选项）
 * 数据库：:memory: SQLite（db.initDatabase() 全量真实 schema，零漂移）。
 *
 * 付款种子走生产真实写入路径：
 *   payment_settlement_logs(payment, applied) + payment_transactions(reconciled)
 *   + payment_allocations(reconciled) —— 与 server.js 确认付款时一致。
 * 红线：仅新增本测试文件；不改生产数据。
 */

process.env.DB_DRIVER = 'sqlite';
process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { query, queryOne, run, getDB } = require('../db');

require('../db').initDatabase();
const { app } = require('../server');

// ---------------------------------------------------------------------------
// 鉴权种子
// ---------------------------------------------------------------------------
let AUTH_TOKEN = null;
(function seedAuth() {
  run("INSERT OR REPLACE INTO roles (id, name, permissions) VALUES ('role_pay','Payer','[\"payment_view\"]')");
  run("INSERT OR REPLACE INTO users (id, username, name, role_id, status) VALUES ('u_pay','payer','Payer','role_pay','active')");
  AUTH_TOKEN = 'test-ledger-' + crypto.randomBytes(8).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(AUTH_TOKEN).digest('hex');
  run("INSERT OR REPLACE INTO sessions (id, token_hash, user_id, created_at, expires_at) VALUES ('s_pay', ?, 'u_pay', datetime('now'), '2099-12-31 23:59:59')", [tokenHash]);
})();

function uid(p) { return p + '_' + Math.random().toString(36).slice(2, 9); }

const PAY_TABLES = [
  // 顺序敏感：payment_allocations FK→payment_request_items/transactions；
  // settlement_logs/transactions FK→payment_requests —— 先删子表再删父表
  'payment_allocations', 'payment_transactions', 'payment_settlement_logs', 'payment_request_items',
  'payment_requests', 'payable_items', 'ci_cost_items', 'logistics_batches',
  'commercial_invoices', 'historical_commercial_invoices', 'proforma_invoices'
];
function resetLedgerData() {
  const d = getDB();
  for (const t of PAY_TABLES) d.exec(`DELETE FROM ${t};`);
}

// ---------------------------------------------------------------------------
// 来源单据种子
// ---------------------------------------------------------------------------
function seedCi(id, brand, country) {
  run("INSERT INTO commercial_invoices (id, ci_no, ci_date, brand, country) VALUES (?, ?, '2026-07-01', ?, ?)",
    [id, 'CI_' + id, brand, country]);
  return id;
}
function seedHistoricalCi(id, brandName, country) {
  run(`INSERT INTO historical_commercial_invoices
        (id, historical_ci_no, supplier_name, supplier_identity, brand_name, country, ci_date, currency,
         gross_goods_amount, historical_paid_amount, idempotency_key, payload_hash, source_mode)
       VALUES (?, ?, 'HistSupplier', 'sup:hist', ?, ?, '2026-01-01', 'USD', 1000, 0, ?, 'hash', 'historical')`,
    [id, 'HCI_' + id, brandName, country, 'idem_' + id]);
  return id;
}
function seedPi(id, brand, country) {
  run("INSERT INTO proforma_invoices (id, pi_no, pi_date, brand, country) VALUES (?, ?, '2026-06-01', ?, ?)",
    [id, 'PI_' + id, brand, country]);
  return id;
}

// payable_items：feeType + lifecycle 可配；subcategoryCode 决定定金/尾款派生路径
function seedPayable(opts) {
  const id = opts.id || uid('pit');
  run(`INSERT INTO payable_items
        (id, fee_no, source_type, source_id, source_no, source_ci_id, fee_type, category_code,
         subcategory_code, payee_type, payee_key, payee_name_snapshot, payer_entity_key,
         payer_name_snapshot, currency, payable_amount_minor, is_active, lifecycle_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, 'factory', 'fac:xyz', 'Snap', 'payer', 'Payer', 'USD', ?, 1, ?)`,
    [id, opts.feeNo, opts.sourceType, opts.sourceId, opts.sourceNo || '', opts.sourceCiId || '',
     opts.feeType || 'balance', opts.subcategoryCode || '', opts.amountMinor || 100000,
     opts.lifecycle || 'active']);
  return id;
}

// 一笔真实付款（生产写入路径：settlement log + transaction + allocation）
function seedRealPayment(payableId, amountMinor, paidDate, opts) {
  const pr = uid('pr');
  const pri = uid('pri');
  const psl = uid('psl');
  const tx = uid('tx');
  const alc = uid('alc');
  run("INSERT INTO payment_requests (id, request_no) VALUES (?, ?)", [pr, 'PR_' + pr]);
  run("INSERT INTO payment_request_items (id, payment_request_id, payable_item_id, requested_amount_minor) VALUES (?, ?, ?, ?)",
    [pri, pr, payableId, amountMinor]);
  run(`INSERT INTO payment_settlement_logs
        (id, payment_request_id, event_type, amount, status, reason, paid_date, operator_name, is_legacy)
       VALUES (?, ?, 'payment', ?, 'applied', 'test', ?, 'tester', 0)`,
    [psl, pr, amountMinor / 100, paidDate]);
  run(`INSERT INTO payment_transactions
        (id, trans_no, payment_request_id, paid_amount_minor, paid_date, trans_status, settlement_log_id)
       VALUES (?, ?, ?, ?, ?, 'reconciled', ?)`,
    [tx, 'TX_' + tx, pr, amountMinor, paidDate, psl]);
  run("INSERT INTO payment_allocations (id, transaction_id, payment_request_item_id, allocated_amount_minor, status) VALUES (?, ?, ?, ?, 'reconciled')",
    [alc, tx, pri, amountMinor]);
  return pr;
}

// 纯抵扣结清（无真实付款事件）
function seedDeductionSettle(payableId, amountMinor) {
  const pr = uid('pr');
  const pri = uid('pri');
  const psl = uid('psl');
  run("INSERT INTO payment_requests (id, request_no) VALUES (?, ?)", [pr, 'PR_' + pr]);
  run("INSERT INTO payment_request_items (id, payment_request_id, payable_item_id, requested_amount_minor) VALUES (?, ?, ?, ?)",
    [pri, pr, payableId, amountMinor]);
  run(`INSERT INTO payment_settlement_logs
        (id, payment_request_id, event_type, amount, status, reason, operator_name, is_legacy)
       VALUES (?, ?, 'deduction', ?, 'applied', '全额抵扣', 'tester', 0)`,
    [psl, pr, amountMinor / 100]);
  return pr;
}

// cancelled PR 带付款日志（口径一致性场景：应被排除）
function seedCancelledPrPayment(payableId, amountMinor, paidDate) {
  const pr = uid('pr');
  const pri = uid('pri');
  const psl = uid('psl');
  run("INSERT INTO payment_requests (id, request_no, payment_status, approval_status) VALUES (?, ?, 'cancelled', 'cancelled')", [pr, 'PR_' + pr]);
  run("INSERT INTO payment_request_items (id, payment_request_id, payable_item_id, requested_amount_minor) VALUES (?, ?, ?, ?)",
    [pri, pr, payableId, amountMinor]);
  run(`INSERT INTO payment_settlement_logs
        (id, payment_request_id, event_type, amount, status, reason, paid_date, operator_name, is_legacy)
       VALUES (?, ?, 'payment', ?, 'applied', 'cancelled flow', ?, 'tester', 0)`,
    [psl, pr, amountMinor / 100, paidDate]);
  return pr;
}

// ---------------------------------------------------------------------------
// HTTP 驱动
// ---------------------------------------------------------------------------
async function getJson(pathname) {
  const server = app.listen(0);
  try {
    const port = server.address().port;
    const res = await fetch(`http://127.0.0.1:${port}${pathname}`, {
      method: 'GET',
      headers: { 'Cookie': `session_token=${AUTH_TOKEN}` }
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  } finally {
    await new Promise(r => server.close(r));
  }
}

async function getList(qs) {
  const { status, body } = await getJson('/api/payable-items' + (qs || ''));
  assert.equal(status, 200, 'GET /api/payable-items 应 200');
  return body;
}
function feeSet(body) { return new Set(body.items.map(it => it.fee_no)); }
function byFeeNo(body, feeNo) {
  const it = body.items.find(x => x.fee_no === feeNo);
  assert.ok(it, '列表中应存在 ' + feeNo);
  return it;
}

// ---------------------------------------------------------------------------
// 标准场景数据（每次测试独立重建，id 隔离避免唯一索引冲突）
// ---------------------------------------------------------------------------
function buildStandardScenario(tag) {
  resetLedgerData();
  // ① active 未付款（Netac / 印度尼西亚，运营 CI 来源）
  const ci1 = seedCi('ci1_' + tag, 'Netac', '印度尼西亚');
  const unpaid = seedPayable({ feeNo: 'FEE_UNPAID_' + tag, sourceType: 'ci', sourceId: 'src1_' + tag, sourceCiId: ci1, feeType: 'balance', amountMinor: 100000, lifecycle: 'active' });
  // ② partially_paid（Redragon / 印度尼西亚，2 笔付款 8-05、8-20 各 30000，应付 100000 → remaining 40000）
  const ci2 = seedCi('ci2_' + tag, 'Redragon', '印度尼西亚');
  const partial = seedPayable({ feeNo: 'FEE_PARTIAL_' + tag, sourceType: 'ci', sourceId: 'src2_' + tag, sourceCiId: ci2, feeType: 'balance', amountMinor: 100000, lifecycle: 'partially_paid' });
  seedRealPayment(partial, 30000, '2026-08-05');
  seedRealPayment(partial, 30000, '2026-08-20');
  // ③ paid 已付清（Redragon / 印度尼西亚，3 笔付款 8-05 / 8-20 / 9-01 → MAX=9-01）
  const ci3 = seedCi('ci3_' + tag, 'Redragon', '印度尼西亚');
  const paid = seedPayable({ feeNo: 'FEE_PAID_' + tag, sourceType: 'ci', sourceId: 'src3_' + tag, sourceCiId: ci3, feeType: 'balance', amountMinor: 100000, lifecycle: 'paid' });
  seedRealPayment(paid, 40000, '2026-08-05');
  seedRealPayment(paid, 40000, '2026-08-20');
  seedRealPayment(paid, 20000, '2026-09-01');
  // ④ 纯抵扣结清（历史 CI / country='ID' 存代码 / brand Netac）→ 状态已付清但无真实付款
  const hci = seedHistoricalCi('hci1_' + tag, 'Netac', 'ID');
  const dedSettled = seedPayable({ feeNo: 'FEE_DED_' + tag, sourceType: 'historical_ci', sourceId: 'src4_' + tag, sourceCiId: hci, feeType: 'balance', amountMinor: 100000, lifecycle: 'paid' });
  seedDeductionSettle(dedSettled, 100000);
  // ⑤ cancelled（BOYA / 泰国）→ 默认不显示
  const ci5 = seedCi('ci5_' + tag, 'BOYA', '泰国');
  seedPayable({ feeNo: 'FEE_CANCEL_' + tag, sourceType: 'ci', sourceId: 'src5_' + tag, sourceCiId: ci5, feeType: 'balance', amountMinor: 100000, lifecycle: 'cancelled' });
  // ⑥ manual 无来源单据（无品牌）→ 只在「全部」显示
  const manual = seedPayable({ feeNo: 'FEE_MANUAL_' + tag, sourceType: 'manual', sourceId: 'src6_' + tag, feeType: 'other_local', amountMinor: 50000, lifecycle: 'active' });
  // ⑦ PR cancelled 带付款日志（Joypeer / 马来西亚）→ 应视为无付款
  const ci7 = seedCi('ci7_' + tag, 'Joypeer', '马来西亚');
  const cancelPaid = seedPayable({ feeNo: 'FEE_CANPR_' + tag, sourceType: 'ci', sourceId: 'src7_' + tag, sourceCiId: ci7, feeType: 'balance', amountMinor: 100000, lifecycle: 'active' });
  seedCancelledPrPayment(cancelPaid, 30000, '2026-08-10');
  // ⑧ Netac / 马来西亚 已付清，付款 7-15（用于 to-only / 组合排除）
  const ci8 = seedCi('ci8_' + tag, 'Netac', '马来西亚');
  const paidMy = seedPayable({ feeNo: 'FEE_MYPAID_' + tag, sourceType: 'ci', sourceId: 'src8_' + tag, sourceCiId: ci8, feeType: 'balance', amountMinor: 100000, lifecycle: 'paid' });
  seedRealPayment(paidMy, 100000, '2026-07-15');
  // ⑨ 定金 deposit（Netac / 印度尼西亚，PI 来源，active 无付款）→ 品牌走 PI.brand
  const pi9 = seedPi('pi9_' + tag, 'Netac', '印度尼西亚');
  seedPayable({ feeNo: 'FEE_DEP_' + tag, sourceType: 'pi', sourceId: pi9, feeType: 'deposit', subcategoryCode: 'deposit', amountMinor: 20000, lifecycle: 'active' });
  return { unpaid, partial, paid, dedSettled, manual, cancelPaid, paidMy };
}

// ---------------------------------------------------------------------------
// 场景 1-4：基础显示（active / partially_paid / paid 显示，cancelled 不显示）
// ---------------------------------------------------------------------------
test('ledger #1/#2/#3/#4: active+partially_paid+paid 均显示，cancelled 不显示', async () => {
  const s = buildStandardScenario('base');
  const body = await getList('');
  const fees = feeSet(body);
  assert.ok(fees.has('FEE_UNPAID_' + 'base'), '未付款(active)应显示');
  assert.ok(fees.has('FEE_PARTIAL_base'), '部分付款(partially_paid)应显示');
  assert.ok(fees.has('FEE_PAID_base'), '已付清(paid)应显示');
  assert.ok(!fees.has('FEE_CANCEL_base'), 'cancelled 不应显示');
  assert.equal(body.total, body.items.length, 'total 应等于 items 长度（无分页，全量返回）');
  const paidRow = byFeeNo(body, 'FEE_PAID_base');
  assert.equal(paidRow.remaining_amount, 0, '已付清剩余未付=0');
  assert.equal(paidRow.payment_state, 'paid');
  assert.equal(paidRow.paid_amount, 1000); // 100000 minor = 1000 元
});

// ---------------------------------------------------------------------------
// 场景 5-7：付款状态筛选（金额事实口径）
// ---------------------------------------------------------------------------
test('ledger #5: payment_status=unpaid 只回未付款（含 PR cancelled 的无付款费用，不含纯抵扣结清）', async () => {
  buildStandardScenario('unp');
  const body = await getList('?payment_status=unpaid');
  const fees = feeSet(body);
  assert.ok(fees.has('FEE_UNPAID_unp'));
  assert.ok(fees.has('FEE_MANUAL_unp'), 'manual 无品牌费用在 unpaid 筛选下正常显示');
  assert.ok(fees.has('FEE_CANPR_unp'), 'PR cancelled 的费用无真实付款 → 属未付款');
  assert.ok(fees.has('FEE_DEP_unp'));
  assert.ok(!fees.has('FEE_PARTIAL_unp'), 'partial 不应出现');
  assert.ok(!fees.has('FEE_PAID_unp'), 'paid 不应出现');
  assert.ok(!fees.has('FEE_DED_unp'), '纯抵扣结清不是未付款');
  body.items.forEach(it => assert.equal(it.payment_state, 'unpaid'));
});

test('ledger #6: payment_status=partial 只回部分付款', async () => {
  buildStandardScenario('par');
  const body = await getList('?payment_status=partial');
  const fees = feeSet(body);
  assert.ok(fees.has('FEE_PARTIAL_par'));
  assert.equal(body.items.length, 1, '场景中仅 1 笔部分付款');
  body.items.forEach(it => {
    assert.equal(it.payment_state, 'partial');
    assert.ok(it.remaining_amount > 0);
    assert.ok(it.paid_amount > 0);
  });
});

test('ledger #7/#17: payment_status=paid 回已付清（含纯抵扣结清）', async () => {
  buildStandardScenario('pds');
  const body = await getList('?payment_status=paid');
  const fees = feeSet(body);
  assert.ok(fees.has('FEE_PAID_pds'), '真实付款付清');
  assert.ok(fees.has('FEE_DED_pds'), '纯抵扣结清按 remaining=0 归已付清');
  assert.ok(fees.has('FEE_MYPAID_pds'));
  body.items.forEach(it => {
    assert.equal(it.payment_state, 'paid');
    assert.equal(it.remaining_amount, 0);
  });
});

// ---------------------------------------------------------------------------
// 场景 8-11：品牌 / 国家筛选 + 归一 + 无品牌
// ---------------------------------------------------------------------------
test('ledger #8: brand=Redragon 只回 Redragon（大小写不敏感）', async () => {
  buildStandardScenario('brd');
  const body = await getList('?brand=redragon');
  const fees = feeSet(body);
  assert.ok(fees.has('FEE_PARTIAL_brd'));
  assert.ok(fees.has('FEE_PAID_brd'));
  assert.ok(!fees.has('FEE_UNPAID_brd'), 'Netac 不应出现');
  assert.ok(!fees.has('FEE_MANUAL_brd'), '无品牌不命中品牌筛选');
  body.items.forEach(it => assert.equal(String(it.brand).toLowerCase(), 'redragon'));
});

test('ledger #9/#10: country 中文与历史 CI 代码归一到同一筛选值', async () => {
  buildStandardScenario('cty');
  // 中文「印度尼西亚」与代码 ID 均应命中运营 CI（存中文）与历史 CI（存代码 ID）
  for (const q of ['?country=' + encodeURIComponent('印度尼西亚'), '?country=ID', '?country=' + encodeURIComponent('印尼'), '?country=IND']) {
    const body = await getList(q);
    const fees = feeSet(body);
    assert.ok(fees.has('FEE_UNPAID_cty'), q + ' 应命中运营 CI 费用（存中文）');
    assert.ok(fees.has('FEE_DED_cty'), q + ' 应命中历史 CI 费用（存代码 ID）');
    assert.ok(fees.has('FEE_DEP_cty'), q + ' 应命中定金（PI 来源）');
    assert.ok(!fees.has('FEE_MYPAID_cty'), q + ' 不应命中马来西亚费用');
    body.items.forEach(it => assert.equal(it.country_code, 'ID'));
  }
});

test('ledger #11: 无品牌费用在「全部」中正常显示、facets 不含空品牌', async () => {
  buildStandardScenario('nob');
  const all = await getList('');
  assert.ok(feeSet(all).has('FEE_MANUAL_nob'), '无品牌在全部中显示');
  assert.equal(byFeeNo(all, 'FEE_MANUAL_nob').brand, '', 'manual 品牌为空字符串');
  const f = await getJson('/api/payable-items/facets');
  assert.equal(f.status, 200);
  assert.ok(f.body.brands.every(b => b && b.trim()), 'facets 品牌不含空值');
  assert.ok(f.body.brands.includes('Redragon'));
  assert.ok(f.body.brands.includes('Netac'));
  assert.ok(f.body.brands.includes('Joypeer'));
  assert.ok(!f.body.brands.includes('BOYA'), '仅 cancelled 费用的品牌不进 facets');
});

// ---------------------------------------------------------------------------
// 场景 12-15：付款日期区间（真实付款流水 EXISTS）
// ---------------------------------------------------------------------------
test('ledger #12: pay_date_from only（含 2026-08-01 起的付款即命中，7-15 不命中）', async () => {
  buildStandardScenario('fdf');
  const body = await getList('?pay_date_from=2026-08-01');
  const fees = feeSet(body);
  assert.ok(fees.has('FEE_PARTIAL_fdf'), '8-05 付款命中');
  assert.ok(fees.has('FEE_PAID_fdf'), '8-05/8-20/9-01 付款命中');
  assert.ok(!fees.has('FEE_MYPAID_fdf'), '7-15 付款不命中 from=8-01');
  assert.ok(!fees.has('FEE_DED_fdf'), '纯抵扣无 payment 事件不命中');
  assert.ok(!fees.has('FEE_UNPAID_fdf'), '无付款不命中');
});

test('ledger #13: pay_date_to only', async () => {
  buildStandardScenario('fdt');
  const body = await getList('?pay_date_to=2026-07-31');
  const fees = feeSet(body);
  assert.ok(fees.has('FEE_MYPAID_fdt'), '7-15 付款命中 to=7-31');
  assert.ok(!fees.has('FEE_PARTIAL_fdt'), '8 月付款不命中');
  assert.ok(!fees.has('FEE_PAID_fdt'), '8/9 月付款不命中');
});

test('ledger #14: from+to 区间', async () => {
  buildStandardScenario('frt');
  const body = await getList('?pay_date_from=2026-08-01&pay_date_to=2026-08-31');
  const fees = feeSet(body);
  assert.ok(fees.has('FEE_PARTIAL_frt'));
  assert.ok(fees.has('FEE_PAID_frt'));
  assert.ok(!fees.has('FEE_MYPAID_frt'), '7-15 在区间外');
});

test('ledger #15: 多次付款任意一笔命中即出现（8-05/8-20/9-01，筛 8 月与筛 9 月均命中同一费用）', async () => {
  buildStandardScenario('multi');
  const aug = await getList('?pay_date_from=2026-08-01&pay_date_to=2026-08-31');
  assert.ok(feeSet(aug).has('FEE_PAID_multi'), '8 月区间命中');
  const sep = await getList('?pay_date_from=2026-09-01&pay_date_to=2026-09-30');
  assert.ok(feeSet(sep).has('FEE_PAID_multi'), '9 月区间也应命中（任意一笔命中即可）');
  const jul = await getList('?pay_date_from=2026-07-01&pay_date_to=2026-07-31');
  assert.ok(!feeSet(jul).has('FEE_PAID_multi'), '7 月区间不命中');
});

// ---------------------------------------------------------------------------
// 场景 16-18：最近付款日期 / 纯抵扣结清 / 无付款
// ---------------------------------------------------------------------------
test('ledger #16: last_payment_date = MAX(真实 payment paid_date)', async () => {
  buildStandardScenario('lpd');
  const body = await getList('');
  assert.equal(byFeeNo(body, 'FEE_PAID_lpd').last_payment_date, '2026-09-01', '取最新一笔真实付款日期');
  assert.equal(byFeeNo(body, 'FEE_PARTIAL_lpd').last_payment_date, '2026-08-20');
});

test('ledger #17b: 纯抵扣结清 → 已付清但最近付款日期为空、日期筛选不命中', async () => {
  buildStandardScenario('ded');
  const all = await getList('');
  const row = byFeeNo(all, 'FEE_DED_ded');
  assert.equal(row.payment_state, 'paid', 'remaining=0 → 已付清');
  assert.equal(row.remaining_amount, 0);
  assert.equal(row.deduction_amount, 1000, '抵扣金额=全额');
  assert.equal(row.paid_amount, 0, '无真实付款');
  assert.equal(row.last_payment_date, '', '无真实 payment → 最近付款日期为空');
  const aug = await getList('?pay_date_from=2026-08-01&pay_date_to=2026-08-31');
  assert.ok(!feeSet(aug).has('FEE_DED_ded'), '付款日期筛选不命中（无真实付款流水）');
});

test('ledger #18: 无付款费用使用付款日期筛选时不出现', async () => {
  buildStandardScenario('nopay');
  const body = await getList('?pay_date_from=2026-01-01&pay_date_to=2026-12-31');
  const fees = feeSet(body);
  assert.ok(!fees.has('FEE_UNPAID_nopay'));
  assert.ok(!fees.has('FEE_MANUAL_nopay'));
  assert.ok(!fees.has('FEE_CANPR_nopay'), 'PR cancelled 的日志不是真实付款');
  assert.ok(!fees.has('FEE_DEP_nopay'));
});

// ---------------------------------------------------------------------------
// 场景 19：多条件组合
// ---------------------------------------------------------------------------
test('ledger #19: 已付清 + Redragon + 印度尼西亚 + 8 月区间 组合筛选', async () => {
  buildStandardScenario('combo');
  const qs = '?payment_status=paid&brand=Redragon&country=' + encodeURIComponent('印度尼西亚') + '&pay_date_from=2026-08-01&pay_date_to=2026-08-31';
  const body = await getList(qs);
  const fees = feeSet(body);
  assert.ok(fees.has('FEE_PAID_combo'), '核心组合应命中');
  assert.equal(body.items.length, 1, '组合条件下仅 1 笔');
  const it = body.items[0];
  assert.equal(it.payment_state, 'paid');
  assert.equal(it.brand, 'Redragon');
  assert.equal(it.country_code, 'ID');
  assert.equal(it.remaining_amount, 0);
  assert.equal(it.last_payment_date, '2026-09-01');
});

// ---------------------------------------------------------------------------
// 场景 20：无分页 + total 一致
// ---------------------------------------------------------------------------
test('ledger #20: 本端点无分页，total 与 items 完全一致', async () => {
  buildStandardScenario('page');
  const body = await getList('');
  assert.ok(Array.isArray(body.items));
  assert.equal(body.total, body.items.length);
  assert.equal(body.items.length, 8, '8 笔非 cancelled 费用全量返回');
});

// ---------------------------------------------------------------------------
// 补充口径场景
// ---------------------------------------------------------------------------
test('ledger #22: PR cancelled 的付款日志不参与日期筛选与最近付款日期（与 breakdown 同口径）', async () => {
  buildStandardScenario('canpr');
  const body = await getList('');
  const row = byFeeNo(body, 'FEE_CANPR_canpr');
  assert.equal(row.payment_state, 'unpaid', 'cancelled PR 的付款不计入金额事实');
  assert.equal(row.paid_amount, 0);
  assert.equal(row.last_payment_date, '');
  const aug = await getList('?pay_date_from=2026-08-01&pay_date_to=2026-08-31');
  assert.ok(!feeSet(aug).has('FEE_CANPR_canpr'));
});

test('ledger #23: pay_date 非法格式返回 400', async () => {
  buildStandardScenario('badfmt');
  const bad1 = await getJson('/api/payable-items?pay_date_from=2026/08/01');
  assert.equal(bad1.status, 400);
  const bad2 = await getJson('/api/payable-items?pay_date_to=08-31-2026');
  assert.equal(bad2.status, 400);
  const ok = await getJson('/api/payable-items?pay_date_from=2026-08-01');
  assert.equal(ok.status, 200);
});

test('ledger #24: keyword 扩展供应商搜索（JOIN 派生列）', async () => {
  resetLedgerData();
  const ci = seedCi('ci_kw', 'Netac', '印度尼西亚');
  run("UPDATE commercial_invoices SET supplier_name = 'Shenzhen Keeb Co' WHERE id = 'ci_kw'");
  seedPayable({ feeNo: 'FEE_KW', sourceType: 'ci', sourceId: 'src_kw', sourceCiId: ci, feeType: 'balance', amountMinor: 100000, lifecycle: 'active' });
  const body = await getList('?keyword=' + encodeURIComponent('Keeb'));
  assert.ok(feeSet(body).has('FEE_KW'), '供应商名可被关键词命中');
});

test('ledger #25: facets 国家选项归一去重（历史 CI ID 与运营 CI 中文合并为一项）', async () => {
  buildStandardScenario('facets');
  const f = await getJson('/api/payable-items/facets');
  assert.equal(f.status, 200);
  const idEntries = f.body.countries.filter(c => c.code === 'ID');
  assert.equal(idEntries.length, 1, 'ID 应去重为单项');
  assert.equal(idEntries[0].name, '印度尼西亚', '显示名走 displayCountry');
  assert.ok(f.body.countries.some(c => c.code === 'MY'), '马来西亚在选项中');
  assert.ok(!f.body.countries.some(c => c.code === 'TH'), '仅 cancelled 费用的泰国不进 facets（正确排除）');
});

test('ledger #26: 传 lifecycle_status=paid 的历史精确查询仍可用（兼容性）', async () => {
  buildStandardScenario('compat');
  const body = await getList('?lifecycle_status=paid');
  const fees = feeSet(body);
  assert.ok(fees.has('FEE_PAID_compat'));
  assert.ok(fees.has('FEE_DED_compat'));
  assert.ok(!fees.has('FEE_UNPAID_compat'), '精确查询仍按传参过滤');
});
