'use strict';

const assert = require('assert');
const {
  requiredIsoDate,
  assertPilotDiscoveryAllowed,
  discoverGmsCampaign,
} = require('../scripts/discover-pilot-gms.cjs');

const env = {
  SHOPEE_ANALYTICS_DEPLOYMENT_MODE: 'PILOT_GMV_MAX',
  SHOPEE_PILOT_GMV_MAX_SHOP_ID: '1101364305',
  SHOPEE_PILOT_GMV_MAX_BRAND: 'REDRAGON',
  SHOPEE_PILOT_GMV_MAX_CAMPAIGN_IDS: '',
  SHOPEE_OAUTH_ENABLE: 'YES',
  SHOPEE_PILOT_DISCOVERY_ENABLE: 'YES',
  SHOPEE_PILOT_DISCOVERY_START_DATE: '2026-09-16',
  SHOPEE_PILOT_DISCOVERY_END_DATE: '2026-09-22',
};

assert.deepStrictEqual(assertPilotDiscoveryAllowed(env), { shopId: 1101364305, brand: 'REDRAGON' });
assert.throws(
  () => assertPilotDiscoveryAllowed({ ...env, SHOPEE_PILOT_DISCOVERY_ENABLE: 'NO' }),
  /Refusing Pilot GMS discovery/,
);
assert.throws(
  () => assertPilotDiscoveryAllowed({ ...env, SHOPEE_PILOT_GMV_MAX_CAMPAIGN_IDS: '492245682' }),
  /allowed only during PILOT_GMV_MAX OAuth bootstrap/,
);
assert.strictEqual(requiredIsoDate('SHOPEE_PILOT_DISCOVERY_START_DATE', env), '2026-09-16');
assert.throws(() => requiredIsoDate('BAD_DATE', { BAD_DATE: '16-09-2026' }), /YYYY-MM-DD/);

(async () => {
  const calls = [];
  const client = {
    async shopRequest(request) {
      calls.push(request);
      return {
        response: {
          campaign_id: 492245682,
          report: {
            impression: 1000,
            clicks: 50,
            expense: 100,
            broad_gmv: 700,
            broad_order: 10,
            direct_gmv: 500,
            direct_order: 7,
          },
        },
      };
    },
  };

  const result = await discoverGmsCampaign({
    client,
    shopId: 1101364305,
    accessToken: 'fixture-token',
    startDate: '2026-09-16',
    endDate: '2026-09-22',
  });
  assert.strictEqual(result.campaignId, 492245682);
  assert.strictEqual(result.performance.broadRoas, 7);
  assert.strictEqual(calls.length, 1);
  assert(calls[0].path.includes('get_gms_campaign_performance'));
  assert.strictEqual(calls[0].method, 'POST');
  assert.deepStrictEqual(calls[0].body, { start_date: '16-09-2026', end_date: '22-09-2026' });
  assert.strictEqual(Object.prototype.hasOwnProperty.call(calls[0].body, 'campaign_id'), false);

  await assert.rejects(
    discoverGmsCampaign({
      client: { async shopRequest() { return { response: { report: {} } }; } },
      shopId: 1101364305,
      accessToken: 'fixture-token',
      startDate: '2026-09-16',
      endDate: '2026-09-22',
    }),
    /did not return a valid campaign_id/,
  );
  console.log('shopee pilot GMS discovery tests: ok');
})().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
