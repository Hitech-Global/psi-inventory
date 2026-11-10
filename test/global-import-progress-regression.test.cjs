'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const bigSellerSales = fs.readFileSync(path.join(root, 'assets', 'bigseller-sales-import.js'), 'utf8');
const bigSellerInventory = fs.readFileSync(path.join(root, 'assets', 'bigseller-inventory-import.js'), 'utf8');
const zhisuSales = fs.readFileSync(path.join(root, 'assets', 'zhisu-sales-import.js'), 'utf8');
const zhisuInventory = fs.readFileSync(path.join(root, 'assets', 'zhisu-inventory-import.js'), 'utf8');

test('BigSeller sales import exposes real file-read and parse-stage progress', () => {
  assert.match(bigSellerSales, /function setImportProgress\(win, message, percent, state\)/);
  assert.match(bigSellerSales, /reader\.onprogress = function \(event\)/);
  assert.match(bigSellerSales, /正在读取 BigSeller 销售文件/);
  assert.match(bigSellerSales, /正在解析 Excel 与识别订单/);
  assert.match(bigSellerSales, /正在校验 SKU 与品牌主数据/);
  assert.match(bigSellerSales, /role="progressbar"/);
});

test('BigSeller inventory import exposes file-read, mapping and precheck progress', () => {
  assert.match(bigSellerInventory, /function setInventoryFileProgress/);
  assert.match(bigSellerInventory, /reader\.onprogress = function \(event\)/);
  assert.match(bigSellerInventory, /正在读取 BigSeller 库存文件/);
  assert.match(bigSellerInventory, /正在匹配仓库与品牌主数据/);
  assert.match(bigSellerInventory, /正在校验 SKU 与品牌主数据/);
  assert.match(bigSellerInventory, /role="progressbar"/);
});

test('Zhisu inventory import exposes file-read, mapping and precheck progress', () => {
  assert.match(zhisuInventory, /function setInventoryFileProgress/);
  assert.match(zhisuInventory, /reader\.onprogress = function \(event\)/);
  assert.match(zhisuInventory, /正在读取至速仓库存文件/);
  assert.match(zhisuInventory, /正在匹配国家与目标仓库/);
  assert.match(zhisuInventory, /正在校验 SKU 与品牌主数据/);
  assert.match(zhisuInventory, /role="progressbar"/);
});

test('Zhisu sales retains its existing staged percentage progress', () => {
  assert.match(zhisuSales, /function setImportProgress\(win, message, percent, options\)/);
  assert.match(zhisuSales, /reader\.onprogress = function \(event\)/);
  assert.match(zhisuSales, /正在读取至速仓销售文件/);
  assert.match(zhisuSales, /正在解析 Excel 与识别订单 SKU/);
  assert.match(zhisuSales, /后台 SKU \/ 品牌预检查/);
  assert.match(zhisuSales, /role="progressbar"/);
});
