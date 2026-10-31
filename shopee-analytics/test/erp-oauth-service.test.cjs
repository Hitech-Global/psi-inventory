const assert = require('assert');
const crypto = require('crypto');
const {
  ErpOAuthService,
  resolveErpRedirectUrl,
  stateCookie,
  ERP_CALLBACK_PATH,
} = require('../src/erp-oauth-service');

assert.strictEqual(
  resolveErpRedirectUrl({ FEISHU_EXTERNAL_BASE_URL: 'https://analytics.example.com' }),
  `https://analytics.example.com${ERP_CALLBACK_PATH}`,
);
assert(stateCookie('abc', 600).includes('HttpOnly'));
assert(stateCookie('abc', 600).includes('SameSite=Lax'));

const masterKey = crypto.randomBytes(32).toString('base64');
const env = {
  SHOPEE_ERP_PARTNER_ID: '123',
  SHOPEE_ERP_PARTNER_KEY: 'secret',
  FEISHU_EXTERNAL_BASE_URL: 'https://analytics.example.com',
  SHOPEE_OAUTH_STATE_TTL_SECONDS: '600',
  SHOPEE_TOKEN_MASTER_KEY: masterKey,
};
const deterministicState = Buffer.alloc(32, 9).toString('base64url');
const activeState = {
  state_hash: crypto.createHash('sha256').update(deterministicState).digest('hex'),
  app_role: 'ERP',
  expected_shop_id: 1326456001,
  redirect_uri: `https://analytics.example.com${ERP_CALLBACK_PATH}`,
};
const writes = [];
const pool = {
  async query(sql, args) {
    if (/SELECT 1 FROM shopee_shop_profiles/.test(sql)) return { rows: [{}] };
    if (/LEFT JOIN shopee_app_tokens/.test(sql)) {
      return { rows: [{ shop_id: 1326456001, token_expires_at: null, token_refresh_error: null }] };
    }
    if (/INSERT INTO shopee_oauth_states/.test(sql)) { writes.push({ sql, args }); return { rows: [] }; }
    if (/FROM shopee_oauth_states/.test(sql)) {
      return { rows: [{ ...activeState, consumed_at: null, expires_at: new Date(Date.now()+600000) }] };
    }
    if (/UPDATE shopee_oauth_states/.test(sql)) {
      return { rows: [{ ...activeState, consumed_at: new Date() }] };
    }
    if (/INSERT INTO shopee_app_tokens/.test(sql)) { writes.push({ sql, args }); return { rows: [] }; }
    throw new Error(`Unexpected SQL: ${sql}`);
  },
};
let exchangeBody = null;
const fetchImpl = async (_url, options) => {
  exchangeBody = JSON.parse(options.body);
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      shop_id_list: [1326456001, 1770037299],
      access_token: 'erp-access-token',
      refresh_token: 'erp-refresh-token',
      expire_in: 14400,
    }),
  };
};

(async () => {
  const service = new ErpOAuthService({
    pool,
    env,
    randomBytes: () => Buffer.alloc(32, 9),
    fetchImpl,
    now: () => new Date('2026-10-02T10:00:00Z'),
  });
  const status = await service.status({ shopId: 1326456001 });
  assert.strictEqual(status.credentialConfigured, true);
  assert.strictEqual(status.tokenPresent, false);
  const start = await service.beginAuthorization({ shopId: 1326456001 });
  const authUrl = new URL(start.authorizationUrl);
  assert.strictEqual(authUrl.searchParams.get('auth_type'), null);
  assert.strictEqual(authUrl.searchParams.get('redirect'), `https://analytics.example.com${ERP_CALLBACK_PATH}`);

  const result = await service.completeAuthorization({ state: start.state, code: 'one-time-code' });
  assert.strictEqual(result.shopId, 1326456001);
  assert.deepStrictEqual(result.authorizedShopIds, [1326456001, 1770037299]);
  assert.strictEqual(exchangeBody.code, 'one-time-code');
  const tokenInsert = writes.find(row => /INSERT INTO shopee_app_tokens/.test(row.sql));
  assert(tokenInsert, 'encrypted ERP token insert missing');
  assert.strictEqual(tokenInsert.args[0], 'ERP');
  assert.strictEqual(Number(tokenInsert.args[1]), 1326456001);
  assert(!tokenInsert.args.includes('erp-access-token'), 'plaintext access token must not be stored as a SQL argument');
  assert(!tokenInsert.args.includes('erp-refresh-token'), 'plaintext refresh token must not be stored as a SQL argument');
  console.log('ERP OAuth service tests: ok');
})().catch(error => { console.error(error); process.exitCode = 1; });
