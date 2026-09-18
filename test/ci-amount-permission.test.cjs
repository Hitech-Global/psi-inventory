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
must(server, /alreadyCanViewCI[\s\S]*perms\.includes\('ci_amount_view'\)[\s\S]*perms\.push\('ci_amount_view'\)/, 'migration must grant existing CI viewers once');
must(server, /INSERT INTO system_config \(key, value, description, updated_at\)/, 'migration completion must be persisted');
assert.doesNotMatch(
  server.slice(server.indexOf('function ensureCIAmountViewPermissionOnce'), server.indexOf('// Phase 2：为拥有审批权限', server.indexOf('function ensureCIAmountViewPermissionOnce'))),
  /CI_AMOUNT_PERMISSION/,
  'startup migration must not depend on later const initialization'
);

// Fresh DB defaults: all existing built-in CI-view roles preserve current behavior.
for (const src of [sqlite, pg]) {
  must(src, /CI-AMOUNT-VIEW-DEFAULT-V1/, 'default-role marker missing');
  const ciViewCount = (src.match(/['"]ci_view['"]/g) || []).length;
  const ciAmountCount = (src.match(/['"]ci_amount_view['"]/g) || []).length;
  assert.ok(ciAmountCount >= 3, 'admin/operator/viewer defaults must include ci_amount_view');
  assert.ok(ciViewCount >= ciAmountCount, 'amount permission must not exceed CI-view defaults');
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

// Export contract: PL-only is safe by default; CI&PL is explicitly privileged.
must(server, /const scope = req\.query\.scope === 'ci_pl' \? 'ci_pl' : 'pl'/, 'export scope must default fail-safe to PL');
must(server, /scope === 'ci_pl' && !ciCanViewAmounts\(req\)[\s\S]{0,180}status\(403\)/, 'CI&PL export must hard 403 without permission');
must(server, /if \(scope === 'pl'\)[\s\S]*ci_items:\s*\[\][\s\S]*price_lookup:\s*\{\}/, 'PL-only API must return no CI prices');
const plBranchStart = server.indexOf("if (scope === 'pl')");
const ciItemsStart = server.indexOf("const ciItems =", plBranchStart);
assert.ok(plBranchStart >= 0 && ciItemsStart > plBranchStart, 'PL branch must precede CI price query');
const plBranch = server.slice(plBranchStart, ciItemsStart);
assert.doesNotMatch(plBranch, /commercial_invoice_items/, 'PL-only branch must not query CI item prices');

// Frontend: permission-aware list/detail, logistics columns, and export actions.
must(client, /hasPermission\('ci_amount_view'\)/, 'client amount permission check missing');
must(client, /renderOperationalCITable[\s\S]*renderHistoricalCITable[\s\S]*renderCIItemsRows[\s\S]*renderCIPaymentRecords[\s\S]*renderCILogisticsTable/, 'client render guards incomplete');
must(client, /viewCICost\(/, 'CI cost action escape path must be removed');
must(client, /createBalPay\(/, 'CI balance action escape path must be removed');
must(client, /export-data\?scope=pl/, 'PL export must request safe PL scope');
must(client, /export-data\?scope=ci_pl/, 'CI&PL export must request privileged scope');
must(client, /buildPLOnlyWorkbook/, 'true PL-only workbook builder missing');
const wbStart = client.indexOf('function buildPLOnlyWorkbook');
const wbEnd = client.indexOf('function installExportGuards', wbStart);
const wbBlock = client.slice(wbStart, wbEnd);
assert.doesNotMatch(wbBlock, /CI单价|unit_price|price_lookup|CI币种/, 'PL-only workbook must contain no CI price fields');

must(inline, /function canViewAmounts\(\)[\s\S]{0,120}ci_amount_view/, 'inline logistics permission check missing');
must(inline, /var showAmounts = canViewAmounts\(\)/, 'inline logistics amount-column gate missing');
must(inline, /showAmounts[\s\S]*cargo_value[\s\S]*total_freight/, 'inline logistics cargo/freight columns must be conditional');
must(inline, /var ratio = b\.freight_value_ratio/, 'inline logistics freight ratio source missing');
must(inline, /showAmounts[\s\S]*logistics\.col\.freight_ratio/, 'inline logistics freight ratio column must be conditional');
must(inline, /canViewAmounts\(\)[\s\S]*data-ci-logi-export-ci-pl/, 'inline export menu must hide CI&PL without permission');

// Role UI label and script ordering.
must(i18n, /permission\.label\.ci_amount_view/, 'permission i18n label missing');
const inlinePos = index.indexOf('<script src="ci-list-inline-logistics.js"></script>');
const amountPos = index.indexOf('<script src="ci-amount-permission.js"></script>');
assert.ok(inlinePos >= 0 && amountPos > inlinePos, 'amount guard must load after CI inline logistics enhancement');

console.log('ci-amount-permission: PASS');
