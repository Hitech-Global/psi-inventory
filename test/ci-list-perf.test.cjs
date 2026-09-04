'use strict';

/**
 * ci-list-perf.test.cjs — CI/PL PERF-01 回归测试
 *
 * 1) 批量付款事实与单条版【逐字段 deepEqual】（口径冻结契约）：
 *    computeHistoricalCIPaymentFactsBulk  ≡ computeHistoricalCIPaymentFacts
 *    computeOperatingCIBalancePaymentFactsBulk ≡ computeOperatingCIBalancePaymentFacts
 *    等价性依据：payableItemsSettlementBreakdown 的 PR 级分摊基数 totalByPr 按
 *    payment_request_id 全体 pris 求和（server.js "WHERE payment_request_id IN"），
 *    与调用方传入的 item 集合无关 → 一次全局调用与逐条调用结果一致。
 * 2) 索引迁移：全新 SQLite 库（initDatabase）包含 13 条 CI/PL 索引；
 *    db.js PG 迁移数组包含同款同名 DDL。
 *
 * 不访问生产 DB；全部用例运行于 :memory: SQLite。
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DB_DRIVER = 'sqlite';
process.env.DB_PATH = ':memory:';

const dbMod = require('../db');
const { run, query } = dbMod;
const {
  computeHistoricalCIPaymentFacts,
  computeHistoricalCIPaymentFactsBulk,
  computeOperatingCIBalancePaymentFacts,
  computeOperatingCIBalancePaymentFactsBulk,
} = require('../server');

// 全真 SQLite schema + 全部索引（含 PERF-01 新增 13 条）
dbMod.initDatabase();
seed();

function insertHci(id, { gross, paid }) {
  run(`INSERT INTO historical_commercial_invoices
       (id, historical_ci_no, supplier_name, supplier_identity, brand_name, country, ci_date, currency,
        gross_goods_amount, historical_paid_amount, source_mode, idempotency_key, payload_hash)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, 'HIT-' + id, 'Supplier-' + id, 'corp', 'BrandA', 'ID', '2026-01-01', 'USD', gross, paid, 'historical', 'idem-' + id, 'hash-' + id]);
}

function insertCi(id, payableBalance) {
  run(`INSERT INTO commercial_invoices (id, ci_no, ci_date, payable_balance) VALUES (?,?,?,?)`,
    [id, 'CI-' + id, '2026-01-01', payableBalance]);
}

function insertPi(id, { source_type, source_id, source_ci_id, fee_type, minor }) {
  run(`INSERT INTO payable_items (id, fee_no, source_type, source_id, source_ci_id, fee_type,
        payee_key, payer_entity_key, currency, payable_amount_minor)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [id, 'FEE-' + id, source_type, source_id, source_ci_id || '', fee_type, 'PAYEE-X', 'PAYER-X', 'USD', minor]);
}

function insertPR(id, { approval, status }) {
  run(`INSERT INTO payment_requests (id, request_no, payment_status, approval_status, currency) VALUES (?,?,?,?,?)`,
    [id, 'PAY-' + id, status, approval, 'USD']);
}

function insertPri(id, prId, piId, minor) {
  run(`INSERT INTO payment_request_items (id, payment_request_id, payable_item_id, requested_amount_minor) VALUES (?,?,?,?)`,
    [id, prId, piId, minor]);
}

function insertTx(id, prId, minor) {
  run(`INSERT INTO payment_transactions (id, trans_no, payment_request_id, paid_amount_minor, paid_date, payment_account, trans_status)
       VALUES (?,?,?,?,?,?,?)`,
    [id, 'TXN-' + id, prId, minor, '2026-01-10', 'BCA-123', 'reconciled']);
}

function insertAlloc(id, txId, priId, minor) {
  run(`INSERT INTO payment_allocations (id, transaction_id, payment_request_item_id, allocated_amount_minor, status)
       VALUES (?,?,?,?,?)`,
    [id, txId, priId, minor, 'reconciled']);
}

function insertLog(id, prId, eventType, amount, isLegacy) {
  run(`INSERT INTO payment_settlement_logs (id, payment_request_id, event_type, amount, status, is_legacy, created_at)
       VALUES (?,?,?,?,?,?,?)`,
    [id, prId, eventType, amount, 'applied', isLegacy || 0, '2026-01-10T00:00:00Z']);
}

function seed() {
  // ── 历史 CI ──
  // HCI-1：有 item，PR-H1 经 allocation 实付 400 + 抵扣 5 + 抹零 0.2（PR 级 share=1）
  insertHci('HCI-1', { gross: 1000, paid: 100 });
  insertPi('HI-1', { source_type: 'historical_ci', source_id: 'HCI-1', fee_type: 'balance', minor: 100000 });
  insertPR('PR-H1', { approval: 'approved', status: 'partial_paid' });
  insertPri('PRI-H1', 'PR-H1', 'HI-1', 100000);
  insertTx('TX-H1', 'PR-H1', 40000);
  insertAlloc('ALLOC-H1', 'TX-H1', 'PRI-H1', 40000);
  insertLog('SL-H1A', 'PR-H1', 'deduction', 5);
  insertLog('SL-H1B', 'PR-H1', 'rounding', 0.2);
  // HCI-2：无 item → 回退 gross_goods_amount
  insertHci('HCI-2', { gross: 800, paid: 0 });
  // HCI-3：仅 legacy payment log（excludeLegacy 排除）→ 后续已付 0，导入历史已付 100
  insertHci('HCI-3', { gross: 500, paid: 100 });
  insertPi('HI-3', { source_type: 'historical_ci', source_id: 'HCI-3', fee_type: 'balance', minor: 50000 });
  insertPR('PR-H3', { approval: 'approved', status: 'paid' });
  insertPri('PRI-H3', 'PR-H3', 'HI-3', 50000);
  insertLog('SL-H3A', 'PR-H3', 'payment', 100, 1);
  // HCI-4：有 item，PR-H4 pending 审批
  insertHci('HCI-4', { gross: 300, paid: 0 });
  insertPi('HI-4', { source_type: 'historical_ci', source_id: 'HCI-4', fee_type: 'balance', minor: 30000 });
  insertPR('PR-H4', { approval: 'pending', status: 'pending' });
  insertPri('PRI-H4', 'PR-H4', 'HI-4', 30000);

  // ── 运营 CI（balance 尾款口径）──
  // CI-1：pi-source balance item，实付 250
  insertCi('CI-1', 0);
  insertPi('OI-1', { source_type: 'pi', source_id: 'PI-1', source_ci_id: 'CI-1', fee_type: 'balance', minor: 60000 });
  insertPR('PR-O1', { approval: 'approved', status: 'partial_paid' });
  insertPri('PRI-O1', 'PR-O1', 'OI-1', 60000);
  insertTx('TX-O1', 'PR-O1', 25000);
  insertAlloc('ALLOC-O1', 'TX-O1', 'PRI-O1', 25000);
  // CI-2：ci 级 balance item，未结算
  insertCi('CI-2', 400);
  insertPi('OI-2', { source_type: 'ci', source_id: 'CI-2', fee_type: 'balance', minor: 40000 });
  // CI-3：无 item → 回退 stored payable_balance
  insertCi('CI-3', 250);
  // CI-4：pi-source item，pending 审批
  insertCi('CI-4', 0);
  insertPi('OI-4', { source_type: 'pi', source_id: 'PI-4', source_ci_id: 'CI-4', fee_type: 'balance', minor: 10000 });
  insertPR('PR-O4', { approval: 'pending', status: 'pending' });
  insertPri('PRI-O4', 'PR-O4', 'OI-4', 10000);
}

// ── 1) 批量 ≡ 单条（口径冻结契约）──

test('historical bulk ≡ single（逐字段 deepEqual）', () => {
  const ids = ['HCI-1', 'HCI-2', 'HCI-3', 'HCI-4'];
  const bulk = computeHistoricalCIPaymentFactsBulk(ids);
  for (const id of ids) {
    const single = computeHistoricalCIPaymentFacts(id);
    assert.ok(single, id + ' single facts missing');
    assert.deepEqual(bulk.get(id), single, id + ' bulk != single');
  }
  // 不存在的 hci：单条返回 null，批量 Map 不含该 key
  assert.equal(computeHistoricalCIPaymentFacts('HCI-X'), null);
  const bulk2 = computeHistoricalCIPaymentFactsBulk(['HCI-1', 'HCI-X']);
  assert.ok(bulk2.has('HCI-1'));
  assert.ok(!bulk2.has('HCI-X'));
  // 空输入
  assert.equal(computeHistoricalCIPaymentFactsBulk([]).size, 0);
});

test('operational bulk ≡ single（逐字段 deepEqual）', () => {
  const ids = ['CI-1', 'CI-2', 'CI-3', 'CI-4'];
  const bulk = computeOperatingCIBalancePaymentFactsBulk(ids);
  for (const id of ids) {
    const single = computeOperatingCIBalancePaymentFacts(id);
    assert.ok(single, id + ' single facts missing');
    assert.deepEqual(bulk.get(id), single, id + ' bulk != single');
  }
  assert.equal(computeOperatingCIBalancePaymentFactsBulk([]).size, 0);
});

// ── 2) 语义抽查（与单条版共享口径，防呆）──

test('historical 语义：结算/回退/legacy 排除/pending（HCI-1..4）', () => {
  const m = computeHistoricalCIPaymentFactsBulk(['HCI-1', 'HCI-2', 'HCI-3', 'HCI-4']);
  const f1 = m.get('HCI-1');
  assert.equal(f1.subsequent_paid_amount, 400);
  assert.equal(f1.deduction_amount, 5);
  assert.equal(f1.rounding_amount, 0.2);
  assert.equal(f1.unpaid_amount, 494.8); // 1000-100-400-5-0.2
  assert.equal(f1.payment_status, 'partial_paid');
  const f2 = m.get('HCI-2');
  assert.equal(f2.unpaid_amount, 800);
  assert.equal(f2.payment_status, 'unpaid');
  const f3 = m.get('HCI-3');
  assert.equal(f3.subsequent_paid_amount, 0); // legacy 被 excludeLegacy 排除
  assert.equal(f3.unpaid_amount, 400);        // 500-100
  assert.equal(f3.payment_status, 'partial_paid');
  assert.equal(m.get('HCI-4').payment_status, 'pending_approval');
});

test('operational 语义：实付/回退/pending（CI-1..4）', () => {
  const m = computeOperatingCIBalancePaymentFactsBulk(['CI-1', 'CI-2', 'CI-3', 'CI-4']);
  assert.equal(m.get('CI-1').balance_paid_amount, 250);
  assert.equal(m.get('CI-1').balance_unpaid_amount, 350);
  assert.equal(m.get('CI-1').balance_payment_status, 'partial_paid');
  assert.equal(m.get('CI-2').balance_gross_amount, 400);
  assert.equal(m.get('CI-2').balance_payment_status, 'unpaid');
  assert.equal(m.get('CI-3').balance_gross_amount, 250); // 回退 payable_balance 快照
  assert.equal(m.get('CI-3').balance_payment_status, 'unpaid');
  assert.equal(m.get('CI-4').balance_payment_status, 'pending_approval');
});

// ── 3) 索引迁移 ──

test('索引迁移：全新 SQLite 库包含 13 条 CI/PL 索引', () => {
  const expect = [
    ['payable_items', 'ix_payable_src'],
    ['payable_items', 'ix_payable_items_source_ci_fee'],
    ['payment_request_items', 'ix_pri_item'],
    ['payment_request_items', 'ix_pri_req'],
    ['payment_settlement_logs', 'ix_payment_settlement_request'],
    ['payment_allocations', 'ix_alloc_item'],
    ['payment_transactions', 'ix_tx_req'],
    ['commercial_invoices', 'ix_ci_brand'],
    ['commercial_invoices', 'ix_ci_country'],
    ['commercial_invoices', 'ix_ci_warehouse'],
    ['commercial_invoices', 'ix_ci_created_at'],
    ['historical_commercial_invoices', 'ix_hci_brand_name'],
    ['historical_commercial_invoices', 'ix_hci_country'],
  ];
  for (const [tbl, idx] of expect) {
    const names = query('PRAGMA index_list(' + tbl + ')').rows.map(r => r.name || r[1]);
    assert.ok(names.includes(idx), tbl + ' 缺索引 ' + idx + '（实际: ' + names.join(',') + '）');
  }
});

test('索引迁移：db.js PG 迁移数组包含同款同名 DDL', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'db.js'), 'utf8');
  const names = ['ix_payable_src', 'ix_payable_items_source_ci_fee', 'ix_pri_item', 'ix_pri_req',
    'ix_payment_settlement_request', 'ix_alloc_item', 'ix_tx_req', 'ix_ci_brand', 'ix_ci_country',
    'ix_ci_warehouse', 'ix_ci_created_at', 'ix_hci_brand_name', 'ix_hci_country'];
  for (const idx of names) {
    assert.ok(src.includes('CREATE INDEX IF NOT EXISTS ' + idx), 'db.js 缺 ' + idx);
  }
});
