const fs = require('fs');
const assert = require('node:assert/strict');
const server = fs.readFileSync(require.resolve('../server.js'), 'utf8');
const app = fs.readFileSync(require.resolve('../app.js'), 'utf8');

const start = server.indexOf('async function createHistoricalCI(body, req)');
const end = server.indexOf('\nfunction ciPaymentStatusFromFacts', start);
assert.ok(start >= 0 && end > start, 'createHistoricalCI function must be found');
const importer = server.slice(start, end);

assert.match(importer, /createPayableItemFromSource\(/, 'historical import must create payable item');
assert.doesNotMatch(importer, /INSERT INTO payment_requests/, 'historical import must not create a payment request');
assert.doesNotMatch(importer, /INSERT INTO payment_request_items/, 'historical import must not reserve/link the payable item to a PR');
assert.doesNotMatch(importer, /reservePayableItem\(/, 'historical payable item must remain active');
assert.doesNotMatch(importer, /INSERT INTO payment_settlement_logs/, 'historical paid snapshot must not fabricate a settlement event');
assert.match(importer, /payment_request_id:\s*''/, 'import result must not return an auto-created payment request');
assert.match(importer, /historical_paid_amount/, 'historical paid snapshot remains part of the import calculation');

assert.match(server, /function historicalCIHasSettlement\(/, 'historical amount edit lock helper must exist');
assert.match(server, /requireApiPermission\('ci_create'\),\s*\n\s*asyncHandler/, 'historical CI creation requires only CI-create permission');
assert.match(app, /function canImportHistoricalCI\(\)\{return hasPermission\('ci_create'\)\}/, 'historical CI import UI requires only CI-create permission');
assert.match(app, /hasPermission\('payment_view'\)&&h\.payment_request_id/, 'historical CI payment link must only render when a real payment request exists');

console.log('Historical CI import no-auto-payment-request regression: PASS');
