'use strict';
const fs = require('fs');

function replaceRange(path, startMarkers, endMarker, replacement) {
  const src = fs.readFileSync(path, 'utf8');
  const markers = Array.isArray(startMarkers) ? startMarkers : [startMarkers];
  let start = -1;
  for (const marker of markers) {
    const idx = src.indexOf(marker);
    if (idx >= 0 && (start < 0 || idx < start)) start = idx;
  }
  if (start < 0) throw new Error(`${path}: start marker not found`);
  const end = src.indexOf(endMarker, start);
  if (end < 0) throw new Error(`${path}: end marker not found`);
  fs.writeFileSync(path, src.slice(0, start) + replacement.trimEnd() + '\n\n' + src.slice(end));
}

const serverBlock = fs.readFileSync('scripts/inventory-import-progress.server.txt', 'utf8')
  .replace("phase: 'preparing', percent: 12, processed_count: totalCount", "phase: 'preparing', percent: 12, processed_count: 0");
const appBlock = fs.readFileSync('scripts/inventory-import-progress.app.txt', 'utf8');

replaceRange('server.js', ["const inventoryImportRuns = new Map();", "app.post('/api/inventory-imports/bulk-import'"], '// ==================== 库存总表 ====================', serverBlock);
replaceRange('app.js', ['var invImportPollTimer=null;', 'async function submitInvBatchImport(){'], 'function downloadInvImportErrors(){', appBlock);
console.log('inventory import progress patch applied');
