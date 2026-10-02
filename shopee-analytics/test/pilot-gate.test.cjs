'use strict';
const assert = require('assert');
const { evaluatePilotGate } = require('../src/pilot-gate');

const pass = evaluatePilotGate({
  syncSummary: { ok: true, failedRequiredSteps: [] },
  validationReport: { dataHealth: { ok: true, warnings: [] } },
  reconciliation: { pass: true, checks: [] },
  productCardRows: 10,
});
assert.strictEqual(pass.pass, true);
assert.strictEqual(pass.nextGate, 'HISTORICAL_BACKFILL_ALLOWED');

const blocked = evaluatePilotGate({
  syncSummary: { ok: true },
  validationReport: { dataHealth: { ok: true } },
  reconciliation: { pass: false, checks: [] },
  productCardRows: 0,
});
assert.strictEqual(blocked.pass, false);
assert.deepStrictEqual(blocked.failedGates, ['seller_centre_reconciliation', 'product_card_exact_period']);

console.log('shopee pilot gate tests: ok');
