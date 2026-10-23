'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'ci-list-inline-logistics.js'), 'utf8');

function setup({visible=true, success=true}={}) {
  const events=[];
  let modalOpen=true;
  const row={hidden:true}, body={innerHTML:''}, caret={textContent:'▶'}, count={textContent:''};
  const nodes={'ci-list-logi-row-ci1':row,'ci-list-logi-body-ci1':body,
    'ci-list-logi-caret-ci1':caret,'ci-list-logi-count-ci1':count};
  if(visible){nodes['ci-source-mode']={};nodes['ci-table']={};}
  const document={
    getElementById:id=>nodes[id]||null,
    createElement:()=>({textContent:''}),
    head:{appendChild:()=>{}},
    addEventListener:()=>{}
  };
  const save=async()=>{events.push('saved');if(success)modalOpen=false;};
  const window={
    __logiCtx:{source:'ci-list',ciId:'ci1'},
    isModalOpen:()=>modalOpen,hasPermission:()=>false,
    loadLog:()=>events.push('loadLog'),
    loadCI:async()=>{events.push('loadCI');},
    invalidateCILogistics:id=>events.push('invalidate:'+id),
    saveEditLog:save,saveLogWithPL:save,
    api:async url=>{events.push('GET:'+url);return [{id:'log1',batch_no:'UPDATED-BATCH'}];}
  };
  // app.js uses top-level let currentPage, so it is NOT a window property.
  vm.runInNewContext(source,{window,document,Date,Number,String,Array,Promise,console,Map});
  return {window,events,row,body,caret,count};
}

for(const method of ['saveEditLog','saveLogWithPL']) {
  test(method+' refreshes CI list and expanded batch after save',async()=>{
    const x=setup();
    await x.window[method]();
    assert.deepEqual(x.events,['saved','invalidate:ci1','loadCI',
      'GET:/api/commercial-invoices/ci1/logistics-batches']);
    assert.equal(x.window.__logiCtx,null);
    assert.equal(x.row.hidden,false);
    assert.match(x.body.innerHTML,/UPDATED-BATCH/);
    assert.equal(x.caret.textContent,'▼');
    assert.equal(x.count.textContent,'(1)');
  });
}
test('do not repaint if user has navigated away',async()=>{
  const x=setup({visible:false});await x.window.saveEditLog();
  assert.deepEqual(x.events,['saved','invalidate:ci1']);
});
test('failed save does not refresh or clear context',async()=>{
  const x=setup({success:false});await x.window.saveEditLog();
  assert.deepEqual(x.events,['saved']);
  assert.equal(x.window.__logiCtx.ciId,'ci1');
});
