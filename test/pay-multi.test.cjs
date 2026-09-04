'use strict';

/**
 * PAY-MULTI 业务回归测试（生产行为锁定）
 * ============================================================================
 * 目标：把 origin/main = 9592688 已在生产运行的 PAY-MULTI 行为锁住，防止未来回归。
 *
 * 驱动方式（忠实于生产代码，不复制生产逻辑到测试里「自己测自己」）：
 *   · 函数级（#2/#3/#4/#6/#7）：直接调用 server.js 真实导出的
 *     recalculatePaymentSettlement / syncPaymentSource 内部分支，断言 DB 终态。
 *   · 路由级（#1/#5）：驱动真实 HTTP 端点 /api/payment-requests/multi-expense
 *     （app.listen(0) + fetch + 会话 cookie），断言 payment_requests 落库行。
 *
 * 数据库：:memory: SQLite（db.initDatabase() 建全量真实 schema，零漂移风险），
 *         不触碰任何生产/本地 data/*.db 文件。
 *
 * 红线：仅新增本测试文件；不改 server.js / db*.js / app.js；不改生产数据；
 *       不 commit / 不 push / 不 deploy。
 */

process.env.DB_DRIVER = 'sqlite';
process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test'; // 关闭 CSRF，便于测试驱动真实路由

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { query, queryOne, run, getDB } = require('../db');

// 必须在 require('./server') 之前初始化全量真实 schema（server 解构 db 的 query/run 等）
require('../db').initDatabase();

// 导出真实函数 + 真实 express app（require 不会起服务：app.listen 在 require.main 守卫内）
const { recalculatePaymentSettlement, app } = require('../server');

// ---------------------------------------------------------------------------
// 鉴权种子（仅供 HTTP 路由级测试使用，复制自 inventory-safe-delete.test.cjs 模式）
// ---------------------------------------------------------------------------
let AUTH_TOKEN = null;
function seedAuth() {
  run("INSERT OR REPLACE INTO roles (id, name, permissions) VALUES ('role_pay','Payer','[\"payment_create\",\"payment_view\",\"payment_approval\"]')");
  run("INSERT OR REPLACE INTO users (id, username, name, role_id, status) VALUES ('u_pay','payer','Payer','role_pay','active')");
  AUTH_TOKEN = 'test-session-token-' + crypto.randomBytes(8).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(AUTH_TOKEN).digest('hex');
  run("INSERT OR REPLACE INTO sessions (id, token_hash, user_id, created_at, expires_at) VALUES ('s_pay', ?, 'u_pay', datetime('now'), '2099-12-31 23:59:59')", [tokenHash]);
}
seedAuth();

// ---------------------------------------------------------------------------
// 数据工具
// ---------------------------------------------------------------------------
function uid(p) { return p + '_' + Math.random().toString(36).slice(2, 9); }

// 付款相关表 + 来源单据：每次测试前清空（countries/roles/users/sessions 持久，供鉴权）
const PAY_TABLES = [
  'payment_request_items', 'payment_settlement_logs', 'payment_transactions', 'payment_allocations',
  'payable_items', 'ci_cost_items', 'logistics_batches', 'commercial_invoices',
  'proforma_invoices', 'payment_requests'
];
function resetPaymentData() {
  const d = getDB();
  for (const t of PAY_TABLES) d.exec(`DELETE FROM ${t};`);
}

function seedCountry() {
  run("INSERT OR REPLACE INTO countries (id, name, code, status) VALUES ('c1','印度尼西亚','ID','active')");
}

function readPR(id) { return queryOne('SELECT * FROM payment_requests WHERE id = ?', [id]); }
function readLB(id) { return queryOne('SELECT * FROM logistics_batches WHERE id = ?', [id]); }
function readCI(id) { return queryOne('SELECT * FROM commercial_invoices WHERE id = ?', [id]); }
function countRows(t, where, params) { return query(`SELECT COUNT(*) AS n FROM ${t} ${where || ''}`, params || []).rows[0].n; }

// 构造一个「freight payable → ci_cost_items(canonical) → logistics_batches」场景
// 返回 { pr, lb, pi, cci }，供 fee_status / recalc 直接调用 recalculatePaymentSettlement 测试
function seedFreightScenario(opts) {
  const lb = opts.lb || uid('lb');
  const pi = opts.pi || uid('pi_fr');
  const pr = opts.pr || uid('pay');
  const lifecycle = opts.lifecycle || 'active';
  const sourceType = opts.sourceType || ''; // 默认多费用 PR 主表 source_type 为空
  run("INSERT INTO logistics_batches (id, batch_no, fee_status) VALUES (?, ?, 'cost_generated')", [lb, 'BN_' + lb]);
  run(`INSERT INTO payable_items
        (id, fee_no, source_type, source_id, source_no, source_ci_id, fee_type, category_code,
         subcategory_code, payee_type, payee_key, payee_name_snapshot, payer_entity_key,
         payer_name_snapshot, currency, payable_amount_minor, is_active, lifecycle_status)
       VALUES (?, ?, 'logistics', ?, 'LB', ?, 'freight', '', '', 'freight_co', 'fr:xyz',
               'FreightCo', 'payer', 'Payer', 'USD', 10000, 1, ?)`,
    [pi, 'FEE_' + pi, lb, lb, lifecycle]);
  // canonical freight linkage（cost_category='warehouse_arrival' / cost_subcategory='freight' / include_in_landing_cost=1）
  const canonCount = opts.canonCount || 1;
  for (let i = 0; i < canonCount; i++) {
    const cci = uid('cci');
    const pid = (i === 0) ? pi : uid('pi_fr2');
    if (i !== 0) {
      const otherSrc = uid('oth');
      run(`INSERT INTO payable_items
            (id, fee_no, source_type, source_id, source_no, source_ci_id, fee_type, category_code,
             subcategory_code, payee_type, payee_key, payee_name_snapshot, payer_entity_key,
             payer_name_snapshot, currency, payable_amount_minor, is_active, lifecycle_status)
           VALUES (?, ?, 'logistics', ?, 'LB', '', 'freight', '', '', 'freight_co', 'fr:xyz',
                   'FreightCo', 'payer', 'Payer', 'USD', 10000, 1, ?)`,
        [pid, 'FEE_' + pid, otherSrc, lifecycle]);
    }
    run(`INSERT INTO ci_cost_items
          (id, ci_id, logistics_batch_id, payable_item_id, cost_category, cost_subcategory, include_in_landing_cost)
         VALUES (?, 'ci_freight', ?, ?, 'warehouse_arrival', 'freight', 1)`,
      [cci, lb, pid]);
  }
  run(`INSERT INTO payment_requests
        (id, request_no, payment_category, payment_subcategory, source_type, source_id, source_no,
         payee_type, payee_key, payee_name_snapshot, payable_amount, currency, payment_mode,
         payment_status, approval_status)
       VALUES (?, ?, '', '', ?, '', '', 'freight_co', 'fr:xyz', 'FreightCo', 100, 'USD', 'multi',
               'pending_approval', 'pending')`,
    [pr, 'PR_' + pr, sourceType]);
  run(`INSERT INTO payment_request_items (id, payment_request_id, payable_item_id, requested_amount_minor)
       VALUES (?, ?, ?, 100)`,
    [uid('pri'), pr, pi]);
  return { pr, lb, pi };
}

// HTTP 路由驱动（复制自 inventory-safe-delete.test.cjs）
async function postJson(pathname, payload) {
  const server = app.listen(0);
  try {
    const port = server.address().port;
    const res = await fetch(`http://127.0.0.1:${port}${pathname}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': `session_token=${AUTH_TOKEN}` },
      body: JSON.stringify(payload)
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  } finally {
    await new Promise(r => server.close(r));
  }
}

// 构造 payable_items（供 HTTP 创建端点）
// categoryCode / subcategoryCode 默认空；在 category 合约测试中显式传入以区分真实货款 vs 费用。
function seedPayableItem(opts) {
  const pi = opts.id || uid('pi');
  const categoryCode = opts.categoryCode !== undefined ? opts.categoryCode : '';
  const subcategoryCode = opts.subcategoryCode !== undefined ? opts.subcategoryCode : '';
  run(`INSERT INTO payable_items
        (id, fee_no, source_type, source_id, source_no, source_ci_id, fee_type, category_code,
         subcategory_code, payee_type, payee_key, payee_name_snapshot, payer_entity_key,
         payer_name_snapshot, currency, payable_amount_minor, is_active, lifecycle_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'factory', ?, 'Snap', 'payer', 'Payer', 'USD', 10000, 1, 'active')`,
    [pi, 'FEE_' + pi, opts.sourceType, opts.sourceId, opts.sourceNo || '', opts.sourceCiId || '',
     opts.feeType, categoryCode, subcategoryCode, opts.payeeKey || 'fac:xyz']);
  return pi;
}

// 构造 historical_commercial_invoices 行（historical_ci 来源的国家解析依赖此表）
function seedHistoricalCi(id, country) {
  run(`INSERT INTO historical_commercial_invoices
        (id, historical_ci_no, supplier_name, supplier_identity, brand_name, country, ci_date, currency,
         gross_goods_amount, historical_paid_amount, idempotency_key, payload_hash, source_mode)
       VALUES (?, ?, 'HistSupplier', 'sup:hist', 'Brand', ?, '2026-01-01', 'USD', 1000, 0, ?, 'hash', 'historical')`,
    [id, 'HCI_' + id, country, 'idem_' + id]);
}

// 便捷：从一组 payable 种子创建多费用 PR，返回 { status, body, pr }
async function createMultiPr(items) {
  const ids = items.map(it => seedPayableItem(it));
  const { status, body } = await postJson('/api/payment-requests/multi-expense', { payable_item_ids: ids });
  return { status, body, pr: status === 200 ? readPR(body.id) : null };
}

// ===========================================================================
// #2 freight linkage（canonical freight payable）+ #3 fee_status 三态
// ===========================================================================
test('#2/#3 freight canonical linkage → fee_status 三态映射', () => {
  resetPaymentData();
  // paid → paid
  {
    const { pr, lb } = seedFreightScenario({ lifecycle: 'paid' });
    recalculatePaymentSettlement(pr);
    assert.equal(readLB(lb).fee_status, 'paid', 'lifecycle=paid → fee_status=paid');
  }
  // partially_paid → partial_paid
  {
    const { pr, lb } = seedFreightScenario({ lifecycle: 'partially_paid' });
    recalculatePaymentSettlement(pr);
    assert.equal(readLB(lb).fee_status, 'partial_paid', 'lifecycle=partially_paid → fee_status=partial_paid');
  }
  // active / 其它 → unpaid
  {
    const { pr, lb } = seedFreightScenario({ lifecycle: 'active' });
    recalculatePaymentSettlement(pr);
    assert.equal(readLB(lb).fee_status, 'unpaid', 'lifecycle=active → fee_status=unpaid');
  }
});

test('#2 freight linkage：canonical = 0 → 不动 fee_status（不猜测）', () => {
  resetPaymentData();
  const { pr, lb } = seedFreightScenario({ lifecycle: 'paid' });
  // 删除 canonical linkage（把 ci_cost_items 改成非 canonical 属性）
  run("UPDATE ci_cost_items SET cost_category = 'other', include_in_landing_cost = 0 WHERE logistics_batch_id = ?", [lb]);
  recalculatePaymentSettlement(pr);
  assert.equal(readLB(lb).fee_status, 'cost_generated', '0 canonical → fee_status 保持 cost_generated，不猜测');
});

test('#2 freight linkage：canonical > 1 → fail closed（不静默 aggregate）', () => {
  resetPaymentData();
  const { pr, lb } = seedFreightScenario({ lifecycle: 'paid', canonCount: 2 });
  recalculatePaymentSettlement(pr);
  assert.equal(readLB(lb).fee_status, 'cost_generated', '>1 canonical 冲突 → fail closed，fee_status 保持 cost_generated');
});

// ===========================================================================
// #4 历史多费用 PR（source_type 为空）必须经由 payment_request_items linkage 正确 sync
// ===========================================================================
test('#4 历史多费用 PR source_type 为空 → 仍经 payment_request_items linkage sync fee_status', () => {
  resetPaymentData();
  // 显式 source_type=''（多费用 PR 主表为空），freight payable 经 payment_request_items 关联
  const { pr, lb } = seedFreightScenario({ sourceType: '', lifecycle: 'paid' });
  const row = readPR(pr);
  assert.equal(row.source_type, '', '前置：多费用 PR 主表 source_type 必须为空');
  recalculatePaymentSettlement(pr);
  assert.equal(readLB(lb).fee_status, 'paid', 'source_type 为空时仍经 canonical linkage 正确 sync → paid');
});

test('#4 负例：即便 source_type="logistics" 且有 freight payable，也走 canonical（legacy 不预写）', () => {
  resetPaymentData();
  const { pr, lb } = seedFreightScenario({ sourceType: 'logistics', lifecycle: 'paid' });
  recalculatePaymentSettlement(pr);
  // canonical 优先：hasFreightPayableItems 为真 → legacy 分支完全不进入，fee_status=paid（非 legacy 的 unpaid）
  assert.equal(readLB(lb).fee_status, 'paid', 'canonical 优先于 legacy，未误用 source_type 走 legacy 路径');
});

// ===========================================================================
// #6 recalculatePaymentSettlement 幂等
// ===========================================================================
test('#6 recalc 幂等：连续两次不重复生成 settlement/payment/payable，终态一致', () => {
  resetPaymentData();
  const { pr, lb } = seedFreightScenario({ lifecycle: 'paid' });

  const logsBefore = countRows('payment_settlement_logs', 'WHERE payment_request_id = ?', [pr]);
  const priBefore = countRows('payment_request_items', 'WHERE payment_request_id = ?', [pr]);
  const payBefore = countRows('payable_items');
  const txBefore = countRows('payment_transactions');
  const allocBefore = countRows('payment_allocations');

  const r1 = recalculatePaymentSettlement(pr);
  const r2 = recalculatePaymentSettlement(pr);

  // 终态一致
  assert.equal(readLB(lb).fee_status, 'paid');
  assert.equal(r1.payment_status, r2.payment_status, '两次 payment_status 一致');
  assert.equal(r1.outstanding, r2.outstanding, '两次 outstanding 一致');

  // 不重复生成任何行
  assert.equal(countRows('payment_settlement_logs', 'WHERE payment_request_id = ?', [pr]), logsBefore, 'payment_settlement_logs 不新增');
  assert.equal(countRows('payment_request_items', 'WHERE payment_request_id = ?', [pr]), priBefore, 'payment_request_items 不新增');
  assert.equal(countRows('payable_items'), payBefore, 'payable_items 不新增');
  assert.equal(countRows('payment_transactions'), txBefore, 'payment_transactions 不新增');
  assert.equal(countRows('payment_allocations'), allocBefore, 'payment_allocations 不新增');

  // payment_requests 关键金额列稳定
  const p = readPR(pr);
  assert.equal(Number(p.paid_amount), 0, '无付款 → paid_amount=0');
  assert.equal(Number(p.unpaid_amount), 100, '无付款 → unpaid_amount=payable_amount');
});

// ===========================================================================
// #7 non-PAY-MULTI 回归（旧单费用 goods / 普通 logistics / 非 goods）
// ===========================================================================
test('#7 单费用 goods CI balance PR → recalc 不改 fee_status，正确回写 CI balance 状态', () => {
  resetPaymentData();
  const ci = uid('ci_goods');
  run("INSERT INTO commercial_invoices (id, ci_no, ci_date, country) VALUES (?, ?, '2026-01-01', '印度尼西亚')", [ci, 'CI_' + ci]);
  const pr = uid('pay');
  run(`INSERT INTO payment_requests
        (id, request_no, payment_category, payment_subcategory, source_type, source_id, source_no,
         payee_type, payee_key, payee_name_snapshot, payable_amount, currency, payment_mode,
         payment_status, approval_status)
       VALUES (?, ?, 'goods', 'balance', 'ci', ?, '', 'factory', 'fac:xyz', 'Snap', 200, 'USD', 'single',
               'pending_approval', 'pending')`,
    [pr, 'PR_' + pr, ci]);
  const lb = uid('lb_unused');
  run("INSERT INTO logistics_batches (id, batch_no, fee_status) VALUES (?, ?, 'cost_generated')", [lb, 'BN_' + lb]);

  recalculatePaymentSettlement(pr);

  // goods+balance 分支回写 commercial_invoices.balance_payment_status
  // （本 PR 处于 pending_approval → aggregateSourceSettlement 算出 sourcePayStatus='pending_approval'）
  assert.equal(readCI(ci).balance_payment_status, 'pending_approval', 'CI balance 状态回写为 pending_approval（与 PR 审批状态一致）');
  // 无 freight payable → 任何 logistics_batches 的 fee_status 不受影响
  assert.equal(readLB(lb).fee_status, 'cost_generated', '无 freight → fee_status 不被 recalc 触碰');
});

test('#7 普通 logistics PR（legacy 路径，无 payment_request_items）→ fee_status 经 legacy 正确 sync', () => {
  resetPaymentData();
  const lb = uid('lb_legacy');
  run("INSERT INTO logistics_batches (id, batch_no, fee_status) VALUES (?, ?, 'cost_generated')", [lb, 'BN_' + lb]);
  const pr = uid('pay');
  run(`INSERT INTO payment_requests
        (id, request_no, payment_category, payment_subcategory, source_type, source_id, source_no,
         payee_type, payee_key, payee_name_snapshot, payable_amount, currency, payment_mode,
         payment_status, approval_status)
       VALUES (?, ?, '', '', 'logistics', ?, '', 'freight_co', 'fr:xyz', 'FreightCo', 50, 'USD', 'single',
               'pending_approval', 'pending')`,
    [pr, 'PR_' + pr, lb]);
  // 关键：本 PR 不经 payment_request_items 关联任何 freight payable（否则会走 canonical）
  assert.equal(countRows('payment_request_items', 'WHERE payment_request_id = ?', [pr]), 0, '前置：legacy PR 无 payment_request_items');

  recalculatePaymentSettlement(pr);
  // 未结算 → legacy 映射为 unpaid
  assert.equal(readLB(lb).fee_status, 'unpaid', 'legacy 路径：未结算 logistics PR → fee_status=unpaid');
  // legacy 确实由 source_type='logistics' 触发（非 canonical）
  assert.equal(countRows('ci_cost_items', 'WHERE payable_item_id IS NOT NULL AND logistics_batch_id = ?', [lb]), 0,
    'legacy 路径未依赖 ci_cost_items canonical linkage');
});

// ===========================================================================
// #1 多费用 PR 创建（真实 HTTP 端点）+ #5 category=goods 推导
// ===========================================================================
test('#1 多费用 PR 创建：多 payable + payment_request_items 完整关联 + source_type 为空', async () => {
  resetPaymentData();
  seedCountry();
  const pi1 = uid('pi1');
  const pi2 = uid('pi2');
  run("INSERT INTO proforma_invoices (id, pi_no, pi_date, country, currency, pi_status) VALUES (?, ?, '2026-01-01', '印度尼西亚', 'USD', 'pending')", [pi1, 'PI_' + pi1]);
  run("INSERT INTO proforma_invoices (id, pi_no, pi_date, country, currency, pi_status) VALUES (?, ?, '2026-01-01', '印度尼西亚', 'USD', 'pending')", [pi2, 'PI_' + pi2]);
  const a = seedPayableItem({ sourceType: 'pi', sourceId: pi1, feeType: 'deposit', categoryCode: 'goods', subcategoryCode: 'deposit', payeeKey: 'fac:xyz' });
  const b = seedPayableItem({ sourceType: 'pi', sourceId: pi2, feeType: 'deposit', categoryCode: 'goods', subcategoryCode: 'deposit', payeeKey: 'fac:xyz' });

  const { status, body } = await postJson('/api/payment-requests/multi-expense', { payable_item_ids: [a, b] });
  assert.equal(status, 200, '创建应返回 200，实际：' + JSON.stringify(body));
  assert.ok(body.id, '响应应返回 PR id');

  const pr = readPR(body.id);
  assert.equal(pr.payment_mode, 'multi', 'payment_mode=multi');
  assert.equal(pr.source_type, '', '多费用 PR 主表 source_type 为空（关键不变量）');
  assert.equal(pr.source_id, '', '多费用 PR 主表 source_id 为空');
  assert.equal(pr.source_no, '', '多费用 PR 主表 source_no 为空');
  assert.equal(countRows('payment_request_items', 'WHERE payment_request_id = ?', [pr.id]), 2,
    'payment_request_items 关联完整（=2）');
});

test('#5A 全部 goods(pi) payable → payment_category=goods / subcategory=deposit', async () => {
  resetPaymentData();
  seedCountry();
  const pi1 = uid('pi1');
  const pi2 = uid('pi2');
  run("INSERT INTO proforma_invoices (id, pi_no, pi_date, country, currency, pi_status) VALUES (?, ?, '2026-01-01', '印度尼西亚', 'USD', 'pending')", [pi1, 'PI_' + pi1]);
  run("INSERT INTO proforma_invoices (id, pi_no, pi_date, country, currency, pi_status) VALUES (?, ?, '2026-01-01', '印度尼西亚', 'USD', 'pending')", [pi2, 'PI_' + pi2]);
  const a = seedPayableItem({ sourceType: 'pi', sourceId: pi1, feeType: 'deposit', categoryCode: 'goods', subcategoryCode: 'deposit', payeeKey: 'fac:xyz' });
  const b = seedPayableItem({ sourceType: 'pi', sourceId: pi2, feeType: 'deposit', categoryCode: 'goods', subcategoryCode: 'deposit', payeeKey: 'fac:xyz' });
  const { status, body } = await postJson('/api/payment-requests/multi-expense', { payable_item_ids: [a, b] });
  assert.equal(status, 200);
  const pr = readPR(body.id);
  assert.equal(pr.payment_category, 'goods', '全部 goods → payment_category=goods');
  assert.equal(pr.payment_subcategory, 'deposit', '全部 deposit → subcategory=deposit');
});

test('#5B 全部 goods(ci) payable → payment_category=goods / subcategory=balance', async () => {
  resetPaymentData();
  seedCountry();
  const ci1 = uid('ci1');
  const ci2 = uid('ci2');
  run("INSERT INTO commercial_invoices (id, ci_no, ci_date, country) VALUES (?, ?, '2026-01-01', '印度尼西亚')", [ci1, 'CI_' + ci1]);
  run("INSERT INTO commercial_invoices (id, ci_no, ci_date, country) VALUES (?, ?, '2026-01-01', '印度尼西亚')", [ci2, 'CI_' + ci2]);
  const a = seedPayableItem({ sourceType: 'ci', sourceId: ci1, feeType: 'balance', categoryCode: 'goods', subcategoryCode: 'balance', payeeKey: 'fac:xyz' });
  const b = seedPayableItem({ sourceType: 'ci', sourceId: ci2, feeType: 'balance', categoryCode: 'goods', subcategoryCode: 'balance', payeeKey: 'fac:xyz' });
  const { status, body } = await postJson('/api/payment-requests/multi-expense', { payable_item_ids: [a, b] });
  assert.equal(status, 200);
  const pr = readPR(body.id);
  assert.equal(pr.payment_category, 'goods', 'CI 货款 → payment_category=goods');
  assert.equal(pr.payment_subcategory, 'balance', '全部 balance → subcategory=balance');
});

test('#5C 含非货款(logistics freight) payable → payment_category 不误标 goods', async () => {
  resetPaymentData();
  seedCountry();
  const ciFr = uid('ci_fr');
  run("INSERT INTO commercial_invoices (id, ci_no, ci_date, country) VALUES (?, ?, '2026-01-01', '印度尼西亚')", [ciFr, 'CI_' + ciFr]);
  const lbFr = uid('lb_fr');
  run("INSERT INTO logistics_batches (id, batch_no, related_ci_id) VALUES (?, ?, ?)", [lbFr, 'BN_' + lbFr, ciFr]);
  const f = seedPayableItem({ sourceType: 'logistics', sourceId: lbFr, sourceCiId: ciFr, feeType: 'freight', categoryCode: 'warehouse_arrival', subcategoryCode: 'freight', payeeKey: 'fac:xyz' });
  const { status, body } = await postJson('/api/payment-requests/multi-expense', { payable_item_ids: [f] });
  assert.equal(status, 200);
  const pr = readPR(body.id);
  assert.equal(pr.payment_category, '', '非货款(logistics freight) → payment_category 不得为 goods（应为空）');
});

test('#5D 混合 goods + 非货款 → 不得误判为 goods', async () => {
  resetPaymentData();
  seedCountry();
  const pi1 = uid('pi1');
  run("INSERT INTO proforma_invoices (id, pi_no, pi_date, country, currency, pi_status) VALUES (?, ?, '2026-01-01', '印度尼西亚', 'USD', 'pending')", [pi1, 'PI_' + pi1]);
  const ciFr = uid('ci_fr');
  run("INSERT INTO commercial_invoices (id, ci_no, ci_date, country) VALUES (?, ?, '2026-01-01', '印度尼西亚')", [ciFr, 'CI_' + ciFr]);
  const lbFr = uid('lb_fr');
  run("INSERT INTO logistics_batches (id, batch_no, related_ci_id) VALUES (?, ?, ?)", [lbFr, 'BN_' + lbFr, ciFr]);
  const g = seedPayableItem({ sourceType: 'pi', sourceId: pi1, feeType: 'deposit', categoryCode: 'goods', subcategoryCode: 'deposit', payeeKey: 'fac:xyz' });
  const f = seedPayableItem({ sourceType: 'logistics', sourceId: lbFr, sourceCiId: ciFr, feeType: 'freight', categoryCode: 'warehouse_arrival', subcategoryCode: 'freight', payeeKey: 'fac:xyz' });
  const { status, body } = await postJson('/api/payment-requests/multi-expense', { payable_item_ids: [g, f] });
  assert.equal(status, 200);
  const pr = readPR(body.id);
  assert.equal(pr.payment_category, '', 'mixed goods+non-goods → payment_category 不得误判为 goods');
});

test('#5E（已修复）CI 下 freight payable → 现判为非货款(non-goods)', async () => {
  // 修复 #5E 潜伏正确性 bug：payment_category='goods' 仅当「真实货款」——需 source_type 为货物来源
  // AND category_code='goods' AND fee_type∈{deposit,balance}。CI 内嵌 freight 的 category_code 非 'goods'，
  // 故不再被误判 goods，付款日 realtime FX 校验照常执行（不再跳过）。
  resetPaymentData();
  seedCountry();
  const ciFr = uid('ci_fr');
  run("INSERT INTO commercial_invoices (id, ci_no, ci_date, country) VALUES (?, ?, '2026-01-01', '印度尼西亚')", [ciFr, 'CI_' + ciFr]);
  const f = seedPayableItem({ sourceType: 'ci', sourceId: ciFr, feeType: 'freight', categoryCode: 'warehouse_arrival', subcategoryCode: 'freight', payeeKey: 'fac:xyz' });
  const { status, body } = await postJson('/api/payment-requests/multi-expense', { payable_item_ids: [f] });
  assert.equal(status, 200);
  const pr = readPR(body.id);
  assert.equal(pr.payment_category, '', '修复后：CI 来源(fee_type=freight, category_code≠goods) 不再被标 goods');
});

// ===========================================================================
// 新增 category 合约测试 A-H（#5E 修复后的权威口径锁定）
// 规则：payment_category='goods' 当且仅当 货物来源 + category_code='goods' + fee_type∈{deposit,balance}
// ===========================================================================
test('CAT-A CI 真实货款尾款(balance/goods) → payment_category=goods', async () => {
  resetPaymentData(); seedCountry();
  const ci = uid('ci');
  run("INSERT INTO commercial_invoices (id, ci_no, ci_date, country) VALUES (?, ?, '2026-01-01', '印度尼西亚')", [ci, 'CI_' + ci]);
  const { status, pr } = await createMultiPr([{ sourceType: 'ci', sourceId: ci, feeType: 'balance', categoryCode: 'goods', subcategoryCode: 'balance' }]);
  assert.equal(status, 200);
  assert.equal(pr.payment_category, 'goods', 'CI 真实货款(balance) → goods');
  assert.equal(pr.payment_subcategory, 'balance');
});

test('CAT-B CI freight → payment_category 非货款', async () => {
  resetPaymentData(); seedCountry();
  const ci = uid('ci');
  run("INSERT INTO commercial_invoices (id, ci_no, ci_date, country) VALUES (?, ?, '2026-01-01', '印度尼西亚')", [ci, 'CI_' + ci]);
  const { status, pr } = await createMultiPr([{ sourceType: 'ci', sourceId: ci, feeType: 'freight', categoryCode: 'warehouse_arrival', subcategoryCode: 'freight' }]);
  assert.equal(status, 200);
  assert.equal(pr.payment_category, '', 'CI freight → 非货款（付款日 FX 校验照常）');
});

test('CAT-C CI customs → payment_category 非货款', async () => {
  resetPaymentData(); seedCountry();
  const ci = uid('ci');
  run("INSERT INTO commercial_invoices (id, ci_no, ci_date, country) VALUES (?, ?, '2026-01-01', '印度尼西亚')", [ci, 'CI_' + ci]);
  const { status, pr } = await createMultiPr([{ sourceType: 'ci', sourceId: ci, feeType: 'customs', categoryCode: 'customs_duty', subcategoryCode: 'duty' }]);
  assert.equal(status, 200);
  assert.equal(pr.payment_category, '', 'CI customs → 非货款');
});

test('CAT-D CI inspection / warehouse-arrival → payment_category 非货款', async () => {
  resetPaymentData(); seedCountry();
  const ci = uid('ci');
  run("INSERT INTO commercial_invoices (id, ci_no, ci_date, country) VALUES (?, ?, '2026-01-01', '印度尼西亚')", [ci, 'CI_' + ci]);
  const { status, pr } = await createMultiPr([{ sourceType: 'ci', sourceId: ci, feeType: 'inspection', categoryCode: 'inspection_fee', subcategoryCode: 'inspection' }]);
  assert.equal(status, 200);
  assert.equal(pr.payment_category, '', 'CI inspection → 非货款');
});

test('CAT-E PI deposit → payment_category=goods', async () => {
  resetPaymentData(); seedCountry();
  const pi = uid('pi');
  run("INSERT INTO proforma_invoices (id, pi_no, pi_date, country, currency, pi_status) VALUES (?, ?, '2026-01-01', '印度尼西亚', 'USD', 'pending')", [pi, 'PI_' + pi]);
  const { status, pr } = await createMultiPr([{ sourceType: 'pi', sourceId: pi, feeType: 'deposit', categoryCode: 'goods', subcategoryCode: 'deposit' }]);
  assert.equal(status, 200);
  assert.equal(pr.payment_category, 'goods', 'PI 定金 → 货款');
  assert.equal(pr.payment_subcategory, 'deposit');
});

test('CAT-F PI balance → payment_category=goods', async () => {
  resetPaymentData(); seedCountry();
  const pi = uid('pi');
  run("INSERT INTO proforma_invoices (id, pi_no, pi_date, country, currency, pi_status) VALUES (?, ?, '2026-01-01', '印度尼西亚', 'USD', 'pending')", [pi, 'PI_' + pi]);
  const { status, pr } = await createMultiPr([{ sourceType: 'pi', sourceId: pi, feeType: 'balance', categoryCode: 'goods', subcategoryCode: 'balance' }]);
  assert.equal(status, 200);
  assert.equal(pr.payment_category, 'goods', 'PI 尾款 → 货款');
  assert.equal(pr.payment_subcategory, 'balance');
});

test('CAT-G historical_ci balance → payment_category=goods', async () => {
  resetPaymentData(); seedCountry();
  const hci = uid('hci');
  seedHistoricalCi(hci, '印度尼西亚');
  const { status, pr } = await createMultiPr([{ sourceType: 'historical_ci', sourceId: hci, feeType: 'balance', categoryCode: 'goods', subcategoryCode: 'balance' }]);
  assert.equal(status, 200);
  assert.equal(pr.payment_category, 'goods', 'historical_ci 尾款 → 货款（保留 ci 来源判定 + category_code=goods）');
  assert.equal(pr.payment_subcategory, 'balance');
});

test('CAT-H goods + non-goods 混合 → payment_category 非货款', async () => {
  resetPaymentData(); seedCountry();
  const pi = uid('pi');
  run("INSERT INTO proforma_invoices (id, pi_no, pi_date, country, currency, pi_status) VALUES (?, ?, '2026-01-01', '印度尼西亚', 'USD', 'pending')", [pi, 'PI_' + pi]);
  const ci = uid('ci');
  run("INSERT INTO commercial_invoices (id, ci_no, ci_date, country) VALUES (?, ?, '2026-01-01', '印度尼西亚')", [ci, 'CI_' + ci]);
  const { status, pr } = await createMultiPr([
    { sourceType: 'pi', sourceId: pi, feeType: 'deposit', categoryCode: 'goods', subcategoryCode: 'deposit' },
    { sourceType: 'ci', sourceId: ci, feeType: 'freight', categoryCode: 'warehouse_arrival', subcategoryCode: 'freight' }
  ]);
  assert.equal(status, 200);
  assert.equal(pr.payment_category, '', '混合 goods+non-goods → 非货款（不跳过 FX）');
});
