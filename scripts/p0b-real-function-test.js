#!/usr/bin/env node
/**
 * P0-B REAL FUNCTION TEST (STATIC)
 *
 * Asserts:
 *   1. module.exports.refreshInventoryTotals present
 *   2. runOriginalInventoryTotalsLoop helper declared
 *   3. async function refreshInventoryTotals(snapshotCutoffDate) exists
 *   4. latestImports query still OUTSIDE transaction() (OLD concurrency boundary)
 *   5. updateInventoryTransitData( appears EXACTLY ONCE within refreshInventoryTotals body
 *   6. that single call is AFTER all transaction blocks, BEFORE return { warnings }
 *   7. empty latestImports: PG path not entered (guarded by latestImports.length > 0)
 */

const fs = require('fs');
const path = require('path');

const srv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

console.log('P0-B REAL FUNCTION TEST (STATIC)');
console.log('');

// --- 1. export present ---
const hasExport = /  app,\s*\n\s*updateInventoryTransitData,\s*\n\s*refreshInventoryTotals,?\s*\n\s*(?:runOriginalInventoryTotalsLoop,?\s*\n\s*)?\}/.test(srv);

// --- 2. helper declared ---
const hasHelper = /function runOriginalInventoryTotalsLoop\(latestImports, snapshotCutoffDate, warnings\)/.test(srv);

// --- 3. async function exists ---
const hasAsync = /async function refreshInventoryTotals\(snapshotCutoffDate\)/.test(srv);

// --- 4. latestImports query OUTSIDE transaction ---
const fnStart = srv.indexOf('async function refreshInventoryTotals(snapshotCutoffDate) {');
const fnStartLine = srv.indexOf('\n', fnStart);
const fnEnd = srv.indexOf('\nasync function updateInventoryTransitData() {', fnStart);
const fnBody = srv.slice(fnStartLine, fnEnd > 0 ? fnEnd : undefined);

const liPos = fnBody.indexOf('const latestImports = query(latestImportsSql()).rows;');
const txFirst = fnBody.indexOf('transaction(() => {');
const keptTxBoundary = liPos >= 0 && txFirst >= 0 && liPos < txFirst;

// --- 5. updateInventoryTransitData( count within refreshInventoryTotals ---
const transitMatches = fnBody.match(/updateInventoryTransitData\(/g) || [];
const transitCount = transitMatches.length;

// --- 6. single transit call is after all transaction keyword blocks, before return ---
// Find last "transaction(() => {" keyword, then its closing "});"
const lastTxKeyword = fnBody.lastIndexOf('transaction(() => {');
const lastTxClosing = fnBody.indexOf('});', lastTxKeyword);
const transitPos = fnBody.indexOf('updateInventoryTransitData().catch');
const returnPos = fnBody.indexOf('return { warnings };', transitPos);
const transitAfterTx = lastTxClosing > 0 && transitPos > lastTxClosing;
const returnAfterTransit = returnPos > transitPos;

// --- 7. empty latestImports guarded ---
const pgGuard = /if \(driver === 'pg' && latestImports\.length > 0\)/.test(fnBody);

const checks = [
  ['module.exports.refreshInventoryTotals present', hasExport],
  ['runOriginalInventoryTotalsLoop helper declared', hasHelper],
  ['async function refreshInventoryTotals(snapshotCutoffDate) exists', hasAsync],
  ['latestImports query OUTSIDE transaction (boundary preserved)', keptTxBoundary],
  ['updateInventoryTransitData( count = EXACTLY 1 (got ' + transitCount + ')', transitCount === 1],
  ['transit call AFTER all transaction blocks', transitAfterTx],
  ['return { warnings } AFTER transit call', returnAfterTransit],
  ['empty latestImports guarded (PG path requires length > 0)', pgGuard],
];

let ok = 0;
for (const [label, pass] of checks) {
  if (pass) ok++;
  console.log('  ' + (pass ? '\u2713' : '\u2717') + ' ' + label);
}
console.log('');
console.log('\u2500\u2500 static real-function assertions: ' + ok + '/' + checks.length + ' OK');
if (ok !== checks.length) process.exit(1);
