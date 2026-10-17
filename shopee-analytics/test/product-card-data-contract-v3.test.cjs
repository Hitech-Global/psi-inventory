'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ui = fs.readFileSync(path.join(__dirname, '..', 'web', 'product-card-data-contract-v3.js'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '..', 'src', 'standalone-server.js'), 'utf8');

for (const label of ['单品广告', '广告组', '全店推']) assert(ui.includes(label));
assert(!ui.includes("gmvmax:"), 'GMV Max must not be a Product Card tab');
assert(!ui.includes("gms:"), 'overview must not be a Product Card tab');
assert(ui.includes('SHOPEE API'));
assert(ui.includes('MANUAL IMPORT'));
assert(ui.includes('productCardContextV2'));
assert(ui.includes('productCardSourceV2'));
assert(ui.includes('source-dot'));
assert(!ui.includes('product-card-source-matrix'));
assert(server.includes('/product-card-data-contract-v3.js'));

console.log('Product Card compact three-tab data contract: ok');
