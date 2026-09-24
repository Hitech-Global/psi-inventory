'use strict';

const assert = require('assert');
const crypto = require('crypto');
const express = require('express');
const { ShopeeAuthClient } = require('../src/auth-client');
const { ShopeeOAuthService } = require('../src/oauth-service');
const { ShopeeOAuthStateRepository } = require('../src/oauth-state-repository');
const { createOAuthRouter } = require('../src/oauth-router');
const {
  hashState,
  redactSensitive,
  sanitizeForPersistence,
  serializeStateCookie,
  parseCookies,
  loadLiveRedirectUrl,
} = require('../src/oauth-security');
const { encryptTokenBundle } = require('../src/token-crypto');
const { PRODUCTION, OFFLINE_BASELINE, PILOT_GMV_MAX } = require('../src/deployment-mode');

const fixedNow = new Date('2026-09-21T10:00:00.000Z');
const pilotEnv = {
  SHOPEE_ANALYTICS_DEPLOYMENT_MODE: PILOT_GMV_MAX,
  SHOPEE_OAUTH_ENABLE: 'YES',
  SHOPEE_OAUTH_LIVE_REDIRECT_URL: 'https://oauth.example.com/oauth/shopee/callback',
  SHOPEE_OAUTH_STATE_TTL_SECONDS: '600',
  SHOPEE_PILOT_GMV_MAX_SHOP_ID: '1101',
  SHOPEE_PILOT_GMV_MAX_BRAND: 'REDRAGON',
  SHOPEE_PILOT_GMV_MAX_CAMPAIGN_IDS: '2001',
};

class MemoryStateRepository {
  constructor() { this.rows = new Map(); }
  async create(row) {
    this.rows.set(row.stateHash, {
      state_hash: row.stateHash,
      app_role: row.appRole,
      expected_shop_id: row.expectedShopId,
      redirect_uri: row.redirectUri,
      expires_at: row.expiresAt,
      consumed_at: null,
    });
  }
  async findActive({ stateHash, now }) {
    const row = this.rows.get(stateHash);
    return row && !row.consumed_at && row.expires_at > now ? { ...row } : null;
  }
  async consume({ stateHash, now }) {
    const row = this.rows.get(stateHash);
    if (!row || row.consumed_at || row.expires_at <= now) return null;
    row.consumed_at = now;
    return { ...row };
  }
}

function createService({ env = pilotEnv, response, now = () => fixedNow, stateRepository = new MemoryStateRepository(), logger = console } = {}) {
  const saved = [];
  let fetchCalls = 0;
  const service = new ShopeeOAuthService({
    stateRepository,
    tokenRepositoryFactory: () => ({ async save(value) { saved.push(value); } }),
    credentialLoader: () => ({ partnerId: '123', partnerKey: 'SUPER_SECRET_PARTNER_KEY' }),
    env,
    now,
    randomBytes: () => Buffer.alloc(32, 7),
    logger,
    fetchImpl: async (url, options) => {
      fetchCalls += 1;
      assert(!url.includes('SUPER_SECRET_PARTNER_KEY'));
      assert.strictEqual(JSON.parse(options.body).code, 'SUPER_SECRET_CODE');
      return { ok: true, status: 200, text: async () => JSON.stringify(response || {
        shop_id: 1101,
        access_token: 'SUPER_SECRET_ACCESS',
        refresh_token: 'SUPER_SECRET_REFRESH',
        expire_in: 3600,
      }) };
    },
  });
  return { service, stateRepository, saved, get fetchCalls() { return fetchCalls; } };
}

const client = new ShopeeAuthClient({ partnerId: '123', partnerKey: 'SUPER_SECRET_PARTNER_KEY', fetchImpl: async () => { throw new Error('not called'); } });
const url = new URL(client.buildAuthorizationUrl({ redirectUri: pilotEnv.SHOPEE_OAUTH_LIVE_REDIRECT_URL, timestamp: 100 }));
assert.strictEqual(url.origin, 'https://partner.shopeemobile.com');
assert.strictEqual(url.pathname, '/api/v2/shop/auth_partner');
assert.strictEqual(url.searchParams.get('partner_id'), '123');
assert.strictEqual(url.searchParams.get('timestamp'), '100');
assert.strictEqual(url.searchParams.get('redirect'), pilotEnv.SHOPEE_OAUTH_LIVE_REDIRECT_URL);
assert(url.searchParams.get('sign'));
assert.strictEqual(
  url.searchParams.get('sign'),
  crypto.createHmac('sha256', 'SUPER_SECRET_PARTNER_KEY').update('123/api/v2/shop/auth_partner100').digest('hex'),
);
assert.strictEqual(url.searchParams.has('state'), false);
assert(!url.toString().includes('SUPER_SECRET_PARTNER_KEY'));
assert.throws(
  () => loadLiveRedirectUrl({ SHOPEE_OAUTH_LIVE_REDIRECT_URL: 'http://localhost/oauth/shopee/callback' }),
  /HTTPS URL ending/,
);

(async () => {
  const valid = createService();
  const begin = await valid.service.beginAuthorization();
  assert.strictEqual(valid.fetchCalls, 0);
  assert(begin.authorizationUrl.includes('/api/v2/shop/auth_partner'));
  assert.strictEqual(begin.ttlSeconds, 600);
  const result = await valid.service.completeAuthorization({ state: begin.state, code: 'SUPER_SECRET_CODE', shopId: 1101 });
  assert.strictEqual(result.shopId, 1101);
  assert.strictEqual(valid.fetchCalls, 1);
  assert.strictEqual(valid.saved.length, 1);
  assert.strictEqual(valid.saved[0].accessToken, 'SUPER_SECRET_ACCESS');
  assert(valid.saved[0].expiresAt > fixedNow);

  await assert.rejects(
    () => valid.service.completeAuthorization({ state: begin.state, code: 'SUPER_SECRET_CODE', shopId: 1101 }),
    /OAUTH_INVALID_OR_EXPIRED_STATE|OAUTH_INVALID_OR_REPLAYED_STATE/,
  );
  assert.strictEqual(valid.fetchCalls, 1);

  const invalid = createService();
  await assert.rejects(() => invalid.service.completeAuthorization({ state: 'unknown', code: 'SUPER_SECRET_CODE', shopId: 1101 }), /OAUTH_INVALID_OR_EXPIRED_STATE/);
  assert.strictEqual(invalid.fetchCalls, 0);

  const expired = createService({ now: () => new Date('2026-09-21T10:20:01.000Z') });
  await expired.stateRepository.create({ stateHash: hashState('expired'), appRole: 'ADS', expectedShopId: 1101, redirectUri: pilotEnv.SHOPEE_OAUTH_LIVE_REDIRECT_URL, expiresAt: new Date('2026-09-21T10:20:00.000Z') });
  await assert.rejects(() => expired.service.completeAuthorization({ state: 'expired', code: 'SUPER_SECRET_CODE', shopId: 1101 }), /OAUTH_INVALID_OR_EXPIRED_STATE/);
  assert.strictEqual(expired.fetchCalls, 0);

  for (const [label, args, expected] of [
    ['missing code', { code: '', shopId: 1101 }, /OAUTH_MISSING_CODE/],
    ['missing shop', { code: 'SUPER_SECRET_CODE', shopId: '' }, /OAUTH_INVALID_SHOP_ID/],
    ['wrong shop', { code: 'SUPER_SECRET_CODE', shopId: 1102 }, /OAUTH_INVALID_SHOP_ID/],
    ['provider error', { code: 'SUPER_SECRET_CODE', shopId: 1101, providerError: 'denied' }, /OAUTH_PROVIDER_ERROR/],
  ]) {
    const test = createService();
    const started = await test.service.beginAuthorization();
    await assert.rejects(() => test.service.completeAuthorization({ state: started.state, ...args }), expected, label);
    assert.strictEqual(test.fetchCalls, 0, `${label} must not exchange a token`);
    assert.strictEqual(test.saved.length, 0);
  }

  const diagnosticLogs = [];
  const diagnostic = createService({
    logger: { error(message) { diagnosticLogs.push(String(message)); } },
  });
  const diagnosticStart = await diagnostic.service.beginAuthorization();
  await assert.rejects(
    () => diagnostic.service.completeAuthorization({
      state: diagnosticStart.state,
      code: 'SUPER_SECRET_CODE',
      shopId: 1102,
    }),
    /OAUTH_INVALID_SHOP_ID/,
  );
  assert.strictEqual(diagnostic.fetchCalls, 0);
  assert.strictEqual(diagnostic.saved.length, 0);
  assert.deepStrictEqual(diagnosticLogs, [
    '[Shopee OAuth] OAUTH_INVALID_SHOP_ID callbackShopId=1102 expectedShopId=1101',
  ]);
  assert(!diagnosticLogs.join('\n').includes('SUPER_SECRET_'));

  const mismatch = createService({ response: { shop_id: 1102, access_token: 'SUPER_SECRET_ACCESS', refresh_token: 'SUPER_SECRET_REFRESH', expire_in: 3600 } });
  const mismatchStart = await mismatch.service.beginAuthorization();
  await assert.rejects(() => mismatch.service.completeAuthorization({ state: mismatchStart.state, code: 'SUPER_SECRET_CODE', shopId: 1101 }), /OAUTH_RESPONSE_SHOP_MISMATCH/);
  assert.strictEqual(mismatch.fetchCalls, 1);
  assert.strictEqual(mismatch.saved.length, 0);

  const concurrent = createService();
  const concurrentStart = await concurrent.service.beginAuthorization();
  const attempts = await Promise.allSettled([
    concurrent.service.completeAuthorization({ state: concurrentStart.state, code: 'SUPER_SECRET_CODE', shopId: 1101 }),
    concurrent.service.completeAuthorization({ state: concurrentStart.state, code: 'SUPER_SECRET_CODE', shopId: 1101 }),
  ]);
  assert.strictEqual(attempts.filter(row => row.status === 'fulfilled').length, 1);
  assert.strictEqual(concurrent.fetchCalls, 1);

  const offline = createService({ env: { ...pilotEnv, SHOPEE_ANALYTICS_DEPLOYMENT_MODE: OFFLINE_BASELINE } });
  await assert.rejects(() => offline.service.beginAuthorization(), /OAUTH_DISABLED/);
  await assert.rejects(() => offline.service.completeAuthorization({ state: 'anything', code: 'SUPER_SECRET_CODE', shopId: 1101 }), /OAUTH_DISABLED/);
  assert.strictEqual(offline.fetchCalls, 0);

  const production = createService({ env: { ...pilotEnv, SHOPEE_ANALYTICS_DEPLOYMENT_MODE: PRODUCTION } });
  await assert.rejects(() => production.service.beginAuthorization(), /OAUTH_DISABLED/);
  assert.strictEqual(production.fetchCalls, 0);

  const encrypted = encryptTokenBundle({ accessToken: 'SUPER_SECRET_ACCESS', refreshToken: 'SUPER_SECRET_REFRESH' }, crypto.randomBytes(32));
  assert(!encrypted.tokenBlob.includes('SUPER_SECRET_ACCESS'));
  assert(!encrypted.tokenBlob.includes('SUPER_SECRET_REFRESH'));
  const rawError = 'code=SUPER_SECRET_CODE access_token=SUPER_SECRET_ACCESS refresh_token=SUPER_SECRET_REFRESH partner_key=SUPER_SECRET_PARTNER_KEY sign=SUPER_SECRET_SIGN authorization=SUPER_SECRET_AUTH cookie=SUPER_SECRET_COOKIE SHOPEE_TOKEN_MASTER_KEY=SUPER_SECRET_MASTER';
  const sanitized = sanitizeForPersistence(new Error(rawError));
  assert(!sanitized.includes('SUPER_SECRET_'));
  assert(!redactSensitive(`Authorization: Bearer SUPER_SECRET_ACCESS; ${rawError}`).includes('SUPER_SECRET_'));
  const cookie = serializeStateCookie('state-value', 600);
  assert(cookie.includes('Secure') && cookie.includes('HttpOnly') && cookie.includes('SameSite=Lax'));
  assert.strictEqual(parseCookies('x=1; shopee_oauth_state=state-value').shopee_oauth_state, 'state-value');

  // SQL repository contract: atomic consume is one UPDATE constrained by unused + unexpired state.
  const statements = [];
  const repository = new ShopeeOAuthStateRepository({ pool: { async query(sql) { statements.push(sql); return { rows: [] }; } } });
  await repository.consume({ stateHash: 'hash', now: fixedNow });
  assert(statements[0].includes('UPDATE shopee_oauth_states'));
  assert(statements[0].includes('consumed_at IS NULL'));
  assert(statements[0].includes('expires_at>$2'));

  let callbackInput = null;
  const routerApp = express();
  routerApp.use(createOAuthRouter({
    oauthService: {
      async beginAuthorization() { return { state: 'router-state', ttlSeconds: 600, authorizationUrl: 'https://partner.shopeemobile.com/authorize' }; },
      async completeAuthorization(input) { callbackInput = input; return { appRole: 'ADS', shopId: 1101, expiresAt: fixedNow }; },
    },
    logger: { error() { throw new Error('router should not log on valid flow'); } },
  }));
  const server = await new Promise(resolve => { const instance = routerApp.listen(0, '127.0.0.1', () => resolve(instance)); });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const start = await fetch(`${base}/oauth/shopee/start`, { redirect: 'manual' });
    assert.strictEqual(start.status, 302);
    assert.strictEqual(start.headers.get('location'), 'https://partner.shopeemobile.com/authorize');
    const setCookie = start.headers.get('set-cookie');
    assert(setCookie.includes('Secure') && setCookie.includes('HttpOnly'));
    const callback = await fetch(`${base}/oauth/shopee/callback?code=SUPER_SECRET_CODE&shop_id=1101`, {
      headers: { cookie: 'shopee_oauth_state=router-state' },
    });
    assert.strictEqual(callback.status, 200);
    assert.strictEqual(callbackInput.state, 'router-state');
    assert.strictEqual(callbackInput.code, 'SUPER_SECRET_CODE');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }

  console.log('shopee OAuth flow tests: ok');
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
