'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const { ErpOAuthService } = require('../src/erp-oauth-service');

const masterKey = crypto.randomBytes(32).toString('base64');
const env = {
  SHOPEE_ERP_PARTNER_ID: '123',
  SHOPEE_ERP_PARTNER_KEY: 'k'.repeat(64),
  SHOPEE_ERP_REDIRECT_URL: 'https://analytics.example.com/api/shopee-analytics/erp/oauth/callback',
  SHOPEE_TOKEN_MASTER_KEY: masterKey,
};

/**
 * A pool that answers what the authorization flow asks of it.
 */
function makePool({ authorizedShopIds = [1520133690], profileRows = [] } = {}) {
  const writes = [];
  const registered = [];
  return {
    writes,
    registered,
    async query(sql, args) {
      if (/INSERT INTO shopee_oauth_states/.test(sql)) {
        writes.push({ sql, args });
        return { rows: [] };
      }
      if (/FROM shopee_oauth_states/.test(sql)) {
        return {
          rows: [{
            state_hash: 'x', app_role: 'ERP', expected_shop_id: 0, redirect_uri: 'https://x',
            created_at: new Date(), expires_at: new Date(Date.now() + 600000), consumed_at: null,
            register_mode: 'REGISTER',
            register_country_code: 'ID',
            register_brand_code: 'REDRAGON',
            register_display_name: 'Redragon Indonesia Official',
          }],
        };
      }
      if (/UPDATE shopee_oauth_states/.test(sql)) {
        return { rows: [{
          state_hash: 'x', app_role: 'ERP', expected_shop_id: 0, redirect_uri: 'https://x',
          created_at: new Date(), expires_at: new Date(Date.now() + 600000), consumed_at: new Date(),
          register_mode: 'REGISTER',
          register_country_code: 'ID',
          register_brand_code: 'REDRAGON',
          register_display_name: 'Redragon Indonesia Official',
        }] };
      }
      if (/INSERT INTO shopee_app_tokens/.test(sql)) { writes.push({ sql, args }); return { rows: [] }; }
      if (/INSERT INTO shopee_shop_profiles/.test(sql)) {
        registered.push(args);
        return { rows: [] };
      }
      if (/SELECT shop_id FROM shopee_shop_profiles/.test(sql)) {
        return { rows: profileRows };
      }
      if (/SELECT 1 FROM shopee_shop_profiles/.test(sql)) return { rows: [{}] };
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
}

const fetchImpl = async () => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify({
    shop_id_list: [1520133690],
    access_token: 'a', refresh_token: 'r', expire_in: 14400,
  }),
});

test('adding a shop sends the reader to the platform with the details attached', async () => {
  const pool = makePool();
  const service = new ErpOAuthService({
    pool, env, randomBytes: () => Buffer.alloc(32, 7), fetchImpl,
    now: () => new Date('2026-11-02T10:00:00Z'),
  });
  const result = await service.beginAuthorization({
    shopId: 0,
    register: { countryCode: 'ID', brandCode: 'redragon', displayName: 'Redragon Indonesia Official' },
  });
  assert.equal(result.registering, true);
  assert.equal(result.shopId, null);
  assert.ok(result.authorizationUrl.includes('auth_partner'));

  // The details travel with the request, because the shop's own number is
  // not known until the code is exchanged.
  const state = pool.writes.find(row => /INSERT INTO shopee_oauth_states/.test(row.sql));
  assert(state, 'the request must be recorded');
  assert.strictEqual(state.args[2], 0, 'the shop number is not known yet');
  assert.strictEqual(state.args[5], 'REGISTER');
  assert.strictEqual(state.args[6], 'ID');
  assert.strictEqual(state.args[7], 'REDRAGON');
  assert.strictEqual(state.args[8], 'Redragon Indonesia Official');
});

test('the shop is registered when the code comes back', async () => {
  const pool = makePool();
  const service = new ErpOAuthService({
    pool, env, randomBytes: () => Buffer.alloc(32, 7), fetchImpl,
    now: () => new Date('2026-11-02T10:00:00Z'),
  });
  const result = await service.completeAuthorization({ state: 'state', code: 'one-time-code' });
  assert.equal(result.registered, true);
  assert.equal(result.shopId, 1520133690);
  assert.deepStrictEqual(result.connectedShopIds, [1520133690]);
  // The shop is now known here, with the details the reader gave.
  assert.equal(pool.registered.length, 1);
  assert.strictEqual(Number(pool.registered[0][0]), 1520133690);
  assert.strictEqual(pool.registered[0][3], 'ID');
  assert.strictEqual(pool.registered[0][4], 'REDRAGON');
  // And it has a token of its own.
  const token = pool.writes.find(row => /INSERT INTO shopee_app_tokens/.test(row.sql));
  assert(token, 'the new shop must have a token');
  assert.strictEqual(Number(token.args[1]), 1520133690);
});

test('a shop being added must be given a country, a brand and a name', async () => {
  const pool = makePool();
  const service = new ErpOAuthService({
    pool, env, randomBytes: () => Buffer.alloc(32, 7), fetchImpl,
    now: () => new Date('2026-11-02T10:00:00Z'),
  });
  for (const register of [
    { brandCode: 'R', displayName: 'n' },
    { countryCode: 'ID', displayName: 'n' },
    { countryCode: 'ID', brandCode: 'R' },
  ]) {
    await assert.rejects(() => service.beginAuthorization({ shopId: 0, register }), /INVALID_SHOP_ID/);
  }
});
