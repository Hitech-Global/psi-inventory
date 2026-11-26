'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');

const src=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
function section(a,b){
  const i=src.indexOf(a),j=src.indexOf(b,i);
  assert(i>=0&&j>i,a+' section should exist');
  return src.slice(i,j);
}

test('payable multi-select changes schedule one debounced automatic refresh',()=>{
  const timers=new Map(),elements={'payl-ms-fb-text':{textContent:''}};
  let nextId=0,loads=0;
  const cb={value:'Redragon',closest:()=>({querySelector:()=>({textContent:'Redragon'})})};
  const ctx={
    document:{
      getElementById:id=>elements[id]||null,
      querySelectorAll:selector=>{
        if(selector==='#payl-ms-fb .payl-ms-cb:checked')return [cb];
        return [];
      }
    },
    t:(_,fallback)=>fallback,
    loadPayableList:()=>{loads++;},
    setTimeout:(fn,delay)=>{const id=++nextId;timers.set(id,{fn,delay});return id;},
    clearTimeout:id=>timers.delete(id)
  };
  vm.createContext(ctx);
  vm.runInContext(section('// ── 应付费用列表：多选下拉','// ── 付款日期快捷按钮'),ctx);

  ctx.paylMsChange('payl-ms-fb');
  assert.equal(elements['payl-ms-fb-text'].textContent,'Redragon');
  assert.equal(timers.size,1);
  assert.equal([...timers.values()][0].delay,280);

  // 连续勾选时只保留最后一次定时刷新。
  ctx.paylMsChange('payl-ms-fb');
  assert.equal(timers.size,1);
  const [pendingId,pending]=[...timers.entries()][0];
  timers.delete(pendingId); // fake timers remove the fired timer before running its callback
  pending.fn();
  assert.equal(loads,1);
  assert.equal(timers.size,0);
});

test('automatic filter scheduler supports immediate apply and silent state restoration',()=>{
  const timers=new Map(),elements={'payl-ms-fb-text':{textContent:''}};
  let nextId=0,loads=0;
  const cb={value:'Redragon',closest:()=>({querySelector:()=>({textContent:'Redragon'})})};
  const ctx={
    document:{
      getElementById:id=>elements[id]||null,
      querySelectorAll:selector=>selector==='#payl-ms-fb .payl-ms-cb:checked'?[cb]:[]
    },
    t:(_,fallback)=>fallback,
    loadPayableList:()=>{loads++;},
    setTimeout:(fn,delay)=>{const id=++nextId;timers.set(id,{fn,delay});return id;},
    clearTimeout:id=>timers.delete(id)
  };
  vm.createContext(ctx);
  vm.runInContext(section('// ── 应付费用列表：多选下拉','// ── 付款日期快捷按钮'),ctx);

  ctx.paylMsChange('payl-ms-fb',false);
  assert.equal(timers.size,0);
  assert.equal(loads,0);

  ctx.paylScheduleFilterLoad(450);
  assert.equal(timers.size,1);
  ctx.paylScheduleFilterLoad(0);
  assert.equal(timers.size,0);
  assert.equal(loads,1);
});

test('payable date and keyword controls auto-apply; quick month applies immediately',()=>{
  const list=section('async function renderPayableList(){','function renderPayableTable(){');
  assert.ok(list.includes('paylMsChange(id,false);'),'restoring saved filters must not trigger duplicate requests');
  assert.ok(list.includes('oninput="paylMsUpdateQuickActive();paylScheduleFilterLoad(350)"'));
  assert.ok(list.includes('onchange="paylMsUpdateQuickActive();paylScheduleFilterLoad(0)"'));
  assert.ok(list.includes('oninput="paylScheduleFilterLoad(450)"'));
  assert.match(list,/onkeydown="if\(event\.key===\\'Enter\\'\)\{event\.preventDefault\(\);paylScheduleFilterLoad\(0\)\}"/);
  const quick=section('function paylQuickMonth(which){','// 当前日期区间正好等于完整本月/上月时对应按钮高亮');
  assert.match(quick,/loadPayableList\(\)/);
});

test('latest payable filter request alone can update the list and its PR status map',()=>{
  const load=section('async function loadPayableList(){','function renderPayableTable(){');
  const status=section('async function loadPayablePrStatusMap(items){','// ── 应付费用列表：多选下拉');
  assert.match(load,/const requestId=\+\+_paylListRequestSeq/);
  assert.match(load,/if\(requestId!==_paylListRequestSeq\)return/);
  assert.match(load,/const nextPrStatusMap=await loadPayablePrStatusMap\(_payableListData\)/);
  assert.match(load,/_payablePrStatusMap=nextPrStatusMap/);
  assert.match(status,/const statusMap=\{\}/);
  assert.match(status,/return statusMap/);
  assert.doesNotMatch(status,/_payablePrStatusMap\s*=/);
});
