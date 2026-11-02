'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { COUNTRY_TIMEZONES, resolveShopTimezone } = require('../src/shop-timezone');

test('a shop keeps the timezone it has', () => {
  assert.equal(resolveShopTimezone({ timezone: 'Asia/Jakarta', countryCode: 'MY' }), 'Asia/Jakarta');
  assert.equal(resolveShopTimezone({ timezone: 'GMT+7', countryCode: 'ID' }), 'GMT+7');
});

test('a shop without one gets the timezone its country fixes', () => {
  assert.equal(resolveShopTimezone({ countryCode: 'ID' }), 'Asia/Jakarta');
  assert.equal(resolveShopTimezone({ countryCode: 'MY' }), 'Asia/Kuala_Lumpur');
  assert.equal(resolveShopTimezone({ country_code: 'TH' }), 'Asia/Bangkok');
});

test('a shop whose country does not fix one has no timezone', () => {
  assert.equal(resolveShopTimezone({ countryCode: 'ZZ' }), null);
  assert.equal(resolveShopTimezone({}), null);
  assert.equal(resolveShopTimezone(null), null);
});

test('every market Shopee serves has a timezone', () => {
  for (const code of ['ID', 'MY', 'TH', 'VN', 'PH', 'SG', 'TW', 'BR']) {
    assert.ok(COUNTRY_TIMEZONES[code], `${code} must have a timezone`);
  }
});
