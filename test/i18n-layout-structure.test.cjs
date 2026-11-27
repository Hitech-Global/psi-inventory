'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const i18nSource = fs.readFileSync(path.join(root, 'i18n.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function decodeDoubleQuoted(raw) {
  return JSON.parse('"' + raw + '"');
}

function decodeSingleQuoted(raw) {
  return raw.replace(/\\'/g, "'").replace(/\\\\/g, '\\').replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t');
}

function parseDictionary(language) {
  const dictionary = Object.create(null);
  const doubleQuoted = new RegExp(
    'I18N\\.dict\\.' + language + '\\["([^"]+)"\\]\\s*=\\s*"((?:\\\\.|[^"\\\\])*)";',
    'g'
  );
  const singleQuoted = new RegExp(
    "I18N\\.dict\\." + language + "\\['([^']+)'\\]\\s*=\\s*'((?:\\\\.|[^'\\\\])*)';",
    'g'
  );
  for (const match of i18nSource.matchAll(doubleQuoted)) dictionary[match[1]] = decodeDoubleQuoted(match[2]);
  for (const match of i18nSource.matchAll(singleQuoted)) dictionary[match[1]] = decodeSingleQuoted(match[2]);
  return dictionary;
}

function hasHtmlTag(value) {
  return /<\/?[a-z][a-z0-9-]*(?:\s[^>]*)?>/i.test(String(value || ''));
}

function assertBalancedHtml(source, label) {
  const html = String(source || '').replace(/\{v\d+\}/g, '');
  const tokens = html.match(/<\/?[a-z][a-z0-9-]*\b[^>]*>/gi) || [];
  const stack = [];
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  for (const token of tokens) {
    const name = token.match(/^<\/?([a-z][a-z0-9-]*)/i)[1].toLowerCase();
    if (token.startsWith('</')) {
      assert.equal(stack.pop(), name, label + ' has an unexpected closing tag: ' + token);
    } else if (!voidTags.has(name) && !token.endsWith('/>')) {
      stack.push(name);
    }
  }
  assert.deepEqual(stack, [], label + ' has unclosed HTML tags');
}

const dictionaries = {
  zh: parseDictionary('zh'),
  en: parseDictionary('en'),
  id: parseDictionary('id')
};

const callsiteFallbackPattern = /\bt\(\s*(['"])([^'"]+)\1\s*,\s*(['"])((?:\\.|(?!\3)[\s\S])*)\3/g;
const plainTextMarkupMismatches = [];
let inspectedCallsites = 0;
for (const match of app.matchAll(callsiteFallbackPattern)) {
  const key = match[2];
  const fallback = match[4];
  if (hasHtmlTag(fallback)) continue;
  inspectedCallsites++;
  for (const language of ['en', 'id']) {
    const translation = dictionaries[language][key];
    if (translation != null && hasHtmlTag(translation)) {
      plainTextMarkupMismatches.push({ key, language, translation: translation.slice(0, 100) });
    }
  }
}
assert.ok(inspectedCallsites > 1000, 'translation audit must inspect the main application callsites');
assert.deepEqual(
  plainTextMarkupMismatches,
  [],
  'plain-text t() fallbacks must never be replaced with HTML fragments'
);

assert.equal(dictionaries.en['gen.L5767.2'], ' records', 'English CI summary suffix must be plain text');
assert.equal(dictionaries.id['gen.L5767.2'], ' catatan', 'Indonesian CI summary suffix must be plain text');
assert.ok(!hasHtmlTag(dictionaries.en['gen.L5767.2']));
assert.ok(!hasHtmlTag(dictionaries.id['gen.L5767.2']));

const summaryStart = app.indexOf('function renderPurchaseAmountSummary(operationalData,historicalData){');
const summaryEnd = app.indexOf('\n}', summaryStart) + 2;
assert.ok(summaryStart >= 0 && summaryEnd > summaryStart, 'CI summary renderer must exist');
const summaryFunction = app.slice(summaryStart, summaryEnd);
const summaryData = {
  operationalRows: [{
    ci_status: 'completed',
    currency: 'RMB',
    goods_amount: 100,
    balance_paid_amount: 20,
    actual_deducted_deposit: 10,
    balance_deduction_amount: 5,
    balance_rounding_amount: 0.2,
    balance_unpaid_amount: 64.8
  }],
  historicalRows: [{
    currency: 'USD',
    gross_goods_amount: 50,
    historical_paid_amount: 10,
    subsequent_paid_amount: 5,
    deduction_amount: 2,
    rounding_amount: 0.1,
    unpaid_amount: 32.9
  }]
};

for (const language of ['zh', 'en', 'id']) {
  const context = {
    summary: summaryData,
    t: (key, fallback) => dictionaries[language][key] != null ? dictionaries[language][key] : fallback,
    esc: value => String(value)
  };
  vm.runInNewContext(summaryFunction + '\nresult = renderPurchaseAmountSummary(summary);', context);
  const rendered = context.result;
  assert.equal((rendered.match(/class="stat-card"/g) || []).length, 3, language + ' must render three summary cards');
  assert.match(rendered, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/, language + ' must retain the three-column grid');
  assert.equal((rendered.match(/<div\b/g) || []).length, (rendered.match(/<\/div>/g) || []).length, language + ' summary card HTML must be balanced');
}

const actionKeys = [
  "downloadDocTemplate('ci')",
  "openDocImport('ci')",
  "downloadDocTemplate('pl')",
  "openDocImport('pl')",
  'createCI()'
];
for (const language of ['zh', 'en', 'id']) {
  const actions = dictionaries[language]['gen.L5756.1'] || '';
  for (const action of actionKeys) {
    assert.ok(actions.includes(action), language + ' CI/PL action group is missing ' + action);
  }
}

const renderCiFallback = app.match(/\bt\(\s*(['"])html\.renderCI\1\s*,\s*(['"])((?:\\.|(?!\2)[\s\S])*)\2\s*,\s*\{/);
assert.ok(renderCiFallback, 'Chinese CI page template fallback must exist');
assertBalancedHtml(decodeSingleQuoted(renderCiFallback[3]), 'Chinese CI page template');
assertBalancedHtml(dictionaries.en['html.renderCI'], 'English CI page template');
assertBalancedHtml(dictionaries.id['html.renderCI'], 'Indonesian CI page template');

assert.match(index, /CI-PL-I18N-COMPACT-LAYOUT-20261127/);
assert.match(index, /#content-inner \.filter-form:has\(#ci-source-mode\)\{flex-wrap:nowrap/);
assert.match(index, /filter-actions \.btn\{padding:5px 7px;font-size:11px/);
assert.match(index, /@media\(max-width:1540px\)/);

console.log('i18n HTML structure audit and compact CI/PL layout: PASS');
