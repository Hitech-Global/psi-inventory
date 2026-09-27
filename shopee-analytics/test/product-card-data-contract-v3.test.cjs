'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ui = fs.readFileSync(path.join(__dirname, '..', 'web', 'product-card-data-contract-v3.js'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '..', 'src', 'standalone-server.js'), 'utf8');

assert(ui.includes('Product Card 总览'));
assert(ui.includes('单品广告'));
assert(ui.includes('全店推'));
assert(ui.includes('广告组'));
assert(ui.includes('SHOPEE API'));
assert(ui.includes('MANUAL IMPORT'));
assert(ui.includes('当前唯一数据源为 Seller Centre 广告组报表手动批量导入'));
assert(ui.includes('不调用 API 伪造广告组数据'));
assert(server.includes('/product-card-data-contract-v3.js'));

console.log('Product Card data source contract: ok');
