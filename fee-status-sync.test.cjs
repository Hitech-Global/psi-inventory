'use strict';

/**
 * Freight fee_status sync — Targeted Tests (TEST A-G)
 *
 * 验证 syncPaymentSource 对运费(fee_type='freight')的 fee_status 回写：
 *   - 经 canonical freight linkage 反查批次：
 *       ci_cost_items WHERE logistics_batch_id = batch
 *         AND cost_category='warehouse_arrival' AND cost_subcategory='freight'
 *         AND include_in_landing_cost=1 AND payable_item_id 非空
 *       → DISTINCT payable_item_id（排除 lifecycle_status='cancelled'）
 *   - 按该批次 canonical payable 自身 lifecycle_status 映射：
 *       paid → 'paid' / partially_paid → 'partial_paid' / 其它 → 'unpaid'
 *   - 0 个 canonical：不猜测、不动 fee_status
 *   - >1 个 canonical：数据冲突，fail closed，不静默 aggregate
 *   - 绝不按整个 PR 的 isSettled/hasSettlement 一刀切；每个批次独立推导（multi 不连坐）
 *   - canonical linkage 仅依赖 payable.lifecycle_status，与 payable.source_type 无关
 *     （兼容新模型 source_type='logistics'/source_id=batch 与历史模型 source_type='ci'/'manual'）
 */

process.env.DB_DRIVER = 'sqlite';
process.env.DB_PATH = ':memory:';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { query, queryOne, run, getDB } = require('./db');
const { syncPaymentSource } = require('./server');

// 自建最小 schema（server 的 SQLite init 不保证建出 ci_cost_items 等表）
function createTestSchema() {
  const d = getDB();
  d.exec(`
    CREATE TABLE IF NOT EXISTS logistics_batches (
      id TEXT PRIMARY KEY, batch_no TEXT NOT NULL UNIQUE, fee_status TEXT DEFAULT 'unpaid',
      total_freight NUMERIC(18,4) DEFAULT 0, actual_arrival_date TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS payable_items (
      id TEXT PRIMARY KEY, fee_no TEXT NOT NULL UNIQUE, source_type TEXT NOT NULL, source_id TEXT NOT NULL,
      source_ci_id TEXT DEFAULT '', fee_type TEXT NOT NULL, payee_key TEXT NOT NULL, payer_entity_key TEXT NOT NULL,
      currency TEXT NOT NULL, payable_amount_minor INTEGER NOT NULL, lifecycle_status TEXT NOT NULL DEFAULT 'active',
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS payment_request_items (
      id TEXT PRIMARY KEY, payment_request_id TEXT NOT NULL, payable_item_id TEXT NOT NULL, requested_amount_minor INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS payment_requests (
      id TEXT PRIMARY KEY, payment_category TEXT DEFAULT '', payment_mode TEXT DEFAULT 'single',
      source_type TEXT DEFAULT '', source_id TEXT DEFAULT '', related_ci_id TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS ci_cost_items (
      id TEXT PRIMARY KEY, ci_id TEXT NOT NULL, ci_no TEXT DEFAULT '', payment_request_id TEXT DEFAULT '',
      payable_item_id TEXT DEFAULT '', logistics_batch_id TEXT DEFAULT '', paid_amount NUMERIC(18,4) DEFAULT 0,
      cost_category TEXT DEFAULT '', cost_subcategory TEXT DEFAULT '', include_in_landing_cost INTEGER DEFAULT 0
    );
  `);
}

function resetDB() {
  const d = getDB();
  d.pragma('foreign_keys = OFF');
  d.exec(`
    DELETE FROM payment_request_items;
    DELETE FROM payment_requests;
    DELETE FROM ci_cost_items;
    DELETE FROM payable_items;
    DELETE FROM logistics_batches;
  `);
  d.pragma('foreign_keys = ON');
}

function feeNo() { return 'fee_' + Math.random().toString(36).slice(2, 10); }

// 插入一个 freight payable + 其到批次的 canonical freight linkage，返回 batch id
// canonical linkage：ci_cost_items(cost_category='warehouse_arrival', cost_subcategory='freight',
//   include_in_landing_cost=1, payable_item_id=payableId, logistics_batch_id=batchId)
function seedFreightPayable({ payableId, batchId, batchFeeStatus, lifecycle, ciId, amount = 13601,
                              sourceType = 'ci', sourceId, sourceCiId = '' }) {
  const sid = sourceId !== undefined ? sourceId : ciId;
  run('INSERT OR IGNORE INTO logistics_batches (id, batch_no, fee_status, total_freight) VALUES (?, ?, ?, ?)',
    [batchId, 'B_' + batchId, batchFeeStatus, amount]);
  run(`INSERT INTO payable_items
        (id, fee_no, source_type, source_id, source_ci_id, fee_type, payee_key, payer_entity_key, currency, payable_amount_minor, lifecycle_status, is_active)
       VALUES (?, ?, ?, ?, ?, 'freight', 'sp:x', 'pe:x', 'RMB', ?, ?, 1)`,
    [payableId, feeNo(), sourceType, sid, sourceCiId, amount * 100, lifecycle]);
  run(`INSERT INTO ci_cost_items
        (id, ci_id, payable_item_id, logistics_batch_id, cost_category, cost_subcategory, include_in_landing_cost)
       VALUES (?, ?, ?, ?, 'warehouse_arrival', 'freight', 1)`,
    ['cci_' + payableId, ciId, payableId, batchId]);
  return batchId;
}

function linkPR(prId, payableId) {
  run('INSERT INTO payment_request_items (id, payment_request_id, payable_item_id, requested_amount_minor) VALUES (?, ?, ?, ?)',
    ['pri_' + prId + '_' + payableId, prId, payableId, 1360100]);
}

function callSync(prId, mode, override) {
  const payment = Object.assign(
    { id: prId, payment_mode: mode, payment_category: 'warehouse_arrival', source_type: 'ci', source_id: 'ci_common', related_ci_id: 'ci_common' },
    override || {}
  );
  const facts = { effectivePaid: 13601, effectiveDeduction: 0, effectiveRounding: 0, outstanding: 0 };
  return syncPaymentSource(payment, facts, 'paid');
}

function batchFee(batchId) {
  return queryOne('SELECT fee_status FROM logistics_batches WHERE id = ?', [batchId]).fee_status;
}

test('TEST A — single freight payable fully paid → batch fee_status = paid (idempotent)', async () => {
  createTestSchema(); resetDB();
  const B = 'batch_A';
  seedFreightPayable({ payableId: 'pA', batchId: B, batchFeeStatus: 'cost_generated', lifecycle: 'paid', ciId: 'ciA' });
  linkPR('prA', 'pA');
  await callSync('prA', 'single');
  assert.strictEqual(batchFee(B), 'paid');
  // idempotent：重复调用结果一致（recalculatePaymentSettlement 幂等的基础）
  await callSync('prA', 'single');
  assert.strictEqual(batchFee(B), 'paid');
});

test('TEST B — multi PR: one freight payable paid + one partially_paid → batches paid / partial_paid', async () => {
  createTestSchema(); resetDB();
  const B1 = 'batch_B1', B2 = 'batch_B2';
  seedFreightPayable({ payableId: 'pB1', batchId: B1, batchFeeStatus: 'cost_generated', lifecycle: 'paid', ciId: 'ciB1' });
  seedFreightPayable({ payableId: 'pB2', batchId: B2, batchFeeStatus: 'cost_generated', lifecycle: 'partially_paid', ciId: 'ciB2' });
  linkPR('prB', 'pB1');
  linkPR('prB', 'pB2');
  await callSync('prB', 'multi');
  assert.strictEqual(batchFee(B1), 'paid');
  assert.strictEqual(batchFee(B2), 'partial_paid');
});

test('TEST C — multi PR terminal but one payable not settled → unsettled batch must NOT become paid', async () => {
  createTestSchema(); resetDB();
  const B1 = 'batch_C1', B2 = 'batch_C2';
  seedFreightPayable({ payableId: 'pC1', batchId: B1, batchFeeStatus: 'cost_generated', lifecycle: 'paid', ciId: 'ciC1' });
  seedFreightPayable({ payableId: 'pC2', batchId: B2, batchFeeStatus: 'cost_generated', lifecycle: 'active', ciId: 'ciC2' });
  linkPR('prC', 'pC1');
  linkPR('prC', 'pC2');
  await callSync('prC', 'multi');
  assert.strictEqual(batchFee(B1), 'paid');     // settled payable → paid
  assert.notStrictEqual(batchFee(B2), 'paid');  // unsettled payable → 不得变 paid
  assert.strictEqual(batchFee(B2), 'unpaid');
});

test('TEST D — production-equivalent 13601 freight fully paid (multi) → batch fee_status = paid', async () => {
  createTestSchema(); resetDB();
  const B = 'log_1785822282160_jyjayz';
  seedFreightPayable({ payableId: 'payitem_1787226953116_6m54ky', batchId: B, batchFeeStatus: 'cost_generated', lifecycle: 'paid', ciId: 'ci_1785312736968_3sne9r', amount: 13601 });
  linkPR('pay_1787232290699_jpw0wi', 'payitem_1787226953116_6m54ky');
  await callSync('pay_1787232290699_jpw0wi', 'multi');
  assert.strictEqual(batchFee(B), 'paid');
});

test('TEST E — normal “到货日期” business entry exists (distinct from historical backfill)', () => {
  const S = fs.readFileSync(__dirname + '/app.js', 'utf8');
  // 正常编辑表单含 actual_arrival_date 输入
  assert.ok(/id="el-arrival"/.test(S), 'editLog form must have a normal actual_arrival_date input');
  // 正常保存 payload 携带 actual_arrival_date
  assert.ok(/actual_arrival_date:document\.getElementById\('el-arrival'\)\.value/.test(S), 'saveEditLog must submit actual_arrival_date via normal PUT');
  // 历史补录入口已重命名为“历史到货日期补录”，与正常入口区分
  assert.ok(/wac\.backfill_btn_arrival','历史到货日期补录'/.test(S), 'historical backfill button must be relabeled');
  // 后端正常 PUT 已允许 actual_arrival_date（不依赖历史 handler）
  const serverSrc = fs.readFileSync(__dirname + '/server.js', 'utf8');
  assert.ok(/app\.put\('\/api\/logistics-batches\/:id'[\s\S]{0,2000}allowed = \[[^\]]*'actual_arrival_date'/.test(serverSrc), 'PUT /logistics-batches must allow actual_arrival_date');
});

test('TEST F — production-equivalent NEW model (source_type=logistics, source_id=batch, source_ci_id=ci) freight paid → fee_status = paid', async () => {
  createTestSchema(); resetDB();
  const B = 'log_F';
  // 生产事实：payable source_type='logistics', source_id=batch.id, source_ci_id=ci.id
  seedFreightPayable({
    payableId: 'pay_F', batchId: B, batchFeeStatus: 'cost_generated', lifecycle: 'paid', ciId: 'ci_F',
    sourceType: 'logistics', sourceId: B, sourceCiId: 'ci_F'
  });
  // 校验种子确实是新模型
  const p = queryOne('SELECT source_type, source_id, source_ci_id, fee_type FROM payable_items WHERE id = ?', ['pay_F']);
  assert.strictEqual(p.source_type, 'logistics');
  assert.strictEqual(p.source_id, B);
  assert.strictEqual(p.source_ci_id, 'ci_F');
  assert.strictEqual(p.fee_type, 'freight');
  linkPR('pr_F', 'pay_F');
  await callSync('pr_F', 'multi');
  assert.strictEqual(batchFee(B), 'paid');
});

test('TEST G — same batch with TWO distinct canonical freight payable_item_id → fail closed (leave unchanged, no silent aggregate)', async () => {
  createTestSchema(); resetDB();
  const B = 'log_G';
  // 两个 distinct canonical freight payable 指向同一批次（重复/历史残留）
  seedFreightPayable({ payableId: 'pG1', batchId: B, batchFeeStatus: 'cost_generated', lifecycle: 'paid', ciId: 'ciG' });
  seedFreightPayable({ payableId: 'pG2', batchId: B, batchFeeStatus: 'cost_generated', lifecycle: 'partially_paid', ciId: 'ciG' });
  linkPR('prG', 'pG1');
  linkPR('prG', 'pG2');
  await callSync('prG', 'multi');
  // 数据冲突：不得静默 aggregate 成 paid / partial_paid；保留原 fee_status
  assert.strictEqual(batchFee(B), 'cost_generated');
  assert.notStrictEqual(batchFee(B), 'paid');
  assert.notStrictEqual(batchFee(B), 'partial_paid');
});

test('TEST H — legacy/canonical overlap: freight payable exists → canonical wins, legacy must NOT write paid', async () => {
  createTestSchema(); resetDB();
  const B = 'log_H';
  // 历史 PR：source_type='logistics', source_id=batch（legacy 条件满足）且 PR aggregate isSettled=true
  // 同时本 PR 存在 freight payable + ci_cost_items canonical linkage，lifecycle='partially_paid'
  seedFreightPayable({ payableId: 'pH', batchId: B, batchFeeStatus: 'cost_generated', lifecycle: 'partially_paid', ciId: 'ciH' });
  linkPR('prH', 'pH');
  await callSync('prH', 'multi', { source_type: 'logistics', source_id: B });
  // 期望：canonical per-payable 路径写入 partial_paid；legacy PR-level 绝不得把该 batch 写成 paid
  assert.strictEqual(batchFee(B), 'partial_paid');
  assert.notStrictEqual(batchFee(B), 'paid');
});

test('TEST I — conflict must genuinely fail closed: legacy branch did NOT pre-write the batch', async () => {
  createTestSchema(); resetDB();
  const B = 'log_I';
  // 历史 PR：source_type='logistics', source_id=batch（legacy 条件满足）
  // 同时该 batch 有 2 个 distinct canonical freight payable_item_id（>1 → fail closed）
  seedFreightPayable({ payableId: 'pI1', batchId: B, batchFeeStatus: 'cost_generated', lifecycle: 'paid', ciId: 'ciI' });
  seedFreightPayable({ payableId: 'pI2', batchId: B, batchFeeStatus: 'cost_generated', lifecycle: 'partially_paid', ciId: 'ciI' });
  linkPR('prI', 'pI1');
  linkPR('prI', 'pI2');
  await callSync('prI', 'multi', { source_type: 'logistics', source_id: B });
  // 期望：>1 冲突 → fail closed，原 fee_status 保持不变（证明 legacy 没有先据 isSettled 改成 paid）
  assert.strictEqual(batchFee(B), 'cost_generated');
  assert.notStrictEqual(batchFee(B), 'paid');
  assert.notStrictEqual(batchFee(B), 'partial_paid');
});
