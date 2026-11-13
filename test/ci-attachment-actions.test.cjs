'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'assets', 'ci-attachment-actions.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

assert.ok(ui.includes('function replaceListAttachmentButtons(html)'));
assert.ok(ui.includes('global.renderOperationalCITable = function'));
assert.ok(ui.includes("global.uploadDocAttachment('ci'"));
assert.ok(ui.includes('openCIAttachmentMenu'));
assert.ok(ui.includes('ci.attachments.upload_ci'));
assert.ok(ui.includes('ci.attachments.upload_pl'));
assert.ok(ui.includes('ci.attachments.upload_customs'));
assert.ok(ui.includes("category: 'customs'"));
assert.ok(ui.includes('shipping-attachments'));
assert.ok(ui.includes('global.ciUnifiedAttachmentHtml = function (ci)'));
assert.ok(ui.includes('ci.shipping_attachments'));
assert.ok(ui.includes('ciPreviewShippingAttachment'));
assert.ok(ui.includes('ciDeleteShippingAttachment'));
assert.ok(ui.includes("'DELETE'"));

assert.ok(app.includes('function ciUnifiedAttachmentHtml(ci)'), 'the existing CI/PL detail attachment section is preserved');
assert.ok(app.includes('function uploadDocAttachment(docType,id,field)'), 'the existing CI and PL upload handlers remain in place');
assert.ok(server.includes("app.get('/api/commercial-invoices/:id/shipping-attachments'"));
assert.ok(server.includes("app.post('/api/commercial-invoices/:id/shipping-attachments'"));
assert.ok(server.includes("app.delete('/api/commercial-invoices/:id/shipping-attachments/:fileId'"));

const appIndex = index.indexOf('app.js?v=');
const newScriptIndex = index.indexOf('assets/ci-attachment-actions.js?v=20261113-1');
const lastCiModuleIndex = index.indexOf('assets/ci-summary-compact.js');
assert.ok(appIndex >= 0 && newScriptIndex > appIndex, 'attachment override must load after app.js');
assert.ok(lastCiModuleIndex >= 0 && newScriptIndex > lastCiModuleIndex, 'attachment override must load after other CI modules');
assert.ok(pkg.scripts.postinstall.includes('node test/ci-attachment-actions.test.cjs'));
assert.ok(pkg.scripts.postinstall.includes('node --check assets/ci-attachment-actions.js'));

console.log('CI attachment menu and customs document integration: PASS');
