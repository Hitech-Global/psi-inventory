'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

const app=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
const start=app.indexOf('function addHistoricalColsToActive(');
const end=app.indexOf('\n// 构建单个字段行 HTML',start);
assert(start>=0&&end>start,'historical column helper boundaries must exist');
const source=app.slice(start,end);

class FixedDate extends Date {
  constructor(...args){
    if(args.length)super(...args);
    else super(2026,10,2);
  }
}

const monthlyColumns=[
  '2026-05','2026-06','2026-07','2026-08','2026-09','2026-10','2026-11'
];
const onlineRow={
  '2026-05':5,'2026-06':6,'2026-07':7,
  '2026-08':8,'2026-09':9,'2026-10':10,'2026-11':11
};
const offlineRow={
  '2026-05':50,'2026-06':60,'2026-07':70,
  '2026-08':80,'2026-09':90,'2026-10':100,'2026-11':110
};

function makeHarness({tab='online',mode='monthly',activeKeys}){
  const monthly=mode==='monthly';
  const hist={
    success:true,
    mode,
    columns:monthly?monthlyColumns.slice():undefined,
    data:{'SKU-1':onlineRow},
    channel_data:{online:{'SKU-1':onlineRow},offline:{'SKU-1':offlineRow}}
  };
  const ctx={
    window:{_rpHistoricalSales:hist},
    rpTab:tab,
    Date:FixedDate,
    isRpMonthColKey:key=>/^ms_\d{4}_\d{2}$/.test(String(key||'')),
    rpThCompact:label=>'<th>'+label+'</th>',
    esc:value=>String(value),
    formatQuantityDisplay:value=>String(value),
    t:(_key,fallback)=>fallback
  };
  vm.runInNewContext(source,ctx,{timeout:1500});
  const active=activeKeys.slice();
  const original=activeKeys.slice();
  const cols={};
  const totals={};
  ctx.addHistoricalColsToActive(active,cols,totals,[{sku_code:'SKU-1'}]);
  return {ctx,active,original,cols,totals,hist};
}
function historicalKeys(){
  return ['2026-05','2026-06','2026-07'].map(m=>'hs_'+m.replace(/[^a-zA-Z0-9]/g,'_'));
}
function withoutHistorical(keys){
  return keys.filter(key=>!String(key).startsWith('hs_'));
}

// Default online configuration: SKU → Sales judgement → Model → current months.
// Historical months must join the month group, not be forcibly inserted after SKU.
{
  const x=makeHarness({
    tab:'online',
    activeKeys:['spacer','sku','sales_judgement','model','sales_m4','sales_m3','sales_m2','sales_m1','channel_avg']
  });
  assert.deepEqual(x.active,[
    'spacer','sku','sales_judgement','model',
    ...historicalKeys(),
    'sales_m4','sales_m3','sales_m2','sales_m1','channel_avg'
  ]);
  assert.deepEqual(withoutHistorical(x.active),x.original,'all user-configured columns must retain their exact relative order');
  assert.match(x.cols.hs_2026_05.td({sku_code:'SKU-1'}),/>5</);
  assert.equal(x.totals._historical.hs_2026_05,5);
}

// When Model is hidden, Sales judgement must still be immediately after SKU.
{
  const x=makeHarness({
    tab:'online',
    activeKeys:['spacer','sku','sales_judgement','sales_m4','sales_m3','sales_m2','sales_m1']
  });
  assert.deepEqual(x.active,[
    'spacer','sku','sales_judgement',
    ...historicalKeys(),
    'sales_m4','sales_m3','sales_m2','sales_m1'
  ]);
  assert.equal(x.active[x.active.indexOf('sku')+1],'sales_judgement');
}

// Respect a user's reordered built-in month position; only insert history before the first visible month.
{
  const x=makeHarness({
    tab:'offline',
    activeKeys:['spacer','sku','sales_m4','sales_judgement','model','sales_m1']
  });
  assert.deepEqual(x.active,[
    'spacer','sku',
    ...historicalKeys(),
    'sales_m4','sales_judgement','model','sales_m1'
  ]);
  assert.deepEqual(withoutHistorical(x.active),x.original);
  assert.match(x.cols.hs_2026_05.td({sku_code:'SKU-1'}),/>50</);
}

// If every built-in month is hidden, history columns go to the end rather than breaking configured field order.
{
  const x=makeHarness({
    tab:'online',
    activeKeys:['spacer','sku','sales_judgement','model','channel_avg']
  });
  assert.deepEqual(x.active,[
    'spacer','sku','sales_judgement','model','channel_avg',
    'hs_2026_05','hs_2026_06','hs_2026_07','hs_2026_08','hs_2026_09','hs_2026_10','hs_2026_11'
  ]);
  assert.deepEqual(withoutHistorical(x.active),x.original);
}

// Total forecast keeps its existing SKU-following historical-column behavior.
{
  const x=makeHarness({
    tab:'total',
    activeKeys:['check','sku','model','ms_2026_08','total_avg']
  });
  assert.deepEqual(x.active,[
    'check','sku',...historicalKeys(),'model','ms_2026_08','total_avg'
  ]);
}

// Daily/custom-period history is unchanged and remains after SKU.
{
  const x=makeHarness({
    tab:'online',
    mode:'daily',
    activeKeys:['spacer','sku','sales_judgement','model','sales_m4']
  });
  assert.deepEqual(x.active,[
    'spacer','sku','hs_total','sales_judgement','model','sales_m4'
  ]);
}

console.log('rp-historical-channel-order: PASS');
