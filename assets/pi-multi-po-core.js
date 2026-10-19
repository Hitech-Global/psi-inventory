'use strict';
// PI-MULTI-PO: one PI SKU line, many source PO allocations; all changes happen
// inside the caller's transaction, never inferred from header.related_po_id.
function parseRelatedIds(value,legacy){
 let ids=[];
 if(Array.isArray(value))ids=value;
 else if(typeof value==='string'&&value.trim()){try{ids=JSON.parse(value);}catch(e){throw Error('关联PO列表格式无效');}}
 else if(legacy)ids=[legacy];
 if(!Array.isArray(ids)||ids.some(x=>typeof x!=='string'||!x.trim()))throw Error('关联PO必须是PO ID数组');
 const unique=ids.map(x=>x.trim());
 if(new Set(unique).size!==unique.length)throw Error('关联PO不可重复选择');
 if(unique.length>50)throw Error('单张PI最多关联50张PO');
 return unique;
}
function norm(x){return String(x||'').trim().toLocaleLowerCase();}
function validatePOs(ids,form,queryOne,{allowFullyTransferred=false}={}){
 if(!ids.length)return [];
 const poRows=ids.map(id=>{
   const po=queryOne('SELECT * FROM purchase_orders WHERE id = ?',[id]);
   if(!po)throw Error('关联PO不存在：'+id);
   // PI association is independent from PO approval. A rejected or voided
   // plan is invalid, but draft / pending-approval plans are allowed.
   if(['cancelled','rejected'].includes(po.po_status)||po.approval_status==='rejected')
     throw Error('已作废或已驳回的PO不可关联PI：'+po.po_no);
   if(po.po_status==='transferred_pi'&&!allowFullyTransferred)
     throw Error('该PO已全部转PI：'+po.po_no);
   const supplierMatch=po.supplier_id
     ? String(po.supplier_id)===String(form.supplier_id||'')
     : !!form.supplier_name&&norm(po.supplier_name)===norm(form.supplier_name);
   if(!supplierMatch||!form.country||norm(po.country)!==norm(form.country))
     throw Error('关联PO与PI的供应商或国家不一致：'+po.po_no);
   return po;
 });
 // A single PI / CI is a single supplier/currency/brand/warehouse accounting
 // object. Reject rather than silently combining incompatible POs.
 if(ids.length>1){
   for(const key of ['currency','brand','target_warehouse']){
     if(poRows.some(po=>norm(po[key])!==norm(poRows[0][key])))
       throw Error('多PO的'+({currency:'币种',brand:'品牌',target_warehouse:'目标仓库'}[key])+'必须一致');
   }
   if(form.currency&&norm(form.currency)!==norm(poRows[0].currency))
     throw Error('PI币种必须与关联PO一致');
   if(form.brand&&norm(form.brand)!==norm(poRows[0].brand))
     throw Error('PI品牌必须与关联PO一致');
   if(form.target_warehouse&&norm(form.target_warehouse)!==norm(poRows[0].target_warehouse))
     throw Error('PI仓库必须与关联PO一致');
 }
 return poRows;
}
function getExistingAllocations(piId,query){
 return query('SELECT po_id, po_no, sku_code, allocated_qty, pi_unit_price, pi_discount FROM pi_po_allocations WHERE pi_id = ?',[piId]).rows;
}
function updatePOStatus(poId,query,run){
 const po=query('SELECT po_status, approval_status FROM purchase_orders WHERE id = ?',[poId]).rows[0];
 if(!po)throw Error('PO不存在：'+poId);
 const items=query('SELECT po_qty, transferred_pi_qty FROM purchase_order_items WHERE po_id = ?',[poId]).rows;
 if(!items.length)throw Error('PO没有商品明细：'+poId);
 // A PI is a sourcing fact, NOT an approval action. Preserve draft/pending
 // approval state; final PO approval will derive the transfer status afresh.
 if(po.approval_status!=='approved')return;
 const anyTransferred=items.some(i=>Number(i.transferred_pi_qty)>0);
 const status=anyTransferred&&items.every(i=>Number(i.transferred_pi_qty)>=Number(i.po_qty))?'transferred_pi':
   anyTransferred?'partial_pi':'approved';
 run('UPDATE purchase_orders SET po_status = ? WHERE id = ?',[status,poId]);
}
function restoreMultiAllocations(piId,query,run){
 const old=getExistingAllocations(piId,query);
 for(const a of old){
   const poItem=query('SELECT id, transferred_pi_qty FROM purchase_order_items WHERE po_id = ? AND sku_code = ?',[a.po_id,a.sku_code]).rows[0];
   if(!poItem||Number(poItem.transferred_pi_qty)<Number(a.allocated_qty))
     throw Error('原PO占用数量已异常，拒绝修改PI：'+a.po_no+' / '+a.sku_code);
   const result=run('UPDATE purchase_order_items SET transferred_pi_qty=transferred_pi_qty-?, untransferred_pi_qty=po_qty-(transferred_pi_qty-?) WHERE id = ? AND transferred_pi_qty >= ?',
     [a.allocated_qty,a.allocated_qty,poItem.id,a.allocated_qty]);
   if(result.changes!==1)throw Error('PO数量回退失败');
 }
 run('DELETE FROM pi_po_allocations WHERE pi_id = ?',[piId]);
 return [...new Set(old.map(x=>x.po_id))];
}
function assignMultiPO({piId,poRows,items,sourceItems,query,run,genId}){
 if(poRows.length<2)throw Error('多PO分配至少需要2张PO');
 const poItems=new Map();
 for(const po of poRows){
   const rows=query('SELECT id, sku_code, po_qty, transferred_pi_qty FROM purchase_order_items WHERE po_id = ?',[po.id]).rows;
   const map=new Map();
   for(const r of rows){
     if(map.has(r.sku_code))throw Error('PO出现重复SKU，无法可靠分摊：'+po.po_no+' / '+r.sku_code);
     map.set(r.sku_code,r);
   }
   poItems.set(po.id,map);
 }
 const seen=new Set(),allocations=[];
 if(Array.isArray(sourceItems)){
   // Exact PO-level assignment: no FIFO redistributing one PO line to another.
   const validated=aggregateSourceItems(sourceItems,poRows);
   if(JSON.stringify(validated.map(i=>[i.sku_code,i.pi_confirmed_qty]).sort())!==
     JSON.stringify(items.map(i=>[i.sku_code,Number(i.pi_confirmed_qty||0)]).sort()))
       throw Error('PI汇总与PO分行数量不一致');
   for(const line of sourceItems){
     const poId=String(line.po_id||'').trim(),sku=String(line.sku_code||'').trim();
     const qty=Number(line.pi_confirmed_qty||0);
     if(!poId||qty===0)continue;
     const po=poRows.find(p=>p.id===poId),item=poItems.get(poId)?.get(sku);
     if(!po||!item)throw Error('关联PO未包含此SKU：'+sku);
     const result=run('UPDATE purchase_order_items SET transferred_pi_qty=transferred_pi_qty+?, untransferred_pi_qty=po_qty-(transferred_pi_qty+?) WHERE id=? AND transferred_pi_qty + ? <= po_qty',
       [qty,qty,item.id,qty]);
     if(result.changes!==1)throw Error('PI数量超过对应PO剩余数量：'+po.po_no+' / '+sku);
     run('INSERT INTO pi_po_allocations (id,pi_id,po_id,po_no,sku_code,allocated_qty,pi_unit_price,pi_discount) VALUES (?,?,?,?,?,?,?,?)',
       [genId('ppa'),piId,po.id,po.po_no,sku,qty,Number(line.unit_price||0),Number(line.discount||0)]);
     allocations.push({pi_id:piId,po_id:po.id,po_no:po.po_no,sku_code:sku,allocated_qty:qty});
   }
   for(const po of poRows)updatePOStatus(po.id,query,run);
   return allocations;
 }
 for(const item of items){
   const sku=String(item.sku_code||'').trim(),qty=Number(item.pi_confirmed_qty||0);
   if(!sku||seen.has(sku))throw Error('多PO的PI明细每个SKU只能有一行：'+sku);
   seen.add(sku);
   if(!Number.isSafeInteger(qty)||qty<0)throw Error('PI确认数量须为非负整数：'+sku);
   const matches=poRows.filter(po=>poItems.get(po.id).has(sku));
   if(!matches.length)continue; // legitimate manual PI-added SKU
   let remaining=qty;
   for(const po of matches){
     const record=poItems.get(po.id).get(sku);
     const available=Number(record.po_qty||0)-Number(record.transferred_pi_qty||0);
     if(!Number.isSafeInteger(available)||available<0)throw Error('PO库存数量异常：'+po.po_no+' / '+sku);
     const take=Math.min(remaining,available);
     if(take>0){
       const result=run('UPDATE purchase_order_items SET transferred_pi_qty=transferred_pi_qty+?, untransferred_pi_qty=po_qty-(transferred_pi_qty+?) WHERE id = ? AND transferred_pi_qty + ? <= po_qty',
         [take,take,record.id,take]);
       if(result.changes!==1)throw Error('PO余量发生并发变化，请刷新重试：'+po.po_no+' / '+sku);
       run('INSERT INTO pi_po_allocations (id, pi_id, po_id, po_no, sku_code, allocated_qty) VALUES (?, ?, ?, ?, ?, ?)',
         [genId('ppa'),piId,po.id,po.po_no,sku,take]);
       allocations.push({piId,po_id:po.id,po_no:po.po_no,sku_code:sku,allocated_qty:take});
       remaining-=take;
     }
     if(!remaining)break;
   }
   if(remaining>0)throw Error('PI确认数量超过已关联PO剩余数量：'+sku+'，超出 '+remaining);
 }
 for(const po of poRows)updatePOStatus(po.id,query,run);
 return allocations;
}
module.exports={parseRelatedIds,validatePOs,getExistingAllocations,updatePOStatus,restoreMultiAllocations,assignMultiPO,aggregateSourceItems};

/**
 * Input: separate PO+SKU lines, including manual rows with no po_id.
 * Output: ONE CI-safe PI line per SKU, with exact extended-price totals.
 * Source allocations remain independent and auditable by PO+SKU.
 */
function aggregateSourceItems(sourceRows,poRows){
 if(!Array.isArray(sourceRows)||sourceRows.length>10000)throw Error('PI来源明细格式无效');
 const poById=new Map(poRows.map(p=>[String(p.id),p]));
 const keys=new Set(),sourceSkus=new Set(),groups=new Map();
 for(const line of sourceRows){
   const sku=String(line.sku_code||'').trim(),poId=String(line.po_id||'').trim();
   const poNo=String(line.po_no||'').trim();
   const qty=Number(line.pi_confirmed_qty||0),price=Number(line.unit_price||0),discount=Number(line.discount||0);
   if(!sku||!Number.isSafeInteger(qty)||qty<0||!Number.isFinite(price)||price<0||
      !Number.isFinite(discount)||discount<0||discount>1)
     throw Error('PI来源行数量、单价或折扣无效：'+sku);
   const key=poId+'|'+sku;
   if(keys.has(key))throw Error('同一PO的SKU只能出现一行：'+sku);
   keys.add(key);
   if(poId){
     const po=poById.get(poId);
     if(!po||po.po_no!==poNo)throw Error('PI来源PO不属于本次关联范围：'+poNo);
     sourceSkus.add(sku);
   }else if(poNo)throw Error('手工PI行不能伪造关联PO号');
   let g=groups.get(sku);
   if(!g){g={sku_code:sku,po_qty:0,pi_confirmed_qty:0,gross:0,net:0};groups.set(sku,g);}
   g.pi_confirmed_qty+=qty;
   g.gross+=qty*price;
   g.net+=qty*price*(1-discount);
   g.po_qty+=Number(line.po_qty||0);
 }
 // Manual SKU identical to a sourced PO SKU is ambiguous to CI allocation.
 for(const line of sourceRows){
   if(!line.po_id&&sourceSkus.has(String(line.sku_code||'').trim()))
     throw Error('手工行与PO来源SKU重复，请在对应PO行填写数量：'+line.sku_code);
 }
 return [...groups.values()].map(g=>({
   sku_code:g.sku_code,po_qty:g.po_qty,pi_confirmed_qty:g.pi_confirmed_qty,
   unit_price:g.pi_confirmed_qty?g.gross/g.pi_confirmed_qty:0,
   discount:g.gross?(1-g.net/g.gross):0,pi_amount:g.net
 }));
}
