'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

const source=fs.readFileSync(path.join(__dirname,'..','quotation-procurement-brief.js'),'utf8');
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
    return null;
  },
  contains(){return true;}
};
const context={
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
