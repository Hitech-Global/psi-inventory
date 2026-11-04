'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

test('every application the shop holds may be configured', () => {
  const { APP_ROLES, loadAppCredentials } = require('../src/config');
  // The applications on the platform: the advertising and the shop side
  // were there first, the affiliate marketing and the rest came later.
  for (const role of ['ADS', 'STORE_OPS', 'ERP', 'BRAND_PORTAL',
    'MARKETING', 'VIDEO', 'ONLINE', 'STORE_OPS_BRAIN', 'ORDER_ANALYSIS']) {
    assert.ok(APP_ROLES.includes(role), `${role} must be a known application`);
  }
});

test('an application may be held under more than one partner', () => {
  const { loadAppCredentials } = require('../src/config');
  // The advertising under one partner and under another: the first one
  // that answers is the one used, so a partner whose permission is not
  // enough does not stop the others.
  const credentials = loadAppCredentials('ADS', {
    env: {
      SHOPEE_ADS_PARTNER_ID: '2045578,1244903',
      SHOPEE_ADS_PARTNER_KEY: 'key1,key2',
    },
  });
  assert.equal(credentials.length, 2);
  assert.equal(credentials[0].partnerId, '2045578');
  assert.equal(credentials[0].partnerKey, 'key1');
  assert.equal(credentials[1].partnerId, '1244903');
  assert.equal(credentials[1].partnerKey, 'key2');
});

test('an application that has not been configured is simply not there', () => {
  const { loadAppCredentials } = require('../src/config');
  assert.deepStrictEqual(loadAppCredentials('VIDEO', { env: {} }), []);
});

test('the affiliate marketing endpoints belong to the affiliate application', () => {
  const { ENDPOINTS } = require('../src/catalog');
  // Only an application of the affiliate marketing kind may call these,
  // so they must be asked of that application and no other.
  assert.equal(ENDPOINTS.amsShopPerformance.app, 'MARKETING');
  assert.equal(ENDPOINTS.amsConversionReport.app, 'MARKETING');
  assert.equal(ENDPOINTS.amsValidationList.app, 'MARKETING');
  // The commission and the return on it are here, so they need not be
  // read out of the seller centre any more.
  assert.ok(ENDPOINTS.amsValidationReport.path.includes('get_validation_report'));
});

test('the endpoints that are asked of an application are the ones of that application', () => {
  const { ENDPOINTS } = require('../src/catalog');
  const { PRODUCTION_ROLES } = require('../src/deployment-mode');
  for (const [key, endpoint] of Object.entries(ENDPOINTS)) {
    assert.ok(PRODUCTION_ROLES.includes(endpoint.app),
      `${key} asks an application that may not be called: ${endpoint.app}`);
  }
});
