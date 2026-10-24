'use strict';

const assert = require('assert');
const { selectConfiguredRuntimeRoles } = require('../src/sync-runtime');

const ads = {
  SHOPEE_ANALYTICS_DEPLOYMENT_MODE: 'PRODUCTION',
  SHOPEE_ADS_PARTNER_ID: '1',
  SHOPEE_ADS_PARTNER_KEY: 'ads-key',
};
assert.deepStrictEqual(selectConfiguredRuntimeRoles({ env: ads }), ['ADS']);

assert.deepStrictEqual(selectConfiguredRuntimeRoles({ env: {
  ...ads,
  SHOPEE_STORE_OPS_PARTNER_ID: '2',
  SHOPEE_STORE_OPS_PARTNER_KEY: 'store-key',
} }), ['ADS', 'STORE_OPS']);
assert.throws(() => selectConfiguredRuntimeRoles({ env: {
  ...ads,
  SHOPEE_ERP_PARTNER_ID: '3',
} }), /partner ID\/key must be configured together/);

assert.throws(() => selectConfiguredRuntimeRoles({ env: {
  SHOPEE_ANALYTICS_DEPLOYMENT_MODE: 'PRODUCTION',
} }), /ADS partner credential is required/);

assert.deepStrictEqual(selectConfiguredRuntimeRoles({ env: {
  SHOPEE_ANALYTICS_DEPLOYMENT_MODE: 'OFFLINE_BASELINE',
} }), []);

assert.deepStrictEqual(selectConfiguredRuntimeRoles({ env: {
  SHOPEE_ANALYTICS_DEPLOYMENT_MODE: 'PILOT_GMV_MAX',
  SHOPEE_ADS_PARTNER_ID: '1',
  SHOPEE_ADS_PARTNER_KEY: 'ads-key',
} }), ['ADS']);

console.log('Shopee sync runtime configured-role tests: ok');
