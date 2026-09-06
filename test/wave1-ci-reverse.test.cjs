'use strict';
/**
 * Wave 1 — CI Reverse 测试 Part A（SQLite 业务 fixture + 静态 AST）
 * =================================================================================================================
 * 覆盖（Wave 1 gate §十三 R1–R13 的 SQLite 可证明部分 + §十四 静态部分）：
 *   R13-STATIC / R13-STATIC-2：reverseCiCorePg AST 结构契约
 *     —— 0 个 transaction() 调用、0 个 db.* sync bridge 引用、恰好 1 个 withGenerateClient、
 *        set_config('app.wac_unlock','1',true)（SET LOCAL 语义）、FOR UPDATE 行锁、
 *        不含 ALTER TABLE/DISABLE/ENABLE TRIGGER（AccessExclusiveLock 类别性消除）、
 *        after-COMMIT 顺序（transit refresh + logOperation 位于事务 owner 之后、fire-and-forget 不 await）
 *   Part A 业务 fixture（R1–R8 + R12）：SQLite :memory: 全栈 HTTP。
 *     【诚实边界】SQLite 分支走 legacy sync 路径（Wave 1 保持逐字节不动）→ 本组证明的是
 *     「legacy 业务语义零回归」；PG row lock / FOR UPDATE / SET LOCAL / trigger 语义的证明
 *     一律在 Part B（wave1-ci-reverse-pg.test.cjs，真实 PostgreSQL）——SQLite 不冒充锁证明。
 *
 * R12 判别口径：in_transit_qty UPDATE 只可能来自 after-COMMIT 的 transit refresh
 * （reverse 主流程只写 available_qty），故该计数 > 0 即证明 after-COMMIT hook 已运行。
 */

process.env.NODE_ENV = 'test'; // CSRF guard 在 test 环境自动关闭

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');

const REPO = path.resolve(__dirname, '..');
const SERVER = path.join(REPO, 'server.js');

// ---------------------------------------------------------------------------
// R13-STATIC：reverseCiCorePg 结构契约
// ---------------------------------------------------------------------------
function findFunction(name) {
  const src = fs.readFileSync(SERVER, 'utf8');
  const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'script', ranges: true });
  let fn = null;
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'FunctionDeclaration' && node.id && node.id.name === name) fn = node;
    for (const k of Object.keys(node)) { if (node[k] && typeof node[k] === 'object') walk(node[k]); }
  };
  walk(ast);
  assert.ok(fn, '必须找到函数定义: ' + name);
  return { src: src.slice(fn.body.start, fn.body.end), node: fn };
}

function astScan(fnBodyNode) {
  const calls = [];
  const memberCalls = [];
  const dbMemberCalls = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'CallExpression') {
      if (node.callee.type === 'Identifier') calls.push(node.callee.name);
      if (node.callee.type === 'MemberExpression' && !node.callee.computed &&
          node.callee.object.type === 'Identifier' && node.callee.property.type === 'Identifier') {
        memberCalls.push(node.callee.object.name + '.' + node.callee.property.name);
        if (node.callee.object.name === 'db') dbMemberCalls.push('db.' + node.callee.property.name);
      }
    }
    for (const k of Object.keys(node)) { if (node[k] && typeof node[k] === 'object') walk(node[k]); }
  };
  walk(fnBodyNode);
  return { calls, memberCalls, dbMemberCalls };
}

test('R13-STATIC: reverseCiCorePg —— 0 transaction / 0 db.* / 单 withGenerateClient / SET LOCAL / FOR UPDATE / 无 DDL', () => {
  const { src, node } = findFunction('reverseCiCorePg');
  const { calls, memberCalls, dbMemberCalls } = astScan(node.body);

  assert.strictEqual(calls.filter((c) => c === 'transaction').length, 0,
    'PG 分支不得调用 transaction()（sync bridge）');
  assert.strictEqual(dbMemberCalls.length, 0,
    'PG 分支不得引用 db.query/db.queryOne/db.run/db.transaction，实际: ' + dbMemberCalls.join(','));
  assert.strictEqual(calls.filter((c) => c === 'withGenerateClient').length, 1,
    'PG 分支必须恰好 1 个 withGenerateClient（单 client 事务 owner，禁止中途换连接）');
  assert.ok(/set_config\(\s*'app\.wac_unlock'\s*,\s*'1'\s*,\s*true\s*\)/.test(src),
    '必须用 set_config(..., is_local=true)（SET LOCAL 语义：COMMIT/ROLLBACK 自动消失）');
  const fuCount = (src.match(/FOR UPDATE/g) || []).length;
  assert.ok(fuCount >= 3, '必须含 FOR UPDATE 行锁（CI 行 + PI headers + PI items），实际 ' + fuCount);
  assert.ok(!/ALTER\s+TABLE/i.test(src), 'PG 分支不得含 ALTER TABLE（AccessExclusiveLock 消除）');
  assert.ok(!/DISABLE\s+TRIGGER/i.test(src), 'PG 分支不得含 DISABLE TRIGGER');
  assert.ok(!/ENABLE\s+TRIGGER/i.test(src), 'PG 分支不得含 ENABLE TRIGGER');
  assert.ok(calls.includes('updateInventoryTransitDataAsync'), 'after-COMMIT transit refresh 必须存在');
  assert.ok(calls.includes('logOperation'), 'logOperation 必须存在（COMMIT 后唯一 sync call，P2 债务口径）');
  assert.ok(memberCalls.includes('WAC_TRIGGER_GUARD.ensureGuardInTx'), 'WAC 触发器守卫自愈确保必须存在');
  assert.ok(/jsonb_to_recordset/.test(src), 'PI headers 金额必须走 jsonb set-based（0 N-dependent）');
});

test('R13-STATIC-2: after-COMMIT 顺序 + fire-and-forget（不 await）', () => {
  const { node: fnNode } = findFunction('reverseCiCorePg');
  const fnSrc = fs.readFileSync(SERVER, 'utf8').slice(fnNode.body.start, fnNode.body.end);
  // 【范围限定】只扫 reverseCiCorePg 函数节点 —— 全文件有 24 个 transit 调用点，不可全扫
  let genEnd = -1, transitStart = -1;
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier') {
      if (node.callee.name === 'withGenerateClient') genEnd = node.range[1];
      if (node.callee.name === 'updateInventoryTransitDataAsync' && transitStart < 0) transitStart = node.range[0];
    }
    for (const k of Object.keys(node)) { if (node[k] && typeof node[k] === 'object') walk(node[k]); }
  };
  walk(fnNode.body);
  assert.ok(genEnd > 0 && transitStart > genEnd,
    'updateInventoryTransitDataAsync 必须位于 withGenerateClient 调用（含 COMMIT/ROLLBACK）之后');
  const respPos = fnSrc.indexOf('res.status(outcome.status)');
  const transitPos = fnSrc.indexOf('updateInventoryTransitDataAsync()');
  const logPos = fnSrc.indexOf('logOperation({');
  assert.ok(respPos >= 0 && transitPos > respPos && logPos > transitPos,
    '顺序必须为：响应写出 → transit refresh → logOperation（owner 已释放后）');
  assert.ok(/\.catch\(\s*\(err\)\s*=>\s*\{[^}]*CI-REVERSE/.test(fnSrc),
    'transit refresh 必须 fire-and-forget .catch 可观察');
  assert.ok(!/await\s+updateInventoryTransitDataAsync/.test(fnSrc),
    '不得恢复 await refresh（Wave 0B 纪律）');
});

// ===========================================================================
// Part A：SQLite 业务 fixture（legacy 分支零回归证明）
// ===========================================================================
process.env.DB_DRIVER = 'sqlite';
process.env.DB_PATH = ':memory:';

const db = require('../db');
db.initDatabase();

// sync bridge 计数器（必须在 require('../server') 之前替换 db 导出）
const counters = { inventoryRuns: 0, transitRuns: 0 };
const origRun = db.run;
function resetCounters() { counters.inventoryRuns = 0; counters.transitRuns = 0; }
let runHook = null; // 测试注入点（R8 中途失败模拟）：抛错即注入
db.run = function (sql, params) {
  const s = String(sql);
  if (/UPDATE\s+inventory/i.test(s)) counters.inventoryRuns++;
  if (/UPDATE\s+inventory[\s\S]*in_transit_qty/i.test(s)) counters.transitRuns++; // 仅 transit refresh 写 in_transit_qty
  if (runHook) runHook(s);
  return origRun(sql, params);
};

const G = () => db.getDB();
G().exec(`
  CREATE TABLE IF NOT EXISTS consignment_inventory_lots (
    id TEXT PRIMARY KEY, country_name TEXT, warehouse_name TEXT NOT NULL, customer_name TEXT,
    outbound_no TEXT, outbound_date TEXT, sku_code TEXT NOT NULL, outbound_qty INTEGER, sold_qty INTEGER,
    returned_qty INTEGER, remaining_qty INTEGER, unit_cost NUMERIC(18,4), remaining_inventory_value NUMERIC(18,4),
    import_batch_id TEXT NOT NULL, source_line_no INTEGER, source_type TEXT DEFAULT 'excel',
    status TEXT DEFAULT 'active', created_by TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS consignment_inventory_import_batches (
    id TEXT PRIMARY KEY, warehouse_name TEXT NOT NULL, country_name TEXT, original_filename TEXT,
    total_rows INTEGER, valid_rows INTEGER, error_rows INTEGER, customer_count INTEGER, sku_count INTEGER,
    total_remaining_qty INTEGER, total_remaining_value NUMERIC(18,4), status TEXT DEFAULT 'pending',
    created_by TEXT, created_at TEXT DEFAULT (datetime('now')), activated_at TEXT
  );
`);
for (const stmt of [
  "ALTER TABLE commercial_invoices ADD COLUMN original_inventory_imported INTEGER DEFAULT 0",
  "ALTER TABLE payable_items ADD COLUMN source_ci_id TEXT DEFAULT ''",
  "ALTER TABLE payable_items ADD COLUMN lifecycle_status TEXT NOT NULL DEFAULT 'active'"
]) { try { G().prepare(stmt).run(); } catch (e) { /* 已存在 */ } }

const server = require('../server');
const { app } = server;

// 鉴权种子
const TOKEN_A = 'wave1-test-token';
const TOKEN_HASH_A = crypto.createHash('sha256').update(TOKEN_A).digest('hex');
G().prepare(`INSERT OR REPLACE INTO roles (id, name, description, permissions, is_system) VALUES ('role_wave1', 'Wave1 Role', '', ?, 0)`)
  .run(JSON.stringify(['ci_view', 'ci_edit', 'user_manage']));
G().prepare(`INSERT OR REPLACE INTO users (id, username, name, password, role_id, status) VALUES ('user_wave1', 'wave1', 'Wave1 Tester', '', 'role_wave1', 'active')`).run();
G().prepare(`INSERT OR REPLACE INTO sessions (id, token_hash, user_id, created_at, expires_at) VALUES ('sess_wave1', ?, 'user_wave1', datetime('now'), datetime('now', '+1 day'))`).run(TOKEN_HASH_A);
const COOKIE = `session_token=${TOKEN_A}`;

let port = 0;
let srv;
before(async () => {
  await new Promise((resolve) => { srv = app.listen(0, () => { port = srv.address().port; resolve(); }); });
});
after(() => { try { srv.close(); } catch (e) {} });

async function fetchJSON(method, pathStr, body) {
  const res = await fetch(`http://127.0.0.1:${port}${pathStr}`, {
    method,
    headers: { 'content-type': 'application/json', cookie: COOKIE },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let json = null; try { json = await res.json(); } catch (e) {}
  return { status: res.status, json };
}
async function waitFor(predicate, label) {
  for (let i = 0; i < 200; i++) { if (predicate()) return true; await new Promise((r) => setImmediate(r)); }
  assert.fail('timeout waiting for: ' + (label || 'condition'));
}

// --- seed：单 CI 场景（1 PI / 1 item / N inbound / wac 锁定 / 分摊 / balance payable / PL）---
let seqA = 0;
function seedSingle(tag, opts = {}) {
  seqA++;
  const sku = 'SKU-' + tag;
  const ciId = 'ci_' + tag;
  const piId = 'pi_' + tag;
  const ciItems = opts.ciItems || [{ sku, shipped: 30, amount: 300 }];
  const inbounds = opts.inbounds || [{ qty: 5 }, { qty: 7 }];

  G().prepare(`INSERT OR REPLACE INTO inventory (id, sku_code, country, warehouse, available_qty, in_transit_qty, pi_confirmed_unshipped_qty, po_unconfirmed_pi_qty)
            VALUES (?, ?, 'ID', 'WH1', ?, 0, 0, 0)`).run(['inv_' + tag, sku, opts.invQty != null ? opts.invQty : 100]);
  G().prepare(`INSERT OR REPLACE INTO proforma_invoices (id, pi_no, pi_date, need_deposit, deposit_ratio, balance_ratio,
              total_amount, currency, pi_status, deposit_payment_status, country, target_warehouse,
              payable_deposit, deducted_deposit, available_deduct_deposit, shipped_amount, unshipped_amount)
            VALUES (?, ?, '2026-08-01', 0, 0, 100, 500, 'USD', 'shipped_complete', 'unpaid', 'ID', 'WH1', 200, 175, 25, 400, 100)`)
    .run([piId, 'PI-' + tag]);
  G().prepare(`INSERT OR REPLACE INTO proforma_invoice_items (id, pi_id, pi_no, po_no, sku_code, po_qty, pi_confirmed_qty,
              unit_price, pi_amount, shipped_qty, unshipped_qty)
            VALUES (?, ?, ?, '', ?, 0, 50, 0, 0, 50, 0)`).run(['pii_' + tag, piId, 'PI-' + tag, sku]);
  G().prepare(`INSERT OR REPLACE INTO commercial_invoices (id, ci_no, ci_date, currency, ci_status, country, target_warehouse,
              actual_deducted_deposit, wac_confirmed, wac_version_id, cost_confirmed, cost_allocated, remark, original_inventory_imported)
            VALUES (?, ?, '2026-08-01', 'USD', 'inbound_complete', 'ID', 'WH1', 100, 1, 'wv1', 1, 1, 'ci-remark', 1)`)
    .run([ciId, 'CI-' + tag]);
  let n = 0;
  for (const it of ciItems) {
    n++;
    G().prepare(`INSERT INTO commercial_invoice_items (id, ci_id, ci_no, pi_id, sku_code, shipped_qty, inbound_qty, ci_amount, unit_price)
              VALUES (?, ?, ?, ?, ?, ?, 0, ?, 0)`)
      .run([`cii_${tag}_${n}`, ciId, 'CI-' + tag, piId, it.sku, it.shipped, it.amount]);
  }
  let m = 0;
  for (const ib of inbounds) {
    m++;
    G().prepare(`INSERT INTO inbound_records (id, inbound_no, source_ci_id, source_ci_no, country, warehouse, inbound_date,
                sku_code, actual_qty, inbound_status, remark)
              VALUES (?, ?, ?, ?, ?, 'WH1', '2026-08-05', ?, ?, 'completed', ?)`)
      .run([`ib_${tag}_${m}`, 'IB-' + tag + '-' + m, ciId, 'CI-' + tag,
            ib.country != null ? ib.country : 'ID', ib.sku || sku, ib.qty, ib.remark != null ? ib.remark : '']);
  }
  G().prepare(`INSERT OR REPLACE INTO wac_history (id, version_no, ci_id, ci_no, sku_code, country, warehouse, is_locked, confirmation_status)
            VALUES (?, 1, ?, ?, ?, 'ID', 'WH1', 1, 'confirmed')`).run(['wac_' + tag, ciId, 'CI-' + tag, sku]);
  G().prepare(`INSERT OR REPLACE INTO cost_allocations (id, ci_id, ci_no, sku_code, allocation_basis) VALUES (?, ?, ?, ?, 'BASE')`)
    .run(['ca_' + tag, ciId, 'CI-' + tag, sku]);
  G().prepare(`INSERT INTO payable_items (id, fee_no, source_type, source_id, source_no, source_ci_id, fee_type, payee_key,
              payee_name_snapshot, payer_entity_key, payer_name_snapshot, currency, payable_amount_minor, is_active, lifecycle_status)
            VALUES (?, ?, 'pi', ?, '', ?, 'balance', 'payee1', 'Payee', 'payer1', 'Payer', 'USD', 10000, 1, 'active')`)
    .run(['pay_' + tag, 'FEE-' + tag, piId, ciId]);
  G().prepare(`INSERT OR REPLACE INTO packing_lists (id, pl_no, related_ci_id, related_ci_no, total_qty, status, remark)
            VALUES (?, ?, ?, ?, 12, 'confirmed', 'pl-remark')`).run(['pl_' + tag, 'PL-' + tag, ciId, 'CI-' + tag]);
  return { sku, ciId, piId };
}
function invRowA(sku) {
  return db.queryOne('SELECT available_qty, in_transit_qty FROM inventory WHERE sku_code = ? AND country = ? AND warehouse = ?', [sku, 'ID', 'WH1']) || {};
}
function piRowA(piId) { return db.queryOne('SELECT * FROM proforma_invoices WHERE id = ?', [piId]) || {}; }
function ciRowA(ciId) { return db.queryOne('SELECT * FROM commercial_invoices WHERE id = ?', [ciId]) || {}; }

describe('Part A: SQLite 业务 fixture（legacy 分支零回归）', () => {
  test('R1: 正常 reverse —— 全字段与 legacy 语义逐项一致', async () => {
    const sku1 = 'SKU-R1X'; const sku2 = 'SKU-R1Y';
    G().prepare(`INSERT OR REPLACE INTO inventory (id, sku_code, country, warehouse, available_qty) VALUES ('inv_R1X', ?, 'ID', 'WH1', 100)`).run(sku1);
    G().prepare(`INSERT OR REPLACE INTO inventory (id, sku_code, country, warehouse, available_qty) VALUES ('inv_R1Y', ?, 'ID', 'WH1', 50)`).run(sku2);
    G().prepare(`INSERT OR REPLACE INTO proforma_invoices (id, pi_no, pi_date, need_deposit, deposit_ratio, balance_ratio,
                total_amount, currency, pi_status, deposit_payment_status, country, target_warehouse,
                payable_deposit, deducted_deposit, available_deduct_deposit, shipped_amount, unshipped_amount)
              VALUES ('pi_R1', 'PI-R1', '2026-08-01', 0, 0, 100, 500, 'USD', 'shipped_complete', 'unpaid', 'ID', 'WH1',
                      200, 175, 25, 400, 100)`).run();
    G().prepare(`INSERT OR REPLACE INTO proforma_invoice_items (id, pi_id, pi_no, po_no, sku_code, po_qty, pi_confirmed_qty,
                unit_price, pi_amount, shipped_qty, unshipped_qty)
              VALUES ('pii_R1_1', 'pi_R1', 'PI-R1', '', ?, 0, 50, 0, 0, 50, 0)`).run(sku1);
    G().prepare(`INSERT OR REPLACE INTO proforma_invoice_items (id, pi_id, pi_no, po_no, sku_code, po_qty, pi_confirmed_qty,
                unit_price, pi_amount, shipped_qty, unshipped_qty)
              VALUES ('pii_R1_2', 'pi_R1', 'PI-R1', '', ?, 0, 10, 0, 0, 10, 0)`).run(sku2);
    G().prepare(`INSERT OR REPLACE INTO commercial_invoices (id, ci_no, ci_date, currency, ci_status, country, target_warehouse,
                actual_deducted_deposit, wac_confirmed, wac_version_id, cost_confirmed, cost_allocated, remark, original_inventory_imported)
              VALUES ('ci_R1', 'CI-R1', '2026-08-01', 'USD', 'inbound_complete', 'ID', 'WH1', 100, 1, 'wv1', 1, 1, 'ci-remark', 1)`).run();
    G().prepare(`INSERT INTO commercial_invoice_items (id, ci_id, ci_no, pi_id, sku_code, shipped_qty, inbound_qty, ci_amount, unit_price)
              VALUES ('cii_R1_1', 'ci_R1', 'CI-R1', 'pi_R1', ?, 30, 0, 300, 0)`).run(sku1);
    G().prepare(`INSERT INTO commercial_invoice_items (id, ci_id, ci_no, pi_id, sku_code, shipped_qty, inbound_qty, ci_amount, unit_price)
              VALUES ('cii_R1_2', 'ci_R1', 'CI-R1', 'pi_R1', ?, 10, 0, 100, 0)`).run(sku2);
    G().prepare(`INSERT INTO inbound_records (id, inbound_no, source_ci_id, source_ci_no, country, warehouse, inbound_date, sku_code, actual_qty, inbound_status, remark)
              VALUES ('ib_R1_1', 'IB-R1-1', 'ci_R1', 'CI-R1', 'ID', 'WH1', '2026-08-05', ?, 5, 'completed', '')`).run(sku1);
    G().prepare(`INSERT INTO inbound_records (id, inbound_no, source_ci_id, source_ci_no, country, warehouse, inbound_date, sku_code, actual_qty, inbound_status, remark)
              VALUES ('ib_R1_2', 'IB-R1-2', 'ci_R1', 'CI-R1', 'ID', 'WH1', '2026-08-05', ?, 7, 'completed', 'note')`).run(sku1);
    G().prepare(`INSERT INTO inbound_records (id, inbound_no, source_ci_id, source_ci_no, country, warehouse, inbound_date, sku_code, actual_qty, inbound_status, remark)
              VALUES ('ib_R1_3', 'IB-R1-3', 'ci_R1', 'CI-R1', 'ID', 'WH1', '2026-08-05', ?, 3, 'completed', '')`).run(sku2);
    G().prepare(`INSERT OR REPLACE INTO wac_history (id, version_no, ci_id, ci_no, sku_code, country, warehouse, is_locked, confirmation_status)
              VALUES ('wac_R1', 1, 'ci_R1', 'CI-R1', ?, 'ID', 'WH1', 1, 'confirmed')`).run(sku1);
    G().prepare(`INSERT OR REPLACE INTO cost_allocations (id, ci_id, ci_no, sku_code, allocation_basis) VALUES ('ca_R1', 'ci_R1', 'CI-R1', ?, 'BASE')`).run(sku1);
    G().prepare(`INSERT INTO payable_items (id, fee_no, source_type, source_id, source_no, source_ci_id, fee_type, payee_key,
                payee_name_snapshot, payer_entity_key, payer_name_snapshot, currency, payable_amount_minor, is_active, lifecycle_status)
              VALUES ('pay_R1', 'FEE-R1', 'pi', 'pi_R1', '', 'ci_R1', 'balance', 'payee1', 'Payee', 'payer1', 'Payer', 'USD', 10000, 1, 'active')`).run();
    G().prepare(`INSERT OR REPLACE INTO packing_lists (id, pl_no, related_ci_id, related_ci_no, total_qty, status, remark)
              VALUES ('pl_R1', 'PL-R1', 'ci_R1', 'CI-R1', 12, 'confirmed', 'pl-remark')`).run();

    resetCounters();
    const r = await fetchJSON('POST', '/api/commercial-invoices/ci_R1/reverse');
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(r.json, { success: true, id: 'ci_R1', ci_no: 'CI-R1' });

    const ci = ciRowA('ci_R1');
    assert.equal(ci.ci_status, 'reversed');
    assert.equal(ci.wac_confirmed, 0); assert.equal(ci.cost_confirmed, 0); assert.equal(ci.original_inventory_imported, 0);
    assert.ok(String(ci.remark).indexOf('ci-remark\n') === 0 && ci.remark.indexOf('[冲销 ') > 0, 'remark 追加: ' + ci.remark);
    assert.equal(invRowA(sku1).available_qty, 88, 'sku1 100-(5+7)=88（无 clamp 语义保持）');
    assert.equal(invRowA(sku2).available_qty, 47, 'sku2 50-3=47');
    const pit1 = db.queryOne('SELECT * FROM proforma_invoice_items WHERE id = ?', ['pii_R1_1']);
    const pit2 = db.queryOne('SELECT * FROM proforma_invoice_items WHERE id = ?', ['pii_R1_2']);
    assert.equal(pit1.shipped_qty, 20); assert.equal(pit1.unshipped_qty, 30);
    assert.equal(pit2.shipped_qty, 0); assert.equal(pit2.unshipped_qty, 10);
    const pi = piRowA('pi_R1');
    assert.equal(pi.deducted_deposit, 75); assert.equal(pi.available_deduct_deposit, 125);
    assert.equal(pi.shipped_amount, 0); assert.equal(pi.unshipped_amount, 500);
    assert.equal(pi.pi_status, 'partial_shipped');
    const ibs = db.query('SELECT * FROM inbound_records WHERE source_ci_id = ? ORDER BY id', ['ci_R1']).rows;
    assert.equal(ibs.length, 3);
    ibs.forEach((b) => { assert.equal(b.inbound_status, 'reversed'); assert.ok(String(b.remark).indexOf('[冲销 ') >= 0); });
    assert.ok(ibs[1].remark.indexOf('note\n[冲销 ') === 0, '已有 remark 追加换行: ' + ibs[1].remark);
    const wac = db.queryOne('SELECT * FROM wac_history WHERE id = ?', ['wac_R1']);
    assert.equal(wac.is_locked, 0); assert.equal(wac.confirmation_status, 'reversed');
    const ca = db.queryOne('SELECT * FROM cost_allocations WHERE id = ?', ['ca_R1']);
    assert.equal(ca.ci_id, ''); assert.ok(ca.allocation_basis.indexOf(' [reversed ') > 0);
    assert.equal(db.queryOne('SELECT lifecycle_status FROM payable_items WHERE id = ?', ['pay_R1']).lifecycle_status, 'released');
    const pl = db.queryOne('SELECT remark FROM packing_lists WHERE id = ?', ['pl_R1']);
    assert.ok(pl.remark.indexOf('pl-remark\n[冲销 ') === 0, 'PL remark: ' + pl.remark);
    // R12: after-COMMIT transit refresh 可观察（in_transit_qty UPDATE 只可能来自 refresh hook）
    await waitFor(() => counters.transitRuns > 0, 'after-COMMIT transit refresh');
  });

  test('R2: 二次 reverse → 400 + 不重复扣减', async () => {
    const before = invRowA('SKU-R1X').available_qty;
    const r = await fetchJSON('POST', '/api/commercial-invoices/ci_R1/reverse');
    assert.strictEqual(r.status, 400);
    assert.equal(r.json.error, '该 CI 已冲销，不能重复冲销');
    assert.equal(invRowA('SKU-R1X').available_qty, before, '库存不得二次扣减');
  });

  test('R3+R4: 多 inbound 同 key SUM 恒等 + 同 SKU 多 ci item 连减恒等', async () => {
    const f = seedSingle('R3', { invQty: 100, inbounds: [{ qty: 5 }, { qty: 7 }, { qty: 9 }] });
    G().prepare(`INSERT INTO commercial_invoice_items (id, ci_id, ci_no, pi_id, sku_code, shipped_qty, inbound_qty, ci_amount, unit_price)
              VALUES ('cii_R3_extra', ?, ?, ?, ?, 6, 0, 60, 0)`).run([f.ciId, 'CI-R3', f.piId, f.sku]);
    const r = await fetchJSON('POST', '/api/commercial-invoices/' + f.ciId + '/reverse');
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.equal(invRowA(f.sku).available_qty, 79, 'SUM(5+7+9)=21 一次扣减：100-21');
    const pit = db.queryOne('SELECT * FROM proforma_invoice_items WHERE pi_id = ? AND sku_code = ?', [f.piId, f.sku]);
    assert.equal(pit.shipped_qty, 14, 'shipped 50-(30+6)=14（逐行连减 ≡ SUM 恒等）');
    assert.equal(pit.unshipped_qty, 36, 'unshipped = max(0, 50-14)');
  });

  test('R5: 共享 PI 双 CI 顺序 reverse —— 累计扣减无丢失', async () => {
    const sku = 'SKU-R5';
    G().prepare(`INSERT OR REPLACE INTO inventory (id, sku_code, country, warehouse, available_qty) VALUES ('inv_R5', ?, 'ID', 'WH1', 200)`).run(sku);
    G().prepare(`INSERT OR REPLACE INTO proforma_invoices (id, pi_no, pi_date, need_deposit, deposit_ratio, balance_ratio,
                total_amount, currency, pi_status, deposit_payment_status, country, target_warehouse,
                payable_deposit, deducted_deposit, available_deduct_deposit, shipped_amount, unshipped_amount)
              VALUES ('pi_R5', 'PI-R5', '2026-08-01', 0, 0, 100, 500, 'USD', 'shipped_complete', 'unpaid', 'ID', 'WH1',
                      200, 175, 25, 400, 100)`).run();
    G().prepare(`INSERT OR REPLACE INTO proforma_invoice_items (id, pi_id, pi_no, po_no, sku_code, po_qty, pi_confirmed_qty,
                unit_price, pi_amount, shipped_qty, unshipped_qty)
              VALUES ('pii_R5', 'pi_R5', 'PI-R5', '', ?, 0, 80, 0, 0, 80, 0)`).run(sku);
    for (const [cid, amt, deduct, ship] of [['ci_R5A', 300, 60, 30], ['ci_R5B', 100, 40, 50]]) {
      G().prepare(`INSERT OR REPLACE INTO commercial_invoices (id, ci_no, ci_date, currency, ci_status, country, target_warehouse,
                  actual_deducted_deposit, wac_confirmed, wac_version_id, cost_confirmed, cost_allocated, remark, original_inventory_imported)
                VALUES (?, ?, '2026-08-01', 'USD', 'inbound_complete', 'ID', 'WH1', ?, 1, 'wv', 1, 1, '', 1)`).run([cid, 'CI-' + cid, deduct]);
      G().prepare(`INSERT INTO commercial_invoice_items (id, ci_id, ci_no, pi_id, sku_code, shipped_qty, inbound_qty, ci_amount, unit_price)
                VALUES (?, ?, ?, 'pi_R5', ?, ?, 0, ?, 0)`).run(['cii_' + cid, cid, 'CI-' + cid, sku, ship, amt]);
      G().prepare(`INSERT INTO inbound_records (id, inbound_no, source_ci_id, source_ci_no, country, warehouse, inbound_date, sku_code, actual_qty, inbound_status, remark)
                VALUES (?, ?, ?, ?, 'ID', 'WH1', '2026-08-05', ?, 0, 'completed', '')`).run(['ib_' + cid, 'IB-' + cid, cid, 'CI-' + cid, sku]);
    }
    let r = await fetchJSON('POST', '/api/commercial-invoices/ci_R5A/reverse');
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    let pi = piRowA('pi_R5');
    assert.equal(pi.deducted_deposit, 115); assert.equal(pi.shipped_amount, 100); assert.equal(pi.pi_status, 'partial_shipped');
    r = await fetchJSON('POST', '/api/commercial-invoices/ci_R5B/reverse');
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    pi = piRowA('pi_R5');
    assert.equal(pi.deducted_deposit, 75, '175-60-40=75（无 lost update）');
    assert.equal(pi.available_deduct_deposit, 125);
    assert.equal(pi.shipped_amount, 0); assert.equal(pi.unshipped_amount, 500);
    const pit = db.queryOne('SELECT * FROM proforma_invoice_items WHERE id = ?', ['pii_R5']);
    assert.equal(pit.shipped_qty, 0); assert.equal(pit.unshipped_qty, 80);
    assert.equal(piRowA('pi_R5').pi_status, 'pending', 'shipped 0 → pending');
  });

  test('R6: 无 inbound 记录 —— reverse 成功，库存不动', async () => {
    const f = seedSingle('R6', { inbounds: [] });
    const r = await fetchJSON('POST', '/api/commercial-invoices/' + f.ciId + '/reverse');
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.equal(invRowA(f.sku).available_qty, 100, '无 inbound → 库存不动');
  });

  test('R7: partial linked —— 空串国家回退 CI.country + ghost PI/缺失明细安全跳过', async () => {
    const sku = 'SKU-R7'; const sku2 = 'SKU-R7B';
    G().prepare(`INSERT OR REPLACE INTO inventory (id, sku_code, country, warehouse, available_qty) VALUES ('inv_R7', ?, 'ID', 'WH1', 60)`).run(sku);
    G().prepare(`INSERT OR REPLACE INTO inventory (id, sku_code, country, warehouse, available_qty) VALUES ('inv_R7B', ?, 'ID', 'WH1', 40)`).run(sku2);
    G().prepare(`INSERT OR REPLACE INTO proforma_invoices (id, pi_no, pi_date, need_deposit, deposit_ratio, balance_ratio,
                total_amount, currency, pi_status, deposit_payment_status, country, target_warehouse,
                payable_deposit, deducted_deposit, available_deduct_deposit, shipped_amount, unshipped_amount)
              VALUES ('pi_R7', 'PI-R7', '2026-08-01', 0, 0, 100, 100, 'USD', 'shipped_complete', 'unpaid', 'ID', 'WH1',
                      0, 0, 0, 20, 80)`).run();
    G().prepare(`INSERT OR REPLACE INTO proforma_invoice_items (id, pi_id, pi_no, po_no, sku_code, po_qty, pi_confirmed_qty,
                unit_price, pi_amount, shipped_qty, unshipped_qty)
              VALUES ('pii_R7', 'pi_R7', 'PI-R7', '', ?, 0, 30, 0, 0, 20, 10)`).run(sku2);
    G().prepare(`INSERT OR REPLACE INTO commercial_invoices (id, ci_no, ci_date, currency, ci_status, country, target_warehouse,
                actual_deducted_deposit, wac_confirmed, wac_version_id, cost_confirmed, cost_allocated, remark, original_inventory_imported)
              VALUES ('ci_R7', 'CI-R7', '2026-08-01', 'USD', 'inbound_complete', 'ID', 'WH1', 0, 1, 'wv', 1, 1, '', 1)`).run();
    G().prepare(`INSERT INTO commercial_invoice_items (id, ci_id, ci_no, pi_id, sku_code, shipped_qty, inbound_qty, ci_amount, unit_price)
              VALUES ('cii_R7_1', 'ci_R7', 'CI-R7', 'pi_ghost', ?, 5, 0, 50, 0)`).run(sku);
    // item2 的 SKU 无任何 pit 明细行 → set-based/逐行都不命中（缺失行安全跳过）
    G().prepare(`INSERT INTO commercial_invoice_items (id, ci_id, ci_no, pi_id, sku_code, shipped_qty, inbound_qty, ci_amount, unit_price)
              VALUES ('cii_R7_2', 'ci_R7', 'CI-R7', 'pi_R7', 'SKU-R7C-无明细', 8, 0, 0, 0)`).run();
    G().prepare(`INSERT INTO inbound_records (id, inbound_no, source_ci_id, source_ci_no, country, warehouse, inbound_date, sku_code, actual_qty, inbound_status, remark)
              VALUES ('ib_R7', 'IB-R7', 'ci_R7', 'CI-R7', '', 'WH1', '2026-08-05', ?, 6, 'completed', '')`).run(sku);
    const r = await fetchJSON('POST', '/api/commercial-invoices/ci_R7/reverse');
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.equal(invRowA(sku).available_qty, 54, "inbound.country='' 回退 ci.country='ID' → 60-6");
    const pit = db.queryOne('SELECT * FROM proforma_invoice_items WHERE id = ?', ['pii_R7']);
    assert.equal(pit.shipped_qty, 20, '(pi_R7, sku2) 无 ci 明细命中 → 不变（ghost PI item 跳过）');
  });

  test('R8: 中途失败 → 整体 ROLLBACK（业务原子性）', async () => {
    const f = seedSingle('R8');
    const before = {
      inv: invRowA(f.sku).available_qty,
      ci: ciRowA(f.ciId).ci_status,
      wac: db.queryOne('SELECT is_locked FROM wac_history WHERE id = ?', ['wac_R8']).is_locked,
      pay: db.queryOne('SELECT lifecycle_status FROM payable_items WHERE id = ?', ['pay_R8']).lifecycle_status
    };
    let injected = false;
    runHook = (s) => {
      if (!injected && /UPDATE\s+commercial_invoices\s+SET\s+ci_status\s*=\s*'reversed'/i.test(s)) {
        injected = true;
        throw new Error('W1-INJECTED-FAILURE');
      }
    };
    let resp;
    try { resp = await fetchJSON('POST', '/api/commercial-invoices/' + f.ciId + '/reverse'); }
    finally { runHook = null; }
    assert.strictEqual(resp.status, 500, JSON.stringify(resp.json));
    assert.equal(invRowA(f.sku).available_qty, before.inv, '库存必须回滚');
    assert.equal(ciRowA(f.ciId).ci_status, before.ci, 'CI 状态必须回滚');
    assert.equal(db.queryOne('SELECT is_locked FROM wac_history WHERE id = ?', ['wac_R8']).is_locked, before.wac, 'WAC 必须仍锁定');
    assert.equal(db.queryOne('SELECT lifecycle_status FROM payable_items WHERE id = ?', ['pay_R8']).lifecycle_status, before.pay, 'payable 必须未释放');
    const ib = db.queryOne('SELECT inbound_status FROM inbound_records WHERE source_ci_id = ?', [f.ciId]);
    assert.equal(ib.inbound_status, 'completed', 'inbound 必须回滚');
  });
});
