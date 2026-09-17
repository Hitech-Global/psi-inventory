'use strict';
const assert=require('node:assert/strict');
const {patchAppPerfSource}=require('../scripts/ci-edit-list-sync-hotfix.cjs');

const src=`
async function saveCIEdit(id,backPay,backMode){
  await api('/api/commercial-invoices/'+id,'PUT',payload);
  showToast('CI 已更新','success');
  await viewCI(id,backPay,backMode);
}
`;
const out=patchAppPerfSource(src);
assert.equal(patchAppPerfSource(out),out,'patch must be idempotent');
assert.match(out,/CI-EDIT-LIST-SYNC-V1/);
assert.match(out,/document\.getElementById\('ci-table'\)/);
assert.match(out,/typeof loadCI==='function'/);
assert.match(out,/Promise\.resolve\(loadCI\(\)\)\.catch/);
assert.ok(out.indexOf('CI-EDIT-LIST-SYNC-V1')>out.indexOf("await api('/api/commercial-invoices/'+id,'PUT',payload);"),'refresh must start after successful mutation');
new Function('api','payload','showToast','viewCI','document','loadCI','console',out);
console.log('ci-edit-list-sync hotfix: PASS');
