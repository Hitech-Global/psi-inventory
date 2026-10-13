'use strict';
// Regression: RP column drag must preserve click-sort listeners (including cached re-entry).
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const app=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
const sortStart=app.indexOf('var _rpTableSort=new WeakMap();');
const sortEnd=app.indexOf('// 全局 tooltip',sortStart);
const dragStart=app.indexOf('function initRpTableDrag(',sortEnd);
const dragEnd=app.indexOf('async function renderReplenishment(',dragStart);
assert(sortStart>=0&&sortEnd>sortStart&&dragStart>sortEnd&&dragEnd>dragStart);

class Header {
  constructor(){
    this.dataset={};
    this.style={};
    this.title='';
    this.draggable=false;
    this.classes=new Set();
    this.classList={
      contains:k=>this.classes.has(k),
      add:k=>this.classes.add(k)
    };
    this.listeners={};
    this.indicator=null;
  }
  querySelector(selector){
    if(selector==='.rp-sort-indicator')return this.indicator;
    if(selector==='input,button,select')return null;
    throw new Error('Unexpected header selector: '+selector);
  }
  appendChild(child){this.indicator=child;}
  addEventListener(type,fn){
    (this.listeners[type]||(this.listeners[type]=[])).push(fn);
  }
  cloneNode(){throw new Error('Must not clone header: this destroys attached sort handlers');}
  fire(type){
    const transfer={effectAllowed:'',dropEffect:'',setData(){}};
    const ev={
      target:{closest(){return null;}},
      dataTransfer:transfer,
      preventDefault(){},
      stopPropagation(){}
    };
    (this.listeners[type]||[]).forEach(fn=>fn.call(this,ev));
  }
}

function dataRow(id,value){
  const input={value:String(value)};
  return {id,dataset:{},children:[
    {textContent:id,querySelector(){return null;}},
    {textContent:'',querySelector(selector){
      assert.equal(selector,'input[type="number"]');
      return input;
    }}
  ]};
}

const headers=[new Header(),new Header()];
const headerRow={cells:headers,querySelectorAll(s){
  assert.equal(s,'th');
  return headers;
}};
const a=dataRow('A',0),b=dataRow('B',350),c=dataRow('C',12);
const body={
  rows:[a,b,c],
  querySelectorAll(s){assert.equal(s,':scope > tr');return this.rows.slice();},
  appendChild(r){
    const i=this.rows.indexOf(r);
    assert(i>=0);
    this.rows.splice(i,1);
    this.rows.push(r);
  }
};
const table={
  tHead:{rows:[headerRow]},
  tBodies:[body],
  querySelector(s){assert.equal(s,'thead tr');return headerRow;}
};
const container={querySelector(s){
  assert(s==='table'||s==='.rp-monthly-table, .daily-table-wrap table');
  return table;
}};
const queue=[];
const reorders=[];
const ctx={
  WeakMap,Date,Number,String,Array,
  window:{_rpHistoricalSales:false},
  document:{createElement(tag){
    assert.equal(tag,'span');
    return {className:'',textContent:'',style:{}};
  }},
  setTimeout(fn,ms){assert.equal(ms,300);queue.push(fn);},
  rpActiveContainer(){return container;},
  getRpColConfig(tab){assert.equal(tab,'total');return [
    {key:'sku',visible:true},{key:'suggested',visible:true}
  ];},
  reorderRpColConfig(tab,from,to){reorders.push([tab,from,to].join(':'));},
  t(k,fallback){return fallback;}
};
vm.runInNewContext(app.slice(sortStart,sortEnd)+'\n'+app.slice(dragStart,dragEnd),ctx,{timeout:2000});
function ids(){return body.rows.map(r=>r.id).join(',');}
function flush(){while(queue.length)queue.shift()();}

// Sort listeners exist before drag's delayed 300ms initialization.
ctx.initRpTableSort(container);
assert.equal((headers[1].listeners.click||[]).length,1);
headers[1].fire('click');
assert.equal(ids(),'B,C,A','descending before drag initialization');

// Delayed drag initialization must not replace headers or their existing listeners.
ctx.initRpTableDrag('total',container);
ctx.initRpTableDrag('total',container);
flush();
assert.equal((headers[1].listeners.dragstart||[]).length,1,'drag bound only once');
assert.equal((headers[1].listeners.click||[]).length,1,'sort listener retained');
assert.equal(headers[1].indicator.textContent,'▼','sort indicator retained');
headers[1].fire('click');
assert.equal(ids(),'A,C,B','ascending after drag initialization');

// Drag still works without starting an extra listener on cached view re-entry.
headers[0].fire('dragstart');
headers[1].fire('drop');
assert.equal(reorders.join(','),'total:sku:suggested','reorder called once');
ctx.initRpTableDrag('total',container);
ctx.initRpTableSort(container);
flush();
assert.equal((headers[1].listeners.dragstart||[]).length,1,'no duplicate drag events');
assert.equal((headers[1].listeners.click||[]).length,1,'no duplicate click events');
headers[1].fire('click');
assert.equal(ids(),'A,B,C','third click restores original order');
b.children[1].querySelector('input[type="number"]').value='999';
headers[1].fire('click');
assert.equal(ids(),'B,C,A','live edited input still sorts after cached re-entry');
console.log('rp-sort-drag-listener: PASS');
