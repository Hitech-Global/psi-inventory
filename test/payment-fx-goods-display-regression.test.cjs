'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const app=fs.readFileSync(path.join(root,'app.js'),'utf8'),server=fs.readFileSync(path.join(root,'server.js'),'utf8');
function extract(src,start,end){const i=src.indexOf(start),j=src.indexOf(end,i);assert(i>=0&&j>i,start);return src.slice(i,j);}
const frontend=extract(app,'function renderPayFxDisplay(){','async function saveConfirmedPayment(id){');
function setup(category='goods',fetchResult={}){
 const el={ 'pay-fx-display':{style:{display:'none'},innerHTML:''},
   'pay-final-date':{value:'2026-10-13'},'pay-final-amount':{value:'42976.83'} };
 const ctx={window:{_finalPayCtx:{outstanding:42976.83,prId:'goods1',paymentCategory:category,dateInputId:'pay-final-date',amountInputId:'pay-final-amount'}},
   document:{getElementById:id=>el[id]||null},fmtMoney:(v,c)=>c+' '+Number(v).toFixed(2),esc:v=>String(v),
   api:async(url,method,data)=>{ctx.calls.push({url,method,data});return fetchResult},calls:[]};
 vm.createContext(ctx);vm.runInContext(frontend,ctx);return {ctx,el};
}
test('goods approvals show exact-day reference rate in preferred RMB->IDR direction',async()=>{
 const x=setup('goods',{rate:2700,rate_date:'2026-10-13',source:'db_direct',direction:'direct',
   local_currency:'IDR',original_currency:'RMB',rmb_rate:1,rmb_source:'identity',reference_only:true});
 await x.ctx.onPayDateChanged();
 assert.equal(x.ctx.calls.length,1,'goods must query the rate just like expenses');
 assert.equal(x.ctx.calls[0].data.rate_date,'2026-10-13');
 assert.match(x.el['pay-fx-display'].innerHTML,/付款日汇率（仅供参考）/);
 assert.match(x.el['pay-fx-display'].innerHTML,/1 RMB = 2,700 IDR/);
 assert.match(x.el['pay-fx-display'].innerHTML,/不改变实际付款金额、货款结算或WAC/);
 assert.equal(x.el['pay-fx-display'].style.display,'block');
});
test('goods missing FX yields a clear error, does not hide or force an approval blocker',async()=>{
 const x=setup('goods');x.ctx.api=async()=>{throw Error('缺少2026-10-13 RMB→IDR参考汇率')};
 await x.ctx.onPayDateChanged();
 assert.match(x.el['pay-fx-display'].innerHTML,/汇率缺失/);
 assert.match(x.el['pay-fx-display'].innerHTML,/缺少2026-10-13/);
});
test('changing date fetches new rate; old async response cannot overwrite new date',async()=>{
 const x=setup('goods',{rate:2700,rate_date:'2026-10-13',original_currency:'RMB',local_currency:'IDR',rmb_rate:1});
 let resolveOld;
 x.ctx.api=()=>new Promise(r=>{resolveOld=r});
 const work=x.ctx.onPayDateChanged();
 x.el['pay-final-date'].value='2026-10-20';
 resolveOld({rate:2700,rate_date:'2026-10-13',original_currency:'RMB',local_currency:'IDR',rmb_rate:1});
 await work;
 assert.equal(x.ctx.window._finalPayCtx.fxRate,null);
});
test('goods category still uses original no-FX ledger snapshots and approval safety rules',()=>{
 assert.match(server,/function buildPaymentRateSnapshot\(payment, amount, paidDate\) \{\s*if \(payment.payment_category === 'goods'\)/);
 assert.match(server,/if \(payment.payment_category !== 'goods'\) \{/);
 const route=extract(server,"app.post('/api/payment-requests/:id/payment-fx/resolve'","// 撤回事务内严格顺序");
 assert.doesNotMatch(route,/skip: true|goods_payment/);
 assert.match(route,/reference_only: payment.payment_category === 'goods'/);
});
test('finance approval and standalone pay confirmation trigger FX for goods',()=>{
 assert.match(app,/if\(paymentFormHtml\)\{ setTimeout\(function\(\)\{ onPayDateChanged\(\); \}, 0\); \}/);
 assert.match(app,/window\._finalPayCtx=\{outstanding:Number\(p.outstanding\|\|0\)[\s\S]{0,280}setTimeout\(function\(\)\{onPayDateChanged\(\);\},0\)/);
});

test('server goods FX preview is read-only payment-wise and returns a dated RMB/IDR quote',async()=>{
 const snippet=extract(server,"app.post('/api/payment-requests/:id/payment-fx/resolve'","// 撤回事务内严格顺序");
 let handler=null,fxCalls=[],writes=0;
 const payment={id:'goods1',request_no:'PAY-GOODS-TEST',payment_category:'goods',
   currency:'RMB',expense_country:'印度尼西亚',payable_amount:42976.83};
 const ctx={app:{post(url,_auth,fn){assert.equal(url,'/api/payment-requests/:id/payment-fx/resolve');handler=fn;}},
   requireApiPermission:()=>()=>{},asyncHandler:fn=>fn,
   isValidRateDate:date=>/^2026-10-13$/.test(date),
   queryOne:async()=>payment,
   resolveSettlementCountry:()=>({name:'印度尼西亚',currency:'IDR'}),
   resolvePaymentFxRate:async(req)=>{fxCalls.push(req);return {rate:2700,rate_date:req.rateDate,source:'db_direct',direction:'direct'};},
   run(){writes++;}};
 vm.runInNewContext(snippet,ctx);
 let status=200,payload;
 await handler({params:{id:'goods1'},body:{rate_date:'2026-10-13'}},{
   status(v){status=v;return this;},json(v){payload=v;return this;}
 });
 assert.equal(status,200);assert.equal(payload.reference_only,true);
 assert.equal(payload.rate,2700);assert.equal(payload.original_currency,'RMB');
 assert.equal(payload.local_currency,'IDR');assert.equal(payload.rmb_rate,1);
 assert.equal(fxCalls.length,1);assert.equal(writes,0);
});
