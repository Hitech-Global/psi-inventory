'use strict';

/**
 * TikTok 授权服务测试。
 *
 * 覆盖三处容易出错的地方：
 *   1. `grant_type` 必须是 `authorized_code`（官方明确说不要"修正"成标准 OAuth 值）；
 *   2. state 一次性消费，且只存哈希；
 *   3. 授权后必须建立 (shop_id, shop_cipher) 成对台账 —— 缺 cipher 的店铺不能被静默跳过。
 */

const assert = require('assert');
const {
  API_BASE_URL,
  TIKTOK_CALLBACK_PATH,
  TikTokOAuthService,
  buildAuthorizationUrl,
  clearStateCookie,
  parseAuthorizedShops,
  parseCookie,
  resolveTikTokRedirectUrl,
  stateCookie,
} = require('../src/tiktok-oauth-service');
const { loadMasterKey } = require('../src/token-crypto');

// ---- 授权链接 ----

const authUrl = buildAuthorizationUrl({
  appKey: '123abc',
  serviceId: 'SVC-1',
  redirectUri: 'https://example.com/api/shopee-analytics/tiktok/oauth/callback',
  state: 'STATE-1',
  regionGroup: 'ROW',
});
assert.ok(authUrl.startsWith('https://services.tiktokshop.com/open/authorize'), 'ROW 卖家走 services 域名');
assert.ok(authUrl.includes('service_id=SVC-1'));
assert.ok(authUrl.includes('state=STATE-1'));
assert.ok(authUrl.includes('redirect_uri='));

// US 走另一个域名
assert.ok(
  buildAuthorizationUrl({
    appKey: 'k', serviceId: 's', redirectUri: 'https://e.com/cb', state: 'st', regionGroup: 'US',
  }).startsWith('https://services.us.tiktokshop.com/open/authorize'),
);

// 不支持的组合必须报错
assert.throws(
  () => buildAuthorizationUrl({ appKey: 'k', serviceId: 's', redirectUri: 'https://e.com/cb', state: 'st', regionGroup: 'EU' }),
  /unsupported TikTok authorization role\/region/,
);
assert.throws(
  () => buildAuthorizationUrl({ appKey: '', serviceId: 's', redirectUri: 'https://e.com/cb', state: 'st' }),
  /appKey is required/,
);

// ---- Redirect URL 解析 ----

assert.strictEqual(
  resolveTikTokRedirectUrl({ TIKTOK_REDIRECT_URL: `https://x.com${TIKTOK_CALLBACK_PATH}` }),
  `https://x.com${TIKTOK_CALLBACK_PATH}`,
);
assert.strictEqual(
  resolveTikTokRedirectUrl({ FEISHU_EXTERNAL_BASE_URL: 'https://x.com/' }),
  `https://x.com${TIKTOK_CALLBACK_PATH}`,
);
assert.throws(() => resolveTikTokRedirectUrl({}), /is required/);
assert.throws(
  () => resolveTikTokRedirectUrl({ TIKTOK_REDIRECT_URL: 'https://x.com/wrong' }),
  /must end in/,
);
assert.throws(
  () => resolveTikTokRedirectUrl({ TIKTOK_REDIRECT_URL: `https://u:p@x.com${TIKTOK_CALLBACK_PATH}` }),
  /must not carry credentials/,
);

// ---- cookie ----

const cookie = stateCookie('abc', 600);
assert.ok(cookie.includes('HttpOnly'));
assert.ok(cookie.includes('Secure'));
assert.ok(cookie.includes('SameSite=Lax'));
assert.strictEqual(parseCookie(cookie, 'shopee_tiktok_oauth_state'), 'abc');
assert.strictEqual(parseCookie('', 'shopee_tiktok_oauth_state'), '');
assert.ok(clearStateCookie().includes('Max-Age=0'));

// ---- 店铺台账解析 ----

const shops = parseAuthorizedShops({
  shops: [
    { id: '12345', cipher: 'CIPHER_A', region: 'MY', seller_type: 'LOCAL', name: 'Shop A' },
    { id: '67890', cipher: 'CIPHER_B', region: 'SG', seller_type: 'CROSS_BORDER', name: 'Shop B' },
  ],
});
assert.strictEqual(shops.length, 2);
assert.strictEqual(shops[0].shopId, '12345');
assert.strictEqual(shops[0].shopCipher, 'CIPHER_A');
assert.strictEqual(shops[1].sellerType, 'CROSS_BORDER');

// 缺 cipher 必须报错，不能静默跳过 —— 那会导致后续请求串店
assert.throws(
  () => parseAuthorizedShops({ shops: [{ id: '1' }] }),
  /TIKTOK_SHOP_MISSING_CIPHER/,
);
// 缺 id 同样不行
assert.throws(
  () => parseAuthorizedShops({ shops: [{ cipher: 'c' }] }),
  /TIKTOK_INVALID_SHOP_RESPONSE/,
);
// 响应结构不对
assert.throws(
  () => parseAuthorizedShops({}),
  /TIKTOK_INVALID_SHOP_RESPONSE/,
);

// ---- 授权流程 ----

function fakePool() {
  const calls = [];
  const state = { consumed: false };
  const pool = {
    calls,
    state,
    async query(sql, params) {
      calls.push({ sql, params });
      // DELETE ... RETURNING state：第一次返回记录，之后返回空（模拟消费后重放）
      if (/DELETE FROM tiktok_oauth_states/.test(sql)) {
        if (state.consumed) return { rows: [] };
        state.consumed = true;
        return { rows: [{ region_group: 'ROW', redirect_uri: 'https://x.com/cb' }] };
      }
      return { rows: [] };
    },
  };
  return pool;
}

const ENV = {
  TIKTOK_APP_KEY: '123abc',
  TIKTOK_APP_SECRET: 'secret',
  TIKTOK_SERVICE_ID: 'SVC-1',
  TIKTOK_REGION_GROUP: 'ROW',
  TIKTOK_REDIRECT_URL: `https://x.com${TIKTOK_CALLBACK_PATH}`,
  SHOPEE_TOKEN_MASTER_KEY: Buffer.alloc(32, 3).toString('base64'),
};

(async () => {
  // status：凭据未配置时应报告出来
  const statusPool = { async query() { return { rows: [] }; } };
  const statusService = new TikTokOAuthService({ pool: statusPool, env: ENV });
  const status = await statusService.status();
  assert.strictEqual(status.platform, 'tiktok');
  assert.strictEqual(status.credentialsConfigured, true);
  assert.strictEqual(status.regionGroup, 'ROW');
  assert.deepStrictEqual(status.shops, []);

  // 未配置凭据时 status 也要能报（不抛错），便于登录页展示"未配置"
  const unconfigured = new TikTokOAuthService({
    pool: statusPool,
    env: { TIKTOK_REGION_GROUP: 'ROW' },
  });
  const unconfiguredStatus = await unconfigured.status();
  assert.strictEqual(unconfiguredStatus.credentialsConfigured, false);

  // beginAuthorization：写 state 表并返回授权链接
  const beginPool = fakePool();
  const beginService = new TikTokOAuthService({
    pool: beginPool,
    env: ENV,
    randomBytes: () => Buffer.from('a'.repeat(32), 'utf8'),
  });
  const begun = await beginService.beginAuthorization();
  assert.ok(begun.authorizationUrl.includes('service_id=SVC-1'));
  assert.ok(begun.state);
  assert.ok(beginPool.calls.some(call => /INSERT INTO tiktok_oauth_states/.test(call.sql)));
  // 存的是哈希，不是明文 state
  const stateInsert = beginPool.calls.find(call => /INSERT INTO tiktok_oauth_states/.test(call.sql));
  assert.ok(!stateInsert.params.includes(begun.state), 'state 必须以哈希入库');

  // completeAuthorization：兑换 token + 建立店铺台账
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const parsed = new URL(url);
    if (parsed.pathname.includes('/token/get')) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify({
          code: 0,
          message: 'success',
          data: {
            access_token: 'TTP_ACCESS',
            refresh_token: 'TTP_REFRESH',
            access_token_expire_in: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
          },
        }),
      };
    }
    if (parsed.pathname.includes('/authorization/202309/shops')) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify({
          code: 0,
          message: 'Success',
          request_id: 'req-1',
          data: {
            shops: [
              { id: '12345', cipher: 'CIPHER_A', region: 'MY', seller_type: 'LOCAL', name: 'Shop A' },
            ],
          },
        }),
      };
    }
    throw new Error(`unexpected url ${url}`);
  };

  const completePool = fakePool();
  const completeService = new TikTokOAuthService({
    pool: completePool,
    env: ENV,
    fetchImpl,
    now: () => new Date('2026-11-01T00:00:00Z'),
  });
  const completed = await completeService.completeAuthorization({
    code: 'TTP_CODE',
    state: 'STATE-X',
  });
  assert.strictEqual(completed.shopCount, 1);
  assert.strictEqual(completed.shops[0].shopId, '12345');

  // token 交换必须用 authorized_code，而不是标准 OAuth 的 authorization_code
  const tokenCall = calls.find(url => url.includes('/token/get'));
  assert.ok(tokenCall.includes('grant_type=authorized_code'));
  assert.ok(!tokenCall.includes('grant_type=authorization_code'));

  // 店铺台账必须写入且 cipher 与 shop_id 成对
  const insertCall = completePool.calls.find(call => /INSERT INTO tiktok_shop_tokens/.test(call.sql));
  assert.ok(insertCall, '必须写入店铺台账');
  assert.ok(insertCall.params.includes('12345'), 'shop_id 入库');
  assert.ok(insertCall.params.includes('CIPHER_A'), 'cipher 入库');
  assert.ok(!insertCall.params.includes('TTP_ACCESS'), 'access token 不得明文入库');

  // 授权后必须调用 Get Authorized Shops 取 cipher
  assert.ok(calls.some(url => url.includes('/authorization/202309/shops')), '必须取店铺台账');
  assert.ok(calls.some(url => url.startsWith(API_BASE_URL)), '店铺台账走 Shop API 主机');

  // state 重放必须被拒绝
  await assert.rejects(
    () => completeService.completeAuthorization({ code: 'TTP_CODE', state: 'STATE-X' }),
    /TIKTOK_OAUTH_INVALID_OR_REPLAYED_STATE/,
  );

  // 卖家拒绝时平台会带 error
  const rejectPool = fakePool();
  const rejectService = new TikTokOAuthService({
    pool: rejectPool, env: ENV, fetchImpl,
  });
  await assert.rejects(
    () => rejectService.completeAuthorization({ code: null, state: 'S', providerError: 'auth_denied' }),
    /TIKTOK_OAUTH_PROVIDER_ERROR/,
  );

  // 缺 state
  await assert.rejects(
    () => completeService.completeAuthorization({ code: 'C', state: '' }),
    /TIKTOK_OAUTH_MISSING_STATE/,
  );

  console.log('tiktok oauth service tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
