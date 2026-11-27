'use strict';
// Shared searchable PO picker for PI creation and editing.
(function(root){
 const state={enabled:false,ids:[],sequence:0,details:[],all:[],loading:false,
   editMode:false,originalIds:[],pi:null};
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
   if(!pos.length){
     if(state.editMode){
       const pi=state.pi||{};
       if(cur){cur.value=pi.currency||cur.value;cur.disabled=false;}
       if(brand){brand.value=pi.brand||'';brand.disabled=false;}
       if(country){country.value=pi.country||'';country.disabled=false;}
       if(wh){wh.value=pi.target_warehouse||'';wh.disabled=false;}
       state.details=[];
       if(typeof window._piEditRowsForSelection==='function')
         window._piEditRowsForSelection([]);
       renderCmpTable();
       return;
     }
     resetRows();return;
   }
   const first=pos[0];
   if(cur){cur.value=first.currency;cur.disabled=state.editMode?pos.length>1:true;}
   if(brand){
     if(first.brand){
       if(![...brand.options].some(o=>o.value===first.brand))
         brand.insertAdjacentHTML('beforeend','<option value="'+esc(first.brand)+'">'+esc(first.brand)+'</option>');
       brand.value=first.brand;
     }
     brand.disabled=state.editMode?pos.length>1:true;
   }
   if(country){country.value=first.country;country.disabled=state.editMode?pos.length>1:true;}
   if(wh){wh.value=first.target_warehouse||'';wh.disabled=state.editMode?pos.length>1:true;}
   if(state.editMode&&typeof window._piEditRowsForSelection==='function'){
     window._piEditRowsForSelection(pos);
     renderCmpTable();
     return;
   }
   // New PI: create one editable PI line per PO+SKU.
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
   window._poRef=lines.map(x=>({po_no:x.poNo,sku_code:x.sku,po_qty:x.poQty,unit_price:x.poPrice}));
   window._piRows=lines.concat(extra);
   renderCmpTable();
 }
 // PO approval and PI association are separate: draft/pending plans can be
 // linked without silently approving the PO. Voided/rejected plans remain blocked.
 function candidates(){return (window._piApprovedPOs||[]).filter(match);}
 function ineligibility(po){
   if(po.po_status==='cancelled')return 'PO已作废';
   if(po.po_status==='rejected'||po.approval_status==='rejected')return '审批已驳回';
   if(po.po_status==='transferred_pi'||
      (po.remaining_pi_qty!==undefined&&po.remaining_pi_qty!==null&&
       Number(po.remaining_pi_qty)<=0))return '已全部转PI';
   return '';
 }
 function originalFullPO(po,reason){
   return state.editMode&&reason==='已全部转PI'&&state.originalIds.includes(po.id);
 }
 function canSelect(po){
   const reason=ineligibility(po);
   return !reason||originalFullPO(po,reason);
 }
 function approvalNote(po){
   return po.approval_status==='approved'?'可关联':'待审批 · 可关联';
 }
 function compatible(a,b){
   return ['supplier_id','country','brand','currency','target_warehouse']
     .every(k=>norm(a[k])===norm(b[k]));
 }
 function refresh(){
   if(!state.enabled)return;
   const matched=candidates(),eligible=matched.filter(canSelect),old=state.ids;
   const keep=old.filter(id=>{
     const po=matched.find(x=>x.id===id);
     return !!po&&(state.editMode||canSelect(po));
   });
   if(keep.length!==old.length){
     state.ids=keep;
     if(state.editMode){
       state.details=state.details.filter(po=>keep.includes(po.id));
       restoreFromPOs(state.details);
     }else resetRows();
   }
   const first=(window._piApprovedPOs||[]).find(po=>po.id===state.ids[0]);
   const anchor=first||(state.editMode?state.pi:null);
   const box=el('pi-multi-po-picker');
   if(!box)return;
   const search=(el('pi-multi-po-search')?.value||'').trim().toLocaleLowerCase();
   const shown=matched.filter(po=>!search||(po.po_no+' '+po.supplier_name).toLocaleLowerCase().includes(search))
     .sort((a,b)=>Number(!canSelect(a))-Number(!canSelect(b)));
   const html=shown.map(po=>{
     const selected=state.ids.includes(po.id);
     const reason=ineligibility(po);
     const restorable=originalFullPO(po,reason);
     const displayReason=restorable?'':reason;
     const conflict=!selected&&!!anchor&&!compatible(anchor,po);
     const forbidden=!selected&&(!!displayReason||conflict);
     const hint=displayReason||(conflict?'品牌/仓库/币种不同，不可合并':'');
     const stateText=displayReason||(restorable?'原关联可恢复':
       conflict?'不能混选':approvalNote(po));
     return '<label class="pi-mpo-row" title="'+esc(hint)+'">'+
       '<input type="checkbox" '+(selected?'checked ':'')+(forbidden?'disabled ':'')+
       'onchange="piMultiPOToggle(decodeURIComponent(\''+encodeURIComponent(po.id).replace(/'/g,'%27')+'\'),this.checked)">'+
       '<span>'+esc(po.po_no)+' · '+esc(po.currency)+' · '+esc(po.brand||'')+
       ' · '+esc(po.target_warehouse||'')+'</span>'+
       '<span class="pi-mpo-state '+(!displayReason&&!conflict?'pi-mpo-state-ok':'')+'">'+esc(stateText)+'</span></label>';
   }).join('');
   box.innerHTML=matched.length?(html||'<div class="pi-mpo-muted">搜索没有匹配PO</div>'):
     '<div class="pi-mpo-muted">请先选择国家和供应商，或无符合条件的PO</div>';
   const tag=el('pi-multi-po-count');
   if(tag)tag.textContent='已选择 '+state.ids.length+' 张 PO · 可关联 '+eligible.length+
     ' 张 · 待处理 '+(matched.length-eligible.length)+' 张';
 }
 async function toggle(id,checked){
   if(!state.enabled)return;
   const po=(window._piApprovedPOs||[]).find(p=>p.id===id);
   if(!po||!match(po))return;
   const reason=ineligibility(po);
   if(checked&&reason&&!originalFullPO(po,reason)){
     showToast(po.po_no+'：'+reason,'warning');refresh();return;
   }
   const old=state.ids.slice(),oldDetails=state.details.slice();
   const first=(window._piApprovedPOs||[]).find(p=>p.id===old[0]);
   const anchor=first||(state.editMode?state.pi:null);
   if(checked&&!old.includes(id)){
     if(anchor&&!compatible(anchor,po)){
       showToast('只能合并同供应商、国家、品牌、币种、仓库的PO','warning');refresh();return;
     }
     state.ids.push(id);
   } else if(!checked)state.ids=old.filter(x=>x!==id);
   refresh();
   const seq=++state.sequence;
   if(!state.ids.length){
     state.details=[];state.loading=false;
     if(state.editMode)restoreFromPOs([]);
     else resetRows();
     return;
   }
   state.loading=true;
   try{
     const fetched=await Promise.all(state.ids.map(x=>api('/api/purchase-orders/'+encodeURIComponent(x))));
     if(seq!==state.sequence||!state.enabled||!el('pi-multi-po-picker'))return;
     if(fetched.some(x=>!compatible(fetched[0],x)||!match(x)))throw Error('关联PO的属性不一致，不能合并');
     if(state.editMode&&fetched.some(x=>!compatible(state.pi||{},x)))
       throw Error('新关联PO必须与当前PI的品牌、仓库和币种一致');
     state.details=fetched;
     const w=el('npi-wh');
     if(w)await populatePIWarehouse(fetched[0].country);
     if(seq!==state.sequence||!state.enabled||!el('pi-multi-po-picker'))return;
     restoreFromPOs(fetched);state.loading=false;
   }catch(e){
     if(seq!==state.sequence)return;
     state.loading=false;
     if(state.editMode){
       state.ids=old;state.details=oldDetails;refresh();
     }else{
       state.ids=[];resetRows();refresh();
     }
     showToast(e.message||'加载PO失败，请重新选择','danger');
   }
 }
 function install(options={}){
   state.enabled=true;state.ids=Array.isArray(options.selectedIds)?options.selectedIds.slice():[];
   state.sequence++;state.all=[];state.details=[];state.loading=false;
   state.editMode=!!options.editMode;state.originalIds=state.editMode?state.ids.slice():[];
   state.pi=state.editMode?(options.pi||null):null;
   const select=el('npi-po');if(!select)return;
   select.style.display='none';
   const wrapper='<div id="pi-multi-po-shell" style="grid-column:1/-1">'+
     '<div style="font-size:13px;font-weight:600;margin-bottom:7px">关联PO（可搜索、多选）</div>'+
     '<div id="pi-multi-po-count" style="font-size:12px;color:var(--text-secondary,#666);margin-bottom:5px">已选择 '+state.ids.length+' 张 PO</div>'+
     '<input id="pi-multi-po-search" type="search" placeholder="搜索 PO 编号" oninput="piMultiPORefresh()" style="width:100%;max-width:450px;margin-bottom:6px;padding:7px;border:1px solid var(--border,#ddd);border-radius:8px">'+
     '<div id="pi-multi-po-picker" style="max-height:165px;overflow:auto;border:1px solid var(--border,#ddd);border-radius:10px;padding:7px;background:var(--bg-card,#fff)"></div>'+
     '<div style="font-size:11px;color:var(--text-secondary,#888);margin-top:6px">可添加或取消关联PO。草稿、待审批PO也可关联；已作废、已驳回的PO不可新增关联。已全部转PI的PO不可新增关联，但当前PI原有关联可取消或恢复。调整关联后，未保留的PO占用数量会释放。</div></div>'+
     '<style>.pi-mpo-row{display:flex;gap:9px;align-items:center;padding:8px 10px;font-size:12px;cursor:pointer;border-radius:7px}.pi-mpo-row:hover{background:var(--bg-hover,#f4f6f9)}.pi-mpo-row:has(input:disabled){opacity:.65;cursor:not-allowed}.pi-mpo-state{font-size:11px;color:#94622d;margin-left:auto;white-space:nowrap}.pi-mpo-state-ok{color:#26794e}.pi-mpo-muted{font-size:12px;color:var(--text-secondary,#999);padding:12px}</style>';
   const group=select.closest&&select.closest('.form-group');
   if(group){group.insertAdjacentHTML('afterend',wrapper);group.style.display='none';}
   else select.insertAdjacentHTML('afterend',wrapper);
   refresh();
 }
 function disable(){
   state.enabled=false;state.ids=[];state.sequence++;state.details=[];state.loading=false;
   state.editMode=false;state.originalIds=[];state.pi=null;
 }
 root.PIMultiPO={install,disable,refresh,toggle,ids,active:()=>state.enabled,loading:()=>state.loading};
})(window);
function piMultiPORefresh(){window.PIMultiPO.refresh();}
function piMultiPOToggle(id,checked){window.PIMultiPO.toggle(id,checked);}
