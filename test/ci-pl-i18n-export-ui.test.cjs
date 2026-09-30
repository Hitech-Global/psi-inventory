'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const app = read('app.js');
const inline = read('ci-list-inline-logistics.js');
const amount = read('ci-amount-permission.js');
const i18n = read('i18n.js');

['app.js', 'ci-list-inline-logistics.js', 'ci-amount-permission.js', 'i18n.js'].forEach(file => {
  execFileSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'pipe' });
});

[
  'html.renderCI', 'ci.detail.total_qty', 'ci.item.actual_customs_rate',
  'pl.item.qty_per_carton', 'export.pl.qty_per_carton', 'export.ci.field',
  'export.ci.original_unit_price'
].forEach(key => assert.match(i18n, new RegExp('I18N\\.dict\\.en\\["' + key.replace(/\./g, '\\.') + '"\\]'), key + ' English translation missing'));

assert.match(inline, /logisticsStatusLabel\(b\.logistics_display_status \|\| b\.logistics_status\)/, 'inline logistics status must use display mapping');
assert.match(inline, /tr\('logistics\.mode\.'/, 'inline transport must use display mapping');
assert.match(inline, /tr\('logistics\.listing_status\.'/, 'inline listing status must use display mapping');
assert.match(inline, /data-ci-logi-export-pl="' \+ esc\(b\.id\)/, 'PL export must bind each batch id');
assert.match(inline, /canViewAmounts\(\) \? '<button class="btn btn-secondary btn-sm" data-ci-logi-export-ci-pl=/, 'CI&PL export must retain its amount permission gate');
assert.doesNotMatch(inline, /data-ci-logi-export="/, 'legacy export-menu trigger must be removed');

assert.match(amount, /tr\('export\.pl\.qty_per_carton'/, 'PL-only workbook headers must be localized');
assert.match(app, /t\('export\.ci\.field'/, 'CI workbook metadata labels must be localized');
assert.match(app, /t\('export\.ci\.original_unit_price'/, 'CI workbook column headers must be localized');

console.log('ci-pl-i18n-export-ui: PASS');
