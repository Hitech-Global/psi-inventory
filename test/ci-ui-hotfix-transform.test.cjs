'use strict';
const assert = require('node:assert/strict');
const { patchAppSource } = require('../scripts/ci-ui-hotfix.cjs');

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
assert.equal(twice, once, 'patch must be idempotent');
assert.match(once, /PAGE-RENDER-EPOCH-GUARD-V1/);
assert.match(once, /const __psiRenderEpoch=window\.__psiPageRenderEpoch\|\|0;/);
assert.doesNotMatch(once, /document\.getElementById\((['"])content-inner\1\)\.innerHTML\s*=/);
new Function('window','document','api','R', once);
console.log('ci-ui-hotfix transform: PASS');
