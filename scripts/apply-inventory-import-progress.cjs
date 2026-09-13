'use strict';
const fs = require('fs');

function replaceRange(path, startMarker, endMarker, replacement) {
  const src = fs.readFileSync(path, 'utf8');
  const start = src.indexOf(startMarker);
  if (start < 0) throw new Error(`${path}: start marker not found`);
  const end = src.indexOf(endMarker, start);
  if (end < 0) throw new Error(`${path}: end marker not found`);
  fs.writeFileSync(path, src.slice(0, start) + replacement.trimEnd() + '\n\n' + src.slice(end));
}

const serverBlock = fs.readFileSync('scripts/inventory-import-progress.server.txt', 'utf8');
const appBlock = fs.readFileSync('scripts/inventory-import-progress.app.txt', 'utf8');

replaceRange('server.js', "app.post('/api/inventory-imports/bulk-import'", '// ==================== 库存总表 ====================', serverBlock);
replaceRange('app.js', 'async function submitInvBatchImport(){', 'function downloadInvImportErrors(){', appBlock);
console.log('inventory import progress patch applied');
