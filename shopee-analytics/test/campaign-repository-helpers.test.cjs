'use strict';

const assert = require('assert');
const {
  comparableSetting,
  changedSettingFields,
  setDiff,
} = require('../src/campaign-repository');

const before = comparableSetting({
  status: 'ONGOING',
  bidding_method: 'GMV_MAX',
  campaign_budget: '100000',
  target_roas: '8.3',
});
const after = comparableSetting({
  campaignStatus: 'ONGOING',
  biddingMethod: 'GMV_MAX',
  campaignBudget: 120000,
  targetRoas: 7.2,
});
assert.deepStrictEqual(
  changedSettingFields(before, after),
  ['campaignBudget', 'targetRoas'],
);

assert.deepStrictEqual(
  setDiff([1, 2, 3], [2, 3, 4]),
  { added: [4], removed: [1] },
);

console.log('shopee campaign repository helper tests: ok');
