'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
assert.ok(app.includes('async function editHistoricalCI(id)'),'historical CI edit dialog exists');
assert.ok(app.includes('async function saveHistoricalCIEdit(id)'),'historical CI edit save handler exists');
assert.ok(app.includes("editHistoricalCI(\\''+h.id"),'historical CI detail exposes edit action');
assert.ok(app.includes("freight_amount:get('freight')"),'freight amount is included in edit payload');
assert.ok(app.includes("customs_duty_idr:get('duty-idr')"),'customs duty is included in edit payload');
assert.ok(app.includes('SKU 成交价格明细（只读）'),'PI-linked SKU snapshot is visibly protected');
assert.ok(server.includes("app.put('/api/historical-commercial-invoices/:id'"),'historical CI update API exists');
assert.ok(server.includes("requireApiPermission('ci_edit')"),'update API requires CI edit permission');
assert.ok(server.includes('没有金额查看/编辑权限'),'update API enforces amount permission');
assert.ok(server.includes('已有 PI SKU 出货快照或付款流水，总货款和币种已锁定'),'financial fields are locked after linked activity');
assert.ok(server.includes('导入前历史已付款属于原始付款事实'),'legacy paid facts cannot be overwritten');
assert.ok(server.includes('UPDATE historical_commercial_invoice_items SET hci_no=?'),'CI number changes sync to SKU snapshots');
assert.ok(server.includes('UPDATE payment_requests SET source_no=?'),'CI number changes sync to payment request');

const historicalList = app.slice(
  app.indexOf('function renderHistoricalCITable(data)'),
  app.indexOf('\nfunction toggleHistoricalCIDetail')
);
assert.ok(historicalList.includes("hasPermission('ci_edit')?'<button class=\"action-btn\" onclick=\"event.stopPropagation();editHistoricalCI"), 'historical CI list must expose an edit action to users with ci_edit permission');
assert.ok(app.includes("tr.appendChild(cell(srcTable,sourceRow,['操作','Actions']))"), 'the unified CI list must preserve the historical row action cell including edit');


const historicalDetail = app.slice(app.indexOf("async function viewHistoricalCI(id,backPay,backMode)"), app.indexOf("async function editHistoricalCI(id)"));
const skuDetail = historicalDetail.slice(historicalDetail.indexOf("var itemsSection=''"), historicalDetail.indexOf("openModal("));
for (const field of ['unit_price','net_unit_price','ci_amount']) assert.ok(skuDetail.includes('fmtMoney(it.'+field+',h.currency)'), field+' must display the historical CI currency');
assert.ok(!skuDetail.includes('ci-col-right'), 'historical CI SKU detail table must not right-align columns');
assert.ok(skuDetail.includes('font-size:12px;text-align:left'), 'historical CI SKU detail table must be left-aligned without changing its size');

console.log('Historical CI full edit regression: PASS');
