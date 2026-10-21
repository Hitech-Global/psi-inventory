'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
process.env.DB_DRIVER='sqlite';process.env.DB_PATH=':memory:';
const db=require('../db'),express=require('express');
const {installSharedLogisticsFeeRoutes,sharedWacParts,settledConversion,exactRate}=require('../shared-logistics-fee-server');
test('HIT20260901-1C: fully paid RMB snapshot is formal CI/WAC cost without independent exchange rate',async()=>{
 db.initDatabase();
 const ci='ci-auto-fx-1',pr='pay-auto-fx-1';
 db.run('INSERT INTO commercial_invoices(id,ci_no,ci_date,currency,country,goods_amount,cost_confirmed,wac_confirmed) VALUES (?,?,?,?,?,?,?,?)',
   [ci,'HIT20260901-1C','2026-09-01','RMB','印度尼西亚',276402.246,0,0]);
 const fees=[['b-auto-1','SZIS0013406',5864.5],['b-auto-2','SZIS0013407',9558.4],['b-auto-3','SZIS0013408',6180]];
 for(const [id,no,total] of fees)
   db.run('INSERT INTO logistics_batches(id,batch_no,related_ci_id,freight_currency,total_freight) VALUES (?,?,?,?,?)',
     [id,no,ci,'RMB',total]);
 db.run('INSERT INTO payment_requests(id,request_no,payment_category,payment_subcategory,source_type,source_id,source_no,currency,payable_amount,paid_amount,unpaid_amount,payment_status,approval_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
   [pr,'PAY-SHF-TEST','warehouse_arrival','delivery','shared_logistics','shared1','SHF-1','IDR',950000,950000,0,'paid','approved']);
 db.run('INSERT INTO shared_logistics_fees(id,ci_id,ci_no,bill_no,fee_type,payee_name,currency,amount_minor,payment_request_id) VALUES (?,?,?,?,?,?,?,?,?)',
   ['shared1',ci,'HIT20260901-1C','SHF-1','delivery','Forwarder','IDR',95000000,pr]);
 const part=[40000000,30000000,25000000];
 fees.forEach(([id],i)=>db.run('INSERT INTO shared_logistics_fee_batches(fee_id,batch_id,mode,basis,basis_value,amount_minor) VALUES (?,?,?,?,?,?)',
    ['shared1',id,'sea','cbm',1,part[i]]));
 db.run('INSERT INTO payment_settlement_logs(id,payment_request_id,event_type,status,amount,original_currency,local_amount,local_currency,local_rate_date,paid_date,local_rate,rmb_rate,rmb_rate_date,rmb_rate_direction,rmb_amount) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
   ['settle1',pr,'payment','applied',950000,'IDR',950000,'IDR','2026-10-13','2026-10-13',1,0.00037,'2026-10-13','direct',351.50]);
 db.run('INSERT INTO exchange_rates(id,from_currency,to_currency,rate,rate_date,rate_type) VALUES (?,?,?,?,?,?)',
   ['fxauto_2026-10-13_IDR_RMB_realtime','IDR','RMB',0.000370,'2026-10-13','realtime']);
 assert.equal(exactRate('IDR','RMB','2026-10-13'),null,'formal cost conversion must NOT use automatic reference');
 const locked=settledConversion(pr,95000000,'IDR','RMB');
 assert.equal(locked.amount_minor,35150);
 assert.equal(locked.source,'locked_payment_rmb_snapshot');
 const app=express();
 const pass=()=>((req,res,next)=>next());
 installSharedLogisticsFeeRoutes(app,{requireApiPermission:pass,requireCIAmountView:pass(),
  asyncHandler:fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next)});
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 try{
  const url='http://127.0.0.1:'+server.address().port;
  const result=await (await fetch(url+'/api/ci-freight-summaries?ids='+ci)).json();
  const obj=result[ci];
  assert.equal(obj.total_rmb,21954.4,'formal cost uses locked payment RMB snapshot');
  assert.equal(obj.freight_ratio,7.94);
  assert.equal(obj.reference_only,false);
  assert.equal(obj.reference_total_rmb,null);
  const detail=await (await fetch(url+'/api/commercial-invoices/'+ci+'/shared-logistics-fees')).json();
  assert.equal(detail.fees[0].conversion.amount_minor,35150);
  assert.equal(detail.fees[0].conversion.source,'locked_payment_rmb_snapshot');
  assert.equal(detail.fees[0].reference_conversion,null);
  const wac=sharedWacParts(fees[0][0],'RMB');
  assert.equal(wac.parts.length,1);
  assert.equal(wac.parts[0].amount_minor,Math.round(35150*40000000/95000000));
  assert.equal(wac.errors.length,0);
  db.run('INSERT INTO exchange_rates(id,from_currency,to_currency,rate,rate_date,rate_type) VALUES (?,?,?,?,?,?)',
   ['manual-confirmed-idr-rmb','IDR','RMB',0.000370,'2026-10-13','realtime']);
  const after=await (await fetch(url+'/api/ci-freight-summaries?ids='+ci)).json();
  assert.equal(after[ci].total_rmb,21954.4,'confirmed snapshot is stable after unrelated exchange rate change');
  assert.equal(after[ci].reference_only,false);
  assert.equal(after[ci].reference_total_rmb,null);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
test('frontend labels estimation only when payment RMB snapshot is absent',()=>{
 const ui=fs.readFileSync(path.join(__dirname,'..','assets/ci-list-freight.js'),'utf8');
 const app=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
 assert.match(ui,/reference_only&&Number\.isFinite/);
 assert.match(ui,/（参考）/);
 assert.match(ui,/不参与CI正式成本、WAC或已确认运费/);
 assert.match(app,/待财务确认/);
 const src=fs.readFileSync(path.join(__dirname,'..','shared-logistics-fee-server.js'),'utf8');
 assert.match(src,/function sharedWacParts[\s\S]*?settledConversion\(fee\.payment_request_id,Number\(fee\.amount_minor\),fee\.currency,targetCurrency,true\)/);
});
