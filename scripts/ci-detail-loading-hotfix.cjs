'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const APP_JS = path.join(__dirname, '..', 'app.js');
const INDEX_HTML = path.join(__dirname, '..', 'index.html');
const APP_MARKER = '// CI-DETAIL-LOADING-STATE-V1';
const CSS_MARKER = '/* CI-DETAIL-LOADING-STYLE-V1 */';
const APP_CACHE_VERSION = '20261118-1';
const VIEW_CI_ANCHOR = "async function viewCI(id, backPay, backMode){\n  try{const ci=await api('/api/commercial-invoices/'+id);";
const NEXT_SECTION_MARKER = '// ==================== CI/PL × 物流合并 PHASE A（前端）====================';
const CATCH_ANCHOR = "  }catch(e){showToast(e.message,'danger')}";

function appStartPatch() {
  return `function retryCIDetail(){
  const retry=window.__ciDetailRetry;
  if(retry) viewCI(retry.id,retry.backPay,retry.backMode);
}
async function viewCI(id, backPay, backMode){
  ` + APP_MARKER + `
  const __ciRequestId=(window.__ciDetailRequestSeq||0)+1;
  window.__ciDetailRequestSeq=__ciRequestId;
  window.__ciDetailRetry={id:id,backPay:backPay||null,backMode:backMode||null};
  const __ciLang=typeof getLang==='function'?getLang():'zh';
  const __ciLoadingText=__ciLang==='en'?'Loading CI details…':__ciLang==='id'?'Memuat detail CI…':'正在加载 CI 详情…';
  const __ciLoadingBody='<div class="ci-detail-loading" data-request-id="'+__ciRequestId+'" role="status" aria-live="polite" aria-busy="true">'
    +'<div class="ci-detail-loading-banner"><span class="ci-detail-spinner" aria-hidden="true"></span><span>'+__ciLoadingText+'</span></div>'
    +'<div class="ci-loading-card"><div class="ci-skeleton-title"></div><div class="ci-skeleton-grid">'+new Array(8).fill('<div class="ci-skeleton-field"></div>').join('')+'</div></div>'
    +'<div class="ci-loading-card"><div class="ci-skeleton-title"></div><div class="ci-skeleton-line ci-skeleton-line-wide"></div><div class="ci-skeleton-line"></div><div class="ci-skeleton-line ci-skeleton-line-short"></div></div>'
    +'<div class="ci-loading-card"><div class="ci-skeleton-title"></div><div class="ci-skeleton-grid">'+new Array(4).fill('<div class="ci-skeleton-field"></div>').join('')+'</div></div></div>';
  openModal(__ciLang==='en'?'CI/PL Details':__ciLang==='id'?'Detail CI/PL':'CI/PL详情',__ciLoadingBody,
    '<button class="btn btn-secondary" onclick="closeModal()">'+(__ciLang==='en'?'Close':__ciLang==='id'?'Tutup':'关闭')+'</button>','modal-ci-create');
  try{const ci=await api('/api/commercial-invoices/'+id);
    const __ciLoadingNode=document.querySelector('#modal-content .ci-detail-loading[data-request-id="'+__ciRequestId+'"]');
    const __ciLoadingOverlay=document.getElementById('modal-overlay');
    if(!__ciLoadingNode||!__ciLoadingOverlay||!__ciLoadingOverlay.classList.contains('show'))return;
    window.__ciDetailRetry=null;`;
}

function appCatchPatch() {
  return `  }catch(e){
    const __ciLoadingNode=document.querySelector('#modal-content .ci-detail-loading[data-request-id="'+__ciRequestId+'"]');
    const __ciLoadingOverlay=document.getElementById('modal-overlay');
    if(__ciLoadingNode&&__ciLoadingOverlay&&__ciLoadingOverlay.classList.contains('show')){
      const __ciErrorLang=typeof getLang==='function'?getLang():'zh';
      const __ciErrorTitle=__ciErrorLang==='en'?'Unable to load CI details':__ciErrorLang==='id'?'Gagal memuat detail CI':'CI 详情加载失败';
      const __ciErrorText=esc(e&&e.message?e.message:(__ciErrorLang==='en'?'Please try again.':__ciErrorLang==='id'?'Silakan coba lagi.':'请稍后重试。'));
      __ciLoadingNode.className='ci-detail-loading ci-detail-error-state';
      __ciLoadingNode.setAttribute('role','alert');
      __ciLoadingNode.setAttribute('aria-busy','false');
      __ciLoadingNode.innerHTML='<div class="ci-detail-error-card"><div class="ci-detail-error-icon">!</div>'
        +'<div class="ci-detail-error-title">'+__ciErrorTitle+'</div>'
        +'<div class="ci-detail-error-message">'+__ciErrorText+'</div>'
        +'<div class="ci-detail-error-actions"><button class="btn btn-primary" onclick="retryCIDetail()">'+(__ciErrorLang==='en'?'Try again':__ciErrorLang==='id'?'Coba lagi':'重试')+'</button>'
        +'<button class="btn btn-secondary" onclick="closeModal()">'+(__ciErrorLang==='en'?'Close':__ciErrorLang==='id'?'Tutup':'关闭')+'</button></div></div>';
    }else if(__ciLoadingOverlay&&__ciLoadingOverlay.classList.contains('show')){
      showToast(e&&e.message?e.message:String(e),'danger');
    }
  }`;
}

function patchAppSource(src) {
  if (src.includes(APP_MARKER)) return src;
  if (!src.includes(VIEW_CI_ANCHOR)) throw new Error('[CI-DETAIL-LOADING] viewCI start anchor missing');
  let out = src.replace(VIEW_CI_ANCHOR, appStartPatch());
  const viewStart = out.indexOf(APP_MARKER);
  const nextSection = out.indexOf(NEXT_SECTION_MARKER, viewStart);
  if (nextSection < 0) throw new Error('[CI-DETAIL-LOADING] viewCI end anchor missing');
  const catchAt = out.lastIndexOf(CATCH_ANCHOR, nextSection);
  if (catchAt < viewStart) throw new Error('[CI-DETAIL-LOADING] viewCI catch anchor missing');
  out = out.slice(0, catchAt) + appCatchPatch() + out.slice(catchAt + CATCH_ANCHOR.length);
  return out;
}

function cssPatch() {
  return `
` + CSS_MARKER + `
/* CI detail loading: macOS-style neutral surface, visible progress and subtle skeleton. */
.modal-overlay.ci-mode .modal-ci-create:has(.ci-detail-loading){background:#f5f5f7;border:1px solid rgba(0,0,0,.08);border-radius:18px;box-shadow:0 18px 48px rgba(0,0,0,.14);color:#1d1d1f}
.modal-overlay.ci-mode .modal-ci-create:has(.ci-detail-loading) .modal-header{padding:14px 20px;background:rgba(255,255,255,.96);border-bottom:.5px solid #d2d2d7;min-height:52px}
.modal-overlay.ci-mode .modal-ci-create:has(.ci-detail-loading) .modal-title{font-size:19px;font-weight:650;letter-spacing:-.2px;color:#1d1d1f}
.modal-overlay.ci-mode .modal-ci-create:has(.ci-detail-loading) .modal-body{padding:18px 20px 22px;background:#f5f5f7}
.modal-overlay.ci-mode .modal-ci-create:has(.ci-detail-loading) .modal-footer{padding:11px 20px;background:rgba(255,255,255,.97);border-top:.5px solid #d2d2d7}
.ci-detail-loading{min-height:340px;color:#1d1d1f}
.ci-detail-loading-banner{display:flex;align-items:center;gap:10px;margin-bottom:13px;padding:12px 14px;background:#fff;border:1px solid #e5e5ea;border-radius:12px;color:#6e6e73;font-size:13px;font-weight:550}
.ci-detail-spinner{display:inline-block;flex:0 0 16px;width:16px;height:16px;border:2px solid #d9d9de;border-top-color:#007aff;border-radius:50%;animation:ciDetailSpin .8s linear infinite}
.ci-loading-card{margin-bottom:12px;padding:16px;background:#fff;border:1px solid #e5e5ea;border-radius:14px}
.ci-skeleton-title{width:104px;height:14px;margin-bottom:15px;border-radius:6px;background:#ececf0}
.ci-skeleton-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:11px}
.ci-skeleton-field,.ci-skeleton-line{background:linear-gradient(90deg,#eeeef1 25%,#f8f8fa 42%,#eeeef1 65%);background-size:300% 100%;animation:ciDetailShimmer 1.35s ease-in-out infinite}
.ci-skeleton-field{height:48px;border-radius:9px}
.ci-skeleton-line{width:72%;height:11px;margin-top:10px;border-radius:6px}
.ci-skeleton-line-wide{width:92%;margin-top:0}
.ci-skeleton-line-short{width:48%}
.ci-detail-error-state{display:flex;align-items:center;justify-content:center;min-height:340px}
.ci-detail-error-card{width:min(440px,100%);padding:28px 24px;text-align:center;background:#fff;border:1px solid #e5e5ea;border-radius:16px;box-shadow:0 8px 24px rgba(0,0,0,.04)}
.ci-detail-error-icon{display:flex;align-items:center;justify-content:center;width:34px;height:34px;margin:0 auto 12px;border-radius:50%;background:#fff1f0;color:#d93025;font-size:19px;font-weight:700}
.ci-detail-error-title{color:#1d1d1f;font-size:16px;font-weight:650}
.ci-detail-error-message{margin-top:8px;color:#6e6e73;font-size:13px;line-height:1.55;overflow-wrap:anywhere}
.ci-detail-error-actions{display:flex;justify-content:center;gap:8px;margin-top:18px}
.ci-detail-error-actions .btn{min-height:34px;padding:6px 14px;border-radius:9px;font-size:13px}
@keyframes ciDetailSpin{to{transform:rotate(360deg)}}
@keyframes ciDetailShimmer{to{background-position:-150% 0}}
@media(max-width:760px){.ci-skeleton-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.ci-detail-loading-banner{font-size:12px}}
@media(prefers-reduced-motion:reduce){.ci-detail-spinner,.ci-skeleton-field,.ci-skeleton-line{animation:none}.ci-skeleton-field,.ci-skeleton-line{background:#eeeef1}}
`;
}

function patchIndexSource(src) {
  let out = src;
  if (!out.includes(CSS_MARKER)) {
    const close = '</style>';
    const pos = out.lastIndexOf(close);
    if (pos < 0) throw new Error('[CI-DETAIL-LOADING] index style anchor missing');
    out = out.slice(0, pos) + cssPatch() + '\n' + out.slice(pos);
  }
  const appScriptPattern = /<script src=(['"])app\.js\?v=[^'"]+\1><\/script>/;
  if (!appScriptPattern.test(out)) throw new Error('[CI-DETAIL-LOADING] app.js cache version anchor missing');
  out = out.replace(appScriptPattern, '<script src="app.js?v=' + APP_CACHE_VERSION + '"></script>');
  return out;
}

function apply() {
  const appSrc = fs.readFileSync(APP_JS, 'utf8');
  const appOut = patchAppSource(appSrc);
  if (appOut !== appSrc) fs.writeFileSync(APP_JS, appOut, 'utf8');

  const indexSrc = fs.readFileSync(INDEX_HTML, 'utf8');
  const indexOut = patchIndexSource(indexSrc);
  if (indexOut !== indexSrc) fs.writeFileSync(INDEX_HTML, indexOut, 'utf8');

  execFileSync(process.execPath, ['--check', APP_JS], { stdio: 'inherit' });
  console.log('[CI-DETAIL-LOADING] immediate loading skeleton + retryable error state applied');
}

if (require.main === module) apply();
module.exports = { APP_MARKER, CSS_MARKER, appStartPatch, appCatchPatch, cssPatch, patchAppSource, patchIndexSource };
