'use strict';

const assert = require('assert');
const {
  isRetryableError,
  computeBackoffDelay,
  withRateLimitRetry,
  DEFAULT_MAX_ATTEMPTS,
} = require('../src/rate-limit-retry');
const { ShopeeClient } = require('../src/shopee-client');
const { loadRateLimitRetryOptions } = require('../src/config');

// ---- 可重试判定 --------------------------------------------------------------
assert.strictEqual(isRetryableError({ kind: 'RATE_LIMIT' }), true, 'RATE_LIMIT 必须可重试');
assert.strictEqual(isRetryableError({ status: 429 }), true, 'HTTP 429 必须可重试');
assert.strictEqual(isRetryableError({ status: 503 }), true, 'HTTP 5xx 必须可重试');
assert.strictEqual(isRetryableError({ status: 400 }), false, 'HTTP 4xx 业务错误不得重试');
assert.strictEqual(isRetryableError({ status: 403 }), false, 'HTTP 403 不得重试');
assert.strictEqual(isRetryableError({ kind: 'SHOPEE_API_ERROR', status: 404 }), false, '404 不得重试');
assert.strictEqual(isRetryableError(null), false, '空错误不得重试');

// ---- 退避时长计算 ------------------------------------------------------------
// 指数退避：无 Retry-After 时按 base * 2^(n-1) 增长，抖动落在 [50%,100%) 区间
const jitterSamples = [];
for (let i = 0; i < 50; i += 1) {
  jitterSamples.push(computeBackoffDelay({ attempt: 1, baseDelayMs: 1000, maxDelayMs: 60000, random: () => i / 50 }));
}
assert(jitterSamples.every(v => v >= 500 && v <= 1000), `抖动必须落在 [500,1000]，实际 ${jitterSamples[0]}..${jitterSamples[49]}`);
assert(new Set(jitterSamples).size > 10, '抖动必须真正打散重试时刻');

const attempt1 = computeBackoffDelay({ attempt: 1, baseDelayMs: 1000, maxDelayMs: 60000, random: () => 0 });
const attempt3 = computeBackoffDelay({ attempt: 3, baseDelayMs: 1000, maxDelayMs: 60000, random: () => 0 });
assert(attempt1 >= 500 && attempt3 >= 2000, `退避必须随尝试次数增长：${attempt1} -> ${attempt3}`);

// 服务端 Retry-After 优先（平台是权威节流指示）
assert.strictEqual(
  computeBackoffDelay({ attempt: 1, baseDelayMs: 1000, maxDelayMs: 60000, retryAfterSeconds: 12 }),
  12000,
  'Retry-After 必须优先于指数退避'
);
// 但仍受 maxDelayMs 封顶，避免异常大的 Retry-After 卡死同步
assert.strictEqual(
  computeBackoffDelay({ attempt: 1, baseDelayMs: 1000, maxDelayMs: 5000, retryAfterSeconds: 3600 }),
  5000,
  'Retry-After 必须受 maxDelayMs 封顶'
);
// 退避上限
assert(
  computeBackoffDelay({ attempt: 10, baseDelayMs: 1000, maxDelayMs: 3000, random: () => 0 }) <= 3000,
  '退避不得超过 maxDelayMs'
);

// ---- withRateLimitRetry 行为 -------------------------------------------------
(async () => {
  // 1) 限流后成功：应重试并最终返回
  let calls = 0;
  const waits = [];
  const result = await withRateLimitRetry(async () => {
    calls += 1;
    if (calls < 3) {
      const err = new Error('rate limited');
      err.kind = 'RATE_LIMIT';
      err.status = 429;
      throw err;
    }
    return 'ok';
  }, { sleep: async ms => waits.push(ms), random: () => 0 });
  assert.strictEqual(result, 'ok');
  assert.strictEqual(calls, 3, '限流后必须重试到成功');
  assert.strictEqual(waits.length, 2, '每次重试前都要等待');

  // 2) 不可重试错误：立即抛出，不等待
  calls = 0;
  waits.length = 0;
  await assert.rejects(
    () => withRateLimitRetry(async () => {
      calls += 1;
      const err = new Error('bad request');
      err.status = 400;
      throw err;
    }, { sleep: async ms => waits.push(ms) }),
    /bad request/
  );
  assert.strictEqual(calls, 1, '4xx 不得重试');
  assert.strictEqual(waits.length, 0, '4xx 不得等待');

  // 3) 尝试次数用尽后抛出最后一次原始错误（保留 kind/status/code/requestId）
  calls = 0;
  const finalError = await withRateLimitRetry(async () => {
    calls += 1;
    const err = new Error('still limited');
    err.kind = 'RATE_LIMIT';
    err.status = 429;
    err.code = 'ads_rate_limit_shop_api';
    err.requestId = 'req-42';
    throw err;
  }, { maxAttempts: 3, sleep: async () => {} }).then(() => null, e => e);
  assert.strictEqual(calls, 3, '必须尝试满 maxAttempts 次');
  assert.strictEqual(finalError.kind, 'RATE_LIMIT');
  assert.strictEqual(finalError.code, 'ads_rate_limit_shop_api');
  assert.strictEqual(finalError.requestId, 'req-42', '必须保留原始 requestId 供排障');

  // 4) onRetry 回调应报告每次重试
  const retryEvents = [];
  calls = 0;
  await withRateLimitRetry(async () => {
    calls += 1;
    if (calls < 2) {
      const err = new Error('rate limited');
      err.kind = 'RATE_LIMIT';
      err.status = 429;
      err.retryAfterSeconds = 3;
      throw err;
    }
    return 'ok';
  }, { sleep: async () => {}, onRetry: info => retryEvents.push(info) });
  assert.strictEqual(retryEvents.length, 1);
  assert.strictEqual(retryEvents[0].attempt, 1);
  assert.strictEqual(retryEvents[0].kind, 'RATE_LIMIT');
  assert.strictEqual(retryEvents[0].status, 429);

  // ---- 客户端层集成：真实 429 响应应被退避重试并最终成功 --------------------
  let fetchCalls = 0;
  const client = new ShopeeClient({
    partnerId: '123',
    partnerKey: 'secret',
    retryOptions: { sleep: async () => {}, random: () => 0 },
    fetchImpl: async () => {
      fetchCalls += 1;
      if (fetchCalls < 3) {
        return {
          ok: false,
          status: 429,
          text: async () => '{"error":"ads_rate_limit_shop_api"}',
          headers: { get: name => (name === 'retry-after' ? '2' : null) },
        };
      }
      return { ok: true, status: 200, text: async () => '{"response":{"ok":true}}' };
    },
  });
  const payload = await client.shopRequest({
    path: '/api/v2/ads/get_gms_item_performance', shopId: 456, accessToken: 'token',
  });
  assert.strictEqual(fetchCalls, 3, '客户端必须对限流响应退避重试');
  assert.deepStrictEqual(payload, { response: { ok: true } });

  // 客户端层集成：4xx 不重试
  let badCalls = 0;
  const badClient = new ShopeeClient({
    partnerId: '123',
    partnerKey: 'secret',
    retryOptions: { sleep: async () => {} },
    fetchImpl: async () => {
      badCalls += 1;
      return {
        ok: false,
        status: 403,
        text: async () => '{"error":"forbidden"}',
        headers: { get: () => null },
      };
    },
  });
  await assert.rejects(
    () => badClient.shopRequest({ path: '/api/v2/product/get_item_list', shopId: 456, accessToken: 'token' }),
    /forbidden/
  );
  assert.strictEqual(badCalls, 1, '客户端对 4xx 不得重试');

  // ---- 环境变量解析 ------------------------------------------------------------
  assert.deepStrictEqual(loadRateLimitRetryOptions({}), {}, '未设置时不得注入任何覆盖值');
  assert.deepStrictEqual(
    loadRateLimitRetryOptions({
      SHOPEE_RATE_LIMIT_MAX_ATTEMPTS: '6',
      SHOPEE_RATE_LIMIT_BASE_DELAY_MS: '250',
      SHOPEE_RATE_LIMIT_MAX_DELAY_MS: '9000',
    }),
    { maxAttempts: 6, baseDelayMs: 250, maxDelayMs: 9000 },
    '环境变量必须正确映射到退避参数'
  );
  assert.throws(
    () => loadRateLimitRetryOptions({ SHOPEE_RATE_LIMIT_MAX_ATTEMPTS: 'abc' }),
    /SHOPEE_RATE_LIMIT_MAX_ATTEMPTS must be a non-negative number/,
    '非法退避参数必须报错'
  );

  assert.strictEqual(DEFAULT_MAX_ATTEMPTS, 4, '默认尝试次数必须是 4');
  console.log('shopee rate limit retry tests: ok');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
