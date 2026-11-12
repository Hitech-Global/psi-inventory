'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'quotation-management.js'),'utf8');
const importer=fs.readFileSync(path.join(root,'quotation-import-progress.js'),'utf8');
const brief=fs.readFileSync(path.join(root,'quotation-procurement-brief.js'),'utf8');
const locale=fs.readFileSync(path.join(root,'quotation-locale.js'),'utf8');
const bootstrap=require(path.join(root,'scripts','quotation-management-bootstrap.cjs'));

test('quotation navigation uses language-aware stable keys and not only Chinese text',()=>{
  assert.match(source,/window\.t\('nav\.po','PO管理'\)/);
  assert.match(source,/window\.t\('nav\.pi','PI管理'\)/);
  assert.match(source,/window\.t\('nav\.ci','CI\/PL管理'\)/);
  assert.match(source,/data-page','quotation-management'/);
  assert.match(source,/data-quotation-nav-label/);
  assert.doesNotMatch(source,/if\(!\[\.\.\.n\.querySelectorAll\('\.sidebar-item'\)\]\.some\(x=>\/PO管理\|PI管理/);
});

test('language changes preserve quotation page and do not overwrite the in-progress modal',()=>{
  assert.match(source,/event\.target\.id!=='lang-switcher'/);
  assert.match(source,/if\(activeModal\)\{nav\(\);return;\}/);
  assert.match(source,/queueMicrotask\(\(\)=>\{/);
  assert.match(source,/localizeQuotation\(\$\('#qm'\)\)/);
});

test('quote report and smart importer translate dynamically updated UI',()=>{
  assert.match(importer,/watchQuotationModal\(m\)/);
  assert.match(importer,/localeObserver\.observe\(node,\{childList:true,subtree:true\}\)/);
  assert.match(importer,/localizeQuotation\(b\)/);
  assert.match(brief,/function makeEnglishBrief/);
  assert.match(brief,/data-qm-brief/);
  assert.match(brief,/\.qm-report-title \.qm-brand \.qm-badge/);
  assert.doesNotMatch(brief,/\.textContent\.includes\('品牌报告'\)/);
});

test('quotation locale translates English labels without touching business data',()=>{
  const window={getLang:()=> 'en'};
  vm.runInNewContext(locale,{window},{timeout:1000});
  assert.equal(window.QuotationLocale.label('报价管理'),'Quotation Management');
  assert.equal(window.QuotationLocale.label('导入报价'),'Import Quotes');
  assert.equal(window.QuotationLocale.label('报价日期'),'Quote Date');
  assert.equal(window.QuotationLocale.label('涨价'),'Price Increases');
  assert.equal(window.QuotationLocale.label('降价'),'Price Decreases');
  assert.equal(window.QuotationLocale.label('共 '),'Total ');
  assert.equal(window.QuotationLocale.label(' 个有效 SKU'),' active SKUs');
  assert.match(source,/qmLabel\('共 '\)\+rows\.length\+qmLabel\(' 个有效 SKU'\)/);
  assert.match(source,/qmLabel\(mode==='up'\?'涨价':'降价'\)/);
  assert.equal(window.QuotationLocale.convert('Netac 品牌报告','en'),'Netac Brand Report');
  assert.equal(window.QuotationLocale.convert('NT01N535S-240G-S3X','en'),'NT01N535S-240G-S3X');
  window.getLang=()=> 'zh';
  assert.equal(window.QuotationLocale.label('报价管理'),'报价管理');
});

test('quotation bootstrap inserts locale script before page scripts',()=>{
  const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const patched=bootstrap.patchIndexSource(index);
  assert(patched.includes('quotation-locale.js?v=20261112e'));
  assert(patched.indexOf('quotation-locale.js')<patched.indexOf('quotation-management.js'));
  assert.equal(bootstrap.patchIndexSource(patched),patched);
});
