'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'..');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const appSource=fs.readFileSync(path.join(root,'app.js'),'utf8');
const sku='NT03UA31N-008G-20BL';
const routeStart=server.indexOf("app.get('/api/replenishment-suggestions/historical-sales'");
const routeEnd=server.indexOf('// 月度销量矩阵',routeStart);
assert(routeStart>=0&&routeEnd>routeStart);
let routeHandler;
const queries=[];
const routeCtx={
  app:{get:(name,_permission,handler)=>{assert.equal(name,'/api/replenishment-suggestions/historical-sales');routeHandler=handler;}},
  requireApiPermission:()=>()=>{},
  asyncHandler:fn=>fn,
  salesOrderDateExpr:()=> 'order_date',
  buildReplenishmentDataScopeFilter:()=>({sql:'',params:[]}),
  buildSalesDataScopeFilter:()=>({sql:'',params:[]}),
  query:(sql,params)=>{
    if(sql.includes('FROM replenishment_suggestions'))return {rows:[{sku_code:sku},{sku_code:'EMPTY'}]};
    assert(sql.includes('FROM sales_records'));
    queries.push({sql,params});
    if(sql.includes(' as ym'))return {rows:[
      {sku_code:sku,ym:'2026-05',qty:1297,online_qty:1242,offline_qty:55},
      {sku_code:sku,ym:'2026-06',qty:2555,online_qty:2427,offline_qty:128}
    ]};
    return {rows:[{sku_code:sku,qty:2555,online_qty:2427,offline_qty:128}]};
  }
};
vm.runInNewContext(server.slice(routeStart,routeEnd),routeCtx,{timeout:2000});
async function response(query){
  let data;
  const res={json:obj=>{data=obj;return obj;},status:code=>{throw Error('unexpected status '+code);}};
  await routeHandler({query},res);
  return data;
}

(async()=>{
  const monthly=await response({mode:'monthly',start:'2026-05',end:'2026-06',country:'印度尼西亚'});
  assert.equal(monthly.data[sku]['2026-05'],1297);
  assert.equal(monthly.data[sku]['2026-06'],2555);
  assert.equal(monthly.channel_data.online[sku]['2026-05'],1242);
  assert.equal(monthly.channel_data.online[sku]['2026-06'],2427);
  assert.equal(monthly.channel_data.offline[sku]['2026-05'],55);
  assert.equal(monthly.channel_data.offline[sku]['2026-06'],128);
  assert.equal(monthly.channel_data.offline.EMPTY['2026-06'],0);
  const daily=await response({mode:'daily',start:'2026-06-01',end:'2026-06-30',country:'印度尼西亚'});
  assert.equal(daily.data[sku].total,2555);
  assert.equal(daily.channel_data.online[sku].total,2427);
  assert.equal(daily.channel_data.offline[sku].total,128);
  assert.equal(daily.channel_data.offline.EMPTY.total,0);
  assert.equal(queries.length,2);
  queries.forEach(({sql,params})=>{
    assert.match(sql,/shop_platform LIKE '%线上%'/);
    assert.match(sql,/shop_platform LIKE '%线下%'/);
    assert.match(sql,/is_valid_order = 1/);
    assert.match(sql,/country = \?/);
    assert(params.includes('印度尼西亚'));
  });
  const pos=appSource.indexOf('function addHistoricalColsToActive(');
  const stop=appSource.indexOf('// 构建单个字段行 HTML',pos);
  assert(pos>=0&&stop>pos);
  const ctx={
    window:{_rpHistoricalSales:monthly},rpTab:'total',
    isRpMonthColKey:()=>false,
    rpThCompact:label=>'<th>'+label+'</th>',
    formatQuantityDisplay:v=>Math.round(v).toLocaleString('en-US'),
    t:(_key,fallback)=>fallback,esc:v=>String(v)
  };
  vm.runInNewContext(appSource.slice(pos,stop),ctx,{timeout:2000});
  function cell(tab,hist,column) {
    ctx.rpTab=tab;
    ctx.window._rpHistoricalSales=hist;
    const cols={};const totals={};const active=['sku'];
    ctx.addHistoricalColsToActive(active,cols,totals,[{sku_code:sku}]);
    const key='hs_'+column.replace(/[^a-zA-Z0-9]/g,'_');
    assert(active.includes(key));
    return {html:cols[key].td({sku_code:sku}),sum:totals._historical[key]};
  }
  assert.match(cell('total',monthly,'2026-06').html,/>2,555</);
  assert.match(cell('online',monthly,'2026-06').html,/>2,427</);
  assert.match(cell('offline',monthly,'2026-06').html,/>128</);
  assert.equal(cell('offline',monthly,'2026-05').sum,55);
  assert.match(cell('offline',daily,'total').html,/>128</);
  assert.match(cell('online',daily,'total').html,/>2,427</);
  assert.match(cell('total',daily,'total').html,/>2,555</);
  console.log('rp-historical-channel-split: PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
