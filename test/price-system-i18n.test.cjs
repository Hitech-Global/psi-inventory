const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const priceSystem = fs.readFileSync(path.join(root, 'assets/price-system.js'), 'utf8');
const i18n = fs.readFileSync(path.join(root, 'i18n.js'), 'utf8');

function languageKeys(lang) {
  const start = priceSystem.indexOf('\n' + lang + ':{');
  assert.notEqual(start, -1, 'missing ' + lang + ' dictionary');
  const end = priceSystem.indexOf('\n}', start);
  assert.notEqual(end, -1, 'unterminated ' + lang + ' dictionary');
  const block = priceSystem.slice(start, end);
  return [...block.matchAll(/(?:^|,)([A-Za-z_$][\\w$]*):(?=['"])/g)].map(match => match[1]);
}

test('Price System has matching zh/en/id translation keys', () => {
  const zh = languageKeys('zh');
  const en = languageKeys('en');
  const id = languageKeys('id');
  assert.deepEqual([...new Set(en)].sort(), [...new Set(zh)].sort());
  assert.deepEqual([...new Set(id)].sort(), [...new Set(zh)].sort());
  for (const lang of ['zh', 'en', 'id']) {
    const keys = languageKeys(lang);
    for (const key of keys) {
      assert.ok(keys.includes(key), lang + ' missing ' + key);
    }
  }
});

test('Price System visible helper strings use translation keys', () => {
  const code = priceSystem.slice(priceSystem.indexOf('\n};', priceSystem.indexOf('const TXT=')) + 3);
  for (const literal of [
    '根据所选国家自动带入默认币种，也可以手动调整',
    'Store name (optional)',
    'type-reference">来源：',
    "preview.textContent='填写公式后点击校验并预览。'",
    "return value?'开启':'关闭'"
  ]) assert.equal(code.includes(literal), false, 'hardcoded UI string remains: ' + literal);
});

test('language switching refreshes Price System without clearing dirty edits', () => {
  assert.match(priceSystem, /window\\.psHandleLanguageChange=function\\(\\)[\\s\\S]*?main\\(\\);/);
  assert.match(priceSystem, /window\\.psHasUnsavedChanges=function\\(\\)\\{return psDirtyCount\\(\\)>0;\\}/);
  const hook = i18n.indexOf('priceSystemHandled = !!window.psHandleLanguageChange()');
  const save = i18n.indexOf("api('/api/users/me/language-preference', 'PUT'");
  const guard = i18n.indexOf('if (priceSystemHandled) return;');
  assert.ok(hook > -1 && save > hook && guard > save, 'language refresh must not bypass language preference save');
});

test('main language-sensitive modals register render callbacks', () => {
  for (const marker of [
    'renderSchemeCreateModal(readSchemeCreateFormValues())',
    'window.psOpenFieldsModal()',
    'window.psOpenFieldEditor(f?f.id:null,percentDefault)',
    'window.psOpenVersionsModal()',
    'window.psViewVersionDiff(id,no,pagination.page)'
  ]) assert.ok(priceSystem.includes(marker), 'missing modal language callback: ' + marker);
});
