'use strict';
const assert=require('node:assert/strict');
const {patchAppPerfSource,patchIndexSource,patchServerSource}=require('../scripts/ci-edit-before-pl-hotfix.cjs');

const perf=patchAppPerfSource('/* perf */');
assert.equal(patchAppPerfSource(perf),perf,'perf patch idempotent');
assert.match(perf,/CI-EDIT-BEFORE-PL-UI-V1/);
assert.match(perf,/\(ci\.packing_lists\|\|\[\]\)\.length>0/);
assert.match(perf,/api\('\/api\/commercial-invoices\/'\+id,'PUT',payload\)/);
assert.match(perf,/var ci=\(ctx && String\(ctx\.ciId\)===String\(id\) && ctx\.ci\)/,'cached CI must be preferred for instant editor');
new Function(perf);

const html='<html><head><style>.x{}</style></head><body></body></html>';
const html1=patchIndexSource(html);
assert.equal(patchIndexSource(html1),html1,'css patch idempotent');
assert.match(html1,/CI-EDIT-BEFORE-PL-MAC-V1/);
assert.match(html1,/has\(#eci-ci-no\)/);

const server=`const app={put(){}};\n// CI-SHIP-DATE-01：仅补充/更正运营 CI 的实际出货日期（不触发 payable_date、不动 due_date、不创建/修改 payment_request）\n`;
const s1=patchServerSource(server);
assert.equal(patchServerSource(s1),s1,'server patch idempotent');
assert.match(s1,/CI-EDIT-BEFORE-PL-V1/);
assert.match(s1,/SELECT id, pl_no FROM packing_lists WHERE related_ci_id = \? LIMIT 1/);
assert.match(s1,/status\(409\).*已生成PL/s);
assert.match(s1,/SELECT id FROM commercial_invoices WHERE ci_no = \? AND id != \?/);
assert.match(s1,/UPDATE commercial_invoice_items SET ci_no = \? WHERE ci_id = \?/);
assert.match(s1,/UPDATE logistics_batches SET related_ci_no = \? WHERE related_ci_id = \?/);
new Function(s1);
console.log('ci-edit-before-pl hotfix: PASS');
