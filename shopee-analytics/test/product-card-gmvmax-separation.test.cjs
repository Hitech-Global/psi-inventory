'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

const index = read('web/index.html');
const sourceRouter = read('src/product-ads-source-router.js');
const queryRepo = read('src/query-repository.js');

assert(!index.includes('data-ads-type="gmvmax"'), 'GMV Max must not render as a Product Card child tab');
assert(!index.includes('data-ads-type="gms"'), 'Product Card overview must not render as a child tab');
for (const type of ['manual', 'groups', 'auto']) assert(index.includes(`data-ads-type="${type}"`));
assert(sourceRouter.includes("adType === 'manual' ? 'MANUAL_PRODUCT_AD' : 'AUTO_PRODUCT_AD'"), '全店推 remains AUTO_PRODUCT_AD');
assert(queryRepo.includes("normalized === 'manual' ? 'MANUAL_PRODUCT_AD' : 'AUTO_PRODUCT_AD'"), 'query contract keeps 全店推 separate from GMS');
assert(!sourceRouter.includes("adType === 'auto' ? 'GMS'"), 'must never alias 全店推 to GMS');

console.log('GMV Max algorithm vs Product Card hierarchy contract: ok');
