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
const freight = read('assets/ci-list-freight.js');

['app.js', 'ci-list-inline-logistics.js', 'ci-amount-permission.js', 'i18n.js', 'assets/ci-list-freight.js'].forEach(file => {
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

assert.match(i18n, /I18N\.dict\.en\["ci\.col\.total_freight"\]="Total Freight"/, 'CI total freight English label missing');
assert.match(i18n, /I18N\.dict\.en\["ci\.col\.freight_ratio"\]="Freight\/Value"/, 'CI freight ratio English label missing');
assert.match(i18n, /I18N\.dict\.en\["logistics\.col\.cargo_value"\]="Cargo Value"/, 'cargo value English label missing');
assert.match(freight, /global\.t\('ci\.col\.total_freight'/, 'runtime freight header must use i18n');
assert.match(freight, /global\.t\('ci\.col\.freight_ratio'/, 'runtime freight ratio header must use i18n');
assert.match(app, /id="ci-country"[^;]+t\('common\.all','全部'\)/, 'CI filter All option must use i18n');
assert.match(app, /sel\.innerHTML='<option value="">'\+t\('common\.all','全部'\)/, 'dynamic CI filter All option must use i18n');

assert.match(freight, /'印度尼西亚': 'Indonesia'/, 'Indonesia display mapping missing');
assert.match(freight, /'泰国': 'Thailand'/, 'Thailand display mapping missing');
assert.match(freight, /'马来西亚': 'Malaysia'/, 'Malaysia display mapping missing');
assert.match(freight, /typeText === '运营CI'\) cells\[1\]\.textContent = 'Operations CI'/, 'Operations CI display mapping missing');
assert.match(freight, /global\.getLang\(\) !== 'en'/, 'country/type display mapping must only apply in English mode');

console.log('ci-pl-i18n-export-ui: PASS');
