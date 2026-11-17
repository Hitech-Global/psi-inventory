'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  SERVER_MARKER, APP_MARKER, I18N_MARKER, INDEX_MARKER,
  patchServer, patchApp, patchI18n, patchIndex
} = require('../scripts/historical-ci-costs-rma-hotfix.cjs');
const { ensureHistoricalCICostsRmaColumns } = require('../migrations/historical-ci-costs-rma');

const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const i18n = fs.readFileSync(path.join(root, 'i18n.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

assert.ok(server.includes(SERVER_MARKER), 'server patch marker');
assert.ok(app.includes(APP_MARKER), 'app patch marker');
assert.ok(i18n.includes(I18N_MARKER), 'i18n patch marker');
assert.ok(index.includes(INDEX_MARKER), 'index cache marker');
assert.equal(patchServer(server), server, 'server patch idempotency');
assert.equal(patchApp(app), app, 'app patch idempotency');
assert.equal(patchI18n(i18n), i18n, 'i18n patch idempotency');
assert.equal(patchIndex(index), index, 'index patch idempotency');

const pgCalls = [];
const pg = ensureHistoricalCICostsRmaColumns(sql => pgCalls.push(sql), () => ({ rows: [] }), true);
assert.equal(pg.added.length, 7);
assert.equal(pgCalls.length, 7);
assert.ok(pgCalls.some(sql => /historical_customs_duty_rmb_amount/.test(sql)));

const existingCalls = [];
const existingNames = ['is_rma','historical_freight_amount','historical_freight_currency','historical_customs_duty_amount','historical_customs_duty_currency','historical_customs_duty_rmb_amount','historical_customs_duty_exchange_rate'];
const existing = ensureHistoricalCICostsRmaColumns(
  sql => existingCalls.push(sql),
  () => ({ rows: existingNames.map(column_name => ({ column_name })) }),
  true
);
assert.equal(existing.added.length, 0);
assert.equal(existingCalls.length, 0);
console.log('historical CI costs/RMA regression: PASS');
