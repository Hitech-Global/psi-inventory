'use strict';

const assert = require('assert');
const {
  membershipFromSetting,
  normalizeCampaignSetting,
  fetchCampaignSettings,
} = require('../src/sync-campaigns');

const raw = {
  campaign_id: 123,
  common_info: {
    ad_type: 'auto',
    ad_name: 'Headset group',
    campaign_status: 'ongoing',
    bidding_method: 'auto',
    campaign_budget: 726000,
    item_id_list: [11, 22],
  },
  auto_bidding_info: { roas_target: 8.3 },
  auto_product_ads_info: [
    { item_id: 22, product_name: 'B' },
    { item_id: 33, product_name: 'C' },
  ],
};
assert.deepStrictEqual(membershipFromSetting(raw), [11, 22, 33]);
const normalized = normalizeCampaignSetting(raw);
assert.strictEqual(normalized.targetRoas, 8.3);
assert.strictEqual(normalized.itemIds.length, 3);

const calls = [];
const client = {
  async shopRequest(req) {
    calls.push(req);
    return { response: { campaign_list: [raw] } };
  },
};

(async () => {
  const ids = Array.from({ length: 101 }, (_, i) => i + 1);
  const result = await fetchCampaignSettings({
    client,
    shopId: 1,
    accessToken: 'token',
    campaignIds: ids,
  });
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(calls[0].query.campaign_id_list.split(',').length, 100);
  assert.strictEqual(calls[0].query.info_type_list, '1,2,3,4');
  assert.strictEqual(result.rows.length, 2);
  console.log('shopee campaigns tests: ok');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
