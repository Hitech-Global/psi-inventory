'use strict';
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {patchSource,MARKER}=require('../scripts/ci-clearance-filter-hotfix.cjs');
const patched=patchSource('/* app-perf fixture */');
assert.equal(patchSource(patched),patched,'patch must be idempotent');
assert.ok(patched.includes(MARKER));
new Function(patched);
let ready,changeHandler;
let filter=null;
const calls=[];
let reloads=0;
const doc={
  getElementById:function(id){return id==='ci-clearance-filter'?filter:null;},
  addEventListener:function(name,fn){if(name==='change')changeHandler=fn;}
};
const ctx={
  document:doc,
  addEventListener:function(name,fn){if(name==='DOMContentLoaded')ready=fn;},
  renderUnifiedCITable:function(op,hist){calls.push({op:op,hist:hist});return 'unified';},
  renderHistoricalCITable:function(rows){calls.push({historical:rows});return 'historical';},
  onCISourceModeChange:function(){return 'mode';},
  loadCI:function(){reloads++;}
};
ctx.window=ctx;
vm.runInNewContext(patched,ctx);
assert.equal(typeof ready,'function');
ready();
// Filter does not exist when DOMContentLoaded fires because this is a SPA page.
assert.equal(typeof changeHandler,'function','delegated change listener must be installed without a rendered filter');
const op=[{id:'o1',clearance_type:'formal'},{id:'o2',clearance_type:'non_formal'},{id:'o3',clearance_type:''}];
const hist=[{id:'h1',clearance_type:'formal'},{id:'h2',clearance_type:'non_formal'},{id:'h3',clearance_type:null}];
// Once the filter is created later, renderer reads its live value.
filter={value:'formal',disabled:false,getAttribute:function(){return null;}};
ctx.renderUnifiedCITable(op,hist);
assert.deepEqual(calls[0].op.map(x=>x.id),['o1']);
assert.deepEqual(calls[0].hist.map(x=>x.id),['h1']);
filter.value='non_formal';
ctx.renderUnifiedCITable(op,hist);
assert.deepEqual(calls[1].op.map(x=>x.id),['o2']);
assert.deepEqual(calls[1].hist.map(x=>x.id),['h2']);
filter.value='unset';
ctx.renderHistoricalCITable(hist);
assert.deepEqual(calls[2].historical.map(x=>x.id),['h3']);
filter.value='';
ctx.renderUnifiedCITable(op,hist);
assert.equal(calls[3].op.length,3);
assert.equal(calls[3].hist.length,3);
changeHandler({target:{id:'ci-clearance-filter',getAttribute:function(){return null;}}});
assert.equal(reloads,1);
changeHandler({target:{id:'other-filter',getAttribute:function(){return null;}}});
assert.equal(reloads,1);
changeHandler({target:{id:'ci-clearance-filter',getAttribute:function(){return 'loadCI()';}}});
assert.equal(reloads,1);
console.log('CI clearance filter dynamic SPA regression: PASS');
