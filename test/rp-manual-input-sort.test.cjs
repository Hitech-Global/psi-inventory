'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const app=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
const start=app.indexOf('var _rpTableSort=new WeakMap();');
const end=app.indexOf('// 全局 tooltip',start);
assert(start>=0&&end>start,'RP sort source boundaries must exist');
const ctx={WeakMap,Date,Number,String,Array};
vm.runInNewContext(app.slice(start,end),ctx,{timeout:1500});

function cell(value, text='') {
  const input={value:String(value)};
  return {input,textContent:text,querySelector(selector){
    assert.equal(selector,'input[type="number"]');
    return input;
  }};
}
function plain(text) {
  return {textContent:String(text),querySelector(){return null;}};
}
function row(id,value) {
  return {id,dataset:{},children:[plain(id),cell(value)]};
}
function fakeTable(initial) {
  const tbody={
    rows:initial.slice(),
    querySelectorAll(selector){assert.equal(selector,':scope > tr');return this.rows.slice();},
    appendChild(r){const i=this.rows.indexOf(r);assert(i>=0);this.rows.splice(i,1);this.rows.push(r);}
  };
  return {tBodies:[tbody],tbody};
}
function ids(t){return t.tbody.rows.map(r=>r.id).join(',');}

assert.equal(ctx.rpSortCellValue(cell(0)),0,'explicit manual zero is sortable');
assert.equal(ctx.rpSortCellValue(cell(123)),123,'numeric input value must be read');
assert.equal(ctx.rpSortCellValue(cell(23.5)),23.5,'decimal input sort');
assert.equal(ctx.rpSortCellValue(cell('')),null,'empty input sorts after values');
assert.equal(ctx.rpSortCellValue(plain('1,230')),1230,'ordinary numeric column unchanged');
assert.equal(ctx.rpSortCellValue(plain('2.5%')),2.5,'percentage column unchanged');
assert.equal(ctx.rpSortCellValue(plain('unknown-text')),'unknown-text','text column unchanged');
const a=row('A',0),b=row('B',350),c=row('C',12),d=row('D',0);
const table=fakeTable([a,b,c,d]);
ctx.rpApplyTableSort(table,1,'desc');
assert.equal(ids(table),'B,C,A,D','descending should bring positive suggested values to top');
ctx.rpApplyTableSort(table,1,'asc');
assert.equal(ids(table),'A,D,C,B','ascending should bring zero-valued suggestions to top');
ctx.rpApplyTableSort(table,1,'none');
assert.equal(ids(table),'A,B,C,D','default must restore stable source order');
// User's newest edit is in .value, not the initially rendered HTML attribute.
a.children[1].input.value='999';
ctx.rpApplyTableSort(table,1,'desc');
assert.equal(ids(table),'A,B,C,D','sort uses latest edited value without page reload');
assert.equal(a.children[1].input.value,'999','sort must not alter pending user input');
assert.equal(b.children[1].input.value,'350','sort must not alter other input values');
assert.deepEqual([a,b,c,d].map(r=>r.dataset.rpOriginalOrder),['0','1','2','3']);
console.log('rp-manual-input-sort: PASS');
