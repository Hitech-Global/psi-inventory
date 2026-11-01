'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

const app=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
const keyStart=app.indexOf('function isRpMonthColKey(key){');
const keyEnd=app.indexOf('function rpMonthColDefs(){',keyStart);
const configStart=app.indexOf('function getRpColConfig(tabKey){');
const configEnd=app.indexOf('// 保存字段配置',configStart);
assert(keyStart>=0&&keyEnd>keyStart,'month key helper boundary must exist');
assert(configStart>=0&&configEnd>configStart,'column config source boundary must exist');
const source=app.slice(keyStart,keyEnd)+'\n'+app.slice(configStart,configEnd);

const monthDefs=[];
for(const year of [2025,2026]){
  for(let month=1;month<=12;month++){
    const mm=String(month).padStart(2,'0');
    monthDefs.push({
      key:'ms_'+year+'_'+mm,
      label:year+'-'+mm,
      visibleByDefault:year===2026&&month<=11
    });
  }
}
const expectedMonths=monthDefs.map(d=>d.key);
const nonMonthKeys=['check','sku','model','online_avg','offline_avg'];

function makeHarness(savedItems,{v8Done=true}={}){
  const storage=new Map();
  storage.set('prediction_table_columns_total',JSON.stringify(savedItems));
  storage.set('rp_col_config_v5_total','1');
  if(v8Done)storage.set('rp_col_config_v8_total','1');
  const localStorage={
    getItem(key){return storage.has(key)?storage.get(key):null;},
    setItem(key,value){storage.set(key,String(value));}
  };
  const defs=[
    {key:'check',label:'Selection',fixed:true},
    {key:'sku',label:'SKU',fixed:true},
    {key:'model',label:'Model'},
    ...monthDefs,
    {key:'online_avg',label:'Online average'},
    {key:'offline_avg',label:'Offline average'}
  ];
  const ctx={
    localStorage,
    RP_COL_STORAGE_KEYS:{total:'prediction_table_columns_total'},
    rpTotalColMeta(){return defs;},
    rpChannelColMeta(){throw new Error('channel config must not be used');},
    rpMonthColDefs(){return monthDefs;}
  };
  vm.runInNewContext(source,ctx,{timeout:2000});
  return {ctx,storage};
}
function monthItems(keys,visibleFor){
  return keys.map(key=>({key,visible:visibleFor?visibleFor(key):true}));
}
function monthKeys(config){
  return config.filter(item=>/^ms_\d{4}_\d{2}$/.test(item.key)).map(item=>item.key);
}
function nonMonthKeysIn(config){
  return config.filter(item=>!/^ms_\d{4}_\d{2}$/.test(item.key)).map(item=>item.key);
}

// Regression 1: an already-saved November column must not remain ahead of January–October.
// The migration sorts only month-column slots; non-month fields and their relative order stay put.
{
  const unsorted=['ms_2026_11',...expectedMonths.filter(k=>k!=='ms_2026_11')];
  const saved=[
    {key:'check',visible:true},
    {key:'sku',visible:true},
    {key:'model',visible:true},
    ...monthItems(unsorted,key=>key!=='ms_2026_11'&&key!=='ms_2025_03'),
    {key:'online_avg',visible:false},
    {key:'offline_avg',visible:true}
  ];
  const {ctx,storage}=makeHarness(saved);
  const result=ctx.getRpColConfig('total');
  assert.equal(monthKeys(result).join('|'),expectedMonths.join('|'),'all existing month columns must be chronological');
  assert.equal(nonMonthKeysIn(result).join('|'),nonMonthKeys.join('|'),'non-month column order must not change');
  assert.equal(result.find(x=>x.key==='ms_2026_11').visible,false,'saved November visibility must be retained');
  assert.equal(result.find(x=>x.key==='ms_2025_03').visible,false,'saved hidden month must remain hidden');
  const persisted=JSON.parse(storage.get('prediction_table_columns_total'));
  assert.deepEqual(monthKeys(persisted),expectedMonths,'chronological order must be persisted for the user');
  assert.equal(storage.get('rp_col_config_v9_total'),'1','one-time repair migration must be marked complete');
}

// Regression 2: if v8 has already run, any newly introduced month fields must be inserted
// into the chronological month sequence instead of being appended after unrelated columns.
{
  const existing=expectedMonths.filter(k=>k!=='ms_2026_11'&&k!=='ms_2026_12');
  const saved=[
    {key:'check',visible:true},
    {key:'sku',visible:true},
    {key:'model',visible:true},
    ...monthItems(existing),
    {key:'online_avg',visible:true},
    {key:'offline_avg',visible:false}
  ];
  const {ctx}=makeHarness(saved,{v8Done:true});
  const result=ctx.getRpColConfig('total');
  assert.equal(monthKeys(result).join('|'),expectedMonths.join('|'),'new month fields must be inserted at their chronological positions');
  assert.equal(nonMonthKeysIn(result).join('|'),nonMonthKeys.join('|'),'adding month fields must not reorder other fields');
  assert.equal(result.find(x=>x.key==='ms_2026_11').visible,true,'new current month follows its default visibility');
  assert.equal(result.find(x=>x.key==='ms_2026_12').visible,false,'future month remains hidden by default');
}

// Regression 3: if the old v8 migration adds missing months after Model, v9 must sort
// those new items together with existing months without changing saved visibility.
{
  const existing=expectedMonths.filter(k=>k!=='ms_2026_11'&&k!=='ms_2026_12');
  const saved=[
    {key:'check',visible:true},
    {key:'sku',visible:true},
    {key:'model',visible:true},
    ...monthItems(existing,key=>key!=='ms_2025_04'),
    {key:'online_avg',visible:false},
    {key:'offline_avg',visible:true}
  ];
  const {ctx}=makeHarness(saved,{v8Done:false});
  const result=ctx.getRpColConfig('total');
  assert.equal(monthKeys(result).join('|'),expectedMonths.join('|'),'v8-inserted month fields must be sorted with existing months');
  assert.equal(nonMonthKeysIn(result).join('|'),nonMonthKeys.join('|'),'v8/v9 migration must preserve non-month field order');
  assert.equal(result.find(x=>x.key==='ms_2025_04').visible,false,'v8/v9 must retain prior visibility');
}

console.log('rp-month-column-order: PASS');
