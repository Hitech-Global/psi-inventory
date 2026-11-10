'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'ci-list-inline-logistics.js'), 'utf8');

test('every logistics batch renders an explicit WAC status column', () => {
  assert.match(source, /function wacStatusCellHtml\(batch\)/);
  assert.match(source, /wacStatusCellHtml\(b\)/);
  assert.match(source, /<th>WAC 状态<\/th>/);
  assert.match(source, /ci-list-wac-badge-not-ready/);
});

test('WAC actions depend on batch state and do not mix status badges into the action column', () => {
  const start = source.indexOf('function wacActionsHtml(batch, ciId)');
  const end = source.indexOf('\n\n  var LOGISTICS_INLINE_STATUS_OPTIONS', start);
  assert.ok(start >= 0 && end > start);
  const block = source.slice(start, end);
  assert.match(block, /data-ci-logi-wac-confirm/);
  assert.match(block, /data-ci-logi-wac-exclude/);
  assert.match(block, /data-ci-logi-wac-cc/);
  assert.match(block, /data-ci-logi-wac-restore/);
  assert.match(block, /data-ci-logi-wac-view/);
  assert.doesNotMatch(block, /ci-list-wac-badge/);
});

test('not-ready WAC batches have a visible explanation action', () => {
  assert.match(source, /暂不可计算/);
  assert.match(source, /查看原因/);
  assert.match(source, /data-ci-logi-wac-view/);
});
