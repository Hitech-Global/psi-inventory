'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const installPOPlan=require('../po-plan-server.js');
const root=path.join(__dirname,'..');

function harness({quotes=[],skus=[]}={}){
  const handlers={},writes=[];
  let seq=0;
  const deps={
    app:{
      get:(route,...args)=>{handlers['GET '+route]=args.at(-1);},
      post:(route,...args)=>{handlers['POST '+route]=args.at(-1);},
      put:(route,...args)=>{handlers['PUT '+route]=args.at(-1);},
      delete:(route,...args)=>{handlers['DELETE '+route]=args.at(-1);}
    },
    query:(sql,args=[])=>{
      if(sql.includes('FROM quotation_prices')){
        const brand=String(args[0]||'').toLowerCase(),wanted=new Set(args.slice(1).map(x=>String(x).toUpperCase()));
        const rows=quotes.filter(q=>String(q.brand||'').toLowerCase()===brand&&wanted.has(String(q.sku_code||'').trim().toUpperCase()));
        rows.sort((a,b)=>String(b.quote_date||'').localeCompare(String(a.quote_date||''))||String(b.created_at||'').localeCompare(String(a.created_at||''))||String(b.id||'').localeCompare(String(a.id||'')));
        return {rows};
      }
      if(sql.includes('FROM skus')){
        const wanted=new Set(args.map(x=>String(x)));
        const col=sql.includes('purchase_price_usd')?'purchase_price_usd':'purchase_price_rmb';
        return {rows:skus.filter(s=>wanted.has(String(s.sku_code))).map(s=>({sku_code:s.sku_code,price:s[col]}))};
      }
      return {rows:[]};
    },
    queryOne:()=>null,
    run:(sql,args=[])=>{writes.push({sql,args});return{};},
    transaction:fn=>fn(),
    genId:prefix=>prefix+'-'+(++seq),
    asyncHandler:fn=>fn,
    requireApiPermission:()=>fn=>fn,
    updateInventoryTransitDataAsync:()=>Promise.resolve()
  };
  installPOPlan(deps);
  return {handlers,writes};
}
function response(){
  return {
    statusCode:200,body:null,
    status(code){this.statusCode=code;return this;},
    json(body){this.body=body;return this;}
  };
}
async function call(h,method,route,body){
  const res=response();
  await h.handlers[method+' '+route]({body,query:{},params:{}},res);
  return res;
}
const baseSkus=[
  {sku_code:'M724',purchase_price_rmb:70,purchase_price_usd:10},
  {sku_code:'M816',purchase_price_rmb:55,purchase_price_usd:8}
];
const quote=(sku,price,currency,date,id='q')=>({id,brand:'Netac',sku_code:sku,quote_price:price,currency,quote_date:date,created_at:date+'T00:00:00Z'});
const item=(sku,qty)=>({sku_code:sku,po_qty:qty});
const createBody=(extra={})=>({
  supplier_id:'supplier-1',supplier_name:'Netac',brand:'Netac',country:'Indonesia',
  target_warehouse:'Bekasi',po_date:'2026-11-05',currency:'RMB',
  items:[item('M724',2)],...extra
});

test('preview selects the latest dated FOB per brand+SKU and converts all quoted lines with one rate',async()=>{
  const h=harness({skus:baseSkus,quotes:[
    quote('M724',10,'USD','2026-09-01','old'),
    quote('M724',12.5,'USD','2026-10-01','new'),
    quote('M816',8,'USD','2026-10-15','other')
  ]});
  const res=await call(h,'POST','/api/po-plans/price-preview',{
    brand:'Netac',currency:'RMB',exchange_rate:6.7,items:[item('M724',2),item('M816',3)]
  });
  assert.equal(res.statusCode,200);
  assert.equal(res.body.quote_currency,'USD');
  assert.equal(res.body.exchange_rate,6.7);
  assert.equal(res.body.rows[0].quote_unit_price,12.5);
  assert.equal(res.body.rows[0].quote_date,'2026-10-01');
  assert.equal(res.body.rows[0].unit_price,83.75);
  assert.equal(res.body.rows[0].amount,167.5);
  assert.equal(res.body.rows[1].unit_price,53.6);
  assert.equal(res.body.total_amount,328.3);
  assert.equal(res.body.can_create,true);
});

test('mixed latest FOB currencies are reported and PO creation is blocked before any write',async()=>{
  const h=harness({skus:baseSkus,quotes:[
    quote('M724',12,'USD','2026-10-01'),
    quote('M816',80,'RMB','2026-10-02')
  ]});
  const preview=await call(h,'POST','/api/po-plans/price-preview',{
    brand:'Netac',currency:'RMB',exchange_rate:6.7,items:[item('M724',1),item('M816',1)]
  });
  assert.equal(preview.body.currency_mismatch,true);
  assert.equal(preview.body.can_create,false);
  assert.deepEqual(preview.body.quote_currencies,['RMB','USD']);
  const created=await call(h,'POST','/api/po-plans',createBody({
    quote_currency:'',exchange_rate:6.7,items:[item('M724',1),item('M816',1)]
  }));
  assert.equal(created.statusCode,409);
  assert.match(created.body.error,/币种不一致/);
  assert.equal(h.writes.length,0);
});

test('a latest no-quote record falls back to SKU master instead of reviving an older FOB price',async()=>{
  const h=harness({skus:baseSkus,quotes:[
    quote('M724',12,'USD','2026-09-01','old'),
    quote('M724',0,'USD','2026-10-30','latest-no-quote')
  ]});
  const res=await call(h,'POST','/api/po-plans/price-preview',{
    brand:'Netac',currency:'RMB',items:[item('M724',2)]
  });
  assert.equal(res.body.quote_currency,'');
  assert.equal(res.body.rows[0].price_source,'sku_master');
  assert.equal(res.body.rows[0].quote_unit_price,null);
  assert.equal(res.body.rows[0].unit_price,70);
  assert.equal(res.body.total_amount,140);
});

test('creating a PO locks source FOB, quote date, final unit price and the manual exchange rate',async()=>{
  const h=harness({skus:baseSkus,quotes:[quote('M724',12.5,'USD','2026-10-28','latest')]});
  const res=await call(h,'POST','/api/po-plans',createBody({quote_currency:'USD',exchange_rate:6.7}));
  assert.equal(res.statusCode,200);
  assert.equal(res.body.currency,'RMB');
  assert.equal(res.body.quote_currency,'USD');
  assert.equal(res.body.exchange_rate,6.7);
  const poInsert=h.writes.find(x=>x.sql.startsWith('INSERT INTO purchase_orders'));
  const itemInsert=h.writes.find(x=>x.sql.startsWith('INSERT INTO purchase_order_items'));
  const totalUpdate=h.writes.find(x=>x.sql.startsWith('UPDATE purchase_orders SET total_amount'));
  assert.ok(poInsert);assert.ok(itemInsert);assert.ok(totalUpdate);
  assert.equal(poInsert.args[9],'RMB');
  assert.equal(poInsert.args[17],'USD');
  assert.equal(poInsert.args[18],6.7);
  assert.equal(itemInsert.args[5],83.75);
  assert.equal(itemInsert.args[6],167.5);
  assert.equal(itemInsert.args[7],12.5);
  assert.equal(itemInsert.args[8],'USD');
  assert.equal(itemInsert.args[9],'2026-10-28');
  assert.equal(itemInsert.args[10],'quotation');
  assert.equal(totalUpdate.args[0],167.5);
});

test('a quoted PO with a different final currency cannot be created without a positive manual rate',async()=>{
  const h=harness({skus:baseSkus,quotes:[quote('M724',12.5,'USD','2026-10-28')]});
  const res=await call(h,'POST','/api/po-plans',createBody({quote_currency:'USD'}));
  assert.equal(res.statusCode,400);
  assert.match(res.body.error,/填写有效汇率/);
  assert.equal(h.writes.length,0);
});

test('no-quote PO creation preserves the original SKU-master price path',async()=>{
  const h=harness({skus:baseSkus,quotes:[]});
  const res=await call(h,'POST','/api/po-plans',createBody({quote_currency:'',exchange_rate:1}));
  assert.equal(res.statusCode,200);
  assert.equal(res.body.quote_currency,'');
  const itemInsert=h.writes.find(x=>x.sql.startsWith('INSERT INTO purchase_order_items'));
  assert.equal(itemInsert.args[5],70);
  assert.equal(itemInsert.args[6],140);
  assert.equal(itemInsert.args[7],null);
  assert.equal(itemInsert.args[8],'');
  assert.equal(itemInsert.args[10],'sku_master');
});

test('same-currency quotes need no manual rate and use a rate snapshot of one',async()=>{
  const h=harness({skus:baseSkus,quotes:[quote('M724',80,'RMB','2026-10-28')]});
  const res=await call(h,'POST','/api/po-plans',createBody({quote_currency:'RMB'}));
  assert.equal(res.statusCode,200);
  assert.equal(res.body.exchange_rate,1);
  const poInsert=h.writes.find(x=>x.sql.startsWith('INSERT INTO purchase_orders'));
  assert.equal(poInsert.args[18],1);
});


test('creation is blocked if a quote or SKU-master price changes after preview',async()=>{
  const quotes=[quote('M724',12.5,'USD','2026-10-28','latest')];
  const h=harness({skus:baseSkus,quotes});
  const preview=await call(h,'POST','/api/po-plans/price-preview',{
    brand:'Netac',currency:'RMB',items:[item('M724',2)]
  });
  assert.ok(preview.body.snapshot_key);
  quotes[0].quote_price=13;
  const res=await call(h,'POST','/api/po-plans',createBody({
    quote_currency:'USD',exchange_rate:6.7,price_snapshot_key:preview.body.snapshot_key
  }));
  assert.equal(res.statusCode,409);
  assert.match(res.body.error,/价格已更新/);
  assert.equal(h.writes.length,0);
});

test('PO creation UI exposes original/final FOB columns and blocks mixed quote currencies',()=>{
  const ui=fs.readFileSync(path.join(root,'po-plan-ui.js'),'utf8');
  const boot=fs.readFileSync(path.join(root,'scripts/po-plan-bootstrap.cjs'),'utf8');
  assert.match(ui,/\/api\/po-plans\/price-preview/);
  assert.match(ui,/FOB \('\+E\(quoteCurrency\)\+'\)/);
  assert.match(ui,/同一张PO的最新报价币种不一致/);
  assert.match(ui,/button\.disabled=mismatch\|\|!rateValid\|\|!rowsValid/);
  assert.match(boot,/ASSET_VERSION='20261105b'/);
});
