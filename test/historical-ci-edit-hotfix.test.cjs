'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  SERVER_MARKER, INDEX_MARKER, DETAIL_ITEMS_OLD, DETAIL_ITEMS_NEW,
  patchServerSource, patchIndexSource, ROUTE
} = require('../scripts/historical-ci-edit-hotfix.cjs');

assert.ok(ROUTE.includes("app.put('/api/historical-commercial-invoices/:id'"), 'full historical CI PUT route must exist');
assert.ok(ROUTE.includes('payment_settlement_logs'), 'legacy payment corrections must be preserved as settlement history');
assert.ok(ROUTE.includes("status = 'reversed'"), 'old imported payment logs must be reversed, not deleted');
assert.ok(ROUTE.includes('payment_request_items'), 'gross amount changes must synchronize payment request allocation');
assert.ok(ROUTE.includes('UPDATE proforma_invoice_items'), 'PI shipped quantities must be synchronized');
assert.ok(ROUTE.includes('updateInventoryTransitDataAsync'), 'PI shipment changes must refresh transit forecast');
assert.ok(ROUTE.includes("operation_type: 'historical_ci_edit'"), 'edits must be audited');
assert.ok(ROUTE.includes('ciCanViewAmounts(req)'), 'amount editing must respect amount-view permission');
assert.ok(ROUTE.includes('lifecycle_status'), 'settled payable items must be protected');
new Function(ROUTE);

const serverStub = DETAIL_ITEMS_OLD + "\napp.post('/api/historical-commercial-invoices/:id/attachment', function () {});\n";
const patchedServer = patchServerSource(serverStub);
assert.ok(patchedServer.includes(DETAIL_ITEMS_NEW), 'detail API must return item id and PI linkage for safe editing');
assert.ok(patchedServer.includes(SERVER_MARKER), 'server route patch marker must be present');
assert.equal(patchServerSource(patchedServer), patchedServer, 'server patch must be idempotent');
new Function(patchedServer);

const indexStub = '<html><body></body></html>';
const patchedIndex = patchIndexSource(indexStub);
assert.ok(patchedIndex.includes(INDEX_MARKER), 'historical CI editor asset must load after app.js');
assert.equal(patchIndexSource(patchedIndex), patchedIndex, 'index patch must be idempotent');

const asset = fs.readFileSync(path.join(__dirname, '..', 'assets', 'historical-ci-edit.js'), 'utf8');
new Function(asset);
for (const token of [
  '编辑整张记录', 'saveHistoricalCIEdit', 'hci-edit-freight',
  'hci-edit-duty-idr', 'hci-edit-paid', 'hci-edit-item',
  'onHistoricalCIEditSupplierChange', 'paymentStatus.indexOf'
]) assert.ok(asset.includes(token), 'editor UI missing: ' + token);

const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
assert.ok(packageJson.scripts.postinstall.includes('scripts/historical-ci-edit-hotfix.cjs'), 'Render postinstall must apply backend route');
assert.ok(packageJson.scripts.postinstall.includes('test/historical-ci-edit-hotfix.test.cjs'), 'Render postinstall must run regression test');

console.log('historical CI full edit regression: PASS');
