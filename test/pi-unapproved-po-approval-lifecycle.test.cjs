'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
const start=server.indexOf("function poHasNoncancelledPI(poId){");
const end=server.indexOf('// PO 提交审批',start);
assert.ok(start>0&&end>start);
function gateHarness({linked=true,transferred=40}={}){
 const handlers={},mutations=[];
 const po={id:'p1',po_no:'PO-1',currency:'RMB',po_status:'draft',approval_status:'pending',
   supplier_id:'s1',supplier_name:'Netac',brand:'Netac',country:'泰国',target_warehouse:'BKK'};
 const rows=[{id:'i1',sku_code:'SKU-1',transferred_pi_qty:transferred,po_qty:100}];
 const ctx={app:{
  put(url,_p,fn){handlers['put']=fn;},
  post(url,_p,fn){handlers[url]=fn;},
  delete(url,_p,fn){handlers['delete']=fn;}},
  requireApiPermission:()=>()=>{},asyncHandler:fn=>fn,
  queryOne(sql){if(sql.includes('FROM proforma_invoices pi'))return linked?{present:1}:undefined;
    if(sql.includes('FROM purchase_orders'))return po;
    throw Error('unexpected queryOne '+sql);},
  query(sql){if(sql.includes('FROM purchase_order_items'))return {rows};
    throw Error('unexpected query '+sql);},
  run(sql,args){mutations.push([sql,args]);return {changes:1};},
  updateInventoryTransitDataAsync:()=>Promise.resolve(),
  logOperation(){},transaction:fn=>fn(),console:{warn(){},error(){}}
 };
 vm.createContext(ctx);vm.runInContext(server.slice(start,end),ctx);
 const invoke=async(key,body={})=>{
  let code=200,result;
  await handlers[key]({params:{id:'p1'},body,currentUserName:'tester'},{
    status(n){code=n;return this;},json(value){result=value;return this;}});
  return {code,result};
 };
 return {invoke,mutations,po};
}
test('draft PO with PI cannot change supplier/country/warehouse',async()=>{
 const h=gateHarness();
 for(const patch of [{supplier_id:'new'},{country:'印度尼西亚'},{brand:'Other'},{target_warehouse:'KL'}]){
  const r=await h.invoke('put',patch);
  assert.equal(r.code,400);
 }
 assert.equal(h.mutations.length,0);
});
test('transferred SKU quantity cannot shrink below linked PI, replace SKU, or delete source item',async()=>{
 const h=gateHarness();
 for(const items of [
  [{id:'i1',sku_code:'SKU-1',po_qty:39}],
  [{id:'i1',sku_code:'SKU-2',po_qty:100}],
  []]){
   const r=await h.invoke('put',{items});
   assert.equal(r.code,400);
 }
 assert.equal(h.mutations.length,0);
});
test('draft linked PO cannot be hard-deleted or voided, even when approval is pending',async()=>{
 const h=gateHarness();
 const del=await h.invoke('delete');assert.equal(del.code,409);
 const delSoft=await h.invoke("/api/purchase-orders/:id/void",{void_reason:'test'});
 assert.equal(delSoft.code,409);
 assert.equal(h.mutations.length,0);
});
test('draft unlinked PO without transferred items retains ordinary editing',async()=>{
 const h=gateHarness({linked:false,transferred:0});
 const r=await h.invoke('put',{remark:'normal edit'});
 assert.equal(r.code,200,JSON.stringify(r));
 assert.equal(h.mutations.length,1);
});
function approveHarness(qty,partially=false){
 const start=server.indexOf("app.post('/api/purchase-orders/:id/approve'");
 const end=server.indexOf('// PO 标记为已发工厂',start);
 assert.ok(start>0&&end>start);
 const state={po:{id:'p1',po_no:'PO-1',po_status:'pending_approval',approval_status:'pending'},
   approval:{id:'a1',business_id:'p1',business_type:'po',status:'pending',
    current_level:1,max_level:1,approvers:JSON.stringify([{level:1,approver_user_id:'user1'}]),
    approval_history:'[]'},logs:[]};
 const ctx={
  app:{post(_url,_p,fn){state.handler=fn;}},
  requireApiPermission:()=>()=>{},asyncHandler:fn=>fn,
  queryOne(sql){
   if(sql.includes('FROM purchase_orders'))return state.po;
   if(sql.includes('FROM approval_records'))return state.approval;
   if(sql.includes('FROM users'))return {name:'Approver'};
   throw Error('unexpected SELECT '+sql);
  },query(sql){
    if(sql.includes('FROM purchase_order_items'))
      return {rows:[{po_qty:100,transferred_pi_qty:qty},{po_qty:10,transferred_pi_qty:partially?0:qty===100?10:0}]};
    throw Error('unexpected query '+sql);
  },
  run(sql,args){
   state.logs.push({sql,args});
   if(sql.includes('UPDATE purchase_orders')){
     state.po.po_status=args[0];state.po.approval_status=args[1];
   }
  },
  notifyApprovalParticipants:()=>Promise.resolve(),console:{error(){}}
 };
 vm.createContext(ctx);vm.runInNewContext(server.slice(start,end),ctx);
 const request=async()=>{
  let code=200;
  await state.handler({params:{id:'p1'},body:{action:'approve',remark:'OK'},currentUserId:'user1'},{
   status(s){code=s;return this;},json(body){return {code,...body};}});
  return code;
 };
 return {state,request};
}
test('later explicit PO final approval derives partial_pi from transferred PI quantities',async()=>{
 const h=approveHarness(40);assert.equal(await h.request(),200);
 assert.equal(h.state.po.approval_status,'approved');
 assert.equal(h.state.po.po_status,'partial_pi');
});
test('later explicit PO final approval derives transferred_pi when all items transferred',async()=>{
 const h=approveHarness(100);assert.equal(await h.request(),200);
 assert.equal(h.state.po.approval_status,'approved');
 assert.equal(h.state.po.po_status,'transferred_pi');
});
test('PO without PI still approves to approved',async()=>{
 const h=approveHarness(0);assert.equal(await h.request(),200);
 assert.equal(h.state.po.po_status,'approved');
});
