'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const must = (src, re, msg) => assert.match(src, re, msg);

const server = read('server.js');
const inline = read('ci-list-inline-logistics.js');
const quotationUi = read('quotation-management.js');
const quotationServer = read('quotation-server.js');
const quotationFast = read('quotation-import-fast.js');
const sqlite = read('db-sqlite.js');
const pg = read('db-pg.js');
const i18n = read('i18n.js');

[
  'server.js','ci-list-inline-logistics.js','quotation-management.js',
  'quotation-server.js','quotation-import-fast.js','db-sqlite.js','db-pg.js','i18n.js'
].forEach(file => execFileSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'pipe' }));

must(
  server,
  /commercial-invoices\/:id\/logistics-batches'[\s\S]{0,120}requireApiPermission\('logistics_view', 'ci_view'\)/,
  'CI-scoped logistics must allow ci_view without logistics_view'
);
must(
  server,
  /logistics-batches\/:id\/export-data'[\s\S]{0,120}requireApiPermission\('logistics_view', 'ci_view'\)/,
  'batch export must allow CI viewers to export PL'
);
must(
  server,
  /if \(!ciCanViewAmounts\(req\)\) rows\.forEach\(ciRedactLogistics\)/,
  'logistics amount fields must still redact without ci_amount_view'
);
const exportStart = server.indexOf("app.get('/api/logistics-batches/:id/export-data'");
const exportEnd = server.indexOf('// 多 PI 改造', exportStart);
assert.ok(exportStart >= 0 && exportEnd > exportStart, 'batch export endpoint block missing');
const exportBlock = server.slice(exportStart, exportEnd);
assert.doesNotMatch(exportBlock, /scope === 'ci_pl' && !ciCanViewAmounts\(req\)/, 'CI&PL export must not require amount permission');
must(exportBlock, /rawCIItems\.map\(it => \(\{ sku_code: it\.sku_code, shipped_qty: it\.shipped_qty \}\)\)/, 'CI&PL export must return only non-monetary CI item fields without amount permission');

must(inline, /var showAmounts = canViewAmounts\(\)/, 'inline logistics amount columns must be permission-aware');
must(inline, /data-ci-logi-export-ci-pl/, 'inline CI&PL export option must be available to CI viewers');
must(inline, /hasPermission\('logistics_edit'\) \? '<button class="action-btn" data-ci-logi-edit=/, 'inline edit must require logistics_edit');

must(
  server,
  /quotation_view:\s*\{\s*label:\s*'查看',\s*module:\s*'采购链',\s*submodule:\s*'报价管理'/,
  'quotation_view must exist in role permission catalog'
);
must(server, /role_admin[\s\S]{0,800}perms\.push\('quotation_view'\)/, 'role_admin quotation compatibility migration missing');

must(quotationUi, /const canView=\(\)=>typeof window\.hasPermission==='function'&&window\.hasPermission\('quotation_view'\)/, 'quotation UI permission helper missing');
must(quotationUi, /function nav\(\)[\s\S]{0,180}if\(!canView\(\)\)return;/, 'quotation nav must be hidden without permission');
must(quotationUi, /function show\(\)[\s\S]{0,120}if\(!canView\(\)\)return;/, 'direct quotation page open must be blocked without permission');
must(quotationUi, /async function prefetchDefault\(\)\{[\s\S]{0,80}if\(!canView\(\)\)return;/, 'quotation prefetch must not run without permission');

assert.doesNotMatch(quotationServer, /requireApiPermission\('cost_view'\)/, 'quotation server must not piggyback cost_view');
assert.doesNotMatch(quotationFast, /requireApiPermission\('cost_view'\)/, 'quotation import must not piggyback cost_view');
must(quotationServer, /requireApiPermission\('quotation_view'\)/, 'quotation server must use quotation_view');
must(quotationFast, /requireApiPermission\('quotation_view'\)/, 'quotation import must use quotation_view');

for (const src of [sqlite, pg]) {
  const a = src.indexOf('const allPerms');
  const o = src.indexOf('const operatorPerms', a);
  const v = src.indexOf('const viewerPerms', o);
  const end = src.indexOf(']);', v);
  assert.ok(a >= 0 && o > a && v > o && end > v, 'built-in role permission blocks missing');
  assert.match(src.slice(a, o), /quotation_view/, 'admin defaults must include quotation_view');
  assert.match(src.slice(o, v), /quotation_view/, 'operator defaults must include quotation_view');
  assert.doesNotMatch(src.slice(v, end), /quotation_view/, 'viewer defaults must not silently receive quotation_view');
}

must(i18n, /permission\.submodule\.报价管理/, 'quotation submodule i18n missing');
must(i18n, /permission\.label\.quotation_view/, 'quotation permission label i18n missing');

console.log('ci-logistics-quotation-permissions: PASS');
