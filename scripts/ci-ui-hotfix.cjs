'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const APP_PERF = path.join(__dirname, '..', 'app-perf.js');
const APP_JS = path.join(__dirname, '..', 'app.js');
const INDEX_HTML = path.join(__dirname, '..', 'index.html');
const CI_MULTI_PI_MARKER = '// CI-MULTI-PI-LOAD-SERIALIZER-V1';
const PAGE_RENDER_HELPER_MARKER = '// PAGE-RENDER-EPOCH-HELPER-V1';
const PAGE_RENDER_MARKER = '// PAGE-RENDER-EPOCH-GUARD-V1';
const CI_CREATE_MAC_MARKER = '/* CI-CREATE-MAC-STYLE-V1 */';

function ciMultiPiPatch() {
  return `\n\n${CI_MULTI_PI_MARKER}\n(function (global) {\n  'use strict';\n  if (!global || typeof global.addEventListener !== 'function') return;\n  global.addEventListener('DOMContentLoaded', function () {\n    var original = global.loadMultiPIItems;\n    if (typeof original !== 'function' || original.__ciMultiPiSerialized) return;\n    var tail = Promise.resolve();\n    function serializedLoadMultiPIItems(addedPiIds, removedPiIds) {\n      var added = Array.isArray(addedPiIds) ? addedPiIds.slice() : [];\n      var removed = Array.isArray(removedPiIds) ? removedPiIds.slice() : [];\n      var run = tail.catch(function () {}).then(function () {\n        return original.call(global, added, removed);\n      });\n      tail = run.catch(function () {});\n      return run;\n    }\n    serializedLoadMultiPIItems.__ciMultiPiSerialized = true;\n    serializedLoadMultiPIItems.__original = original;\n    global.loadMultiPIItems = serializedLoadMultiPIItems;\n  }, { once: true });\n})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));\n`;
}

function pageRenderHelperPatch() {
  return `\n\n${PAGE_RENDER_HELPER_MARKER}\n(function (global) {\n  'use strict';\n  if (!global) return;\n  var staleSink = null;\n  global.__psiPageContent = function (epoch) {\n    var liveEpoch = global.__psiPageRenderEpoch || 0;\n    if (!staleSink && typeof document !== 'undefined') staleSink = document.createElement('div');\n    if (epoch !== liveEpoch) return staleSink;\n    if (typeof document === 'undefined') return staleSink;\n    return document.getElementById('content-inner') || staleSink;\n  };\n})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));\n`;
}

function ciCreateMacCss() {
  return `\n${CI_CREATE_MAC_MARKER}\n/* Operational CI create only. CSS-only: no extra request/listener/render delay. */\n.modal-overlay.ci-mode:has(#nci-supplier){background:rgba(242,242,247,.86)}\n.modal-overlay.ci-mode .modal-ci-create:has(#nci-supplier){background:#f5f5f7;border:1px solid rgba(0,0,0,.08);border-radius:18px;box-shadow:0 18px 48px rgba(0,0,0,.14);color:#1d1d1f}\n.modal-overlay.ci-mode .modal-ci-create:has(#nci-supplier) .modal-header{padding:14px 20px;background:rgba(255,255,255,.96);border-bottom:.5px solid #d2d2d7;min-height:52px}\n.modal-overlay.ci-mode .modal-ci-create:has(#nci-supplier) .modal-title{font-size:19px;font-weight:650;letter-spacing:-.2px;color:#1d1d1f}\n.modal-overlay.ci-mode .modal-ci-create:has(#nci-supplier) .modal-close{width:30px;height:30px;padding:0;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#86868b;font-size:22px;line-height:1;transition:background .12s ease,color .12s ease}\n.modal-overlay.ci-mode .modal-ci-create:has(#nci-supplier) .modal-close:hover{background:#ececef;color:#1d1d1f}\n.modal-overlay.ci-mode .modal-ci-create:has(#nci-supplier) .modal-body{padding:18px 20px 22px;background:#f5f5f7}\n.modal-overlay.ci-mode .modal-ci-create:has(#nci-supplier) .form-grid{gap:12px 16px}\n.modal-overlay.ci-mode .modal-ci-create:has(#nci-supplier) .form-group{margin-bottom:12px}\n.modal-overlay.ci-mode .modal-ci-create:has(#nci-supplier) .form-group>label{display:block;margin-bottom:6px;font-size:12px;font-weight:600;color:#6e6e73;letter-spacing:.01em}\n.modal-overlay.ci-mode .modal-ci-create:has(#nci-supplier) .form-group input,\n.modal-overlay.ci-mode .modal-ci-create:has(#nci-supplier) .form-group select,\n.modal-overlay.ci-mode .modal-ci-create:has(#nci-supplier) .form-group textarea{min-height:38px;background:#fff;border:1px solid #d2d2d7;border-radius:10px;color:#1d1d1f;font-size:14px;padding:8px 11px;box-shadow:0 1px 1px rgba(0,0,0,.02);transition:border-color .12s ease,box-shadow .12s ease}\n.modal-overlay.ci-mode .modal-ci-create:has(#nci-supplier) .form-group input:focus,\n.modal-overlay.ci-mode .modal-ci-create:has(#nci-supplier) .form-group select:focus,\n.modal-overlay.ci-mode .modal-ci-create:has(#nci-supplier) .form-group textarea:focus{outline:none;border-color:#007aff;box-shadow:0 0 0 3px rgba(0,122,255,.12)}\n.modal-overlay.ci-mode .modal-ci-create:has(#nci-supplier) .form-group input[readonly]{background:#ededf0!important;color:#6e6e73}\n.modal-overlay.ci-mode .modal-ci-create:has(#nci-supplier) h4{margin:16px 0 9px!important;font-size:14px;font-weight:650;color:#1d1d1f;letter-spacing:-.1px}\n.modal-overlay.ci-mode .modal-ci-create:has(#nci-supplier) #nci-pi-trigger{min-height:40px!important;padding:8px 12px!important;background:#fff!important;border:1px solid #d2d2d7!important;border-radius:10px!important;box-shadow:0 1px 1px rgba(0,0,0,.02)!important}\n.modal-overlay.ci-mode .modal-ci-create:has(#nci-supplier) #nci-pi-dropdown{margin-top:5px!important;background:#fff!important;border:1px solid #d2d2d7!important;border-radius:12px!important;box-shadow:0 12px 30px rgba(0,0,0,.13)!important;overflow:hidden auto!important}\n.modal-overlay.ci-mode .modal-ci-create:has(#nci-supplier) #ci-items-preview{max-height:min(390px,42vh);background:#fff;border:1px solid #e1e1e6;border-radius:12px;overflow:auto!important;box-shadow:0 1px 2px rgba(0,0,0,.03)}\n.modal-overlay.ci-mode .modal-ci-create:has(#nci-supplier) #ci-items-preview .ci-detail-table{width:100%;border-collapse:separate;border-spacing:0;font-size:13px!important;background:#fff}\n.modal-overlay.ci-mode .modal-ci-create:has(#nci-supplier) #ci-items-preview .ci-detail-table th{position:sticky;top:0;z-index:2;padding:9px 10px!important;background:#f2f2f4!important;border-bottom:1px solid #dcdce1!important;color:#6e6e73!important;font-size:12px!important;font-weight:600!important;white-space:nowrap;text-align:left!important}\n.modal-overlay.ci-mode .modal-ci-create:has(#nci-supplier) #ci-items-preview .ci-detail-table td{padding:8px 10px!important;border-bottom:1px solid #ededf0!important;color:#3a3a3c;vertical-align:middle;text-align:left!important;white-space:nowrap}\n.modal-overlay.ci-mode .modal-ci-create:has(#nci-supplier) #ci-items-preview .ci-detail-table tbody tr:last-child td{border-bottom:none!important}\n.modal-overlay.ci-mode .modal-ci-create:has(#nci-supplier) #ci-items-preview .ci-detail-table tbody tr:hover td{background:#fafafa}\n.modal-overlay.ci-mode .modal-ci-create:has(#nci-supplier) #ci-items-preview .ci-detail-table .ci-col-right,\n.modal-overlay.ci-mode .modal-ci-create:has(#nci-supplier) #ci-items-preview .ci-detail-table .ci-col-act,\n.modal-overlay.ci-mode .modal-ci-create:has(#nci-supplier) #ci-items-preview .ci-detail-table .text-right{ text-align:left!important}\n.modal-overlay.ci-mode .modal-ci-create:has(#nci-supplier) #ci-items-preview .ci-detail-table input[type=number]{height:30px!important;min-height:30px!important;padding:4px 7px!important;background:#fff!important;border:1px solid #d2d2d7!important;border-radius:7px!important;color:#1d1d1f!important;font-size:13px!important;text-align:left!important;box-shadow:none!important}\n.modal-overlay.ci-mode .modal-ci-create:has(#nci-supplier) #ci-items-preview .ci-detail-table input[type=number]:focus{outline:none!important;border-color:#007aff!important;box-shadow:0 0 0 2px rgba(0,122,255,.10)!important}\n.modal-overlay.ci-mode .modal-ci-create:has(#nci-supplier) #ci-items-preview::-webkit-scrollbar{width:8px;height:8px}\n.modal-overlay.ci-mode .modal-ci-create:has(#nci-supplier) #ci-items-preview::-webkit-scrollbar-thumb{background:#c7c7cc;border-radius:999px;border:2px solid #fff}\n.modal-overlay.ci-mode .modal-ci-create:has(#nci-supplier) #ci-items-summary{margin-top:10px!important;padding:11px 14px!important;background:#fff!important;border:1px solid #dfe0e4!important;border-radius:11px!important;color:#1d1d1f!important;box-shadow:0 1px 2px rgba(0,0,0,.03)!important}\n.modal-overlay.ci-mode .modal-ci-create:has(#nci-supplier) .modal-footer{padding:11px 20px;background:rgba(255,255,255,.97);border-top:.5px solid #d2d2d7;gap:8px}\n.modal-overlay.ci-mode .modal-ci-create:has(#nci-supplier) .modal-footer .btn{min-height:36px;border-radius:9px;padding:7px 15px;font-size:13px;font-weight:600;box-shadow:none;transform:none}\n.modal-overlay.ci-mode .modal-ci-create:has(#nci-supplier) .modal-footer .btn-secondary{background:#fff;border-color:#d2d2d7;color:#1d1d1f}\n.modal-overlay.ci-mode .modal-ci-create:has(#nci-supplier) .modal-footer .btn-primary{background:#1d1d1f;border-color:#1d1d1f;color:#fff}\n.modal-overlay.ci-mode .modal-ci-create:has(#nci-supplier) .modal-footer .btn-primary:hover{background:#000;border-color:#000}\n`;
}

function patchAppPerfSource(src) {
  let out = src;
  if (!out.includes(CI_MULTI_PI_MARKER)) out = out.replace(/\s*$/, '') + ciMultiPiPatch();
  if (!out.includes(PAGE_RENDER_HELPER_MARKER)) out = out.replace(/\s*$/, '') + pageRenderHelperPatch();
  return out;
}

function patchAppSource(src) {
  if (src.includes(PAGE_RENDER_MARKER)) return src;
  let out = src;
  const showAnchor = 'function showPage(page){';
  if (!out.includes(showAnchor)) throw new Error('[CI-UI-HOTFIX] showPage anchor missing');
  out = out.replace(
    showAnchor,
    showAnchor + '\n  ' + PAGE_RENDER_MARKER + '\n  window.__psiPageRenderEpoch=(window.__psiPageRenderEpoch||0)+1;'
  );

  let asyncRenderCount = 0;
  out = out.replace(/async function (render[A-Za-z0-9_$]+)\s*\(([^)]*)\)\s*\{/g, function (m) {
    asyncRenderCount++;
    return m + '\n  const __psiRenderEpoch=window.__psiPageRenderEpoch||0;';
  });

  let contentWriteCount = 0;
  out = out.replace(/document\.getElementById\((['"])content-inner\1\)\.innerHTML\s*=/g, function () {
    contentWriteCount++;
    return "window.__psiPageContent((typeof __psiRenderEpoch==='undefined')?(window.__psiPageRenderEpoch||0):__psiRenderEpoch).innerHTML=";
  });

  if (asyncRenderCount === 0) throw new Error('[CI-UI-HOTFIX] async render anchors missing');
  if (contentWriteCount === 0) throw new Error('[CI-UI-HOTFIX] content-inner write anchors missing');
  return out;
}

function patchIndexSource(src) {
  if (src.includes(CI_CREATE_MAC_MARKER)) return src;
  const styleClose = '</style>';
  if (!src.includes(styleClose)) throw new Error('[CI-UI-HOTFIX] index style anchor missing');
  return src.replace(styleClose, ciCreateMacCss() + '\n' + styleClose);
}

function apply() {
  const perfSrc = fs.readFileSync(APP_PERF, 'utf8');
  const perfOut = patchAppPerfSource(perfSrc);
  if (perfOut !== perfSrc) fs.writeFileSync(APP_PERF, perfOut, 'utf8');

  const appSrc = fs.readFileSync(APP_JS, 'utf8');
  const appOut = patchAppSource(appSrc);
  if (appOut !== appSrc) fs.writeFileSync(APP_JS, appOut, 'utf8');

  const indexSrc = fs.readFileSync(INDEX_HTML, 'utf8');
  const indexOut = patchIndexSource(indexSrc);
  if (indexOut !== indexSrc) fs.writeFileSync(INDEX_HTML, indexOut, 'utf8');

  execFileSync(process.execPath, ['--check', APP_JS], { stdio: 'inherit' });
  execFileSync(process.execPath, ['--check', APP_PERF], { stdio: 'inherit' });
  console.log('[CI-UI-HOTFIX] multi-PI serialization + page-render epoch guard + CI mac style applied');
}

if (require.main === module) apply();
module.exports = {
  CI_MULTI_PI_MARKER,
  PAGE_RENDER_HELPER_MARKER,
  PAGE_RENDER_MARKER,
  CI_CREATE_MAC_MARKER,
  patchAppPerfSource,
  patchAppSource,
  patchIndexSource
};
