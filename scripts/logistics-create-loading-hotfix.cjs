'use strict';
const fs = require('node:fs');
const path = require('node:path');

const APP_JS = path.join(__dirname, '..', 'app.js');
const INDEX_HTML = path.join(__dirname, '..', 'index.html');
const APP_MARKER = '// LOGISTICS-CREATE-LOADING-V1';
const CSS_MARKER = '/* LOGISTICS-CREATE-LOADING-STYLE-V1 */';

function helperPatch() {
  return `
${APP_MARKER}
function showLogisticsCreateLoading(stage){
  const formStage=stage==='form';
  const headline=formStage?'正在加载物流批次表单…':'正在加载新建物流批次…';
  const detail=formStage?'正在读取 CI 明细、费用与 SKU 数据，请稍候。':'正在加载可用 CI、货代与负责人数据，请稍候。';
  const body='<div id="logistics-create-loading" class="logistics-create-loading" role="status" aria-live="polite">'
    +'<div class="logistics-create-spinner" aria-hidden="true"></div>'
    +'<div class="logistics-create-loading-title">'+headline+'</div>'
    +'<div class="logistics-create-loading-detail">'+detail+'</div>'
    +'<div class="logistics-create-loading-skeleton"><span></span><span></span><span></span></div>'
    +'</div>';
  openModal('新建物流批次',body,'','modal-ci-create');
}
function closeLogisticsCreateLoading(){
  if(document.getElementById('logistics-create-loading')) closeModal();
}
`;
}

function cssPatch() {
  return `
${CSS_MARKER}
.modal-overlay.ci-mode .modal-ci-create:has(#logistics-create-loading){background:#f5f5f7;border:1px solid rgba(0,0,0,.08);border-radius:18px;box-shadow:0 18px 48px rgba(0,0,0,.14);color:#1d1d1f}
.modal-overlay.ci-mode .modal-ci-create:has(#logistics-create-loading) .modal-header{padding:14px 20px;background:rgba(255,255,255,.97);border-bottom:.5px solid #d2d2d7;min-height:52px}
.modal-overlay.ci-mode .modal-ci-create:has(#logistics-create-loading) .modal-title{font-size:19px;font-weight:650;letter-spacing:-.2px;color:#1d1d1f}
.modal-overlay.ci-mode .modal-ci-create:has(#logistics-create-loading) .modal-close{display:none}
.modal-overlay.ci-mode .modal-ci-create:has(#logistics-create-loading) .modal-body{padding:0;background:#f5f5f7}
.logistics-create-loading{min-height:260px;padding:46px 28px 38px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
.logistics-create-spinner{width:34px;height:34px;border:3px solid #d9d9de;border-top-color:#1d1d1f;border-radius:50%;animation:logisticsCreateSpin .8s linear infinite}
.logistics-create-loading-title{margin-top:18px;color:#1d1d1f;font-size:16px;font-weight:650;letter-spacing:-.1px}
.logistics-create-loading-detail{margin-top:7px;max-width:430px;color:#86868b;font-size:13px;line-height:1.55}
.logistics-create-loading-skeleton{width:min(430px,80%);margin-top:24px;display:grid;gap:8px}
.logistics-create-loading-skeleton span{display:block;height:10px;border-radius:999px;background:linear-gradient(90deg,#e7e7eb 25%,#f5f5f7 50%,#e7e7eb 75%);background-size:200% 100%;animation:logisticsCreateShimmer 1.15s ease-in-out infinite}
.logistics-create-loading-skeleton span:nth-child(2){width:86%}
.logistics-create-loading-skeleton span:nth-child(3){width:70%}
@keyframes logisticsCreateSpin{to{transform:rotate(360deg)}}
@keyframes logisticsCreateShimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
`;
}

function findFunctionRange(src, name) {
  const token='async function '+name+'(';
  const start=src.indexOf(token);
  if(start<0) throw new Error('[LOGISTICS-CREATE-LOADING] function missing: '+name);
  const open=src.indexOf('{', start);
  if(open<0) throw new Error('[LOGISTICS-CREATE-LOADING] opening brace missing: '+name);
  let depth=0, quote='', escaped=false, lineComment=false, blockComment=false;
  for(let i=open;i<src.length;i++){
    const ch=src[i], next=src[i+1];
    if(lineComment){ if(ch==='\n') lineComment=false; continue; }
    if(blockComment){ if(ch==='*'&&next==='/'){ blockComment=false; i++; } continue; }
    if(quote){
      if(escaped){ escaped=false; continue; }
      if(ch==='\\'){ escaped=true; continue; }
      if(ch===quote) quote='';
      continue;
    }
    if(ch==='/'&&next==='/'){ lineComment=true; i++; continue; }
    if(ch==='/'&&next==='*'){ blockComment=true; i++; continue; }
    if(ch==='\''||ch==='"'||ch==='`'){ quote=ch; continue; }
    if(ch==='{') depth++;
    else if(ch==='}'){
      depth--;
      if(depth===0) return { start, open, end:i };
    }
  }
  throw new Error('[LOGISTICS-CREATE-LOADING] closing brace missing: '+name);
}

function patchFunction(src, name, call) {
  const r=findFunctionRange(src,name);
  let segment=src.slice(r.start,r.end+1);
  if(!segment.includes(call)){
    const localOpen=segment.indexOf('{');
    segment=segment.slice(0,localOpen+1)+'\n  '+call+segment.slice(localOpen+1);
  }
  segment=segment.replace(/catch\s*\(e\)\s*\{\s*showToast\(e\.message\s*,\s*'danger'\)\s*;?\s*\}/g,
    "catch(e){ closeLogisticsCreateLoading(); showToast(e.message,'danger'); }");
  if(name==='createLogFromCI'){
    segment=segment.replace(/if\s*\(remaining<=0\)\s*\{\s*showToast/g,
      'if(remaining<=0){ closeLogisticsCreateLoading(); showToast');
  }
  return src.slice(0,r.start)+segment+src.slice(r.end+1);
}

function patchAppSource(src) {
  if(src.includes(APP_MARKER)) return src;
  let out=src;
  out=patchFunction(out,'createLogWithPL',"showLogisticsCreateLoading('list');");
  out=patchFunction(out,'selectCIForPL',"showLogisticsCreateLoading('form');");
  out=patchFunction(out,'createLogFromCI',"showLogisticsCreateLoading('form');");
  const anchor='async function createLogWithPL()';
  const pos=out.indexOf(anchor);
  if(pos<0) throw new Error('[LOGISTICS-CREATE-LOADING] create anchor missing');
  out=out.slice(0,pos)+helperPatch()+'\n'+out.slice(pos);
  return out;
}

function patchIndexSource(src) {
  if(src.includes(CSS_MARKER)) return src;
  const close='</style>';
  const pos=src.lastIndexOf(close);
  if(pos<0) throw new Error('[LOGISTICS-CREATE-LOADING] index style anchor missing');
  return src.slice(0,pos)+cssPatch()+'\n'+src.slice(pos);
}

function apply(){
  const app=fs.readFileSync(APP_JS,'utf8');
  const appOut=patchAppSource(app);
  if(appOut!==app) fs.writeFileSync(APP_JS,appOut,'utf8');
  const html=fs.readFileSync(INDEX_HTML,'utf8');
  const htmlOut=patchIndexSource(html);
  if(htmlOut!==html) fs.writeFileSync(INDEX_HTML,htmlOut,'utf8');
  console.log('[LOGISTICS-CREATE-LOADING] immediate staged loading feedback applied');
}

if(require.main===module) apply();
module.exports={APP_MARKER,CSS_MARKER,helperPatch,cssPatch,patchAppSource,patchIndexSource};
