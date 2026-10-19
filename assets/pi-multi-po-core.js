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
function validatePOs(ids,form,queryOne){
 if(!ids.length)return [];
 const poRows=ids.map(id=>{
   const po=queryOne('SELECT * FROM purchase_orders WHERE id = ?',[id]);
   if(!po)throw Error('关联PO不存在：'+id);
   if(po.approval_status!=='approved'||['cancelled','rejected'].includes(po.po_status))
     throw Error('仅可关联已审批且未作废的PO：'+po.po_no);
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
 return query('SELECT po_id, po_no, sku_code, allocated_qty FROM pi_po_allocations WHERE pi_id = ?',[piId]).rows;
}
function updatePOStatus(poId,query,run){
 const items=query('SELECT po_qty, transferred_pi_qty FROM purchase_order_items WHERE po_id = ?',[poId]).rows;
 if(!items.length)throw Error('PO没有商品明细：'+poId);
 const status=items.every(i=>Number(i.transferred_pi_qty)>=Number(i.po_qty))?'transferred_pi':
   items.some(i=>Number(i.transferred_pi_qty)>0)?'partial_pi':'approved';
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
function assignMultiPO({piId,poRows,items,query,run,genId}){
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
module.exports={parseRelatedIds,validatePOs,getExistingAllocations,updatePOStatus,restoreMultiAllocations,assignMultiPO};
