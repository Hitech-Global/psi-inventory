'use strict';

const assert = require('assert');
const { isRealSecret, validateDesktopEnv } = require('../src/desktop-env-validation');

assert.strictEqual(isRealSecret('CHANGE_ME'), false);
assert.strictEqual(isRealSecret('abc'), true);

const env = {
  POSTGRES_DB: 'shopee_analytics',
  POSTGRES_USER: 'shopee',
  POSTGRES_PASSWORD: 'long-random',
  SHOPEE_TOKEN_MASTER_KEY: 'base64-key',
  SHOPEE_ADS_PARTNER_ID: '1',
  SHOPEE_ADS_PARTNER_KEY: 'a',
  SHOPEE_STORE_OPS_PARTNER_ID: '2',
  SHOPEE_STORE_OPS_PARTNER_KEY: 'b',
  SHOPEE_ERP_PARTNER_ID: '3',
  SHOPEE_ERP_PARTNER_KEY: 'c',
  SHOPEE_BRAND_PORTAL_PARTNER_ID: '4',
  SHOPEE_BRAND_PORTAL_PARTNER_KEY: 'd',
  SHOPEE_BACKUP_LOCAL_DIR: 'D:\\backup',
  SHOPEE_NAS_BACKUP_DIR: '\\\\NAS\\backup',
};
assert.deepStrictEqual(validateDesktopEnv(env), { ok: true, errors: [], warnings: [] });

const bad = validateDesktopEnv({ ...env, POSTGRES_PASSWORD: 'CHANGE_TO_A_LONG_RANDOM_PASSWORD' });
assert.strictEqual(bad.ok, false);
assert(bad.errors.some(row => row.includes('POSTGRES_PASSWORD')));

console.log('shopee desktop env validation tests: ok');
