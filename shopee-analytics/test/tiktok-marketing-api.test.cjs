'use strict';

/**
 * TikTok 广告线（Marketing API）测试。
 *
 * 这条线与 Shop 线是两套完全独立的鉴权体系，测的重点 therefore 是**边界**：
 *   1. 客户端确实用 Access-Token 头、不签名、不碰 Shop 的路径；
 *   2. 两种广告口径分别落库、互不加总；
 *   3. 授权的防重放与 advertiser_ids 处理；
 *   4. 24 小时 token 的过期识别 —— 这是 Marketing 侧独有的节奏，
 *      漏了它会让同步在某个早上突然集体失败。
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  ERROR_CODES,
  MARKETING_BASE_URL,
  TikTokMarketingClient,
  assertMarketingApiPath,
  isShopApiPath,
} = require('../src/tiktok-marketing-client');
const {
  ACCESS_TOKEN_TTL_SECONDS,
  TikTokMarketingOAuthService,
  buildAuthorizationUrl,
  clearStateCookie,
  marketingError,
  parseTokenPayload,
  resolveMarketingRedirectUrl,
  stateCookie,
} = require('../src/tiktok-marketing-oauth-service');
const {
  MARKETING_TOKEN_TTL_SECONDS,
  isExpired,
} = require('../src/tiktok-marketing-token-repository');
const {
  GMV_MAX_METRICS,
  INTEGRATED_METRICS,
  MAX_WINDOW_DAYS,
  TikTokMarketingSyncRunner,
  extractRows,
  readDate,
  splitIntoWindows,
  splitRow,
} = require('../src/tiktok-marketing-sync-runner');

const webDir = path.join(__dirname, '..', 'web');
const html = fs.readFileSync(path.join(webDir, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(webDir, 'app.js'), 'utf8');
const tiktokUi = fs.readFileSync(path.join(webDir, 'tiktok-ui-v1.js'), 'utf8');
const router = fs.readFileSync(path.join(__dirname, '..', 'src', 'http-router.js'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '..', 'src', 'standalone-server.js'), 'utf8');

// ---------------------------------------------------------------------------
// 1. 客户端的鉴权边界
// ---------------------------------------------------------------------------

/** 造一个记录请求的假 fetch。 */
function recordingFetch(payload = { code: 0, data: { list: [] } }) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, async text() { return JSON.stringify(payload); } };
  };
  return { calls, fetchImpl };
}

async function testClientUsesAccessTokenAndNoSignature() {
  const { calls, fetchImpl } = recordingFetch();
  const client = new TikTokMarketingClient({ fetchImpl });
  await client.gmvMaxReport({
    accessToken: 'MARKETING_TOKEN',
    advertiserId: '123456',
    storeIds: ['shop1'],
    metrics: ['cost'],
    startDate: '2026-11-01',
    endDate: '2026-11-05',
  });

  const call = calls[0];
  assert.ok(
    call.url.startsWith(`${MARKETING_BASE_URL}/open_api/v1.3/`),
    `Marketing API 的域名与路径前缀不对：${call.url}`,
  );

  // ★ 头必须是 Access-Token —— TikTok 认这个大小写，
  //   用 Authorization: Bearer 或 access-token 都会拿到 40001。
  assert.strictEqual(call.options.headers['Access-Token'], 'MARKETING_TOKEN');
  assert.ok(
    !('x-tts-access-token' in call.options.headers),
    'Marketing 客户端不能用 Shop 的 x-tts-access-token',
  );

  // ★ 绝不能有签名参数。
  const params = new URL(call.url).searchParams;
  for (const key of ['app_key', 'timestamp', 'sign']) {
    assert.ok(!params.has(key), `Marketing 请求不该有 ${key} —— 它不签名`);
  }
}

function testClientRefusesShopPaths() {
  assert.ok(isShopApiPath('/order/202309/orders/search'));
  assert.ok(isShopApiPath('/product/202502/products/search'));
  assert.ok(!isShopApiPath('/gmv_max/report/get/'));

  assert.throws(() => assertMarketingApiPath('/order/202309/orders/search'), /cannot be sent by the Marketing client/);
  assert.doesNotThrow(() => assertMarketingApiPath('/gmv_max/report/get/'));
}

async function testClientIdentifiesExpiredToken() {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    async text() { return JSON.stringify({ code: ERROR_CODES.INVALID_TOKEN, message: 'invalid access token' }); },
  });
  const client = new TikTokMarketingClient({ fetchImpl });
  try {
    await client.advertiserInfo({ accessToken: 'expired', advertiserId: '1' });
    assert.fail('过期 token 必须报错');
  } catch (error) {
    // ★ 40001 要能被上层区别对待 —— 它意味着「需要刷新或重新授权」，
    //   与其它业务错误不同。
    assert.strictEqual(error.kind, 'TIKTOK_MARKETING_TOKEN_INVALID');
    assert.strictEqual(error.code, ERROR_CODES.INVALID_TOKEN);
  }
}

async function testClientRequiresAdvertiserAndDates() {
  const { fetchImpl } = recordingFetch();
  const client = new TikTokMarketingClient({ fetchImpl });
  await assert.rejects(
    () => client.gmvMaxReport({ accessToken: 'T', storeIds: ['s'], startDate: '2026-11-01', endDate: '2026-11-02' }),
    /advertiserId is required/,
  );
  await assert.rejects(
    () => client.gmvMaxReport({ accessToken: 'T', advertiserId: '1', startDate: '2026-11-01', endDate: '2026-11-02' }),
    /storeIds is required/,
  );
  await assert.rejects(
    () => client.gmvMaxReport({ accessToken: 'T', advertiserId: '1', storeIds: ['s'] }),
    /startDate and endDate are required/,
  );
}

// ---------------------------------------------------------------------------
// 2. 两种口径分别落库
// ---------------------------------------------------------------------------

function testWindowsRespectThirtyDayLimit() {
  const windows = splitIntoWindows({ startDate: '2026-09-01', endDate: '2026-11-05' });
  assert.ok(windows.length >= 2, '超过 30 天必须切窗');
  for (const window of windows) {
    const days = (new Date(`${window.endDate}T00:00:00Z`) - new Date(`${window.startDate}T00:00:00Z`)) / 86400000 + 1;
    assert.ok(days <= MAX_WINDOW_DAYS, `窗口 ${days} 天，超过 ${MAX_WINDOW_DAYS} 天的上限`);
  }
  assert.strictEqual(windows[0].startDate, '2026-09-01');
  assert.strictEqual(windows[windows.length - 1].endDate, '2026-11-05');
  // 窗口之间不能有空隙或重叠。
  for (let i = 1; i < windows.length; i += 1) {
    const expected = new Date(`${windows[i - 1].endDate}T00:00:00Z`);
    expected.setUTCDate(expected.getUTCDate() + 1);
    assert.strictEqual(windows[i].startDate, expected.toISOString().slice(0, 10), '窗口之间不能有缝隙');
  }
}

async function testTwoBasesLandSeparately() {
  const written = [];
  const runner = new TikTokMarketingSyncRunner({
    pool: { query: async () => ({ rows: [] }) },
    tokenRepository: {
      async load() {
        return {
          appId: 'a', advertiserId: '111', accessToken: 'AT', refreshToken: 'RT',
          expiresAt: new Date(Date.now() + 86400000),
        };
      },
      async listAdvertisers() { return [{ appId: 'a', advertiserId: '111' }]; },
    },
    dataRepository: {
      async upsertShopDaily({ rows }) { written.push(...rows); return rows.length; },
    },
    env: { TIKTOK_MARKETING_APP_ID: 'a' },
    client: {
      async gmvMaxReport() {
        return { list: [{
          dimensions: { stat_time_day: '2026-11-01', currency: 'USD' },
          metrics: { cost: '200', gross_revenue: '800', orders: '6' },
        }] };
      },
      async integratedReport() {
        return { list: [{
          dimensions: { stat_time_day: '2026-11-01' },
          metrics: { spend: '200', impressions: '5000', clicks: '300' },
        }] };
      },
    },
  });

  await runner.syncAdvertiser({
    advertiserId: '111', storeIds: ['shop1'], shopCipher: 'cipher1',
    startDate: '2026-11-01', endDate: '2026-11-01',
  });

  assert.strictEqual(written.length, 2, '两张报表应落成两行');

  const attributed = written.find(row => row.attribution_basis === 'platform_attributed');
  const paid = written.find(row => row.attribution_basis === 'paid_only');
  assert.ok(attributed, '应有平台归因口径的行');
  assert.ok(paid, '应有纯付费口径的行');
  assert.strictEqual(attributed.source, 'gmv_max_report');
  assert.strictEqual(paid.source, 'integrated_report');

  // ★ 平台归因口径的 GMV 有值，结算收入必须为 null。
  assert.strictEqual(attributed.gmv_order_total, 800);
  assert.strictEqual(attributed.gmv_settled, null, '平台归因不等于结算收入');

  // ★ 纯付费口径**没有** GMV —— 整合报表给的是花费与漏斗。
  //   拿花费反推 GMV 是编造。
  assert.strictEqual(paid.gmv_order_total, null, '纯付费口径不得有 GMV');
  assert.strictEqual(paid.spend, 200);
  assert.strictEqual(paid.impressions, 5000);
}

async function testOneAdvertiserFailureDoesNotStopBatch() {
  const runner = new TikTokMarketingSyncRunner({
    pool: { query: async () => ({ rows: [] }) },
    tokenRepository: {
      async load() { throw new Error('no credential'); },
      async listAdvertisers() {
        return [{ appId: 'a', advertiserId: '111' }, { appId: 'a', advertiserId: '222' }];
      },
    },
    dataRepository: { async upsertShopDaily() { return 0; } },
    env: { TIKTOK_MARKETING_APP_ID: 'a' },
    client: {},
  });

  const result = await runner.syncAll({
    storeIdsByAdvertiser: { '111': { storeIds: ['s1'], shopCipher: 'c1' }, '222': { storeIds: ['s2'], shopCipher: 'c2' } },
    startDate: '2026-11-01',
    endDate: '2026-11-01',
  });
  assert.strictEqual(result.advertiserCount, 2);
  assert.strictEqual(result.failedCount, 2, '两个都该失败');
  assert.strictEqual(result.summaries.length, 2, '失败的广告主也要出现在摘要里');
}

function testRowParsingHandlesBothShapes() {
  // 标准形状：dimensions + metrics 分开
  const nested = splitRow({ dimensions: { stat_time_day: '2026-11-01' }, metrics: { cost: '10' } });
  assert.strictEqual(nested.metrics.cost, '10');
  assert.strictEqual(readDate(nested.dimensions), '2026-11-01');

  // 平铺形状：维度与指标混在一层
  const flat = splitRow({ stat_time_day: '2026-11-02', currency: 'USD', cost: '20' });
  assert.strictEqual(flat.metrics.cost, '20');
  assert.strictEqual(readDate(flat.dimensions), '2026-11-02');

  // 响应行可能在 list / rows / data.list 几种位置
  assert.strictEqual(extractRows({ list: [1, 2] }).length, 2);
  assert.strictEqual(extractRows({ rows: [1] }).length, 1);
  assert.strictEqual(extractRows({ data: { list: [1] } }).length, 1);
  assert.strictEqual(extractRows(null).length, 0);
}

// ---------------------------------------------------------------------------
// 3. 授权的防重放与 advertiser 处理
// ---------------------------------------------------------------------------

function testAuthorizationUrlHasRequiredParams() {
  const url = new URL(buildAuthorizationUrl({
    appId: 'APP', redirectUri: 'https://x.test/cb', state: 'ST', rid: 'RID',
  }));
  assert.strictEqual(url.origin + url.pathname, 'https://ads.tiktok.com/marketing_api/auth');
  assert.strictEqual(url.searchParams.get('app_id'), 'APP');
  assert.strictEqual(url.searchParams.get('state'), 'ST');
  assert.strictEqual(url.searchParams.get('redirect_uri'), 'https://x.test/cb');
  assert.strictEqual(url.searchParams.get('rid'), 'RID');
}

function testTokenPayloadValidation() {
  const good = parseTokenPayload({
    access_token: 'AT', refresh_token: 'RT', advertiser_ids: ['1', '2'], expires_in: 86400,
  });
  assert.deepStrictEqual(good.advertiserIds, ['1', '2']);
  assert.strictEqual(good.expiresIn, 86400);

  // 没有 advertiser_ids → 这个 token 什么都查不了，必须让授权方知道
  assert.throws(
    () => parseTokenPayload({ access_token: 'AT', refresh_token: 'RT', advertiser_ids: [] }),
    /no advertiser ids/,
  );
  // 缺 refresh_token → 24 小时的 token 就没法自动续期
  assert.throws(
    () => parseTokenPayload({ access_token: 'AT', advertiser_ids: ['1'] }),
    /no refresh_token/,
  );
}

async function testStateMismatchIsRejected() {
  const service = new TikTokMarketingOAuthService({
    tokenRepository: { async save() {} },
    env: {
      TIKTOK_MARKETING_APP_ID: 'a', TIKTOK_MARKETING_APP_SECRET: 's',
      TIKTOK_MARKETING_REDIRECT_URL: 'https://x.test/cb',
    },
    fetchImpl: async () => ({
      ok: true, status: 200,
      async text() { return JSON.stringify({ code: 0, data: { access_token: 'AT', refresh_token: 'RT', advertiser_ids: ['1'] } }); },
    }),
  });

  // ★ state 不匹配必须被拒 —— 否则别人能用他自己的授权码换一个 token。
  await assert.rejects(
    () => service.completeAuthorization({ state: 'other', authCode: 'AC', expectedState: 'mine' }),
    /state does not match/,
  );
  // 缺 state 也要被拒
  await assert.rejects(
    () => service.completeAuthorization({ state: '', authCode: 'AC', expectedState: 'mine' }),
    /state is missing/,
  );
}

async function testEachAdvertiserGetsItsOwnRow() {
  const saved = [];
  const service = new TikTokMarketingOAuthService({
    tokenRepository: { async save(row) { saved.push(row); } },
    env: {
      TIKTOK_MARKETING_APP_ID: 'app', TIKTOK_MARKETING_APP_SECRET: 'sec',
      TIKTOK_MARKETING_REDIRECT_URL: 'https://x.test/cb',
    },
    fetchImpl: async () => ({
      ok: true, status: 200,
      async text() {
        return JSON.stringify({
          code: 0,
          data: { access_token: 'AT', refresh_token: 'RT', advertiser_ids: ['111', '222'], expires_in: 86400 },
        });
      },
    }),
  });

  const result = await service.completeAuthorization({ state: 's', authCode: 'AC', expectedState: 's' });
  assert.strictEqual(result.advertiserCount, 2);
  assert.strictEqual(saved.length, 2, '每个广告主一行 —— 一个 token 覆盖多个广告账户');
  assert.deepStrictEqual(saved.map(row => row.advertiserId).sort(), ['111', '222']);
  // 两个广告主共享同一个 token，但各存一行
  assert.strictEqual(saved[0].accessToken, saved[1].accessToken);
}

function testMarketingCookieIsSeparateFromShopCookie() {
  const cookie = stateCookie('STATE', 600);
  assert.match(cookie, /shopee_tiktok_marketing_oauth_state/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Path=\/api\/shopee-analytics\/tiktok\/marketing\/oauth/);
  // Shop 侧用的是另一个 cookie 名 —— 两者不能互相覆盖
  assert.ok(!/shopee_tiktok_oauth_state=/.test(cookie));
  assert.match(clearStateCookie(), /Max-Age=0/);
}

// ---------------------------------------------------------------------------
// 4. 24 小时 token 的过期识别
// ---------------------------------------------------------------------------

function testTokenExpiryIsRecognised() {
  const now = Date.now();
  // 未过期
  assert.strictEqual(isExpired(new Date(now + 3600 * 1000), now), false);
  // 已过期
  assert.strictEqual(isExpired(new Date(now - 1000), now), true);
  // 缺失视作过期 —— 拿不到过期时间就不能当成还有效
  assert.strictEqual(isExpired(null, now), true);
  assert.strictEqual(isExpired(undefined, now), true);
  // 快过期了也要算过期（留 60 秒余量）
  assert.strictEqual(isExpired(new Date(now + 30 * 1000), now), true);

  assert.strictEqual(MARKETING_TOKEN_TTL_SECONDS, 24 * 60 * 60, 'Marketing token 是 24 小时');
  assert.strictEqual(ACCESS_TOKEN_TTL_SECONDS, 24 * 60 * 60);
}

// ---------------------------------------------------------------------------
// 5. 接入完整性
// ---------------------------------------------------------------------------

function testBackendRoutesRegistered() {
  assert.match(router, /router\.get\('\/tiktok\/marketing\/status'/, '缺少授权状态路由');
  assert.match(router, /router\.get\('\/tiktok\/marketing\/oauth\/start'/, '缺少授权开始路由');
  assert.match(router, /router\.get\('\/tiktok\/marketing\/oauth\/callback'/, '缺少授权回调路由');
  assert.match(router, /router\.post\('\/tiktok\/marketing\/sync'/, '缺少广告同步路由');
  assert.match(router, /router\.get\('\/tiktok\/marketing\/daily'/, '缺少广告数据查询路由');

  // 授权与同步只能 super admin 做
  assert.match(router, /tiktok\/marketing\/oauth\/start[\s\S]{0,400}ROLE_SUPER_ADMIN/,
    '广告授权必须限制为 super admin');
  assert.match(router, /tiktok\/marketing\/sync[\s\S]{0,400}ROLE_SUPER_ADMIN/,
    '广告同步必须限制为 super admin');

  // 服务要注入
  assert.match(server, /tiktokMarketingOAuthService/, 'standalone-server 要注入 Marketing 授权服务');
  assert.match(server, /tiktokMarketingSyncRunner/, 'standalone-server 要注入 Marketing 同步器');
}

function testFrontendWiring() {
  assert.match(html, /id="tiktokAdsSummary"/, '缺少广告概览容器');
  assert.match(html, /id="tiktokAdsHead"/, '缺少广告表头容器');
  assert.match(html, /id="tiktokAdsBody"/, '缺少广告表体容器');
  assert.match(html, /id="tiktokAdsSyncBtn"/, '缺少广告同步按钮');
  assert.match(app, /async function loadTikTokAds/, 'app.js 缺少 loadTikTokAds');
  assert.match(app, /async function syncTikTokAds/, 'app.js 缺少 syncTikTokAds');
  assert.match(app, /tiktok\/marketing\/daily/, 'app.js 缺少广告数据请求');
  assert.match(tiktokUi, /window\.TikTokUI\s*=\s*\{[^}]*renderAds/, 'tiktok-ui-v1.js 必须导出 renderAds');
}

function testMetricsListsAreDistinct() {
  // GMV Max 要的是 cost/gross_revenue，纯付费要的是 spend/impressions/clicks ——
  // 两组指标不能混着请求，否则口径就废了。
  assert.ok(GMV_MAX_METRICS.includes('gross_revenue'));
  assert.ok(GMV_MAX_METRICS.includes('cost'));
  assert.ok(!GMV_MAX_METRICS.includes('spend'), 'GMV Max 用的是 cost，不是 spend');
  assert.ok(INTEGRATED_METRICS.includes('spend'));
  assert.ok(!INTEGRATED_METRICS.includes('gross_revenue'), '整合报表没有 gross_revenue');
}

// ---------------------------------------------------------------------------
// 装配
// ---------------------------------------------------------------------------

const tests = [
  ['客户端用 Access-Token 头且不签名', testClientUsesAccessTokenAndNoSignature],
  ['客户端拒绝 Shop 路径', testClientRefusesShopPaths],
  ['客户端识别过期 token（40001）', testClientIdentifiesExpiredToken],
  ['客户端必填参数校验', testClientRequiresAdvertiserAndDates],
  ['30 天窗口切分', testWindowsRespectThirtyDayLimit],
  ['两种口径分别落库', testTwoBasesLandSeparately],
  ['单广告主失败不中断整批', testOneAdvertiserFailureDoesNotStopBatch],
  ['报表行两种形状都能解析', testRowParsingHandlesBothShapes],
  ['授权 URL 参数齐全', testAuthorizationUrlHasRequiredParams],
  ['token 响应校验', testTokenPayloadValidation],
  ['state 不匹配被拒（防重放）', testStateMismatchIsRejected],
  ['每个广告主各存一行', testEachAdvertiserGetsItsOwnRow],
  ['Marketing cookie 与 Shop 分开', testMarketingCookieIsSeparateFromShopCookie],
  ['24 小时 token 过期可识别', testTokenExpiryIsRecognised],
  ['后端路由已注册且权限受限', testBackendRoutesRegistered],
  ['前端接入完整', testFrontendWiring],
  ['两组指标互不混用', testMetricsListsAreDistinct],
];

async function main() {
  let passed = 0;
  const failures = [];
  for (const [name, fn] of tests) {
    try {
      await fn();
      passed += 1;
    } catch (error) {
      failures.push({ name, error });
    }
  }
  if (failures.length) {
    for (const f of failures) {
      process.stderr.write(`❌ ${f.name}\n   ${f.error && f.error.message}\n`);
    }
    throw new Error(`${failures.length} 个测试失败（共 ${tests.length} 个）`);
  }
  process.stdout.write(`tiktok marketing api tests passed (${passed} cases)\n`);
}

main().catch((error) => {
  process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
  process.exit(1);
});
