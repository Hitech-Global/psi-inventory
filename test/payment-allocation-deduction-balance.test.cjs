'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

function loadAllocationPreview() {
  const start = appSource.indexOf('function allocatePayMinorByWeights(');
  const end = appSource.indexOf('function getPayAllocationInputs(', start);
  assert.ok(start >= 0 && end > start, 'payment allocation preview helpers must exist');
  const context = {};
  vm.createContext(context);
  vm.runInContext(appSource.slice(start, end) +
    ';globalThis.testCalculatePayAllocationPreview=calculatePayAllocationPreview;', context);
  return context.testCalculatePayAllocationPreview;
}

test('deduction preview matches backend largest-remainder allocation for HCI-019/HCI-020', () => {
  const calculate = loadAllocationPreview();
  const items = [
    { id: 'pri-019', requestedMinor: 3935020, baseRemainingMinor: 3935020, deductionWeightMinor: 3935020 },
    { id: 'pri-020', requestedMinor: 4166666, baseRemainingMinor: 4166666, deductionWeightMinor: 4166666 }
  ];
  const preview = calculate(items, 1335166, 6766520);
  const byId = new Map(preview.items.map(item => [item.id, item]));

  assert.equal(byId.get('pri-019').deductionShareMinor, 648495);
  assert.equal(byId.get('pri-020').deductionShareMinor, 686671);
  assert.equal(byId.get('pri-019').remainingMinor, 3286525);
  assert.equal(byId.get('pri-020').remainingMinor, 3479995);
  assert.equal(byId.get('pri-019').paymentAllocationMinor, 3286525);
  assert.equal(byId.get('pri-020').paymentAllocationMinor, 3479995);
  assert.equal(preview.totalAvailableMinor, 6766520);
  assert.equal(preview.invalidDeduction, false);
  assert.equal(preview.items.reduce((sum, item) => sum + item.paymentAllocationMinor, 0), 6766520);
});

test('partial payment is allocated only within each item remaining balance', () => {
  const calculate = loadAllocationPreview();
  const items = [
    { id: 'a', requestedMinor: 10000, baseRemainingMinor: 10000, deductionWeightMinor: 10000 },
    { id: 'b', requestedMinor: 10000, baseRemainingMinor: 10000, deductionWeightMinor: 10000 }
  ];
  const preview = calculate(items, 0, 15000);
  assert.equal(preview.totalAvailableMinor, 20000);
  assert.equal(preview.items.reduce((sum, item) => sum + item.paymentAllocationMinor, 0), 15000);
  assert.ok(preview.items.every(item => item.paymentAllocationMinor <= item.remainingMinor));
});

test('payment request detail exposes backend current balances and deduction weights', () => {
  assert.match(serverSource, /function enrichPaymentRequestItemsForAllocation\(items\)/);
  assert.match(serverSource, /remaining_amount_minor: payableAmountMinor - settledMinor/);
  assert.match(serverSource, /deduction_weight_minor: Math\.max\(0, requestedMinor - paidMinor\)/);
  assert.match(serverSource, /items = enrichPaymentRequestItemsForAllocation\(itemRows\.rows\)/);
  assert.match(appSource, /data-base-remain-minor=/);
  assert.match(appSource, /data-deduction-weight-minor=/);
  assert.match(appSource, /id="pay-final-ded-amt"[^\n]*oninput="onPayDeductionChanged\(\)"/);
  assert.match(appSource, /function onPayDeductionChanged\(\)[\s\S]*?autoDistributePayAllocations\(\)/);
});

test('backend automatic multi-allocation uses current remaining balances, not original requested weights', () => {
  const start = serverSource.indexOf('const payableIds = [...new Set(items.map(item => item.payable_item_id)');
  const end = serverSource.indexOf('// 纯抹零场景：仍需读取 priRows', start);
  assert.ok(start >= 0 && end > start, 'automatic multi-allocation branch must exist');
  const branch = serverSource.slice(start, end);
  assert.match(branch, /payableItemsSettledMinor\(payableIds\)/);
  assert.match(branch, /remainingByPri/);
  assert.match(branch, /allocateMinorByWeights\(/);
  assert.match(branch, /paidAmountMinor > totalRemainingMinor/);
  assert.doesNotMatch(branch, /requested_amount_minor\)\s*\/\s*totalRequestedMinor/);
});

test('manual allocations retain strict per-item and total-amount backend validation', () => {
  const start = serverSource.indexOf('function insertHumanAllocations(');
  const end = serverSource.indexOf('\nfunction applyDeductionSettlementInTx(', start);
  assert.ok(start >= 0 && end > start);
  const fn = serverSource.slice(start, end);
  assert.match(fn, /allocMinor > remainingMinor/);
  assert.match(fn, /sumMinor !== paidAmountMinor/);
});

test('payment request detail returns current payable-item balance and deduction weight', async () => {
  process.env.DB_DRIVER = 'sqlite';
  process.env.DB_PATH = ':memory:';
  process.env.NODE_ENV = 'test';
  const crypto = require('node:crypto');
  const db = require('../db');
  db.initDatabase();
  const { run } = db;
  const { app } = require('../server');

  const token = 'alloc-balance-test-token';
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  run('INSERT OR REPLACE INTO roles (id,name,permissions) VALUES (?,?,?)',
    ['role_alloc_test','Allocation Test',JSON.stringify(['payment_view'])]);
  run("INSERT OR REPLACE INTO users (id,username,name,role_id,status) VALUES ('user_alloc_test','alloc-test','Allocation Test','role_alloc_test','active')");
  run("INSERT OR REPLACE INTO sessions (id,token_hash,user_id,created_at,expires_at) VALUES ('session_alloc_test',?,'user_alloc_test',datetime('now'),'2099-12-31 23:59:59')", [tokenHash]);

  const prId = 'pr_alloc_balance_test';
  const feeA = 'payitem_alloc_balance_a';
  const feeB = 'payitem_alloc_balance_b';
  run(`INSERT INTO payable_items
    (id,fee_no,source_type,source_id,source_no,source_ci_id,fee_type,category_code,subcategory_code,
     payee_type,payee_key,payee_name_snapshot,payer_entity_key,payer_name_snapshot,currency,payable_amount_minor,is_active,lifecycle_status)
    VALUES (?,?,'manual',?,'','','other_local','','','service_provider','svc:alloc','Allocation Test','payer','Payer','RMB',3935020,1,'reserved')`,
    [feeA,'PAY-ALLOC-A','alloc-source-a']);
  run(`INSERT INTO payable_items
    (id,fee_no,source_type,source_id,source_no,source_ci_id,fee_type,category_code,subcategory_code,
     payee_type,payee_key,payee_name_snapshot,payer_entity_key,payer_name_snapshot,currency,payable_amount_minor,is_active,lifecycle_status)
    VALUES (?,?,'manual',?,'','','other_local','','','service_provider','svc:alloc','Allocation Test','payer','Payer','RMB',4166666,1,'reserved')`,
    [feeB,'PAY-ALLOC-B','alloc-source-b']);
  run(`INSERT INTO payment_requests
    (id,request_no,payment_category,payment_subcategory,source_type,source_id,source_no,payee_type,payee_key,
     payee_name_snapshot,payable_amount,currency,payment_mode,payment_status,approval_status)
    VALUES (?,'PAY-ALLOC-TEST','','','','','','service_provider','svc:alloc','Allocation Test',81016.86,'RMB','multi','pending_approval','pending')`,
    [prId]);
  run('INSERT INTO payment_request_items (id,payment_request_id,payable_item_id,requested_amount_minor) VALUES (?,?,?,?)',
    ['pri_alloc_a',prId,feeA,3935020]);
  run('INSERT INTO payment_request_items (id,payment_request_id,payable_item_id,requested_amount_minor) VALUES (?,?,?,?)',
    ['pri_alloc_b',prId,feeB,4166666]);

  const httpServer = app.listen(0);
  try {
    const port = httpServer.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/payment-requests/${prId}`, {
      headers: { Cookie: `session_token=${token}` }
    });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    const byFee = new Map(body.items.map(item => [item.fee_no, item]));
    assert.equal(byFee.get('PAY-ALLOC-A').remaining_amount_minor, 3935020);
    assert.equal(byFee.get('PAY-ALLOC-B').remaining_amount_minor, 4166666);
    assert.equal(byFee.get('PAY-ALLOC-A').deduction_weight_minor, 3935020);
    assert.equal(byFee.get('PAY-ALLOC-B').deduction_weight_minor, 4166666);
  } finally {
    await new Promise(resolve => httpServer.close(resolve));
  }
});
