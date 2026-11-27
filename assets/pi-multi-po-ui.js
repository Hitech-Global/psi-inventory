'use strict';
// Shared searchable PO picker for PI creation and PI editing.
// Edit mode preserves quantities/prices when a source PO is removed or re-added.
(function(root){
 const state={enabled:false,editMode:false,ids:[],originalIds:[],sequence:0,details:[],loading:false,
   originalFields:null,ownBySource:{}};
 function el(id){return document.getElementById(id);}
 const norm=x=>String(x||'').trim().toLocaleLowerCase();
 function match(po){
   const c=el('npi-country'),s=el('npi-sup');
   if(!c||!s||!c.value||!s.value)return false;
   const name=s.options[s.selectedIndex]?.dataset.name||'';
   return piPOCountrySupplierMatch(po,c.value,s.value,name);
 }
 function ids(){return state.ids.slice();}
 function ownQty(poId,sku){return Number(state.ownBySource[poId+'|'+sku]||0);}
 function poOwnTotal(poId){
   return Object.keys(state.ownBySource).reduce((sum,key)=>key.startsWith(poId+'|')?sum+Number(state.ownBySource[key]||0):sum,0);
 }
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
 function ensureOption(select,value){
   if(!select||value==null||value==='')return;
   if(!Array.from(select.options||[]).some(o=>String(o.value)===String(value)))
     select.insertAdjacentHTML('beforeend','<option value="'+esc(value)+'">'+esc(value)+'</option>');
 }
 function captureFields(){
   const out={};
   for(const id of ['npi-cur','npi-brand','npi-country','npi-wh']){
     const field=el(id);if(field)out[id]={value:field.value,disabled:!!field.disabled};
   }
   return out;
 }
 function restoreFields(){
   for(const [id,saved] of Object.entries(state.originalFields||{})){
     const field=el(id);if(!field)continue;
     ensureOption(field,saved.value);field.value=saved.value;field.disabled=saved.disabled;
   }
 }
 function syncLinkedFields(pos){
   if(!state.editMode)return;
   if(!pos.length){restoreFields();return;}
   const first=pos[0];
   const cur=el('npi-cur'),brand=el('npi-brand'),country=el('npi-country'),wh=el('npi-wh');
   if(cur){ensureOption(cur,first.currency);cur.value=first.currency||cur.value;cur.disabled=true;}
   if(brand){ensureOption(brand,first.brand);brand.value=first.brand||brand.value;brand.disabled=true;}
   if(country){ensureOption(country,first.country);country.value=first.country||country.value;country.disabled=true;}
   if(wh){ensureOption(wh,first.target_warehouse);wh.value=first.target_warehouse||wh.value;wh.disabled=true;}
 }
 function restoreFromPOs(pos){
   const poSel=el('npi-po'),brand=el('npi-brand'),cur=el('npi-cur'),
     country=el('npi-country'),wh=el('npi-wh');
   if(poSel)poSel.value=state.ids[0]||'';
   if(!pos.length){resetRows();return;}
   const first=pos[0];
   if(cur){cur.value=first.currency;cur.disabled=true;}
   if(brand){
     if(first.brand)ensureOption(brand,first.brand);
     if(first.brand)brand.value=first.brand;
     brand.disabled=true;
   }
   if(country){country.value=first.country;country.disabled=true;}
   if(wh){wh.value=first.target_warehouse||'';wh.disabled=true;}
   const lines=[];
   for(const po of pos){
     for(const item of (po.items||[])){
       const sku=String(item.sku_code||'').trim();
       if(!sku)continue;
       const left=Math.max(0,Number(item.po_qty||0)-Number(item.transferred_pi_qty||0));
       if(left<=0)continue;
       lines.push({poId:po.id,poNo:po.po_no,sku,poQty:left,
         poPrice:Number(item.unit_price||0),piQty:0,piPrice:0,piDisc:0,fromPO:true});
     }
   }
   const extra=(window._piRows||[]).filter(r=>!r.fromPO);
   window._poRef=lines.map(x=>({po_id:x.poId,po_no:x.poNo,sku_code:x.sku,po_qty:x.poQty,unit_price:x.poPrice}));
   window._piRows=lines.concat(extra);
   renderCmpTable();
 }
 // PO approval and PI association are separate: draft/pending plans can be
 // linked without silently approving the PO. Voided/rejected plans remain blocked.
 function candidates(){return (window._piApprovedPOs||[]).filter(match);}
 function ineligibility(po){
   if(po.po_status==='cancelled')return 'PO已作废';
   if(po.po_status==='rejected'||po.approval_status==='rejected')return '审批已驳回';
   const hasOwn=state.editMode&&poOwnTotal(po.id)>0;
   if(!hasOwn&&(po.po_status==='transferred_pi'||
      (po.remaining_pi_qty!==undefined&&po.remaining_pi_qty!==null&&Number(po.remaining_pi_qty)<=0)))
     return '已全部转PI';
   return '';
 }
 function approvalNote(po){return po.approval_status==='approved'?'可关联':'待审批 · 可关联';}
 function available(){return candidates().filter(po=>!ineligibility(po));}
 function compatible(a,b){
   return ['supplier_id','country','brand','currency','target_warehouse']
     .every(k=>norm(a[k])===norm(b[k]));
 }
 function refresh(){
   if(!state.enabled)return;
   const matched=candidates(),eligible=available();
   const box=el('pi-multi-po-picker');if(!box)return;
   const search=(el('pi-multi-po-search')?.value||'').trim().toLocaleLowerCase();
   const shown=matched.filter(po=>!search||(po.po_no+' '+po.supplier_name).toLocaleLowerCase().includes(search))
     .sort((a,b)=>Number(!!ineligibility(a))-Number(!!ineligibility(b)));
   const first=(window._piApprovedPOs||[]).find(po=>po.id===state.ids[0]);
   const html=shown.map(po=>{
     const selected=state.ids.includes(po.id),reason=ineligibility(po);
     const conflict=!!first&&!compatible(first,po);
     // Existing selected rows must always be removable, including a PO that
     // became cancelled/rejected after the PI was created.
     const forbidden=!selected&&(!!reason||conflict);
     const hint=reason||(conflict?'品牌/仓库/币种不同，不可合并':'');
     return '<label class="pi-mpo-row" title="'+esc(hint)+'">'+
       '<input type="checkbox" '+(selected?'checked ':'')+(forbidden?'disabled ':'')+
       'onchange="piMultiPOToggle(decodeURIComponent(\''+encodeURIComponent(po.id).replace(/'/g,'%27')+'\'),this.checked)">'+
       '<span>'+esc(po.po_no)+' · '+esc(po.currency)+' · '+esc(po.brand||'')+
       ' · '+esc(po.target_warehouse||'')+'</span>'+
       (reason?'<span class="pi-mpo-state" aria-label="'+esc(reason)+'">'+esc(reason)+'</span>':
         conflict?'<span class="pi-mpo-state">不能混选</span>':
         '<span class="pi-mpo-state pi-mpo-state-ok">'+esc(approvalNote(po))+'</span>')+'</label>';
   }).join('');
   box.innerHTML=matched.length?(html||'<div class="pi-mpo-muted">搜索没有匹配PO</div>'):
     '<div class="pi-mpo-muted">请先选择国家和供应商，或无符合条件的PO</div>';
   const tag=el('pi-multi-po-count');
   if(tag)tag.textContent='已选择 '+state.ids.length+' 张 PO · 可关联 '+eligible.length+
     ' 张 · 待处理 '+(matched.length-eligible.length)+' 张';
 }
 async function toggleEdit(id,checked){
   const po=(window._piApprovedPOs||[]).find(p=>p.id===id);
   if(!po||!match(po))return;
   const reason=ineligibility(po);
   if(checked&&reason){showToast(po.po_no+'：'+reason,'warning');refresh();return;}
   const beforeIds=state.ids.slice(),beforeRows=(window._piRows||[]).map(r=>({...r}));
   const beforeDetails=state.details.slice();
   const first=(window._piApprovedPOs||[]).find(p=>p.id===beforeIds[0]);
   if(checked&&!beforeIds.includes(id)){
     if(first&&!compatible(first,po)){
       showToast('只能合并同供应商、国家、品牌、币种、仓库的PO','warning');refresh();return;
     }
     state.ids.push(id);
   }else if(!checked){
     state.ids=beforeIds.filter(x=>x!==id);
     // Keep the PI amount and pricing, but turn the removed PO line into an
     // unlinked/manual line. The server releases its old PO reservation.
     window._piRows=beforeRows.flatMap(r=>{
       if(!r.fromPO||r.poId!==id)return [r];
       if(Number(r.piQty||0)===0&&Number(r.piPrice||0)===0&&Number(r.piDisc||0)===0)return [];
       return [{...r,fromPO:false,formerPoId:id,formerPoNo:r.poNo,poId:'',poNo:'',poQty:0,poPrice:0}];
     });
   }
   refresh();
   const seq=++state.sequence;state.loading=true;
   try{
     const fetched=await Promise.all(state.ids.map(x=>api('/api/purchase-orders/'+encodeURIComponent(x))));
     if(seq!==state.sequence||!state.enabled||!el('pi-multi-po-picker'))return;
     if(fetched.some(x=>!compatible(fetched[0],x)||!match(x)))throw Error('关联PO的属性不一致，不能合并');
     let rows=(window._piRows||[]).slice();
     for(const linked of fetched){
       const restored=rows.map(r=>{
         if(r.formerPoId!==linked.id)return r;
         const item=(linked.items||[]).find(x=>String(x.sku_code||'').trim()===String(r.sku||'').trim());
         if(!item)return r;
         const own=ownQty(linked.id,r.sku);
         return {...r,fromPO:true,poId:linked.id,poNo:linked.po_no,
           poQty:Math.max(0,Number(item.po_qty||0)-Number(item.transferred_pi_qty||0)+own),
           poPrice:Number(item.unit_price||0),formerPoId:undefined,formerPoNo:undefined};
       });
       rows=restored;
       const hasRows=rows.some(r=>r.fromPO&&r.poId===linked.id);
       if(!hasRows){
         for(const item of (linked.items||[])){
           const sku=String(item.sku_code||'').trim();if(!sku)continue;
           const own=ownQty(linked.id,sku);
           const left=Math.max(0,Number(item.po_qty||0)-Number(item.transferred_pi_qty||0)+own);
           if(left<=0)continue;
           rows.push({poId:linked.id,poNo:linked.po_no,sku,poQty:left,
             poPrice:Number(item.unit_price||0),piQty:0,piPrice:0,piDisc:0,fromPO:true});
         }
       }
     }
     window._piRows=rows;state.details=fetched;
     if(fetched.length){
       if(typeof populatePIWarehouse==='function')await populatePIWarehouse(fetched[0].country||'');
       if(seq!==state.sequence||!state.enabled)return;
       syncLinkedFields(fetched);
     }else{
       state.details=[];syncLinkedFields([]);
     }
     state.loading=false;renderCmpTable();refresh();
   }catch(e){
     if(seq!==state.sequence)return;
     state.ids=beforeIds;window._piRows=beforeRows;state.details=beforeDetails;state.loading=false;
     refresh();renderCmpTable();
     showToast(e.message||'加载PO失败，请重新选择','danger');
   }
 }
 async function toggleCreate(id,checked){
   const po=(window._piApprovedPOs||[]).find(p=>p.id===id);
   if(!po||!match(po))return;
   const reason=ineligibility(po);
   if(checked&&reason){showToast(po.po_no+'：'+reason,'warning');refresh();return;}
   const old=state.ids.slice(),first=(window._piApprovedPOs||[]).find(p=>p.id===old[0]);
   if(checked&&!old.includes(id)){
     if(first&&!compatible(first,po)){showToast('只能合并同供应商、国家、品牌、币种、仓库的PO','warning');refresh();return;}
     state.ids.push(id);
   }else if(!checked)state.ids=old.filter(x=>x!==id);
   refresh();
   const seq=++state.sequence;
   if(!state.ids.length){resetRows();return;}
   state.loading=true;
   try{
     const fetched=await Promise.all(state.ids.map(x=>api('/api/purchase-orders/'+encodeURIComponent(x))));
     if(seq!==state.sequence||!state.enabled||!el('pi-multi-po-picker'))return;
     if(fetched.some(x=>!compatible(fetched[0],x)||!match(x)))throw Error('关联PO的属性不一致，不能合并');
     state.details=fetched;
     const w=el('npi-wh');if(w)await populatePIWarehouse(fetched[0].country);
     if(seq!==state.sequence||!state.enabled||!el('pi-multi-po-picker'))return;
     restoreFromPOs(fetched);state.loading=false;
   }catch(e){
     if(seq!==state.sequence)return;
     state.ids=[];resetRows();refresh();
     showToast(e.message||'加载PO失败，请重新选择','danger');
   }
 }
 async function toggle(id,checked){
   if(!state.enabled)return;
   return state.editMode?toggleEdit(id,checked):toggleCreate(id,checked);
 }
 function mount(){
   const select=el('npi-po');if(!select)return;
   select.style.display='none';
   const wrapper='<div id="pi-multi-po-shell" style="grid-column:1/-1">'+
     '<div style="font-size:13px;font-weight:600;margin-bottom:7px">关联PO（可多选）</div>'+
     '<div id="pi-multi-po-count" style="font-size:12px;color:var(--text-secondary,#666);margin-bottom:5px">已选择 0 张 PO</div>'+
     '<input id="pi-multi-po-search" type="search" placeholder="搜索 PO 编号 / 供应商" oninput="piMultiPORefresh()" style="width:100%;max-width:450px;margin-bottom:6px;padding:7px;border:1px solid var(--border,#ddd);border-radius:8px">'+
     '<div id="pi-multi-po-picker" style="max-height:165px;overflow:auto;border:1px solid var(--border,#ddd);border-radius:10px;padding:7px;background:var(--bg-card,#fff)"></div>'+
     '<div style="font-size:11px;color:var(--text-secondary,#888);margin-top:6px">草稿、待审批PO也可关联PI，但不会自动改变PO审批状态；已作废、已驳回及已全部转PI的PO不可新增关联。取消关联会释放原PO占用，原PI数量及价格保留为手工明细。</div></div>'+
     '<style>.pi-mpo-row{display:flex;gap:9px;align-items:center;padding:8px 10px;font-size:12px;cursor:pointer;border-radius:7px}.pi-mpo-row:hover{background:var(--bg-hover,#f4f6f9)}.pi-mpo-row:has(input:disabled){opacity:.65;cursor:not-allowed}.pi-mpo-state{font-size:11px;color:#94622d;margin-left:auto;white-space:nowrap}.pi-mpo-state-ok{color:#26794e}.pi-mpo-muted{font-size:12px;color:var(--text-secondary,#999);padding:12px}</style>';
   const group=select.closest&&select.closest('.form-group');
   if(group){group.insertAdjacentHTML('afterend',wrapper);group.style.display='none';}
   else select.insertAdjacentHTML('afterend',wrapper);
   refresh();
 }
 function install(){
   state.enabled=true;state.editMode=false;state.ids=[];state.originalIds=[];state.sequence++;
   state.details=[];state.loading=false;state.originalFields=null;state.ownBySource={};
   mount();
 }
 function installEdit({selectedIds=[],ownBySource={}}={}){
   state.enabled=true;state.editMode=true;state.ids=selectedIds.slice();state.originalIds=selectedIds.slice();
   state.sequence++;state.details=[];state.loading=false;state.originalFields=captureFields();
   state.ownBySource={...ownBySource};
   for(const row of (window._piRows||[])){
     if(row.fromPO&&row.poId){
       const key=row.poId+'|'+row.sku;
       state.ownBySource[key]=(Number(state.ownBySource[key]||0)+Number(row.piQty||0));
     }
   }
   const select=el('npi-po');if(select)select.value=state.ids[0]||'';
   mount();
   const pos=state.ids.map(id=>(window._piApprovedPOs||[]).find(po=>po.id===id)).filter(Boolean);
   syncLinkedFields(pos);
   refresh();
 }
 function disable(){
   state.enabled=false;state.editMode=false;state.ids=[];state.originalIds=[];state.sequence++;
   state.details=[];state.loading=false;state.originalFields=null;state.ownBySource={};
 }
 root.PIMultiPO={install,installEdit,disable,refresh,toggle,ids,active:()=>state.enabled,loading:()=>state.loading};
})(window);
function piMultiPORefresh(){window.PIMultiPO.refresh();}
function piMultiPOToggle(id,checked){window.PIMultiPO.toggle(id,checked);}
