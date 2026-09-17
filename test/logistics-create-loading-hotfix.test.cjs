'use strict';
const assert = require('node:assert/strict');
const { patchAppSource, patchIndexSource, APP_MARKER, CSS_MARKER } = require('../scripts/logistics-create-loading-hotfix.cjs');

const app = `
async function createLogFromCI(ciId){
  try{
    const ci=await api('/api/commercial-invoices/'+ciId);
    const remaining=0;
    if(remaining<=0){ showToast('no remaining','warning'); return; }
    await selectCIForPL(ciId);
  }catch(e){ showToast(e.message,'danger'); }
}
async function createLogWithPL(){
  try{
    const cis=await api('/api/commercial-invoices/available-for-pl');
    openModal('choose',String(cis.length));
  }catch(e){showToast(e.message,'danger')}
}
async function selectCIForPL(ciId){
  try{
    const ci=await api('/api/commercial-invoices/'+ciId);
    openModal('form',ci.ci_no);
  }catch(e){showToast(e.message,'danger')}
}
`;

const once = patchAppSource(app);
const twice = patchAppSource(once);
assert.equal(twice, once, 'app loading patch must be idempotent');
assert.match(once, /LOGISTICS-CREATE-LOADING-V1/);
assert.match(once, /async function createLogWithPL\(\)\{\s*showLogisticsCreateLoading\('list'\);\s*try/s, 'list loading must render before first request');
assert.match(once, /async function selectCIForPL\(ciId\)\{\s*showLogisticsCreateLoading\('form'\);\s*try/s, 'form loading must render before CI request');
assert.match(once, /async function createLogFromCI\(ciId\)\{\s*showLogisticsCreateLoading\('form'\);\s*try/s, 'CI-detail create must show loading immediately');
assert.match(once, /if\(remaining<=0\)\{ closeLogisticsCreateLoading\(\); showToast/, 'early no-remaining return must clear loading');
assert.ok((once.match(/closeLogisticsCreateLoading\(\); showToast\(e\.message,'danger'\)/g)||[]).length >= 3, 'all create-flow error exits must clear loading');
assert.match(once, /正在加载可用 CI、货代与负责人数据/);
assert.match(once, /正在读取 CI 明细、费用与 SKU 数据/);
new Function(once);

const html='<!doctype html><html><head><style>.base{color:#111}</style></head><body></body></html>';
const htmlOnce=patchIndexSource(html);
assert.equal(patchIndexSource(htmlOnce),htmlOnce,'loading CSS patch must be idempotent');
assert.match(htmlOnce,/LOGISTICS-CREATE-LOADING-STYLE-V1/);
assert.match(htmlOnce,/logistics-create-spinner/);
assert.match(htmlOnce,/@keyframes logisticsCreateSpin/);
assert.doesNotMatch(htmlOnce.slice(htmlOnce.indexOf(CSS_MARKER)),/fetch\(|api\(|setTimeout|setInterval|addEventListener/);
assert.ok(once.includes(APP_MARKER));

console.log('logistics-create-loading hotfix: PASS');
