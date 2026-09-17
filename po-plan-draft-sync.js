(function(global){
'use strict';

function q(id){return document.getElementById(id);}
function readNumber(el){
  if(!el)return 0;
  const n=Number(el.value);
  return Number.isFinite(n)?n:0;
}
function syncEditDraft(){
  const p=global._ppEdit;
  if(!p||!Array.isArray(p.items))return;
  p.items.forEach((row,i)=>{
    const sku=q('pp-e-s-'+i),qty=q('pp-e-q-'+i);
    if(sku)row.sku_code=sku.value.trim();
    if(qty)row.planned_qty=readNumber(qty);
  });
}
function syncCreateDraft(){
  const rows=global._ppCreateRows;
  if(!Array.isArray(rows))return;
  rows.forEach((row,i)=>{
    const sku=q('pp-c-s-'+i),qty=q('pp-c-q-'+i);
    if(sku)row.sku=sku.value.trim();
    if(qty)row.qty=readNumber(qty);
  });
}
function updateSingleInput(target){
  let m=target.id&&target.id.match(/^pp-e-([sq])-(\d+)$/);
  if(m&&global._ppEdit&&Array.isArray(global._ppEdit.items)){
    const row=global._ppEdit.items[Number(m[2])];
    if(row){if(m[1]==='s')row.sku_code=target.value.trim();else row.planned_qty=readNumber(target);}
    return;
  }
  m=target.id&&target.id.match(/^pp-c-([sq])-(\d+)$/);
  if(m&&Array.isArray(global._ppCreateRows)){
    const row=global._ppCreateRows[Number(m[2])];
    if(row){if(m[1]==='s')row.sku=target.value.trim();else row.qty=readNumber(target);}
  }
}

document.addEventListener('input',e=>{
  const t=e.target;
  if(t&&t.id)updateSingleInput(t);
},true);

document.addEventListener('click',e=>{
  const t=e.target&&e.target.closest?e.target.closest('button'):null;
  if(!t)return;
  if(t.id==='pp-e-add'||(t.dataset&&t.dataset.rm!=null&&q('pp-edit-items')))syncEditDraft();
  if(t.id==='pp-add'||(t.dataset&&t.dataset.rm!=null&&q('pp-create-items')))syncCreateDraft();
},true);

})(window);
