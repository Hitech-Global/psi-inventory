'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

const source=fs.readFileSync(path.join(__dirname,'..','quotation-procurement-brief.js'),'utf8');
const managementSource=fs.readFileSync(path.join(__dirname,'..','quotation-management.js'),'utf8');
const serverSource=fs.readFileSync(path.join(__dirname,'..','quotation-server.js'),'utf8');
const bootstrapSource=fs.readFileSync(path.join(__dirname,'..','scripts','quotation-management-bootstrap.cjs'),'utf8');
assert.doesNotMatch(source,/last purchase price|purchase-price|采购价|CI\/PI|currency mismatch/i,'brief must only use quote history');
assert.doesNotMatch(managementSource,/last_purchase_|vs_purchase_pct|above_purchase_count|top_purchase_gaps|最近采购价对比|较上次采购价|采购基准/,'quote UI must not expose purchase-price comparisons');
assert.doesNotMatch(serverSource,/purchaseBaselines|parseIdList|vs_purchase_pct|last_purchase_|above_purchase_count|top_purchase_gaps|commercial_invoice_items|proforma_invoice_items/,'quote API must not load or calculate purchase-price baselines');
assert.doesNotMatch(bootstrapSource,/purchaseBaselineText|last purchase price|purchase-price|与上次采购价/,'production bootstrap must not restore purchase-price comparison logic');
assert.match(source,/采购简报|Procurement Brief/,'brief heading remains available');
const applyStart=source.indexOf('function apply(){');
const applyEnd=source.indexOf('\nfunction wrapApi()',applyStart);
assert(applyStart>=0&&applyEnd>applyStart,'apply function boundaries must exist');
const applySource=source.slice(applyStart,applyEnd);

assert.match(source,/!latestSummary\|\|latestUrl!==currentSummaryUrl\(\)/);
assert.match(source,/target===right\|\|right\.contains\(target\)/);
assert.doesNotMatch(source,/else\s+if\s*\(latestSummary\)\s*apply\(\)/);

const reportTitle={};
const badge={textContent:'品牌报告'};
const brand={childNodes:[{textContent:'Netac'}]};
let writes=0,htmlValue='';
const brief={dataset:{},classList:{add(){},contains:()=>false},previousElementSibling:reportTitle,querySelector:()=>({textContent:'品牌简报'})};
Object.defineProperty(brief,'innerHTML',{
  get(){return htmlValue;},
  set(value){writes++;htmlValue=value;}
});
const right={
  querySelectorAll(selector){
    if(selector==='.qm-badge')return [badge];
    if(selector==='.qm-section')return [brief];
    return [];
  },
  querySelector(selector){
    if(selector==='.qm-brand')return brand;
    if(selector==='.qm-report-title')return reportTitle;
    if(selector==='.qm-report-title .qm-brand .qm-badge')return badge;
    if(selector==='[data-qm-brief="1"]')return brief;
    return null;
  },
  contains(){return true;}
};
const context={
  window:{QuotationLocale:null},
  document:{getElementById:id=>id==='qm-right'?right:null},
  latestSummary:{report:{brand:'Netac',avg_change_pct:1}},
  ensureCss(){},
  makeBrief:r=>'<h4>采购简报</h4><div>'+r.avg_change_pct+'</div>'
};
vm.runInNewContext(applySource+'\napply();\napply();',context,{timeout:1000});
assert.equal(writes,1,'identical report must be written only once');
assert.equal(brief.dataset.qmProcurementBriefHtml,htmlValue,'last applied markup is recorded');
context.latestSummary.report.avg_change_pct=2;
vm.runInNewContext('apply();',context,{timeout:1000});
assert.equal(writes,2,'changed report must still update exactly once');
assert.match(htmlValue,/>2</);
console.log('quotation-procurement-brief-observer: PASS');
