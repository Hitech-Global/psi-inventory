'use strict';
const fs = require('node:fs');
const path = require('node:path');

const APP_PERF = path.join(__dirname, '..', 'app-perf.js');
const CI_MULTI_PI_MARKER = '// CI-MULTI-PI-LOAD-SERIALIZER-V1';

function ciMultiPiPatch() {
  return `\n\n${CI_MULTI_PI_MARKER}\n(function (global) {\n  'use strict';\n  if (!global || typeof global.addEventListener !== 'function') return;\n  global.addEventListener('DOMContentLoaded', function () {\n    var original = global.loadMultiPIItems;\n    if (typeof original !== 'function' || original.__ciMultiPiSerialized) return;\n    var tail = Promise.resolve();\n    function serializedLoadMultiPIItems(addedPiIds, removedPiIds) {\n      var added = Array.isArray(addedPiIds) ? addedPiIds.slice() : [];\n      var removed = Array.isArray(removedPiIds) ? removedPiIds.slice() : [];\n      var run = tail.catch(function () {}).then(function () {\n        return original.call(global, added, removed);\n      });\n      tail = run.catch(function () {});\n      return run;\n    }\n    serializedLoadMultiPIItems.__ciMultiPiSerialized = true;\n    serializedLoadMultiPIItems.__original = original;\n    global.loadMultiPIItems = serializedLoadMultiPIItems;\n  }, { once: true });\n})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));\n`;
}

function patchAppPerfSource(src) {
  if (src.includes(CI_MULTI_PI_MARKER)) return src;
  return src.replace(/\s*$/, '') + ciMultiPiPatch();
}

function apply() {
  const src = fs.readFileSync(APP_PERF, 'utf8');
  const out = patchAppPerfSource(src);
  if (out !== src) fs.writeFileSync(APP_PERF, out, 'utf8');
  console.log('[CI-UI-HOTFIX] multi-PI loader serialization applied');
}

if (require.main === module) apply();
module.exports = { CI_MULTI_PI_MARKER, patchAppPerfSource };
