'use strict';

/**
 * TikTok Shop 客户端与端点目录测试。
 *
 * 重点覆盖三类容易出错的地方：
 *   1. shop_cipher 的端点级差异（缺了报 36009004 Missing，多了报 Unexpected）；
 *   2. 游标分页的异常页检测（token 不推进会静默漏数据）；
 *   3. 错误分类必须结合 message 关键词，不能只看数字码。
 */

const assert = require('assert');
const {
  ERROR_CODES,
  TikTokClient,
  classifyError,
  isSuccessPayload,
  readNested,
} = require('../src/tiktok-client');
const {
  ENDPOINTS,
  MARKETING_ENDPOINTS,
  REGION_GROUPS,
  requiredScopes,
  resolveEndpoint,
  resolveMarketingEndpoint,
} = require('../src/tiktok-catalog');

// ---- 错误分类 ----

// 限流：HTTP 429 与业务码 36009002 都表示限流
assert.strictEqual(classifyError(ERROR_CODES.RATE_LIMIT, 'Too many requests'), 'RATE_LIMIT');
assert.strictEqual(classifyError(null, ''), 'TIKTOK_API_ERROR');

// 超时可退避重试
assert.strictEqual(classifyError(ERROR_CODES.REQUEST_TIMEOUT, 'Request timeout'), 'TIMEOUT');

// 36009004 被复用于多种校验失败，必须结合 message 关键词
assert.strictEqual(
  classifyError(ERROR_CODES.INVALID_IDENTIFIER, 'Missing identifier.'),
  'MISSING_SHOP_CIPHER',
);
assert.strictEqual(
  classifyError(ERROR_CODES.INVALID_IDENTIFIER, 'Unexpected identifier.'),
  'UNEXPECTED_SHOP_CIPHER',
);
assert.strictEqual(
  classifyError(ERROR_CODES.INVALID_IDENTIFIER, 'x-tts-access-token header is invalid'),
  'INVALID_ACCESS_TOKEN',
);
assert.strictEqual(
  classifyError(ERROR_CODES.INVALID_IDENTIFIER, 'Invalid app_key'),
  'INVALID_APP_KEY',
);
// 关键词不匹配时不得误判为 cipher 问题
assert.strictEqual(
  classifyError(ERROR_CODES.INVALID_IDENTIFIER, 'some other validation failure'),
  'TIKTOK_API_ERROR',
);

// 成功结构：业务码为 0
assert.strictEqual(isSuccessPayload({ code: 0, data: {} }), true);
assert.strictEqual(isSuccessPayload({ code: 36009002, message: 'x' }), false);

// 嵌套读取
assert.strictEqual(readNested({ data: { next_page_token: 'abc' } }, 'data.next_page_token'), 'abc');
assert.strictEqual(readNested({ a: 1 }, 'b.c'), undefined);
assert.strictEqual(readNested(null, 'a'), undefined);

// ---- 端点目录 ----

// authorizedShops 不需要 shop_cipher（它是取 cipher 的来源）
assert.strictEqual(ENDPOINTS.authorizedShops.requiresShopCipher, false);
assert.strictEqual(ENDPOINTS.authorizedShops.path, '/authorization/202309/shops');

// 店铺级端点都需要 shop_cipher
for (const key of ['orderSearch', 'shopPerformance', 'statementTransactions']) {
  assert.strictEqual(ENDPOINTS[key].requiresShopCipher, true, `${key} 应要求 shop_cipher`);
}

// 促销域版本分裂
assert.strictEqual(ENDPOINTS.promotionActivities.path, '/promotion/202309/activities/search');
assert.strictEqual(ENDPOINTS.promotionCoupons.path, '/promotion/202406/coupons/search');

// 路径参数替换
assert.strictEqual(
  resolveEndpoint('productDetail', { product_id: '12345' }).path,
  '/product/202309/products/12345',
);
assert.throws(() => resolveEndpoint('productDetail', {}), /missing path parameter product_id/);
assert.throws(() => resolveEndpoint('unknown-endpoint'), /unknown TikTok endpoint/);

// 路径参数会被 URL 编码
assert.strictEqual(
  resolveEndpoint('productDetail', { product_id: 'a/b' }).path,
  '/product/202309/products/a%2Fb',
);

// Marketing API 端点：独立凭据、30 天上限
assert.strictEqual(MARKETING_ENDPOINTS.gmvMaxReport.dateSpanMaxDays, 30);
assert.strictEqual(MARKETING_ENDPOINTS.integratedReport.attributionBasis, 'paid_only');
assert.strictEqual(MARKETING_ENDPOINTS.gmvMaxReport.attributionBasis, 'platform_attributed');
assert.throws(() => resolveMarketingEndpoint('nope'), /unknown TikTok marketing endpoint/);

// 区域组
assert.ok(ENDPOINTS.orderSearch.regionGroups.includes(REGION_GROUPS.ROW));
assert.ok(ENDPOINTS.orderSearch.regionGroups.includes(REGION_GROUPS.US));

// M1 所需 scope
const scopes = requiredScopes();
assert.ok(scopes.includes('Order Information'));
assert.ok(scopes.includes('Finance Information'));
assert.ok(scopes.includes('Return & Refund Basic'));
assert.ok(scopes.includes('Shop Authorized Information'));
// M1 所需 scope 全部是 Public 类型，无需申请 Custom scope
assert.strictEqual(new Set(scopes).size, scopes.length);

// ---- 客户端行为 ----

function jsonResponse(payload, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: key => headers[String(key).toLowerCase()] ?? null },
    text: async () => JSON.stringify(payload),
  };
}

function makeClient(fetchImpl) {
  return new TikTokClient({
    appKey: '29a39d',
    appSecret: 'e59af819cc',
    fetchImpl,
    retryOptions: { maxAttempts: 1 },
  });
}

// 请求带上 x-tts-access-token 头，且 access token 不出现在 query 里
(async () => {
  let captured = null;
  const client = makeClient(async (url, options) => {
    captured = { url, options };
    return jsonResponse({ code: 0, message: 'Success', data: { shops: [] } });
  });

  const data = await client.request({
    path: '/authorization/202309/shops',
    accessToken: 'TOKEN-123',
  });
  assert.deepStrictEqual(data, { shops: [] });
  assert.strictEqual(captured.options.headers['x-tts-access-token'], 'TOKEN-123');
  assert.ok(!captured.url.includes('access_token'), 'access token 不得出现在 query 中');
  assert.ok(captured.url.includes('sign='), '必须带 sign');
  assert.ok(captured.url.includes('app_key=29a39d'));

  // shop_cipher 按端点要求追加
  captured = null;
  await client.request({
    path: '/order/202309/orders/search',
    method: 'POST',
    accessToken: 'TOKEN-123',
    requiresShopCipher: true,
    shopCipher: 'CIPHER-1',
    body: { page_size: 10 },
  });
  assert.ok(captured.url.includes('shop_cipher=CIPHER-1'), '需要 cipher 时必须带上');
  // 请求体参与签名：sign 必须与 body 对应（这里只验证 body 被发送）
  assert.strictEqual(captured.options.body, JSON.stringify({ page_size: 10 }));

  // 不需要 cipher 的端点：即使传了也要去掉，否则平台会报 Unexpected identifier
  captured = null;
  await client.request({
    path: '/authorization/202309/shops',
    accessToken: 'TOKEN-123',
    shopCipher: 'CIPHER-1',
  });
  assert.ok(!captured.url.includes('shop_cipher'), '不需要 cipher 时不得带上');

  // 需要 cipher 但没给：客户端层就应报错，不浪费一次请求
  await assert.rejects(
    () => client.request({
      path: '/order/202309/orders/search',
      method: 'POST',
      accessToken: 'TOKEN-123',
      requiresShopCipher: true,
    }),
    /shop_cipher is required for/,
  );

  // 业务错误：抛出带 kind 与 requestId 的错误
  const failing = makeClient(async () => jsonResponse(
    { code: 36009002, message: 'Too many requests', request_id: 'req-1' },
    { status: 429, headers: { 'retry-after': '5' } },
  ));
  await assert.rejects(
    () => failing.request({ path: '/authorization/202309/shops', accessToken: 'T' }),
    error => {
      assert.strictEqual(error.kind, 'RATE_LIMIT');
      assert.strictEqual(error.code, 36009002);
      assert.strictEqual(error.requestId, 'req-1');
      assert.strictEqual(error.retryAfterSeconds, 5);
      return true;
    },
  );

  // ---- 游标分页 ----

  // 正常翻页（TikTok 的订单搜索响应形如 { orders: [...], next_page_token }）
  const pages = [
    { orders: [1, 2], next_page_token: 't2' },
    { orders: [3], next_page_token: '' },
  ];
  let call = 0;
  const collected = await TikTokClient.paginate({
    itemsPath: 'orders',
    fetchPage: async () => pages[call++],
  });
  assert.deepStrictEqual(collected, [1, 2, 3]);
  assert.strictEqual(call, 2);

  // 异常页：token 重复说明平台没推进，必须停下而不是无限循环
  call = 0;
  await assert.rejects(
    () => TikTokClient.paginate({
      itemsPath: 'orders',
      fetchPage: async () => {
        call += 1;
        return { orders: [1], next_page_token: 'same' };
      },
      maxPages: 10,
    }),
    error => {
      assert.strictEqual(error.kind, 'PAGINATION_STALLED');
      return true;
    },
  );
  assert.strictEqual(call, 2, '检测到重复 token 后应立即停止');

  // 未指定 itemsPath 时，响应本身是数组则直接使用
  const flat = await TikTokClient.paginate({
    fetchPage: async () => [{ id: 1 }],
  });
  assert.deepStrictEqual(flat, [{ id: 1 }]);

  console.log('tiktok client and catalog tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
