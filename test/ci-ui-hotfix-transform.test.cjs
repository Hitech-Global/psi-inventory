'use strict';
const assert = require('node:assert/strict');
const { patchAppSource, patchIndexSource } = require('../scripts/ci-ui-hotfix.cjs');

const src = `
function showPage(page){
  document.getElementById('content-inner').innerHTML='';
  if(R[page])R[page]();
}
async function renderDashboard(){
  document.getElementById('content-inner').innerHTML='loading';
  const d=await api('/api/dashboard');
  document.getElementById('content-inner').innerHTML='done';
}
function syncRender(){
  document.getElementById("content-inner").innerHTML='sync';
}
`;

const once = patchAppSource(src);
const twice = patchAppSource(once);
assert.equal(twice, once, 'app patch must be idempotent');
assert.match(once, /PAGE-RENDER-EPOCH-GUARD-V1/);
assert.match(once, /const __psiRenderEpoch=window\.__psiPageRenderEpoch\|\|0;/);
assert.doesNotMatch(once, /document\.getElementById\((['"])content-inner\1\)\.innerHTML\s*=/);
new Function('window','document','api','R', once);

const html = '<!doctype html><html><head><style>.x{color:red}</style></head><body><div id="modal-content"></div></body></html>';
const htmlOnce = patchIndexSource(html);
const htmlTwice = patchIndexSource(htmlOnce);
assert.equal(htmlTwice, htmlOnce, 'index patch must be idempotent');
assert.match(htmlOnce, /CI-CREATE-MAC-STYLE-V1/);
assert.match(htmlOnce, /\.modal-ci-create:has\(#nci-supplier\)/);
assert.match(htmlOnce, /#ci-items-preview \.ci-detail-table td\{[^}]*text-align:left!important/s);
assert.match(htmlOnce, /#ci-items-preview \.ci-detail-table input\[type=number\]\{[^}]*text-align:left!important/s);
assert.match(htmlOnce, /CSS-only: no extra request\/listener\/render delay/);
console.log('ci-ui-hotfix transform: PASS');
