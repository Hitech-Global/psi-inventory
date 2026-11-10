'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

test('WAC history matrix Latest WAC follows newest confirmation timestamp, not largest version number', () => {
  const start = appSource.indexOf('function _wacHistoryMatrixExportModel(');
  const end = appSource.indexOf('\nasync function exportWacHistoryMatrix', start);
  assert.ok(start >= 0 && end > start, 'export model function must be present');
  const fnSource = appSource.slice(start, end);
  const rows = [
    {
      sku_code: 'NT02P500ECO-016G-S', brand: 'Netac', country: '印度尼西亚',
      warehouse: 'Bekasi Warehouse', version_no: 4, confirmed_at: '2026-08-12 12:00:00',
      last_inbound_date: '2026-08-12', new_avg_cost: 76854, local_currency: 'IDR'
    },
    {
      sku_code: 'NT02P500ECO-016G-S', brand: 'Netac', country: '印度尼西亚',
      warehouse: 'Bekasi Warehouse', version_no: 1, confirmed_at: '2026-11-03 07:13:02',
      last_inbound_date: '2026-11-02', new_avg_cost: 79816.8094, local_currency: 'IDR',
      fx_rate_date: '2026-11-09', rmb_to_local_rate: 5.009638
    }
  ];
  const model = vm.runInNewContext(fnSource + '\n_wacHistoryMatrixExportModel(' + JSON.stringify(rows) + ', {});');
  assert.equal(model.rows.length, 1);
  assert.match(model.rows[0][4], /^79,816\.81 IDR$/);
  assert.equal(model.rows[0][6], '2026-11-02');
  const latestDateHeader = model.headers.find(header => String(header).includes('2026-11-02'));
  assert.ok(latestDateHeader.includes('1 RMB = 5.009638 IDR'));
  assert.ok(latestDateHeader.includes('汇率日 2026-11-09'));
});

test('both screen and export sort latest records by confirmed_at before version_no', () => {
  const comparator = "String(b.confirmed_at||'').localeCompare(String(a.confirmed_at||'')) || Number(b.version_no||0)-Number(a.version_no||0)";
  assert.equal(appSource.split(comparator).length - 1, 2,
    'screen and export must use the same chronological latest-record rule');
  assert.ok(appSource.includes('按WAC实际确认时间最新的记录计算'));
  assert.ok(!appSource.includes('Latest WAC及变化按版本号最新的记录计算'));
});
