'use strict';
const assert = require('assert');
const crypto = require('crypto');
const {
  BrandPortalOAuthService,
  resolveBrandPortalRedirectUrl,
  stateCookie,
  BRAND_PORTAL_CALLBACK_PATH,
} = require('../src/brand-portal-oauth-service');

assert.strictEqual(
  resolveBrandPortalRedirectUrl({ FEISHU_EXTERNAL_BASE_URL: 'https://analytics.example.com' }),
  `https://analytics.example.com${BRAND_PORTAL_CALLBACK_PATH}`,
);
assert(stateCookie('abc', 600).includes('HttpOnly'));
assert(stateCookie('abc', 600).includes('SameSite=Lax'));

const masterKey = crypto.randomBytes(32).toString('base64');
const env = {
  SHOPEE_BRAND_PORTAL_PARTNER_ID: '123',
  SHOPEE_BRAND_PORTAL_PARTNER_KEY: 'secret',
  FEISHU_EXTERNAL_BASE_URL: 'https://analytics.example.com',
  SHOPEE_OAUTH_STATE_TTL_SECONDS: '600',
  SHOPEE_TOKEN_MASTER_KEY: masterKey,
};
const activeState = {
  state_hash: crypto.createHash('sha256').update(Buffer.alloc(32, 7).toString('base64url')).digest('hex'),
  app_role: 'BRAND_PORTAL',
  expected_shop_id: 1326456001,
  redirect_uri: `https://analytics.example.com${BRAND_PORTAL_CALLBACK_PATH}`,
};
const writes = [];
const tx = {
  async query(sql, args) {
    writes.push({ sql, args });
    if (/UPDATE shopee_shop_profiles/.test(sql)) return { rows: [{ shop_id: 1326456001 }] };
    return { rows: [] };
  },
  release() {},
};
const pool = {
  async query(sql, args) {
    if (/SELECT 1 FROM shopee_shop_profiles/.test(sql)) return { rows: [{}] };
    if (/INSERT INTO shopee_oauth_states/.test(sql)) { writes.push({ sql, args }); return { rows: [] }; }
    if (/FROM shopee_oauth_states/.test(sql)) return { rows: [{ ...activeState, consumed_at: null, expires_at: new Date(Date.now()+600000) }] };
    if (/UPDATE shopee_oauth_states/.test(sql)) return { rows: [{ ...activeState, consumed_at: new Date() }] };
    if (/brand_portal_principal_id/.test(sql) && /token_present/.test(sql)) {
      return { rows: [{ brand_portal_principal_id: null, brand_portal_timezone: 'GMT+7', token_present: false }] };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  },
  async connect() { return tx; },
};
let exchangeBody = null;
const fetchImpl = async (_url, options) => {
  exchangeBody = JSON.parse(options.body);
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      principal_id_list: [777],
      access_token: 'principal-access-token',
      refresh_token: 'principal-refresh-token',
      expire_in: 14400,
    }),
  };
};

(async () => {
  const service = new BrandPortalOAuthService({
    pool, env,
    randomBytes: () => Buffer.alloc(32, 7),
    fetchImpl,
    now: () => new Date('2026-09-29T05:00:00Z'),
  });
  const status = await service.status({ shopId: 1326456001 });
  assert.strictEqual(status.credentialConfigured, true);
  assert.strictEqual(status.tokenPresent, false);

  const start = await service.beginAuthorization({ shopId: 1326456001 });
  const authUrl = new URL(start.authorizationUrl);
  assert.strictEqual(authUrl.searchParams.get('auth_type'), 'principal');
  assert.strictEqual(authUrl.searchParams.get('redirect'), `https://analytics.example.com${BRAND_PORTAL_CALLBACK_PATH}`);

  const result = await service.completeAuthorization({ state: start.state, code: 'one-time-code' });
  assert.deepStrictEqual(result, { shopId: 1326456001, principalId: 777 });
  assert.strictEqual(exchangeBody.code, 'one-time-code');
  const tokenInsert = writes.find(row => /INSERT INTO shopee_app_tokens/.test(row.sql));
  assert(tokenInsert, 'encrypted token insert missing');
  assert(!tokenInsert.args.includes('principal-access-token'), 'plaintext access token must not be stored as a SQL argument');
  assert(writes.some(row => /brand_portal_principal_id=\$2/.test(row.sql)), 'shop principal mapping missing');
  console.log('Brand Portal OAuth service tests: ok');
})().catch(error => { console.error(error); process.exitCode = 1; });
