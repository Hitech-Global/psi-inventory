#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

console.log('P0-B SQLITE REGRESSION (STRUCTURAL)');
console.log('');

const srv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

const helperFn = 'function runOriginalInventoryTotalsLoop(latestImports, snapshotCutoffDate, warnings)';
const helperStart = srv.indexOf(helperFn);
const helperEnd = srv.indexOf('async function refreshInventoryTotals(snapshotCutoffDate) {');
const helperBody = helperStart >= 0 && helperEnd > helperStart ? srv.slice(helperStart, helperEnd) : '';

// refreshInventoryTotals function body
const fnStart = srv.indexOf('async function refreshInventoryTotals(snapshotCutoffDate) {');
const fnStartLine = srv.indexOf('\n', fnStart);
const fnEnd = srv.indexOf('\nasync function updateInventoryTransitData() {', fnStart);
const fnBody = srv.slice(fnStartLine, fnEnd > 0 ? fnEnd : undefined);

// SQLite path = the else branch after PG block, using regex for flexible whitespace
const sqliteMatch = fnBody.match(/transaction\(\(\)\s*=>\s*\{\s*runOriginalInventoryTotalsLoop\(latestImports,\s*snapshotCutoffDate,\s*warnings\);\s*\}\);/);

const checks = [
  ['helper defined', helperStart > 0],
  ['SQLite path exists (else branch with transaction + helper call)', sqliteMatch !== null],
  ['SQLite path section does not contain pgSnapshotSql / pgBatchUpdateSql / pgBatchInsertSql constants',
    (() => {
      // Find the else branch for SQLite
      const elseIdx = fnBody.lastIndexOf('} else {');
      const sqliteBlock = elseIdx >= 0 ? fnBody.slice(elseIdx) : '';
      return sqliteBlock.indexOf('const pgSnapshotSql') === -1 &&
             sqliteBlock.indexOf('const pgBatchUpdateSql') === -1 &&
             sqliteBlock.indexOf('const pgBatchInsertSql') === -1;
    })()],
  ['SQLite transaction block calls runOriginalInventoryTotalsLoop(latestImports,...)',
    sqliteMatch !== null],
  ['updateInventoryTransitData().catch() EXACTLY ONCE in refreshInventoryTotals (got ' + (fnBody.match(/updateInventoryTransitData\(\)\.catch/g) || []).length + ')',
    (fnBody.match(/updateInventoryTransitData\(\)\.catch/g) || []).length === 1],
  ['helper body contains OLD loop: for (const imp of latestImports)',
    helperBody.includes('for (const imp of latestImports)')],
  ['helper body contains OLD latestConfirmedWac(sku,country,wh) call',
    helperBody.includes('const wacRecord = latestConfirmedWac(imp.sku_code, imp.country, imp.warehouse)')],
  ['helper body contains OLD warning messages (2 identical strings)',
    helperBody.includes('未找到最新已确认加权平均成本，已保留原成本，请完成成本确认') &&
    helperBody.includes('未找到已确认加权平均成本，成本与金额暂为 0，请尽快完成成本确认')],
];
let ok = 0;
for (const [label, pass] of checks) {
  if (pass) ok++;
  console.log('  ' + (pass ? '\u2713' : '\u2717') + ' ' + label);
}
console.log('');
console.log('\u2500\u2500 SQLite regression structural: ' + ok + '/' + checks.length + ' passed');
if (ok !== checks.length) process.exit(1);
