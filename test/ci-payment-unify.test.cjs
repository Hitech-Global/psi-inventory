'use strict';

/**
 * ci-payment-unify.test.cjs — CI/PAYMENT INTEGRATION FIX 回归测试
 *
 * 根因（见 CI-PAYMENT-ROOT-CAUSE-REPORT.md）：
 *   - 运营 CI 列表/详情只读 commercial_invoices 静态列，从不聚合 settlement；
 *   - 历史 CI 列表 JOIN h.payment_request_id（= 导入期 PAY-HCI PR，生产 12 条全 cancelled），
 *     真实后续付款在 payable_items(source_type='historical_ci') → payment_request_items → PAY-MULTI-*。
 *
 * 修复后统一口径（Single Source of Truth）：
 *   payable_items → payment_request_items → payment_requests → payment_allocations / payment_settlement_logs
 *   复用 payableItemsSettlementBreakdown()；payment_status 镜像 aggregateSourceSettlement().sourcePayStatus。
 *
 * 防双算（用户 Step 4 红线）：
 *   createHistoricalCI 会为导入已付写 is_legacy=1 settlement log 并经 PRI 挂到 hci balance payable_item；
 *   历史 CI「后续已付」必须排除 legacy（= 导入历史已付本身），否则 imported + legacy 双算（HCI-5 锁死）。
 *
 * 金额单位约定：payable_amount_minor / allocated_amount_minor 为分（minor）；
 *              settlement_logs.amount / historical_paid_amount / gross_goods_amount 为元。
 * 不访问生产 DB；生产 4 条铁证（HIT20251118-1A / HIT20251205-1A / HIT20251212-1A / HIT20251212-2A）
 * 的数据形态在 HCI-* 用例中离线回放。
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_DRIVER = 'sqlite';
process.env.DB_PATH = ':memory:';

const dbMod = require('../db');
const { run, getDB } = dbMod;
const {
  computeHistoricalCIPaymentFacts,
  computeOperatingCIBalancePaymentFacts,
} = require('../server');

createSchema();

function createSchema() {
  getDB().exec(`
    CREATE TABLE IF NOT EXISTS historical_commercial_invoices (
      id TEXT PRIMARY KEY, historical_ci_no TEXT, historical_paid_amount NUMERIC DEFAULT 0,
      gross_goods_amount NUMERIC DEFAULT 0, payment_request_id TEXT
    );
    CREATE TABLE IF NOT EXISTS commercial_invoices (
      id TEXT PRIMARY KEY, payable_balance NUMERIC DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS payable_items (
      id TEXT PRIMARY KEY, source_type TEXT, source_id TEXT, source_ci_id TEXT, source_no TEXT,
      fee_type TEXT, payable_amount_minor INTEGER DEFAULT 0, lifecycle_status TEXT DEFAULT 'active'
    );
    CREATE TABLE IF NOT EXISTS payment_requests (
      id TEXT PRIMARY KEY, request_no TEXT, source_type TEXT,
      payment_status TEXT DEFAULT 'pending', approval_status TEXT DEFAULT 'pending'
    );
    CREATE TABLE IF NOT EXISTS payment_request_items (
      id TEXT PRIMARY KEY, payable_item_id TEXT, payment_request_id TEXT, requested_amount_minor INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS payment_allocations (
      id TEXT PRIMARY KEY, payment_request_item_id TEXT, allocated_amount_minor INTEGER DEFAULT 0, status TEXT DEFAULT 'reconciled'
    );
    CREATE TABLE IF NOT EXISTS payment_settlement_logs (
      id TEXT PRIMARY KEY, payment_request_id TEXT, event_type TEXT, amount NUMERIC,
      status TEXT DEFAULT 'applied', is_legacy INTEGER DEFAULT 0
    );
  `);
}

function clearAll() {
  getDB().exec(`
    DELETE FROM payment_allocations;
    DELETE FROM payment_settlement_logs;
    DELETE FROM payment_request_items;
    DELETE FROM payment_requests;
    DELETE FROM payable_items;
    DELETE FROM historical_commercial_invoices;
    DELETE FROM commercial_invoices;
  `);
}

let seq = 0;
const uniq = (p) => `${p}_${++seq}`;
const minor = (yuan) => Math.round(yuan * 100);

function seedPayableItem(o) {
  const id = o.id || uniq('pitem');
  run(
    `INSERT INTO payable_items (id, source_type, source_id, source_ci_id, source_no, fee_type, payable_amount_minor, lifecycle_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, o.source_type, o.source_id, o.source_ci_id || '', o.source_no || '', o.fee_type,
     o.payable_amount_minor, o.lifecycle_status || 'active']
  );
  return id;
}

function seedPR(o) {
  const id = o.id || uniq('pr');
  run(
    `INSERT INTO payment_requests (id, request_no, source_type, payment_status, approval_status)
     VALUES (?, ?, ?, ?, ?)`,
    [id, o.request_no || uniq('PAY'), o.source_type === undefined ? '' : o.source_type,
     o.payment_status || 'pending', o.approval_status || 'pending']
  );
  return id;
}

function seedPRI(payableItemId, prId, requestedMinor) {
  const id = uniq('pri');
  run(
    `INSERT INTO payment_request_items (id, payable_item_id, payment_request_id, requested_amount_minor)
     VALUES (?, ?, ?, ?)`,
    [id, payableItemId, prId, requestedMinor]
  );
  return id;
}

function seedAllocation(priId, allocatedMinor, status) {
  run(
    `INSERT INTO payment_allocations (id, payment_request_item_id, allocated_amount_minor, status)
     VALUES (?, ?, ?, ?)`,
    [uniq('pa'), priId, allocatedMinor, status || 'reconciled']
  );
}

function seedLegacyPaymentLog(prId, amountYuan) {
  run(
    `INSERT INTO payment_settlement_logs (id, payment_request_id, event_type, amount, status, is_legacy)
     VALUES (?, ?, 'payment', ?, 'applied', 1)`,
    [uniq('psl'), prId, amountYuan]
  );
}

function seedSettlementLog(prId, eventType, amountYuan) {
  run(
    `INSERT INTO payment_settlement_logs (id, payment_request_id, event_type, amount, status, is_legacy)
     VALUES (?, ?, ?, ?, 'applied', 0)`,
    [uniq('psl'), prId, eventType, amountYuan]
  );
}

// 运营 CI 标准夹具：CI + per-PI balance payable item（生产真实形态：source_type='pi' + source_ci_id）
function seedOperatingCI(opts) {
  opts = opts || {};
  const ciId = uniq('ci');
  run(`INSERT INTO commercial_invoices (id, payable_balance) VALUES (?, ?)`,
    [ciId, opts.payable_balance === undefined ? 1000 : opts.payable_balance]);
  let itemId = null;
  if (opts.balanceMinor !== null) {
    itemId = seedPayableItem({
      source_type: 'pi', source_id: uniq('pirow'), source_ci_id: ciId,
      fee_type: 'balance', payable_amount_minor: opts.balanceMinor === undefined ? minor(1000) : opts.balanceMinor,
    });
  }
  return { ciId, itemId };
}

// 历史 CI 标准夹具：hci + balance payable item + 导入期 PR（生产真实形态：
// source_type='historical_ci', source_id=hciId, source_ci_id 为空；h.payment_request_id → PAY-HCI-*）
function seedHistoricalCI(opts) {
  opts = opts || {};
  const hciId = uniq('hci');
  const importPrId = seedPR({
    request_no: `PAY-HCI-${seq}`, source_type: 'historical_ci',
    payment_status: opts.importPrStatus || 'cancelled',
    approval_status: (opts.importPrStatus || 'cancelled') === 'cancelled' ? 'cancelled' : 'approved',
  });
  run(
    `INSERT INTO historical_commercial_invoices (id, historical_ci_no, historical_paid_amount, gross_goods_amount, payment_request_id)
     VALUES (?, ?, ?, ?, ?)`,
    [hciId, `HIT-TEST-${seq}`, opts.imported || 0, opts.gross === undefined ? 1000 : opts.gross, importPrId]
  );
  const itemId = seedPayableItem({
    source_type: 'historical_ci', source_id: hciId,
    fee_type: 'balance',
    payable_amount_minor: minor(opts.baseYuan === undefined ? (opts.gross === undefined ? 1000 : opts.gross) : opts.baseYuan),
  });
  return { hciId, itemId, importPrId };
}

// 历史 CI 恒等式断言（用户 Step 4 / 最终交付 I 节）
function assertHciIdentity(facts, gross, imported) {
  const effective = imported + facts.subsequent_paid_amount + facts.deduction_amount + facts.rounding_amount;
  const expectedUnpaid = Math.max(0, Math.round((gross - effective) * 100) / 100);
  assert.equal(
    facts.unpaid_amount, expectedUnpaid,
    `恒等式失败: gross(${gross}) - imported(${imported}) - subsequent(${facts.subsequent_paid_amount}) - ded(${facts.deduction_amount}) - rnd(${facts.rounding_amount}) 应= unpaid(${facts.unpaid_amount})`
  );
}

// ============================================================
// 运营 CI（computeOperatingCIBalancePaymentFacts）
// ============================================================

test('OP-1 (CASE 1): 运营 CI 无付款且无 balance 应付项 → paid=0，unpaid 回退存储 payable_balance，status=unpaid', () => {
  clearAll();
  const { ciId } = seedOperatingCI({ balanceMinor: null, payable_balance: 1234.56 });
  const f = computeOperatingCIBalancePaymentFacts(ciId);
  assert.equal(f.balance_paid_amount, 0);
  assert.equal(f.balance_deduction_amount, 0);
  assert.equal(f.balance_rounding_amount, 0);
  assert.equal(f.balance_unpaid_amount, 1234.56);
  assert.equal(f.balance_payment_status, 'unpaid');
});

test('OP-2 (CASE 2 + CASE 11 运营侧): per-PI balance 部分付款 400/1000，PR source_type 为空（生产真实形态）→ paid=400，unpaid=600，partial_paid', () => {
  clearAll();
  const { ciId, itemId } = seedOperatingCI({});
  const prId = seedPR({ source_type: '' }); // 生产 PAY-MULTI 真实形态：PR 主表 source_type 为空，归属全靠 PRI→payable_item
  const priId = seedPRI(itemId, prId, minor(1000));
  seedAllocation(priId, minor(400));
  const f = computeOperatingCIBalancePaymentFacts(ciId);
  assert.equal(f.balance_gross_amount, 1000);
  assert.equal(f.balance_paid_amount, 400);
  assert.equal(f.balance_deduction_amount, 0);
  assert.equal(f.balance_rounding_amount, 0);
  assert.equal(f.balance_unpaid_amount, 600);
  assert.equal(f.balance_payment_status, 'partial_paid');
  assert.equal(f.balance_gross_amount - f.balance_paid_amount - f.balance_deduction_amount - f.balance_rounding_amount, f.balance_unpaid_amount);
});

test('OP-3 (CASE 3): 运营 CI 全额付款 → paid=1000，unpaid=0，status=paid', () => {
  clearAll();
  const { ciId, itemId } = seedOperatingCI({});
  const prId = seedPR({ payment_status: 'paid', approval_status: 'approved' });
  const priId = seedPRI(itemId, prId, minor(1000));
  seedAllocation(priId, minor(1000));
  const f = computeOperatingCIBalancePaymentFacts(ciId);
  assert.equal(f.balance_paid_amount, 1000);
  assert.equal(f.balance_unpaid_amount, 0);
  assert.equal(f.balance_payment_status, 'paid');
});

test('OP-4 (CASE 4): 运营 CI 抵扣 → deduction 计入，unpaid 相应减少', () => {
  clearAll();
  const { ciId, itemId } = seedOperatingCI({});
  const prId = seedPR({ approval_status: 'approved' });
  const priId = seedPRI(itemId, prId, minor(1000));
  seedAllocation(priId, minor(200));
  seedSettlementLog(prId, 'deduction', 50);
  const f = computeOperatingCIBalancePaymentFacts(ciId);
  assert.equal(f.balance_paid_amount, 200);
  assert.equal(f.balance_deduction_amount, 50);
  assert.equal(f.balance_unpaid_amount, 750);
  assert.equal(f.balance_payment_status, 'partial_paid');
});

test('OP-5 (CASE 5): 运营 CI 抹零 → rounding 计入，unpaid 相应减少', () => {
  clearAll();
  const { ciId, itemId } = seedOperatingCI({});
  const prId = seedPR({ approval_status: 'approved' });
  const priId = seedPRI(itemId, prId, minor(1000));
  seedSettlementLog(prId, 'rounding', 0.5);
  const f = computeOperatingCIBalancePaymentFacts(ciId);
  assert.equal(f.balance_rounding_amount, 0.5);
  assert.equal(f.balance_unpaid_amount, 999.5);
  assert.equal(f.balance_payment_status, 'partial_paid');
});

test('OP-6a: 定金 payable_item（fee_type=deposit）的付款绝不计入尾款已付', () => {
  clearAll();
  const { ciId } = seedOperatingCI({});
  const depositItemId = seedPayableItem({ source_type: 'pi', source_id: uniq('pirow'), source_ci_id: ciId, fee_type: 'deposit', payable_amount_minor: minor(300) });
  const depositPrId = seedPR({ approval_status: 'approved' });
  const depositPriId = seedPRI(depositItemId, depositPrId, minor(300));
  seedAllocation(depositPriId, minor(300));
  const f = computeOperatingCIBalancePaymentFacts(ciId);
  assert.equal(f.balance_paid_amount, 0, '定金付款不得计入尾款已付');
  assert.equal(f.balance_gross_amount, 1000, '尾款基数只含 balance 项');
  assert.equal(f.balance_unpaid_amount, 1000);
  assert.equal(f.balance_payment_status, 'unpaid');
});

test('OP-6b: CI 级 balance（source_type=ci）与 per-PI balance（source_ci_id）两条通道都计入并求和', () => {
  clearAll();
  const ciId = uniq('ci');
  run(`INSERT INTO commercial_invoices (id, payable_balance) VALUES (?, ?)`, [ciId, 0]);
  const ciLevelId = seedPayableItem({ source_type: 'ci', source_id: ciId, fee_type: 'balance', payable_amount_minor: minor(600) });
  const piLevelId = seedPayableItem({ source_type: 'pi', source_id: uniq('pirow'), source_ci_id: ciId, fee_type: 'balance', payable_amount_minor: minor(400) });
  const prId = seedPR({ approval_status: 'approved' });
  const pri1 = seedPRI(ciLevelId, prId, minor(600));
  const pri2 = seedPRI(piLevelId, prId, minor(400));
  seedAllocation(pri1, minor(600));
  seedAllocation(pri2, minor(100));
  const f = computeOperatingCIBalancePaymentFacts(ciId);
  assert.equal(f.balance_gross_amount, 1000);
  assert.equal(f.balance_paid_amount, 700);
  assert.equal(f.balance_unpaid_amount, 300);
  assert.equal(f.balance_payment_status, 'partial_paid');
});

test('OP-7 (CASE 回归): cancelled PR 上的 allocation 必须被排除（与财务 breakdown 同口径）', () => {
  clearAll();
  const { ciId, itemId } = seedOperatingCI({});
  const prId = seedPR({ payment_status: 'cancelled', approval_status: 'cancelled' });
  const priId = seedPRI(itemId, prId, minor(1000));
  seedAllocation(priId, minor(1000)); // 即使有 allocation，PR cancelled → 不计
  const f = computeOperatingCIBalancePaymentFacts(ciId);
  assert.equal(f.balance_paid_amount, 0);
  assert.equal(f.balance_unpaid_amount, 1000);
  assert.equal(f.balance_payment_status, 'unpaid');
});

test('OP-8 (CASE 状态): 仅存在 pending 审批的付款申请（无付款）→ status=pending_approval（与财务 sourcePayStatus 一致）', () => {
  clearAll();
  const { ciId, itemId } = seedOperatingCI({});
  const prId = seedPR({ payment_status: 'pending', approval_status: 'pending' });
  seedPRI(itemId, prId, minor(1000));
  const f = computeOperatingCIBalancePaymentFacts(ciId);
  assert.equal(f.balance_paid_amount, 0);
  assert.equal(f.balance_unpaid_amount, 1000);
  assert.equal(f.balance_payment_status, 'pending_approval');
});

// ============================================================
// 历史 CI（computeHistoricalCIPaymentFacts）
// ============================================================

test('HCI-1 (CASE 6): imported>0 无后续付款 → 导入已付独立展示，subsequent=0，unpaid=gross-imported，partial_paid', () => {
  clearAll();
  const { hciId } = seedHistoricalCI({ imported: 300, gross: 1000 }); // 生产形态：导入 PR cancelled
  const f = computeHistoricalCIPaymentFacts(hciId);
  assert.equal(f.subsequent_paid_amount, 0);
  assert.equal(f.deduction_amount, 0);
  assert.equal(f.rounding_amount, 0);
  assert.equal(f.unpaid_amount, 700);
  assert.equal(f.payment_status, 'partial_paid', '已导入 300/1000，页面状态不得再显示 unpaid/cancelled');
  assertHciIdentity(f, 1000, 300);
});

test('HCI-2 (CASE 7): imported=0 有 PAY-MULTI 付款 → subsequent=付款额，unpaid=余额，partial_paid', () => {
  clearAll();
  // 生产铁证形态（HIT20251212-2A：gross 237,439.88，财务已付 24,701.29 部分付款）按比例缩放回放
  const { hciId, itemId } = seedHistoricalCI({ imported: 0, gross: 1000 });
  const prId = seedPR({ source_type: '' }); // PAY-MULTI：PR 主表 source_type 为空
  const priId = seedPRI(itemId, prId, minor(1000));
  seedAllocation(priId, minor(247.01));
  const f = computeHistoricalCIPaymentFacts(hciId);
  assert.equal(f.subsequent_paid_amount, 247.01);
  assert.equal(f.unpaid_amount, 752.99);
  assert.equal(f.payment_status, 'partial_paid');
  assertHciIdentity(f, 1000, 0);
});

test('HCI-3 (CASE 8): imported>0 + PAY-MULTI 付款 → 两部分分别展示，绝不双算，unpaid=0，paid', () => {
  clearAll();
  // 生产铁证形态（HIT20251205-1A：gross 299,613.44，财务已付 299,613.44 全额）按比例缩放回放
  const { hciId, itemId } = seedHistoricalCI({ imported: 300, gross: 1000 });
  const prId = seedPR({ payment_status: 'paid', approval_status: 'approved' });
  const priId = seedPRI(itemId, prId, minor(1000));
  seedAllocation(priId, minor(700));
  const f = computeHistoricalCIPaymentFacts(hciId);
  assert.equal(f.subsequent_paid_amount, 700, 'subsequent 必须只含 PAY-MULTI 700，不得把 imported(300) 再算一遍');
  assert.equal(f.unpaid_amount, 0);
  assert.equal(f.payment_status, 'paid');
  assertHciIdentity(f, 1000, 300);
});

test('HCI-4 (CASE 9 核心): PAY-HCI cancelled（带 legacy log）+ PAY-MULTI paid → 不再依赖 PAY-HCI，subsequent 只认真实付款', () => {
  clearAll();
  // 生产铁证形态（HIT20251118-1A：gross 272,539.09，财务已付 201,948.09，部分付款）按比例缩放回放：
  // 导入 PR(PAY-HCI) cancelled；真实付款挂在 PAY-MULTI PR（source_type 为空）经 PRI→payable_item。
  const { hciId, itemId, importPrId } = seedHistoricalCI({ imported: 300, gross: 1000, importPrStatus: 'cancelled' });
  // 导入期 legacy log（即使存在，PR cancelled 也必须被排除）
  const importPriId = seedPRI(itemId, importPrId, minor(1000));
  seedLegacyPaymentLog(importPrId, 300);
  // 真实后续付款
  const prId = seedPR({ payment_status: 'paid', approval_status: 'approved' });
  const priId = seedPRI(itemId, prId, minor(1000));
  seedAllocation(priId, minor(700));
  const f = computeHistoricalCIPaymentFacts(hciId);
  assert.equal(f.subsequent_paid_amount, 700, 'cancelled PAY-HCI 的 legacy log 不得计入 subsequent');
  assert.equal(f.unpaid_amount, 0);
  assert.equal(f.payment_status, 'paid');
  assertHciIdentity(f, 1000, 300);
  void importPriId;
});

test('HCI-5 (防双算核心): 新导入形态 —— 导入 PR active + is_legacy=1 导入付款经 PRI 挂在 hci balance item 上 → subsequent 必须为 0', () => {
  clearAll();
  // createHistoricalCI 真实写入形态：导入 PR approved + legacy settlement log（金额=historical_paid_amount）+ PRI→hci balance item。
  // 若不排除 legacy，imported(300) 会通过 settlement 再计入 subsequent → 双算 600。
  const { hciId, itemId, importPrId } = seedHistoricalCI({ imported: 300, gross: 1000, importPrStatus: 'approved' });
  seedPRI(itemId, importPrId, minor(1000));
  seedLegacyPaymentLog(importPrId, 300);
  const f = computeHistoricalCIPaymentFacts(hciId);
  assert.equal(f.subsequent_paid_amount, 0, 'legacy 导入付款 = imported 本身，绝不能再计入 subsequent（防双算）');
  assert.equal(f.unpaid_amount, 700);
  assert.equal(f.payment_status, 'partial_paid');
  assertHciIdentity(f, 1000, 300);
});

test('HCI-6 (CASE 10): imported + PAY-MULTI + deduction + rounding → 全链恒等式成立', () => {
  clearAll();
  const { hciId, itemId } = seedHistoricalCI({ imported: 300, gross: 1000 });
  const prId = seedPR({ approval_status: 'approved' });
  const priId = seedPRI(itemId, prId, minor(1000));
  seedAllocation(priId, minor(500));
  seedSettlementLog(prId, 'deduction', 20);
  seedSettlementLog(prId, 'rounding', 0.5);
  const f = computeHistoricalCIPaymentFacts(hciId);
  assert.equal(f.subsequent_paid_amount, 500);
  assert.equal(f.deduction_amount, 20);
  assert.equal(f.rounding_amount, 0.5);
  assert.equal(f.unpaid_amount, 179.5);
  assert.equal(f.payment_status, 'partial_paid');
  assertHciIdentity(f, 1000, 300);
});

test('HCI-7 (CASE 11): PR source_type 为空，仅凭 payable_items + payment_request_items 归属 → 正确计入 historical_ci', () => {
  clearAll();
  const { hciId, itemId } = seedHistoricalCI({ imported: 0, gross: 1000 });
  const prId = seedPR({ source_type: '' }); // 生产真实结构：PR 主表 source_type 为空
  const priId = seedPRI(itemId, prId, minor(1000));
  seedAllocation(priId, minor(999));
  const f = computeHistoricalCIPaymentFacts(hciId);
  assert.equal(f.subsequent_paid_amount, 999);
  assert.equal(f.unpaid_amount, 1);
  assert.equal(f.payment_status, 'partial_paid');
  assertHciIdentity(f, 1000, 0);
});

test('HCI-8 (CASE 状态): imported=全额无后续 → unpaid=0，status=paid（修复前页面误显示 cancelled/unpaid）', () => {
  clearAll();
  const { hciId } = seedHistoricalCI({ imported: 1000, gross: 1000, importPrStatus: 'cancelled' });
  const f = computeHistoricalCIPaymentFacts(hciId);
  assert.equal(f.subsequent_paid_amount, 0);
  assert.equal(f.unpaid_amount, 0);
  assert.equal(f.payment_status, 'paid');
  assertHciIdentity(f, 1000, 1000);
});

test('HCI-9 (CASE 回归): h.payment_request_id 指向已取消 PAY-HCI 时 helper 完全不读该字段（结构解耦）', () => {
  clearAll();
  // helper 的归属键只有 payable_items.source_type/source_id；payment_request_id 即使 dangling 也不影响结果
  const { hciId } = seedHistoricalCI({ imported: 0, gross: 1000, importPrStatus: 'cancelled' });
  // 不创建任何 PRI/settlement → subsequent=0
  const f = computeHistoricalCIPaymentFacts(hciId);
  assert.equal(f.subsequent_paid_amount, 0);
  assert.equal(f.unpaid_amount, 1000);
  assert.equal(f.payment_status, 'unpaid');
});
