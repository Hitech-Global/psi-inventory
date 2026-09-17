'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const APP_PERF = path.join(__dirname, '..', 'app-perf.js');
const APP_JS = path.join(__dirname, '..', 'app.js');
const CI_MULTI_PI_MARKER = '// CI-MULTI-PI-LOAD-SERIALIZER-V1';
const PAGE_RENDER_HELPER_MARKER = '// PAGE-RENDER-EPOCH-HELPER-V1';
const PAGE_RENDER_MARKER = '// PAGE-RENDER-EPOCH-GUARD-V1';

function ciMultiPiPatch() {
  return `\n\n${CI_MULTI_PI_MARKER}\n(function (global) {\n  'use strict';\n  if (!global || typeof global.addEventListener !== 'function') return;\n  global.addEventListener('DOMContentLoaded', function () {\n    var original = global.loadMultiPIItems;\n    if (typeof original !== 'function' || original.__ciMultiPiSerialized) return;\n    var tail = Promise.resolve();\n    function serializedLoadMultiPIItems(addedPiIds, removedPiIds) {\n      var added = Array.isArray(addedPiIds) ? addedPiIds.slice() : [];\n      var removed = Array.isArray(removedPiIds) ? removedPiIds.slice() : [];\n      var run = tail.catch(function () {}).then(function () {\n        return original.call(global, added, removed);\n      });\n      tail = run.catch(function () {});\n      return run;\n    }\n    serializedLoadMultiPIItems.__ciMultiPiSerialized = true;\n    serializedLoadMultiPIItems.__original = original;\n    global.loadMultiPIItems = serializedLoadMultiPIItems;\n  }, { once: true });\n})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));\n`;
}

function pageRenderHelperPatch() {
  return `\n\n${PAGE_RENDER_HELPER_MARKER}\n(function (global) {\n  'use strict';\n  if (!global) return;\n  var staleSink = null;\n  global.__psiPageContent = function (epoch) {\n    var liveEpoch = global.__psiPageRenderEpoch || 0;\n    if (!staleSink && typeof document !== 'undefined') staleSink = document.createElement('div');\n    if (epoch !== liveEpoch) return staleSink;\n    if (typeof document === 'undefined') return staleSink;\n    return document.getElementById('content-inner') || staleSink;\n  };\n})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));\n`;
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

function apply() {
  const perfSrc = fs.readFileSync(APP_PERF, 'utf8');
  const perfOut = patchAppPerfSource(perfSrc);
  if (perfOut !== perfSrc) fs.writeFileSync(APP_PERF, perfOut, 'utf8');

  const appSrc = fs.readFileSync(APP_JS, 'utf8');
  const appOut = patchAppSource(appSrc);
  if (appOut !== appSrc) fs.writeFileSync(APP_JS, appOut, 'utf8');

  execFileSync(process.execPath, ['--check', APP_JS], { stdio: 'inherit' });
  execFileSync(process.execPath, ['--check', APP_PERF], { stdio: 'inherit' });
  console.log('[CI-UI-HOTFIX] multi-PI serialization + page-render epoch guard applied');
}

if (require.main === module) apply();
module.exports = {
  CI_MULTI_PI_MARKER,
  PAGE_RENDER_HELPER_MARKER,
  PAGE_RENDER_MARKER,
  patchAppPerfSource,
  patchAppSource
};
