'use strict';
// One combined logistics bill; one financial request; independently allocated batch shares.
const {allocateSharedFee}=require('./shared-logistics-fee-core');
const {query,queryOne,run,transaction}=require('./db');
const minor=n=>Math.round(Number(n)*100);
const normalize=c=>String(c||'').toUpperCase()==='CNY'?'RMB':String(c||'').toUpperCase();
const validCurrency=c=>/^[A-Z]{3}$/.test(c);
function exactRate(from,to,date) {
  from=normalize(from);to=normalize(to);
  if(from===to)return {rate:1,date,source:'identity'};
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date||''))return null;
  for(const args of [[from,to,false],[to,from,true]]) {
    const r=queryOne("SELECT rate,rate_date,id FROM exchange_rates WHERE from_currency=? AND to_currency=? AND rate_date=? AND rate_type='realtime' AND id NOT LIKE 'fxauto_%' ORDER BY created_at DESC,id DESC LIMIT 1",[args[0],args[1],date]);
    if(r&&Number(r.rate)>0) return {rate:args[2]?1/Number(r.rate):Number(r.rate),date,source:'realtime',rate_id:r.id};
  }
  return null;
}
// Automatic realtime quotes are admissible for *display-only* estimates, not
// as evidence of formally confirmed freight / WAC costs.
function referenceRate(from,to,date) {
  const strict=exactRate(from,to,date);
  if(strict)return strict;
  from=normalize(from);to=normalize(to);
  if(!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date||''))return null;
  for(const args of [[from,to,false],[to,from,true]]){
    const r=queryOne("SELECT rate,id FROM exchange_rates WHERE from_currency=? AND to_currency=? AND rate_date=? AND rate_type='realtime' AND id LIKE 'fxauto_%' ORDER BY created_at DESC,id DESC LIMIT 1",
      [args[0],args[1],date]);
    if(r&&Number(r.rate)>0)return {rate:args[2]?1/Number(r.rate):Number(r.rate),
      date,source:'auto_reference_only',rate_id:r.id};
  }
  return null;
}
function settledConversion(requestId,amountMinor,sourceCurrency,targetCurrency,requirePayment=false,referenceOnly=false){
  sourceCurrency=normalize(sourceCurrency);targetCurrency=normalize(targetCurrency);
  if(!validCurrency(sourceCurrency)||!validCurrency(targetCurrency))return {error:'币种代码无效'};
  if(sourceCurrency===targetCurrency&&!requirePayment)return {amount_minor:amountMinor,source:'face_currency'};
  if(!requestId)return {error:'缺少付款关联'};
  const payment=queryOne('SELECT approval_status,payment_status FROM payment_requests WHERE id=?',[requestId]);
  if(!payment||payment.approval_status!=='approved'||
     ['cancelled','rejected','reversed','pending_approval'].includes(payment.payment_status))
    return {error:'付款申请未审批通过、已撤销或已冲销，禁止确认成本'};
  if(payment.payment_status!=='paid')
    return {error:'付款申请尚未全部付款，禁止确认成本'};
  const rows=query("SELECT amount,original_currency,local_amount,local_currency,local_rate,local_rate_date,paid_date,rmb_rate,rmb_rate_date,rmb_rate_direction,rmb_amount FROM payment_settlement_logs WHERE payment_request_id=? AND event_type='payment' AND status='applied' AND COALESCE(reversed_at,'')='' ORDER BY paid_date,id",[requestId]).rows;
  if(!rows.length)return {error:'跨币种费用尚未实际结算'};
  if(Math.abs(rows.reduce((a,r)=>a+minor(r.amount||0),0)-amountMinor)>1)return {error:'实付金额尚未结清或存在超付'};
  let total=0,fx=[];
  for(const log of rows) {
    // Confirmed RMB cost comes from the IMMUTABLE snapshot written together
    // with the actual payment, not from exchange_rates (which can change).
    // The referenceOnly path intentionally retains the legacy auto-quote preview.
    if(targetCurrency==='RMB'&&!referenceOnly){
      const paidDate=String(log.paid_date||'').slice(0,10);
      const date=String(log.rmb_rate_date||'').slice(0,10);
      const rate=Number(log.rmb_rate),rmb=Number(log.rmb_amount);
      const amount=Number(log.amount),original=normalize(log.original_currency);
      if(!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(paidDate)||
        !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)||date>paidDate||!Number.isFinite(rate)||rate<=0||
        log.rmb_amount==null||!Number.isFinite(rmb)||rmb<0||
        !Number.isFinite(amount)||amount<=0)
          return {error:'已付款记录缺少有效的付款日锁定RMB汇率或金额快照'};
      if(original&&original!==sourceCurrency)
        return {error:'付款记录原币种与合并运费币种不一致'};
      if(Math.abs(amount*rate-rmb)>0.02)
        return {error:'付款RMB金额与锁定汇率快照不一致'};
      total+=rmb;
      fx.push({from:sourceCurrency,to:'RMB',rate,rate_date:date,
        snapshot:'payment_settlement_logs',original_amount:amount,rmb_amount:rmb});
      continue;
    }
    const cur=normalize(log.local_currency),amt=Number(log.local_amount);
    const date=String(log.local_rate_date||'').slice(0,10);
    if(!validCurrency(cur)||!Number.isFinite(amt)||amt<=0||!(Number(log.local_rate)>0)||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date))return {error:'付款本币金额/汇率/汇率日期快照缺失'};
    const snap=referenceOnly?referenceRate(cur,targetCurrency,date):exactRate(cur,targetCurrency,date);
    if(!snap)return {error:date+' 缺少 '+cur+'→'+targetCurrency+' 同日汇率'};
    total+=amt*snap.rate;
    fx.push({from:cur,to:targetCurrency,rate:snap.rate,rate_date:date,rate_id:snap.rate_id,local_amount:amt});
  }
  return {amount_minor:Math.round(total*100),
    source:targetCurrency==='RMB'&&!referenceOnly?'locked_payment_rmb_snapshot':
      referenceOnly?'reference_only':'applied_settlements',
    reference_only:referenceOnly,fx};
}
function referenceConversion(requestId,amountMinor,sourceCurrency,targetCurrency){
  return settledConversion(requestId,amountMinor,sourceCurrency,targetCurrency,true,true);
}
function loadForCI(ciId){
  const fees=query('SELECT sf.*,pr.approval_status,pr.payment_status FROM shared_logistics_fees sf LEFT JOIN payment_requests pr ON pr.id=sf.payment_request_id WHERE sf.ci_id=? ORDER BY sf.created_at,sf.id',[ciId]).rows;
  for(const fee of fees)fee.allocations=query('SELECT sfb.*,lb.batch_no FROM shared_logistics_fee_batches sfb JOIN logistics_batches lb ON lb.id=sfb.batch_id WHERE sfb.fee_id=? ORDER BY lb.batch_no',[fee.id]).rows;
  return fees;
}
function sharedFeesForCost(ci,targetCurrency,requirePayment=false){
  return loadForCI(ci.id).map(f=>{
    const conversion=settledConversion(f.payment_request_id,Number(f.amount_minor),f.currency,targetCurrency,requirePayment);
    const reference_conversion=conversion.error?
      referenceConversion(f.payment_request_id,Number(f.amount_minor),f.currency,targetCurrency):null;
    return {...f,conversion,reference_conversion};
  });
}
function resolveSharedFeeForwarder(batches){
  if(!Array.isArray(batches)||batches.length<2)throw Object.assign(new Error('至少选择两个物流批次'),{status:400});
  const entries=batches.map(b=>({
    id:String(b.forwarder_id||'').trim(),
    name:String(b.forwarder_name||'').trim()
  }));
  if(entries.some(x=>!x.name))throw Object.assign(new Error('所选物流批次缺少货代，请先在物流批次中维护货代'),{status:400});
  const known=entries.every(x=>x.id),none=entries.every(x=>!x.id);
  if(!known&&!none)throw Object.assign(new Error('物流批次货代ID不完整，请先统一货代资料'),{status:400});
  const unique=new Set(entries.map(x=>known?x.id:x.name));
  if(unique.size!==1)throw Object.assign(new Error('不同货代的物流批次不能合并派送费，请分开创建'),{status:409});
  return entries[0].name;
}
function batchesForCI(ciId,ids){
  const p=ids.map(()=>'?').join(',');
  return query('SELECT lb.id,lb.batch_no,lb.related_ci_id,lb.transport_mode,lb.forwarder_id,lb.forwarder_name,COALESCE(SUM(pli.cbm),0) AS cbm,COALESCE(SUM(pli.gross_weight),0) AS gross_weight FROM logistics_batches lb LEFT JOIN packing_lists pl ON pl.logistics_batch_id=lb.id LEFT JOIN packing_list_items pli ON pli.pl_id=pl.id WHERE lb.id IN ('+p+') GROUP BY lb.id,lb.batch_no,lb.related_ci_id,lb.transport_mode,lb.forwarder_id,lb.forwarder_name',ids).rows.filter(x=>String(x.related_ci_id)===String(ciId));
}
function ownFreightInRmb(batch){
  const amt=Number(batch.total_freight)||0;
  if(!(amt>0))return {amount_minor:0};
  const cur=normalize(batch.freight_currency||'USD');
  if(cur==='RMB')return {amount_minor:minor(amt)};
  const item=queryOne("SELECT payment_request_id,payable_item_id FROM ci_cost_items WHERE logistics_batch_id=? AND cost_category='warehouse_arrival' AND cost_subcategory='freight' AND include_in_landing_cost=1 ORDER BY created_at DESC LIMIT 1",[batch.id]);
  let requestId=item&&item.payment_request_id||'';
  if(!requestId&&item&&item.payable_item_id){
    const linked=queryOne("SELECT pri.payment_request_id AS id FROM payment_request_items pri JOIN payment_requests p ON p.id=pri.payment_request_id WHERE pri.payable_item_id=? AND p.payment_status NOT IN ('cancelled','rejected') ORDER BY p.created_at DESC LIMIT 1",[item.payable_item_id]);
    requestId=linked&&linked.id||'';
  }
  return settledConversion(requestId,minor(amt),cur,'RMB');
}
function installSharedLogisticsFeeRoutes(app,ctx) {
  const {requireApiPermission,requireCIAmountView,asyncHandler,genId,createApprovalInstance,sourceExpenseCountry}=ctx;
  app.get('/api/commercial-invoices/:id/shared-logistics-fees',requireApiPermission('ci_view'),requireCIAmountView,asyncHandler((req,res)=>{
    const ci=queryOne('SELECT * FROM commercial_invoices WHERE id=?',[req.params.id]);
    if(!ci)return res.status(404).json({error:'CI不存在'});
    const fees=sharedFeesForCost(ci,'RMB');
    const batches=query('SELECT id,total_freight,freight_currency FROM logistics_batches WHERE related_ci_id=?',[ci.id]).rows;
    const batch_totals_rmb={};
    batches.forEach(b=>{
      const own=ownFreightInRmb(b);
      batch_totals_rmb[b.id]={total_minor:own.error?null:Number(own.amount_minor),errors:own.error?[own.error]:[]};
    });
    const {splitConvertedMinor}=require('./shared-logistics-fee-core');
    fees.forEach(f=>{
      const converted=f.conversion;
      if(converted.error){
        f.allocations.forEach(a=>{const b=batch_totals_rmb[a.batch_id];if(b){b.errors.push(f.bill_no+': '+converted.error);b.total_minor=null;}});
        return;
      }
      for(const part of splitConvertedMinor(Number(converted.amount_minor),f.allocations)){
        const b=batch_totals_rmb[part.batch_id];
        if(!b)continue;
        if(b.total_minor!==null)b.total_minor+=part.amount_minor;
      }
    });
    const availableCurrencies=query("SELECT code FROM currencies WHERE status='active' ORDER BY sort_order,code").rows
      .map(c=>normalize(c.code)).filter(validCurrency);
    res.json({ci_currency:ci.currency,fees,batch_totals_rmb,currency_options:[...new Set(availableCurrencies)]});
  }));
  // CI list RMB freight = sum of distinct batch freight plus actual shared bill ONCE.
  // Unknown FX is shown as pending, never added as if it were RMB.
  app.get('/api/ci-freight-summaries',requireApiPermission('ci_view'),requireCIAmountView,asyncHandler((req,res)=>{
    const ids=String(req.query.ids||'').split(',').filter(Boolean);
    if(!ids.length||ids.length>200||ids.some(x=>!/^[a-zA-Z0-9_-]{1,100}$/.test(x)))
      return res.status(400).json({error:'请提供1至200个CI ID'});
    const ciRows=query('SELECT id,ci_no,currency,goods_amount FROM commercial_invoices WHERE id IN ('+ids.map(()=>'?').join(',')+')',ids).rows;
    const batchRows=query('SELECT id,related_ci_id,total_freight,freight_currency FROM logistics_batches WHERE related_ci_id IN ('+ids.map(()=>'?').join(',')+')',ids).rows;
    const sharedIds=new Set(query('SELECT ci_id FROM shared_logistics_fees WHERE ci_id IN ('+ids.map(()=>'?').join(',')+') GROUP BY ci_id',ids).rows.map(r=>String(r.ci_id)));
    const result={};
    for(const ci of ciRows) {
      if(!sharedIds.has(String(ci.id))){result[ci.id]={has_shared:false};continue;}
      let totalMinor=0,referenceMinor=0,errors=[],referenceErrors=[],hasBatch=false;
      const own=batchRows.filter(b=>String(b.related_ci_id)===String(ci.id));
      for(const b of own) {
        hasBatch=true;
        const cv=ownFreightInRmb(b);
        if(cv.error){errors.push(b.id+': '+cv.error);referenceErrors.push(b.id+': '+cv.error);}
        else{totalMinor+=cv.amount_minor;referenceMinor+=cv.amount_minor;}
      }
      for(const fee of sharedFeesForCost(ci,'RMB')) {
        hasBatch=true;
        if(fee.conversion.error){
          errors.push(fee.bill_no+': '+fee.conversion.error);
          if(fee.reference_conversion&&!fee.reference_conversion.error)
            referenceMinor+=Number(fee.reference_conversion.amount_minor);
          else referenceErrors.push(fee.bill_no+': '+(fee.reference_conversion?.error||'无可用参考汇率'));
        }else{
          const value=Number(fee.conversion.amount_minor);
          totalMinor+=value;referenceMinor+=value;
        }
      }
      const goods=Number(ci.goods_amount)||0;
      result[ci.id]={currency:'RMB',has_shared:true,has_batch:hasBatch,
        total_rmb:errors.length?null:totalMinor/100,
        freight_ratio:errors.length||normalize(ci.currency)!=='RMB'||goods<=0?null:Number((totalMinor/100/goods*100).toFixed(2)),
        // Never represent reference as a confirmed cost. WAC and cost APIs
        // continue to use strict `total_rmb` only.
        reference_total_rmb:errors.length&&!referenceErrors.length?referenceMinor/100:null,
        reference_freight_ratio:errors.length&&!referenceErrors.length&&normalize(ci.currency)==='RMB'&&goods>0?
          Number((referenceMinor/100/goods*100).toFixed(2)):null,
        reference_only:errors.length>0&&!referenceErrors.length,
        errors:errors};
    }
    res.json(result);
  }));

  app.post('/api/commercial-invoices/:id/shared-logistics-fees',requireApiPermission('ci_edit'),requireApiPermission('payment_create'),requireCIAmountView,asyncHandler(async(req,res)=>{
    try{
      const ci=queryOne('SELECT * FROM commercial_invoices WHERE id=?',[req.params.id]);
      if(!ci)return res.status(404).json({error:'CI不存在'});
      if(ci.cost_confirmed||ci.cost_allocated||ci.wac_confirmed)return res.status(409).json({error:'CI成本已确认/分摊或WAC已确认，禁止新增费用'});
      const d=req.body||{},ids=Array.isArray(d.batch_ids)?d.batch_ids.map(String):[];
      if(ids.length<2||ids.length>50||new Set(ids).size!==ids.length)return res.status(400).json({error:'请选择2到50个不同批次'});
      const batches=batchesForCI(ci.id,ids);
      if(batches.length!==ids.length)return res.status(400).json({error:'存在不属于该CI的物流批次'});
      // Use only batch master data as the payment payee; ignore untrusted client payee.
      const payee=resolveSharedFeeForwarder(batches);
      const key=String(d.request_key||'').trim();
      if(key&&!/^[a-zA-Z0-9-]{12,80}$/.test(key))return res.status(400).json({error:'请求标识无效'});
      // bill_no remains internal for audit/UNIQUE( ci_id, bill_no ); no longer collected in UI.
      // Legacy API clients may still supply a bill_no, but cannot set the payee.
      const id=genId('shfee');
      const billNo=key?'SHF-'+key:(String(d.bill_no||'').trim()||'SHF-'+id);
      if(billNo.length>120)return res.status(400).json({error:'内部业务标识过长'});
      const confirmed=queryOne('SELECT logistics_batch_id FROM wac_history WHERE logistics_batch_id IN ('+ids.map(()=>'?').join(',')+') LIMIT 1',ids);
      if(confirmed)return res.status(409).json({error:'参与的批次已有WAC确认记录，禁止追加入库成本；请使用正式成本调整流程'});
      const calc=allocateSharedFee(d,batches),cur=normalize(calc.currency);
      const activeCurrency=queryOne("SELECT code FROM currencies WHERE code=? AND status='active' LIMIT 1",[cur]);
      if(!activeCurrency)return res.status(400).json({error:'费用币种 '+cur+' 未在系统中启用，请先到币种设置启用'});
      const prior=queryOne('SELECT id FROM shared_logistics_fees WHERE ci_id=? AND bill_no=?',[ci.id,billNo]);
      if(prior)return res.status(409).json({error:key?'这笔合并派送费已创建，请到付款申请列表核对':'货代账单号重复',shared_fee_id:prior.id});
      const payId=genId('pay'),payNo='PAY-SHF-'+Date.now().toString(36)+'-'+payId.slice(-8);
      const value=calc.amount_minor/100,country=sourceExpenseCountry(ci.country,'CI '+ci.ci_no);
      transaction(()=>{
        run('INSERT INTO shared_logistics_fees (id,ci_id,ci_no,bill_no,fee_type,payee_name,currency,amount_minor,payment_request_id,remark) VALUES (?,?,?,?,?,?,?,?,?,?)',[id,ci.id,ci.ci_no,billNo,'delivery',payee,cur,calc.amount_minor,payId,String(d.remark||'')]);
        calc.allocations.forEach(a=>run('INSERT INTO shared_logistics_fee_batches (fee_id,batch_id,mode,basis,basis_value,amount_minor) VALUES (?,?,?,?,?,?)',[id,a.batch_id,a.mode,a.basis,a.weight,a.amount_minor]));
        const payableId=genId('payitem'),payableNo='PAY-ITEM-SHF-'+payableId;
        // PAY-CORE canonical payable ledger: one invoice means ONE payable_items fact.
        // One payment_request_items row reserves it, so approval, rejection, partial/full
        // payment and reconciled allocations follow the existing PAY-CORE lifecycle.
        run('INSERT INTO payable_items (id,fee_no,source_type,source_id,source_no,source_ci_id,fee_type,category_code,subcategory_code,payee_type,payee_key,payee_name_snapshot,payer_entity_key,payer_name_snapshot,currency,payable_amount_minor,is_active,lifecycle_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          [payableId,payableNo,'shared_logistics',id,billNo,ci.id,'delivery','warehouse_arrival','delivery','service_provider','service_provider:'+payee,payee,'self','',cur,calc.amount_minor,1,'reserved']);
        run('INSERT INTO payment_requests (id,request_no,payment_category,payment_subcategory,source_type,source_id,source_no,payee_type,payee_key,payee_name_snapshot,supplier_name,payable_amount,paid_amount,unpaid_amount,currency,payment_status,approval_status,remark,has_deduction,deduction_amount,actual_pay_amount,related_ci_id,related_ci_no,related_po_no,include_in_landing_cost,expense_country) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          [payId,payNo,'warehouse_arrival','delivery','shared_logistics',id,billNo,'service_provider','service_provider:'+payee,payee,payee,value,0,value,cur,'pending_approval','pending','合并派送 '+billNo+' '+String(d.remark||''),0,0,value,ci.id,ci.ci_no,ci.related_po_no||'',1,country]);
        run('INSERT INTO payment_request_items (id,payment_request_id,payable_item_id,requested_amount_minor) VALUES (?,?,?,?)',
          [genId('pri'),payId,payableId,calc.amount_minor]);
      });
      let approval={auto_submitted:true};
      try{
        const pr=queryOne('SELECT * FROM payment_requests WHERE id=?',[payId]);
        const result=await createApprovalInstance(payId,pr,req);
        approval.approval_id=result.approvalId;
      }catch(e){approval={auto_submitted:false,approval_error:e.message};}
      res.json({id,payment_request_id:payId,payment_request_no:payNo,currency:cur,amount:value,allocations:calc.allocations,...approval});
    }catch(e){
      if(/UNIQUE|unique constraint/i.test(String(e.message||'')))return res.status(409).json({error:'合并派送费申请已存在或付款关联重复，请核对付款申请'});
      return res.status(e.status||400).json({error:e.message||'创建合并费用失败'});
    }
  }));
}
function sharedWacParts(batchId,targetCurrency){
  const {splitConvertedMinor}=require('./shared-logistics-fee-core');
  const rows=query('SELECT sf.* FROM shared_logistics_fees sf JOIN shared_logistics_fee_batches sb ON sb.fee_id=sf.id WHERE sb.batch_id=?',[batchId]).rows;
  const out=[],errors=[];
  rows.forEach(fee=>{
    const conversion=settledConversion(fee.payment_request_id,Number(fee.amount_minor),fee.currency,targetCurrency,true);
    if(conversion.error){errors.push({code:'SHARED_FREIGHT_FX_OR_PAYMENT_MISSING',message:'合并账单 '+fee.bill_no+': '+conversion.error});return;}
    const allocations=query('SELECT * FROM shared_logistics_fee_batches WHERE fee_id=?',[fee.id]).rows;
    const batches=splitConvertedMinor(Number(conversion.amount_minor),allocations);
    const part=batches.find(p=>String(p.batch_id)===String(batchId));
    if(!part){errors.push({code:'SHARED_FREIGHT_BATCH_LINK_MISSING',message:'合并账单 '+fee.bill_no+' 缺少关联批次'});return;}
    const lastPaidDate=(conversion.fx||[]).reduce((m,r)=>r.rate_date>m?r.rate_date:m,'');
    out.push({fee_id:fee.id,bill_no:fee.bill_no,amount_minor:part.amount_minor,basis:part.basis,basis_value:part.basis_value,last_paid_date:lastPaidDate});
  });
  return {parts:out,errors};
}

module.exports={installSharedLogisticsFeeRoutes,sharedFeesForCost,settledConversion,exactRate,loadForCI,batchesForCI,sharedWacParts};
