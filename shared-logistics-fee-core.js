'use strict';
/** Shared logistics bill allocation. Pure, minor-unit arithmetic, no DB mutations. */
const MODES = Object.freeze({ sea:'cbm', air:'gross_weight' });
function minor(amount) {
  const n=Number(amount);
  if (!Number.isFinite(n)||n<=0||Math.abs(n*100-Math.round(n*100))>0.00001)
    throw new Error('费用金额必须为正数，且最多两位小数');
  const value=Math.round(n*100);
  if(!Number.isSafeInteger(value))throw new Error('费用金额超过安全整数范围');
  return value;
}
function splitMinor(total,rows) {
  if (!Number.isSafeInteger(total)||total<=0) throw new Error('费用分摊总额无效');
  const denominator=rows.reduce((s,r)=>s+r.weight,0);
  if (!(denominator>0)) throw new Error('运输计费基础为0，不能分摊');
  const out=rows.map(r=>({...r,amount_minor:Math.floor(total*r.weight/denominator)}));
  const remain=total-out.reduce((s,r)=>s+r.amount_minor,0);
  // Deterministic residual to max-weight batch; stable by batch ID.
  const anchor=out.slice().sort((a,b)=>b.weight-a.weight||a.batch_id.localeCompare(b.batch_id))[0];
  anchor.amount_minor+=remain;
  if(out.some(r=>r.amount_minor<0)||out.reduce((s,r)=>s+r.amount_minor,0)!==total)
    throw new Error('费用分摊不守恒');
  return out;
}
function allocateSharedFee(input,batches) {
  const currency=String(input.currency||'').trim().toUpperCase();
  if(!/^[A-Z]{3}$/.test(currency)) throw new Error('费用币种必须为三位ISO代码');
  if(!Array.isArray(batches)||batches.length<2) throw new Error('合并费用至少关联两个物流批次');
  if(new Set(batches.map(b=>b.id)).size!==batches.length) throw new Error('物流批次重复');
  const amount_minor=minor(input.amount);
  const byMode={};
  for(const b of batches){
    const mode=String(b.transport_mode||'').toLowerCase();
    const basis=MODES[mode];
    if(!basis) throw new Error('合并费用暂只支持海运和空运批次');
    const weight=Number(b[basis]);
    if(!Number.isFinite(weight)||weight<=0) throw new Error((b.batch_no||b.id)+' 缺少有效'+(mode==='sea'?'CBM':'KG')+'数据');
    (byMode[mode]||(byMode[mode]=[])).push({batch_id:b.id,mode,basis,weight});
  }
  const modes=Object.keys(byMode).sort();
  let modeMinors={};
  if(modes.length===1) modeMinors[modes[0]]=amount_minor;
  else {
    if(!input.mode_amounts||typeof input.mode_amounts!=='object')
      throw new Error('合并费用同时包含海运和空运，需分别明确两个运输方式的费用金额');
    modes.forEach(m=>{modeMinors[m]=minor(input.mode_amounts[m]);});
    if(Object.values(modeMinors).reduce((s,v)=>s+v,0)!==amount_minor)
      throw new Error('海空费用拆分合计必须等于原始账单金额');
  }
  const allocations=modes.flatMap(m=>splitMinor(modeMinors[m],byMode[m]));
  if(allocations.reduce((s,r)=>s+r.amount_minor,0)!==amount_minor)
    throw new Error('批次分摊金额不守恒');
  return {currency,amount_minor,allocations};
}
function splitConvertedMinor(total,allocations) {
  // Reallocate converted amount in minor units from immutable original shares.
  const sum=allocations.reduce((s,a)=>s+Number(a.amount_minor),0);
  if(sum<=0||!Number.isSafeInteger(total)||total<0) throw new Error('折算金额无效');
  const rows=allocations.map(a=>({batch_id:a.batch_id,mode:a.mode,basis:a.basis,basis_value:Number(a.basis_value),weight:Number(a.amount_minor)}));
  return splitMinor(total,rows);
}
module.exports={MODES,minor,splitMinor,allocateSharedFee,splitConvertedMinor};
