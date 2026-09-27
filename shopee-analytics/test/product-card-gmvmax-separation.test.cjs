'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

const index = read('web/index.html');
const ui = read('web/product-card-ui-v2.js');
const app = read('web/app.js');
const sourceRouter = read('src/product-ads-source-router.js');
const queryRepo = read('src/query-repository.js');

assert(index.includes('data-ads-type="gmvmax"'), 'GMV Max needs its own Product Card tab');
assert(ui.includes("gmvmax: 'GMV Max'"), 'Product Card UI must label the GMV Max tab');
assert(index.includes('id="adsGmsPanel"></div>'), 'overview needs its own static panel');
assert(index.includes('id="adsGmvMaxPanel" class="hidden"'), 'GMV Max needs its own static panel');
assert(!ui.includes('appendChild(legacySummary)'), 'GMV Max panel must not depend on runtime DOM moves');
assert(app.includes("state.adsType === 'gmvmax'"));
assert(app.includes('loadGmvMaxCampaigns()'));
assert(sourceRouter.includes("adType === 'manual' ? 'MANUAL_PRODUCT_AD' : 'AUTO_PRODUCT_AD'"), '全店推 must remain AUTO_PRODUCT_AD');
assert(queryRepo.includes("normalized === 'manual' ? 'MANUAL_PRODUCT_AD' : 'AUTO_PRODUCT_AD'"), 'query contract must keep 全店推 separate from GMS');
assert(!sourceRouter.includes("adType === 'auto' ? 'GMS'"), 'must never alias 全店推 to GMS');

console.log('Product Card GMV Max separation contract: ok');
