'use strict';
const assert = require('node:assert/strict');
const h = require('../scripts/ci-list-inline-logistics-hotfix.cjs');

const op = `function onCIFilterChange(){ refreshCIFilterOptions(); loadCI(); }
function renderOperationalCITable(data){
  return !data.length?'empty':'<table><tbody>'+data.map(c=>'<tr class="clickable-detail-row"><td class="cell-id"><span class="link-text" onclick="viewCI(\\''+c.id+'\\')">'+esc(c.ci_no)+'</span></td><td class="cell-actions">x</td></tr>').join('')+'</tbody></table>';
}
function renderHistoricalCITable(data){ return 'h'; }
`;
const saveBlock = `if(window.__logiCtx && window.__logiCtx.source==='ci-detail'){
      const cid=window.__logiCtx.ciId; window.__logiCtx=null;
      invalidateCILogistics(cid);
      await viewCI(cid);
    } else { loadLog(); }`;
const source = op + '\nasync function a(){'+saveBlock+'}\nasync function b(){'+saveBlock+'}\n';
const patched = h.patchAppSource(source);
assert.equal((patched.match(/CI-LIST-INLINE-LOGISTICS-V1/g)||[]).length,1);
assert.match(patched,/ci-list-logi-toggle/);
assert.match(patched,/renderCIListLogisticsRow\(c\)/);
assert.match(patched,/\/api\/commercial-invoices\/'.*\/logistics-batches/);
assert.match(patched,/source==='ci-list'/);
assert.equal((patched.match(/refreshCIListLogisticsAfterMutation\(cid\)/g)||[]).length,2);
assert.match(patched,/window\.__ciListLogiOpenId/);
assert.match(patched,/__ciLogiCache/);
assert.equal(h.patchAppSource(patched),patched);

const html='<html><head><style>.x{}</style></head><body></body></html>';
const hp=h.patchIndexSource(html);
assert.match(hp,/CI-LIST-INLINE-LOGISTICS-MAC-V1/);
assert.match(hp,/ci-list-logi-table/);
assert.equal(h.patchIndexSource(hp),hp);
console.log('ci-list-inline-logistics hotfix: PASS');
