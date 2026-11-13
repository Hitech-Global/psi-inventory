'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
function read(name) { return fs.readFileSync(path.join(root, name), 'utf8'); }
function must(src, re, msg) { assert.match(src, re, msg); }

const server = read('server.js');
const sqlite = read('db-sqlite.js');
const pg = read('db-pg.js');
const i18n = read('i18n.js');
const app = read('app.js');
const client = read('ci-amount-permission.js');
const inline = read('ci-list-inline-logistics.js');
const index = read('index.html');

// Hard syntax gates: especially protect app.js after all build-time hotfixes.
['app.js','server.js','ci-list-inline-logistics.js','ci-amount-permission.js','db-sqlite.js','db-pg.js','i18n.js'].forEach(function (file) {
  execFileSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'pipe' });
});

// Permission catalog + durable one-time compatibility migration.
must(server, /ci_amount_view:\s*\{\s*label:\s*'查看金额',\s*module:\s*'采购链',\s*submodule:\s*'CI管理'/, 'permission catalog missing');
must(server, /CI-AMOUNT-VIEW-PERMISSION-V1/, 'server marker missing');
must(server, /migration_ci_amount_view_v1/, 'durable migration marker missing');
must(server, /privilegedDefaultRole = role\.id === 'role_admin' \|\| role\.id === 'role_operator'/, 'amount permission migration must preserve only privileged default roles');
must(server, /migration_ci_amount_view_default_v2/, 'viewer amount-permission cleanup migration missing');
must(server, /INSERT INTO system_config \(key, value, description, updated_at\)/, 'migration completion must be persisted');
assert.doesNotMatch(
  server.slice(server.indexOf('function ensureCIAmountViewPermissionOnce'), server.indexOf('// Phase 2：为拥有审批权限', server.indexOf('function ensureCIAmountViewPermissionOnce'))),
  /CI_AMOUNT_PERMISSION/,
  'startup migration must not depend on later const initialization'
);

// Fresh DB defaults: admin/operator may see amounts; ordinary viewer may not.
for (const src of [sqlite, pg]) {
  must(src, /CI-AMOUNT-VIEW-DEFAULT-V1/, 'default-role marker missing');
  const a = src.indexOf('const allPerms');
  const o = src.indexOf('const operatorPerms', a);
  const v = src.indexOf('const viewerPerms', o);
  const end = src.indexOf(']);', v);
  assert.ok(a >= 0 && o > a && v > o && end > v, 'built-in role permission blocks missing');
  assert.match(src.slice(a, o), /ci_amount_view/, 'admin must retain amount permission');
  assert.match(src.slice(o, v), /ci_amount_view/, 'operator must retain amount permission');
  assert.doesNotMatch(src.slice(v, end), /ci_amount_view/, 'ordinary viewer must not have amount permission');
}

// Backend field redaction / hard gates.
must(server, /CI_HEADER_AMOUNT_FIELDS[\s\S]*goods_amount[\s\S]*balance_unpaid_amount[\s\S]*import_duty_total/, 'CI header amount redaction set incomplete');
must(server, /CI_ITEM_AMOUNT_FIELDS[\s\S]*unit_price[\s\S]*net_unit_price[\s\S]*ci_amount/, 'CI item price redaction set incomplete');
must(server, /LOGISTICS_CI_AMOUNT_FIELDS[\s\S]*total_freight[\s\S]*cargo_value[\s\S]*freight_value_ratio/, 'CI logistics amount redaction set incomplete');
must(server, /if \(!ciCanViewAmounts\(req\)\) rows\.forEach\(r => ciRedactOperational\(r, false\)\)/, 'operational CI list must redact');
must(server, /if \(!ciCanViewAmounts\(req\)\) ciRedactOperational\(payload, true\)/, 'operational CI detail must redact');
must(server, /if \(!ciCanViewAmounts\(req\)\) out\.forEach\(r => ciRedactHistorical\(r, false\)\)/, 'historical CI list must redact');
must(server, /if \(!ciCanViewAmounts\(req\)\) ciRedactHistorical\(historical, true\)/, 'historical CI detail must redact');
must(server, /if \(!ciCanViewAmounts\(req\)\) rows\.forEach\(ciRedactLogistics\)/, 'CI-scoped logistics must redact');
must(server, /commercial-invoices\/:id\/pi-balances'[\s\S]{0,180}requireCIAmountView/, 'PI balance endpoint must hard-gate amounts');
must(server, /commercial-invoices\/:id\/cost-summary'[\s\S]{0,180}requireCIAmountView/, 'CI cost summary must hard-gate amounts');
must(server, /purchase-amount-summary'[\s\S]{0,220}amount_view_allowed:\s*false/, 'purchase amount summary must not leak amounts');

// Export contract: CI&PL is available to CI viewers; amount data is included only for amount-authorized users.
must(server, /const scope = req\.query\.scope === 'ci_pl' \? 'ci_pl' : 'pl'/, 'export scope must default fail-safe to PL');
const exportStart = server.indexOf("app.get('/api/logistics-batches/:id/export-data'");
const exportEnd = server.indexOf('// 多 PI 改造', exportStart);
assert.ok(exportStart >= 0 && exportEnd > exportStart, 'batch export endpoint block missing');
const exportBlock = server.slice(exportStart, exportEnd);
assert.doesNotMatch(exportBlock, /scope === 'ci_pl' && !ciCanViewAmounts\(req\)[\s\S]{0,180}status\(403\)/, 'CI&PL export must not be blocked for no-amount users');
must(exportBlock, /const amountViewAllowed = ciCanViewAmounts\(req\)/, 'export must derive amount visibility from permission');
must(exportBlock, /if \(!amountViewAllowed\) ciItems\.forEach\(it => ciStripFields\(it, CI_ITEM_AMOUNT_FIELDS\)\)/, 'CI item amounts must be redacted in export payload');
must(exportBlock, /const priceLookup = amountViewAllowed \? computePriceLookup[\s\S]*: \{\}/, 'price lookup must be omitted without amount permission');
must(exportBlock, /amount_view_allowed:\s*amountViewAllowed/, 'export must expose the safe workbook visibility flag');
must(exportBlock, /const blockingIssues = amountViewAllowed \? validateInScopePrices[\s\S]*: \[\]/, 'price ambiguity must not block amount-free export');
must(exportBlock, /if \(scope === 'pl'\)[\s\S]*ci_items:\s*\[\][\s\S]*price_lookup:\s*\{\}/, 'PL-only API must return no CI prices');
const plBranchStart = exportBlock.indexOf("if (scope === 'pl')");
const ciItemsStart = exportBlock.indexOf("const amountViewAllowed", plBranchStart);
assert.ok(plBranchStart >= 0 && ciItemsStart > plBranchStart, 'PL branch must precede CI price query');
const plBranch = exportBlock.slice(plBranchStart, ciItemsStart);
assert.doesNotMatch(plBranch, /commercial_invoice_items/, 'PL-only branch must not query CI item prices');

// Frontend: permission-aware list/detail, logistics columns, and export actions.
must(client, /hasPermission\('ci_amount_view'\)/, 'client amount permission check missing');
must(client, /renderOperationalCITable[\s\S]*renderHistoricalCITable[\s\S]*renderCIItemsRows[\s\S]*renderCIPaymentRecords[\s\S]*renderCILogisticsTable/, 'client render guards incomplete');
must(client, /viewCICost\(/, 'CI cost action escape path must be removed');
must(client, /createBalPay\(/, 'CI balance action escape path must be removed');
must(client, /export-data\?scope=pl/, 'PL export must request safe PL scope');
must(client, /export-data\?scope=ci_pl/, 'CI&PL export must request CI&PL scope');
must(client, /buildPLWorkbook\(data, true\)/, 'CI&PL workbook builder missing');
const ciPlExportStart = client.indexOf('global.exportBatchCIAndPL');
const ciPlExportEnd = client.indexOf('var originalToggle', ciPlExportStart);
assert.ok(ciPlExportStart >= 0 && ciPlExportEnd > ciPlExportStart, 'CI&PL export handler missing');
assert.doesNotMatch(client.slice(ciPlExportStart, ciPlExportEnd), /if \(!canViewAmounts\(\)\)/, 'CI&PL export must be available without amount permission');
must(app, /amountViewAllowed = !!\(data && data\.amount_view_allowed === true\)/, 'workbook must use backend amount visibility flag');
must(app, /if \(amountViewAllowed\) \{[\s\S]*export\.ci\.original_unit_price/, 'CI price columns must be conditional in workbook');
const wbStart = client.indexOf('function buildPLOnlyWorkbook');
const wbEnd = client.indexOf('function installExportGuards', wbStart);
const wbBlock = client.slice(wbStart, wbEnd);
assert.doesNotMatch(wbBlock, /CI单价|unit_price|price_lookup|CI币种/, 'PL-only workbook must contain no CI price fields');

must(inline, /function canViewAmounts\(\)[\s\S]{0,120}ci_amount_view/, 'inline logistics permission check missing');
must(inline, /var showAmounts = canViewAmounts\(\)/, 'inline logistics amount-column gate missing');
must(inline, /showAmounts[\s\S]*cargo_value[\s\S]*data-ci-logi-freight/, 'inline logistics cargo/freight columns must be conditional and use shared allocation cells');
must(inline, /data-ci-logi-freight-ratio="1"/, 'inline logistics freight ratio cell missing');
must(inline, /async function hydrateSharedFreight[\s\S]*shared-logistics-fees\?view=ci-summary/, 'inline logistics must hydrate the shared freight summary');
must(inline, /batch_totals_rmb/, 'inline logistics must use the shared per-batch freight totals');
must(inline, /showAmounts[\s\S]*logistics\.col\.freight_ratio/, 'inline logistics freight ratio column must be conditional');
must(inline, /data-ci-logi-export-ci-pl/, 'CI&PL export action must remain available to CI viewers');
assert.doesNotMatch(inline, /canViewAmounts\(\) \? '<button[^']*data-ci-logi-export-ci-pl=/, 'CI&PL export action must not be gated by amount permission');

// Role UI label and script ordering.
must(i18n, /permission\.label\.ci_amount_view/, 'permission i18n label missing');
const inlineMatch = index.match(/<script src="ci-list-inline-logistics\.js(?:\?[^"]*)?"><\/script>/);
const inlinePos = inlineMatch ? index.indexOf(inlineMatch[0]) : -1;
const amountPos = index.indexOf('<script src="ci-amount-permission.js"></script>');
assert.ok(inlinePos >= 0 && amountPos > inlinePos, 'amount guard must load after CI inline logistics enhancement');

console.log('ci-amount-permission: PASS');
