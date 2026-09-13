'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const server = fs.readFileSync('server.js', 'utf8');
const app = fs.readFileSync('app.js', 'utf8');

test('backend exposes real inventory import status endpoint', () => {
  assert.match(server, /inventory-imports\/bulk-import\/:importId\/status/);
  assert.match(server, /processed_count/);
  assert.match(server, /total_count/);
  assert.match(server, /yieldInventoryImportProgress/);
});

test('backend progress is tied to completed phases, not a timer', () => {
  const start = server.indexOf('const inventoryImportRuns = new Map()');
  const end = server.indexOf('// ==================== 库存总表 ====================', start);
  assert.ok(start >= 0 && end > start);
  const block = server.slice(start, end);
  assert.doesNotMatch(block, /setInterval\s*\(/);
  assert.match(block, /phase: 'writing', percent: 32/);
  assert.match(block, /phase: 'refreshing_inventory', percent: 76/);
  assert.match(block, /phase: 'finalizing', percent: 96/);
  assert.match(block, /status === 'completed' \? 100/);
});

test('frontend renders mac-style progress and sends import_id', () => {
  const start = app.indexOf('var invImportPollTimer=null;');
  const end = app.indexOf('function downloadInvImportErrors(){', start);
  assert.ok(start >= 0 && end > start);
  const block = app.slice(start, end);
  assert.match(block, /border-radius:16px/);
  assert.match(block, /transition:width \.35s ease/);
  assert.match(block, /正在导入 '\+Math\.round\(p\)\+'%'/);
  assert.match(block, /import_id:importId/);
  assert.match(block, /setTimeout\(function\(\)\{pollInvImportStatus\(importId\)\},400\)/);
  assert.doesNotMatch(block, /setInterval\s*\(/);
});

test('existing fail-closed import semantics remain present', () => {
  assert.match(server, /预检查未通过，数据库零写入/);
  assert.match(server, /PG 批量导入失败，整批已回滚/);
  assert.match(server, /refreshInventoryTotalsForKeys\(keys, snapshotCutoffDate\)/);
});
