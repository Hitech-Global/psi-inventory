'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { encryptTokenBundle, decryptTokenBundle } = require('../src/token-crypto');
const { signPublicRequest } = require('../src/auth-client');
const { ShopeeTokenManager } = require('../src/token-manager');

const key = crypto.randomBytes(32);
const encrypted = encryptTokenBundle({ accessToken: 'a', refreshToken: 'r' }, key);
assert(!encrypted.tokenBlob.includes('"accessToken"'));
assert.deepStrictEqual(
  decryptTokenBundle(encrypted, key),
  { accessToken: 'a', refreshToken: 'r' },
);

const timestamp = 1234567890;
const expected = crypto.createHmac('sha256', 'secret')
  .update('123/api/v2/auth/access_token/get1234567890')
  .digest('hex');
assert.strictEqual(
  signPublicRequest({
    partnerId: '123',
    partnerKey: 'secret',
    path: '/api/v2/auth/access_token/get',
    timestamp,
  }),
  expected,
);

const saved = [];
let refreshCalls = 0;
const tokenRepository = {
  async load() {
    return {
      accessToken: 'expired-access',
      refreshToken: 'refresh-1',
      expiresAt: new Date('2026-09-18T06:00:00Z'),
    };
  },
  async save(value) { saved.push(value); },
  async markRefreshError() {},
};
const manager = new ShopeeTokenManager({
  tokenRepository,
  credentialLoader: () => ({ partnerId: '123', partnerKey: 'secret' }),
  now: () => new Date('2026-09-18T06:00:01Z'),
  fetchImpl: async (url, options) => {
    refreshCalls += 1;
    const body = JSON.parse(options.body);
    assert.strictEqual(body.refresh_token, 'refresh-1');
    assert.strictEqual(body.shop_id, 99);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        access_token: 'new-access',
        refresh_token: 'refresh-2',
        expire_in: 14400,
        partner_id: 123,
        shop_id: 99,
      }),
    };
  },
});

(async () => {
  const [a, b] = await Promise.all([
    manager.getAccessToken({ appRole: 'ADS', shopId: 99 }),
    manager.getAccessToken({ appRole: 'ADS', shopId: 99 }),
  ]);
  assert.strictEqual(a, 'new-access');
  assert.strictEqual(b, 'new-access');
  assert.strictEqual(refreshCalls, 1);
  assert.strictEqual(saved.length, 1);
  assert.strictEqual(saved[0].refreshToken, 'refresh-2');
  assert(saved[0].expiresAt > new Date('2026-09-18T06:00:01Z'));
  console.log('shopee token manager tests: ok');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
