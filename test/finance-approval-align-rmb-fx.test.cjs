'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const app=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const start=app.indexOf('function renderPayFxDisplay(){'),end=app.indexOf('async function saveConfirmedPayment(',start);
assert(start>=0&&end>start,'real payment FX functions not found');
const code=app.slice(start,end);
function setup(fxResp={},from='IDR',amount=950000){
 const pay={value:String(amount)}, date={value:'2026-10-15'}, fx={style:{display:'none',background:''},innerHTML:''};
 const session={outstanding:950000,prId:'test-pr',paymentCategory:'freight',dateInputId:'pay-final-date',amountInputId:'pay-final-amount'};
 const el={'pay-fx-display':fx,'pay-final-amount':pay,'pay-final-date':date};
 const log=[];
 const ctx={window:{_finalPayCtx:session},document:{getElementById:id=>el[id]||null},fmtMoney:(a,c)=>String(c)+' '+Number(a).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}),esc:String,
  api:(url,method,body)=>{log.push({url,method,body});return Promise.resolve(fxResp);}};
 const impl=vm.runInNewContext(code+'\n({renderPayFxDisplay,onPayDateChanged})',ctx);
 return {ctx,fx,pay,date,session,log,impl};
}
test('IDR payout displays BOTH local IDR identity and precise RMB fx and amount',async()=>{
 const h=setup({rate:1,rate_date:'2026-10-15',source:'identity',direction:'identity',original_currency:'IDR',local_currency:'IDR',rmb_rate:0.000374500963,rmb_source:'db_direct'});
 await h.impl.onPayDateChanged();
 assert.equal(h.log.length,1);
 assert.match(h.fx.innerHTML,/付款本币：1 IDR = 1 IDR/);
 assert.match(h.fx.innerHTML,/1 RMB = 2,670.22 IDR/);
 assert.doesNotMatch(h.fx.innerHTML,/1 IDR = 0.000374500963 RMB/);
 assert.match(h.fx.innerHTML,/RMB 355.78/);
 assert.match(h.fx.innerHTML,/汇率日期：2026-10-15/);
 h.pay.value='500000';
 h.impl.renderPayFxDisplay();
 assert.match(h.fx.innerHTML,/RMB 187.25/);
 assert.match(h.fx.innerHTML,/IDR 500,000.00/);
});
test('RMB->IDR retains actual local settlement FX, does not duplicate identity RMB note',async()=>{
 const h=setup({rate:2670,rate_date:'2026-10-15',source:'db_direct',direction:'direct',original_currency:'RMB',local_currency:'IDR',rmb_rate:1,rmb_source:'identity'},'RMB',100);
 await h.impl.onPayDateChanged();
 assert.match(h.fx.innerHTML,/付款本币：1 RMB = 2,670 IDR/);
 assert.match(h.fx.innerHTML,/IDR 267,000.00/);
 assert.doesNotMatch(h.fx.innerHTML,/人民币折算（RMB 成本展示）/);
});
test('FX change recalculates, and a missing RMB rate is never labeled as identity',async()=>{
 const h=setup({rate:1,rate_date:'2026-10-15',source:'identity',direction:'identity',original_currency:'IDR',local_currency:'IDR'});
 await h.impl.onPayDateChanged();
 assert.match(h.fx.innerHTML,/人民币汇率未解析/);
 h.date.value='';
 await h.impl.onPayDateChanged();
 assert.equal(h.session.fxRate,null);
});
test('Finance approval list gets scoped left alignment even with translated template',()=>{
 const start=app.indexOf('async function loadFinanceApprovalList(){'),end=app.indexOf('function tabLabel(',start);
 assert(start>0&&end>start);
 const logic=app.slice(start,end);
 assert.match(logic,/financeTable\.classList\.add\('finance-approval-left'\)/);
 assert.match(html,/\.finance-approval-left th,\.finance-approval-left td\{text-align:left!important\}/);
 assert.match(logic,/class="text-right">总数量/);
 assert.match(logic,/class="text-right">应付金额/);
 assert(!html.includes('.data-table th,.data-table td{text-align:left!important}'),'not a global override');
});
