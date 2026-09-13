'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const app = fs.readFileSync('app.js', 'utf8');

function fnBlock(name, nextMarker) {
  const start = app.indexOf('async function ' + name + '(');
  assert.ok(start >= 0, name + ' not found');
  const end = app.indexOf(nextMarker, start);
  assert.ok(end > start, name + ' end marker not found');
  return app.slice(start, end);
}

test('review report reads the same RP snapshot rows as the monthly page', () => {
  const block = fnBlock('rpReviewEnsureViewModel', 'async function openRpReviewReport');
  assert.match(block, /await rpEnsureSnapshotReady\(\)/);
  assert.match(block, /rpLocalSnapshotRows\(\)/);
  assert.doesNotMatch(block, /rpFetchCached\(rpBaseUrl\(\)\)/);
  assert.match(block, /await loadRp\(\)/);
  assert.match(block, /await loadRpChannelMonthly\(tab\)/);
});

test('Excel sheet model uses snapshot rows too, avoiding the same stale-array bug', () => {
  const block = fnBlock('rpSheetModel', '// ============ 订单预测 → 库存周转复盘报告 V1');
  assert.match(block, /await rpEnsureSnapshotReady\(\)/);
  assert.match(block, /rpLocalSnapshotRows\(\)/);
  assert.doesNotMatch(block, /rpFetchCached\(rpBaseUrl\(\)\)/);
});

test('visible monthly page remains snapshot-backed', () => {
  const start = app.indexOf('async function loadRp(){');
  const end = app.indexOf('// 纯显示函数：用真实年月标识每个自然月', start);
  assert.ok(start >= 0 && end > start);
  const block = app.slice(start, end);
  assert.match(block, /await rpEnsureSnapshotReady\(\)/);
  assert.match(block, /var data=rpLocalSnapshotRows\(\)/);
});
