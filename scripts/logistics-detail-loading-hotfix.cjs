'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const APP_JS = path.join(__dirname, '..', 'app.js');
const INDEX_HTML = path.join(__dirname, '..', 'index.html');
const APP_MARKER = '// LOGISTICS-DETAIL-LOADING-STATE-V1';
const APP_CACHE_VERSION = '20261118-4';
const VIEW_LOG_DETAIL_ANCHOR = "async function viewLogDetail(id){\n  try{\n    const l=await api('/api/logistics-batches/'+id);\n    let plData=null;\n    if(l.pl_id){plData=await api('/api/packing-lists/'+l.pl_id);}";
const NEXT_SECTION_MARKER = 'async function backfillArrival(batchId){';
const CATCH_ANCHOR = "  }catch(e){showToast(e.message,'danger')}\n}";

function preserveEol(original, updated) {
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  return updated.replace(/\r\n/g, '\n').replace(/\n/g, eol);
}

function appStartPatch() {
  return [
    'function retryLogDetail(){',
    '  const retry=window.__logDetailRetry;',
    '  if(retry) viewLogDetail(retry.id);',
    '}',
    'async function viewLogDetail(id){',
    '  ' + APP_MARKER,
    '  const __logRequestId=(window.__logDetailRequestSeq||0)+1;',
    '  window.__logDetailRequestSeq=__logRequestId;',
    '  window.__logDetailRetry={id:id};',
    "  const __logLang=typeof getLang==='function'?getLang():'zh';",
    "  const __logLoadingText=__logLang==='en'?'Loading logistics details…':__logLang==='id'?'Memuat detail logistik…':'正在加载物流详情…';",
    "  const __logLoadingTitle=__logLang==='en'?'Logistics Details':__logLang==='id'?'Detail Logistik':'物流详情';",
    "  const __logLoadingBody='<div class=\"ci-detail-loading log-detail-loading\" data-request-id=\"'+__logRequestId+'\" role=\"status\" aria-live=\"polite\" aria-busy=\"true\">'",
    "    +'<div class=\"ci-detail-loading-banner\"><span class=\"ci-detail-spinner\" aria-hidden=\"true\"></span><span>'+__logLoadingText+'</span></div>'",
    "    +'<div class=\"ci-loading-card\"><div class=\"ci-skeleton-title\"></div><div class=\"ci-skeleton-grid\">'+new Array(8).fill('<div class=\"ci-skeleton-field\"></div>').join('')+'</div></div>'",
    "    +'<div class=\"ci-loading-card\"><div class=\"ci-skeleton-title\"></div><div class=\"ci-skeleton-line ci-skeleton-line-wide\"></div><div class=\"ci-skeleton-line\"></div><div class=\"ci-skeleton-line ci-skeleton-line-short\"></div></div>'",
    "    +'<div class=\"ci-loading-card\"><div class=\"ci-skeleton-title\"></div><div class=\"ci-skeleton-grid\">'+new Array(4).fill('<div class=\"ci-skeleton-field\"></div>').join('')+'</div></div></div>';",
    "  openModal(__logLoadingTitle,__logLoadingBody,",
    "    '<button class=\"btn btn-secondary\" onclick=\"closeModal()\">'+(__logLang==='en'?'Close':__logLang==='id'?'Tutup':'关闭')+'</button>','modal-ci-create');",
    '  try{',
    "    const l=await api('/api/logistics-batches/'+id);",
    "    const __logLoadingNode=document.querySelector('#modal-content .log-detail-loading[data-request-id=\"'+__logRequestId+'\"]');",
    "    const __logLoadingOverlay=document.getElementById('modal-overlay');",
    "    if(!__logLoadingNode||!__logLoadingOverlay||!__logLoadingOverlay.classList.contains('show'))return;",
    '    let plData=null;',
    "    if(l.pl_id){plData=await api('/api/packing-lists/'+l.pl_id);}",
    "    const __logCurrentNode=document.querySelector('#modal-content .log-detail-loading[data-request-id=\"'+__logRequestId+'\"]');",
    "    if(!__logCurrentNode||!__logLoadingOverlay.classList.contains('show'))return;",
    '    window.__logDetailRetry=null;'
  ].join('\n');
}

function appCatchPatch() {
  return [
    '  }catch(e){',
    "    const __logLoadingNode=document.querySelector('#modal-content .log-detail-loading[data-request-id=\"'+__logRequestId+'\"]');",
    "    const __logLoadingOverlay=document.getElementById('modal-overlay');",
    "    if(__logLoadingNode&&__logLoadingOverlay&&__logLoadingOverlay.classList.contains('show')){",
    "      const __logErrorLang=typeof getLang==='function'?getLang():'zh';",
    "      const __logErrorTitle=__logErrorLang==='en'?'Unable to load logistics details':__logErrorLang==='id'?'Gagal memuat detail logistik':'物流详情加载失败';",
    "      const __logErrorText=esc(e&&e.message?e.message:(__logErrorLang==='en'?'Please try again.':__logErrorLang==='id'?'Silakan coba lagi.':'请稍后重试。'));",
    "      __logLoadingNode.className='ci-detail-loading ci-detail-error-state log-detail-loading log-detail-error-state';",
    "      __logLoadingNode.setAttribute('role','alert');",
    "      __logLoadingNode.setAttribute('aria-busy','false');",
    "      __logLoadingNode.innerHTML='<div class=\"ci-detail-error-card\"><div class=\"ci-detail-error-icon\">!</div>'",
    "        +'<div class=\"ci-detail-error-title\">'+__logErrorTitle+'</div>'",
    "        +'<div class=\"ci-detail-error-message\">'+__logErrorText+'</div>'",
    "        +'<div class=\"ci-detail-error-actions\"><button class=\"btn btn-primary\" onclick=\"retryLogDetail()\">'+(__logErrorLang==='en'?'Try again':__logErrorLang==='id'?'Coba lagi':'重试')+'</button>'",
    "        +'<button class=\"btn btn-secondary\" onclick=\"closeModal()\">'+(__logErrorLang==='en'?'Close':__logErrorLang==='id'?'Tutup':'关闭')+'</button></div></div>';",
    '    }',
    '  }',
    '}'
  ].join('\n');
}

function patchAppSource(src) {
  if (src.includes(APP_MARKER)) return src;
  let out = src.replace(/\r\n/g, '\n');
  if (!out.includes(VIEW_LOG_DETAIL_ANCHOR)) {
    throw new Error('[LOGISTICS-DETAIL-LOADING] viewLogDetail start anchor missing');
  }
  out = out.replace(VIEW_LOG_DETAIL_ANCHOR, appStartPatch());
  const viewStart = out.indexOf(APP_MARKER);
  const nextSection = out.indexOf(NEXT_SECTION_MARKER, viewStart);
  if (nextSection < 0) throw new Error('[LOGISTICS-DETAIL-LOADING] viewLogDetail end anchor missing');
  const catchAt = out.lastIndexOf(CATCH_ANCHOR, nextSection);
  if (catchAt < viewStart) throw new Error('[LOGISTICS-DETAIL-LOADING] viewLogDetail catch anchor missing');
  out = out.slice(0, catchAt) + appCatchPatch() + out.slice(catchAt + CATCH_ANCHOR.length);
  return preserveEol(src, out);
}

function patchIndexSource(src) {
  let out = src.replace(/\r\n/g, '\n');
  const appScriptPattern = /<script src=(['"])app\.js\?v=[^'"]+\1><\/script>/;
  if (!appScriptPattern.test(out)) throw new Error('[LOGISTICS-DETAIL-LOADING] app.js cache version anchor missing');
  out = out.replace(appScriptPattern, '<script src="app.js?v=' + APP_CACHE_VERSION + '"></script>');
  return preserveEol(src, out);
}

function apply() {
  const appSrc = fs.readFileSync(APP_JS, 'utf8');
  const appOut = patchAppSource(appSrc);
  if (appOut !== appSrc) fs.writeFileSync(APP_JS, appOut, 'utf8');

  const indexSrc = fs.readFileSync(INDEX_HTML, 'utf8');
  const indexOut = patchIndexSource(indexSrc);
  if (indexOut !== indexSrc) fs.writeFileSync(INDEX_HTML, indexOut, 'utf8');

  execFileSync(process.execPath, ['--check', APP_JS], { stdio: 'inherit' });
  console.log('[LOGISTICS-DETAIL-LOADING] immediate loading skeleton + retryable error state applied');
}

if (require.main === module) apply();
module.exports = { APP_MARKER, APP_CACHE_VERSION, appStartPatch, appCatchPatch, patchAppSource, patchIndexSource };
