'use strict';
// New PI only; the old #npi-po select is retained as a legacy first-PO
// compatibility field, while the visible picker is native checkbox multi-select.
(function(root){
 const state={enabled:false,ids:[],sequence:0,details:[],all:[],loading:false};
 function el(id){return document.getElementById(id);}
 const norm=x=>String(x||'').trim().toLocaleLowerCase();
 function match(po){
   const c=el('npi-country'),s=el('npi-sup');
   if(!c||!s||!c.value||!s.value)return false;
   const name=s.options[s.selectedIndex]?.dataset.name||'';
   return piPOCountrySupplierMatch(po,c.value,s.value,name);
 }
 function ids(){return state.ids.slice();}
 function resetRows(){
   state.sequence++;
   state.details=[];state.loading=false;
   window._poRef=null;
   window._piRows=(window._piRows||[]).filter(r=>!r.fromPO);
   for(const id of ['npi-cur','npi-brand','npi-country','npi-wh']){
     const input=el(id);if(input)input.disabled=false;
   }
   const old=el('npi-po');if(old)old.value='';
   renderCmpTable();
 }
 function restoreFromPOs(pos){
   const poSel=el('npi-po'),brand=el('npi-brand'),cur=el('npi-cur'),
     country=el('npi-country'),wh=el('npi-wh');
   if(poSel)poSel.value=state.ids[0]||'';
   if(!pos.length){resetRows();return;}
   const first=pos[0];
   if(cur){cur.value=first.currency;cur.disabled=true;}
   if(brand){
     if(first.brand){
       if(![...brand.options].some(o=>o.value===first.brand))
         brand.insertAdjacentHTML('beforeend','<option value="'+esc(first.brand)+'">'+esc(first.brand)+'</option>');
       brand.value=first.brand;
     }
     brand.disabled=true;
   }
   if(country){country.value=first.country;country.disabled=true;}
   if(wh){wh.value=first.target_warehouse||'';wh.disabled=true;}
   const grouped=new Map();
   for(const po of pos){
     for(const item of (po.items||[])){
       const sku=String(item.sku_code||'').trim();
       if(!sku)continue;
       const left=Math.max(0,Number(item.po_qty||0)-Number(item.transferred_pi_qty||0));
       const prior=grouped.get(sku)||{sku,poQty:0,poPrice:0,piQty:0,piPrice:0,piDisc:0,fromPO:true,poNos:[]};
       const nextQty=prior.poQty+left;
       prior.poPrice=nextQty?(prior.poPrice*prior.poQty+Number(item.unit_price||0)*left)/nextQty:0;
       prior.poQty=nextQty;
       prior.poNos.push(po.po_no);
       grouped.set(sku,prior);
     }
   }
   const extra=(window._piRows||[]).filter(r=>!r.fromPO);
   window._poRef=[...grouped.values()].map(x=>({sku_code:x.sku,po_qty:x.poQty,unit_price:x.poPrice}));
   window._piRows=[...grouped.values()].concat(extra);
   renderCmpTable();
 }
 function available(){
   return (window._piApprovedPOs||[]).filter(po=>match(po)&&
     po.approval_status==='approved'&&!['cancelled','rejected','transferred_pi'].includes(po.po_status));
 }
 function compatible(a,b){
   return ['supplier_id','country','brand','currency','target_warehouse']
     .every(k=>norm(a[k])===norm(b[k]));
 }
 function refresh(){
   if(!state.enabled)return;
   const matched=available(),old=state.ids;
   const keep=old.filter(id=>matched.some(po=>po.id===id));
   if(keep.length!==old.length){state.ids=keep;resetRows();}
   const first=(window._piApprovedPOs||[]).find(po=>po.id===state.ids[0]);
   const box=el('pi-multi-po-picker');
   if(!box)return;
   const search=(el('pi-multi-po-search')?.value||'').trim().toLocaleLowerCase();
   const html=matched.filter(po=>!search||(po.po_no+' '+po.supplier_name).toLocaleLowerCase().includes(search))
     .map(po=>{
       const selected=state.ids.includes(po.id);
       const forbidden=!!first&&!compatible(first,po);
       return '<label class="pi-mpo-row" title="'+(forbidden?'不同品牌/仓库/币种不可合并':'')+'">'+
         '<input type="checkbox" '+(selected?'checked ':'')+(forbidden?'disabled ':'')+
         'onchange="piMultiPOToggle(decodeURIComponent(\''+encodeURIComponent(po.id).replace(/'/g,'%27')+'\'),this.checked)">'+
         '<span>'+esc(po.po_no)+' · '+esc(po.currency)+' · '+esc(po.brand||'')+
         ' · '+esc(po.target_warehouse||'')+'</span></label>';
     }).join('');
   box.innerHTML=matched.length?(html||'<div class="pi-mpo-muted">无匹配PO</div>'):
     '<div class="pi-mpo-muted">请先选择国家和供应商，或无可用的已审批PO</div>';
   const tag=el('pi-multi-po-count');if(tag)tag.textContent='已选择 '+state.ids.length+' 张 PO';
 }
 async function toggle(id,checked){
   if(!state.enabled)return;
   const po=(window._piApprovedPOs||[]).find(p=>p.id===id);
   if(!po||!match(po))return;
   const old=state.ids.slice(),first=(window._piApprovedPOs||[]).find(p=>p.id===old[0]);
   if(checked&&!old.includes(id)){
     if(first&&!compatible(first,po)){showToast('只能合并同供应商、国家、品牌、币种、仓库的PO','warning');refresh();return;}
     state.ids.push(id);
   } else if(!checked)state.ids=old.filter(x=>x!==id);
   refresh();
   const seq=++state.sequence;
   if(!state.ids.length){resetRows();return;}
   state.loading=true;
   try{
     const fetched=await Promise.all(state.ids.map(x=>api('/api/purchase-orders/'+encodeURIComponent(x))));
     if(seq!==state.sequence||!state.enabled||!el('pi-multi-po-picker'))return;
     if(fetched.some(x=>!compatible(fetched[0],x)||!match(x)))throw Error('关联PO的属性不一致，不能合并');
     // Rebuild from current true source facts; do not infer allocations from
     // stale first-PO header and do not duplicate same SKU rows.
     state.details=fetched;
     const w=el('npi-wh');
     if(w)await populatePIWarehouse(fetched[0].country);
     if(seq!==state.sequence||!state.enabled||!el('pi-multi-po-picker'))return;
     restoreFromPOs(fetched);state.loading=false;
   }catch(e){
     if(seq!==state.sequence)return;
     // Fail closed: never retain an associated PO without loaded source rows.
     state.ids=[];resetRows();refresh();
     showToast(e.message||'加载PO失败，请重新选择','danger');
   }
 }
 function install(){
   state.enabled=true;state.ids=[];state.sequence++;state.all=[];state.details=[];state.loading=false;
   const select=el('npi-po');if(!select)return;
   select.style.display='none';
   const wrapper='<div id="pi-multi-po-shell" style="grid-column:1/-1">'+
     '<div style="font-size:13px;font-weight:600;margin-bottom:7px">关联PO（可多选）</div>'+
     '<div id="pi-multi-po-count" style="font-size:12px;color:var(--text-secondary,#666);margin-bottom:5px">已选择 0 张 PO</div>'+
     '<input id="pi-multi-po-search" type="search" placeholder="搜索 PO 编号" oninput="piMultiPORefresh()" style="width:100%;max-width:450px;margin-bottom:6px;padding:7px;border:1px solid var(--border,#ddd);border-radius:8px">'+
     '<div id="pi-multi-po-picker" style="max-height:165px;overflow:auto;border:1px solid var(--border,#ddd);border-radius:10px;padding:7px;background:var(--bg-card,#fff)"></div>'+
     '<div style="font-size:11px;color:var(--text-secondary,#888);margin-top:6px">可勾选多张PO；同SKU自动合并，按勾选顺序占用剩余数量；更换关联PO会重置已填写的PI商品数量/单价。不同币种/仓库/品牌不可混选。</div></div>'+
     '<style>.pi-mpo-row{display:flex;gap:9px;align-items:center;padding:8px 10px;font-size:12px;cursor:pointer;border-radius:7px}.pi-mpo-row:hover{background:var(--bg-hover,#f4f6f9)}.pi-mpo-row:has(input:disabled){opacity:.48;cursor:not-allowed}.pi-mpo-muted{font-size:12px;color:var(--text-secondary,#999);padding:12px}</style>';
   const group=select.closest&&select.closest('.form-group');
   if(group){group.insertAdjacentHTML('afterend',wrapper);group.style.display='none';}
   else select.insertAdjacentHTML('afterend',wrapper);
   refresh();
 }
 function disable(){state.enabled=false;state.ids=[];state.sequence++;state.details=[];state.loading=false;}
 root.PIMultiPO={install,disable,refresh,toggle,ids,active:()=>state.enabled,loading:()=>state.loading};
})(window);
function piMultiPORefresh(){window.PIMultiPO.refresh();}
function piMultiPOToggle(id,checked){window.PIMultiPO.toggle(id,checked);}
