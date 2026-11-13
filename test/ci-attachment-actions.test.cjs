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

assert.match(ui, /function replaceListAttachmentButtons\(html\)/);
assert.match(ui, /global\.renderOperationalCITable = function/);
assert.match(ui, /global\\.uploadDocAttachment\\('ci'/);
assert.match(ui, /openCIAttachmentMenu/);
assert.match(ui, /ci\.attachments\.upload_ci/);
assert.match(ui, /ci\.attachments\.upload_pl/);
assert.match(ui, /ci\.attachments\.upload_customs/);
assert.match(ui, /category: 'customs'/);
assert.match(ui, /shipping-attachments/);
assert.match(ui, /global\.ciUnifiedAttachmentHtml = function \(ci\)/);
assert.match(ui, /ci\.shipping_attachments/);
assert.match(ui, /ciPreviewShippingAttachment/);
assert.match(ui, /ciDeleteShippingAttachment/);
assert.match(ui, /'DELETE'/);

assert.match(app, /function ciUnifiedAttachmentHtml\(ci\)/, 'the existing CI/PL detail attachment section is preserved');
assert.match(app, /function uploadDocAttachment\\(docType,id,field\\)/, 'the existing CI and PL upload handlers remain in place');
assert.match(server, /app\.get\('\/api\/commercial-invoices\/:id\/shipping-attachments'/);
assert.match(server, /app\.post\('\/api\/commercial-invoices\/:id\/shipping-attachments'/);
assert.match(server, /app\.delete\('\/api\/commercial-invoices\/:id\/shipping-attachments\/:fileId'/);

const appIndex = index.indexOf('app.js?v=');
const newScriptIndex = index.indexOf('assets/ci-attachment-actions.js?v=20261113-1');
const lastCiModuleIndex = index.indexOf('assets/ci-summary-compact.js');
assert.ok(appIndex >= 0 && newScriptIndex > appIndex, 'attachment override must load after app.js');
assert.ok(lastCiModuleIndex >= 0 && newScriptIndex > lastCiModuleIndex, 'attachment override must load after other CI modules');
assert.match(pkg.scripts.postinstall, /node test\/ci-attachment-actions\.test\.cjs/);
assert.match(pkg.scripts.postinstall, /node --check assets\/ci-attachment-actions\.js/);

console.log('CI attachment menu and customs document integration: PASS');
