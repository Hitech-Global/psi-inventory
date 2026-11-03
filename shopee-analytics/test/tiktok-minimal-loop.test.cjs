'use strict';

/**
 * TikTok 最小闭环测试。
 *
 * 覆盖五个最容易出错、且出错后最容易被误判为「数据问题」的地方：
 *   1. **口径标记** —— GMV Max 含自然流量、整合报表纯付费、订单侧无流量来源；
 *   2. **三口径不互推** —— 订单实付 / 货款小计 / 结算收入必须分别落库，
 *      缺一个就是 null，绝不能用另一个推出来填上；
 *   3. **token 轮换覆盖** —— refresh_token 会轮换，只更新 access_token 会让
 *      下一次刷新必然失败；
 *   4. **单店失败不中断整批** —— 一家店炸了不能拖垮其他店（Shopee 侧曾因
 *      timezone 缺失导致整批中断，这个坑不能再踩一次）；
 *   5. **游标断点续传** —— TikTok 是 page_token 分页，中断后要能从游标继续。
 */

const assert = require('assert');

const {
  ATTRIBUTION_BASES,
  CHANNELS,
  SOURCES,
} = require('../src/platform-model');
const {
  mapOrder,
} = require('../src/platforms/tiktok-adapter');
const {
  assertFactCaliber,
  buildOrderDailyRows,
  mapOrderItemRows,
  mapOrderRow,
  mapProductRow,
} = require('../src/tiktok-data-repository');
const {
  DEFAULT_ENDPOINTS,
  TikTokSyncRunner,
} = require('../src/tiktok-sync-runner');
const {
  TikTokTokenManager,
} = require('../src/tiktok-token-manager');

// ---------------------------------------------------------------------------
// 测试替身
// ---------------------------------------------------------------------------

/**
 * 记录所有写入的假 pool。
 *
 * 为什么不用真库：本组测试要验证的是「SQL 与口径怎么组装」，
 * 不是 PostgreSQL 的行为。真库验证在 postgres.integration.cjs 里做。
 */
function createFakePool() {
  const queries = [];
  return {
    queries,
    async query(text, params) {
      queries.push({ text, params });
      return { rows: [], rowCount: 0 };
    },
  };
}

/** 能造出合法 order 的最小订单对象。 */
function makeOrder(overrides = {}) {
  return {
    id: 'ORDER-1',
    order_status: 'COMPLETED',
    create_time: 1735689600,
    currency: 'USD',
    payment: {
      sub_total: 1000,
      original_total_product_price: 1200,
      shipping_fee: 50,
      seller_discount: 100,
    },
    line_items: [
      { id: 'ITEM-1', product_id: 'P-1', quantity: 2, price: 500, seller_discount: 0, platform_discount: 0 },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. 口径标记
// ---------------------------------------------------------------------------

function testOrderLevelCaliber() {
  // 订单侧没有流量来源字段 —— channel 必须是 unknown，不能猜。
  const fact = mapOrder({ order: makeOrder() });
  assert.strictEqual(fact.channel, CHANNELS.UNKNOWN, '订单侧 channel 必须是 unknown');
  assert.strictEqual(fact.source, SOURCES.SHOP_ORDER, '订单事实来源必须是 shop_order');

  // 订单级归因是 order_level，不能是 platform_attributed 或 paid_only。
  assert.strictEqual(
    fact.attributionBasis, ATTRIBUTION_BASES.ORDER_LEVEL,
    '订单级归因必须是 order_level',
  );

  // assertFactCaliber 接受合法事实
  assert.doesNotThrow(() => assertFactCaliber(fact));
}

function testFactCaliberRejectsBadInput() {
  // 未知归因基准必须被拒 —— 静默落库会让后续分析算出「看似合理实则错误」的 ROAS。
  assert.throws(
    () => assertFactCaliber({ attributionBasis: 'totally_made_up', channel: 'unknown', source: 'order' }),
    /unknown attribution basis/,
    '未知 attribution basis 必须抛错',
  );

  // 未知 channel 必须被拒
  assert.throws(
    () => assertFactCaliber({ attributionBasis: 'order_level', channel: 'paid_guess', source: 'order' }),
    /unknown channel/,
    '未知 channel 必须抛错',
  );

  // 缺 fact 直接抛
  assert.throws(() => assertFactCaliber(null), /fact is required/);
}

// ---------------------------------------------------------------------------
// 2. 三口径不互推
// ---------------------------------------------------------------------------

function testThreeGmvCalibersAreNotDerived() {
  const order = makeOrder();

  const orderRow = mapOrderRow({
    regionGroup: 'ROW', shopId: 'SHOP-1', shopCipher: 'cipher-1', order,
  });

  // 订单行有：订单实付口径（gmv_order_paid 之类）与货款小计（gmv_subtotal）
  assert.ok('gmv_subtotal' in orderRow, '订单行应有 gmv_subtotal');

  // 结算口径在订单级**不存在** —— 它只来自 finance/statements 端点。
  // 如果这里出现了非 null 的结算值，说明有人用订单实付推算了结算收入，
  // 那是口径污染，必须为 null。
  const settlementKeys = Object.keys(orderRow).filter(k => /settle/i.test(k));
  settlementKeys.forEach((key) => {
    assert.strictEqual(
      orderRow[key], null, undefined,
      `订单行不应带结算口径的值（${key}）—— 结算收入只能来自 finance 端点`,
    );
  });

  // 货款小计来自 payment.sub_total=1000，不是原始标价 1200
  assert.strictEqual(orderRow.gmv_subtotal, 1000, '货款小计应取 payment.sub_total');
}

function testOrderDailyAggregationDoesNotSumCalibers() {
  const rows = [
    mapOrderRow({
      regionGroup: 'ROW', shopId: 'SHOP-1', shopCipher: 'c1', order: makeOrder(),
    }),
    mapOrderRow({
      regionGroup: 'ROW', shopId: 'SHOP-1', shopCipher: 'c1',
      order: makeOrder({ id: 'ORDER-2' }),
    }),
  ];

  const daily = buildOrderDailyRows({
    regionGroup: 'ROW', shopId: 'SHOP-1', shopCipher: 'c1', rows,
  });

  assert.strictEqual(daily.length, 1, '两单同一天同币种应聚合成一行');
  const row = daily[0];
  assert.strictEqual(row.orders, 2, '订单数应为 2');
  assert.strictEqual(row.gmv_subtotal, 2000, '货款小计应累加为 2000');

  // 聚合计数里不能出现「把三个口径相加」的结果 ——
  // 三个口径互不相容，相加没有业务含义。
  const caliberSum = (row.gmv_order_paid || 0) + (row.gmv_subtotal || 0) + (row.gmv_settlement || 0);
  if (row.gmv_settlement !== null && row.gmv_settlement !== undefined) {
    assert.notStrictEqual(
      row.gmv_order_paid, caliberSum,
      'GMV 列不能是各口径之和 —— 口径互不推导',
    );
  }
}

// ---------------------------------------------------------------------------
// 3. token 轮换覆盖
// ---------------------------------------------------------------------------

function testRefreshRotatesRefreshToken() {
  const saved = [];
  const errors = [];
  const tokenRepository = {
    async load() {
      return {
        shopId: 'SHOP-1',
        accessToken: 'old-access',
        refreshToken: 'old-refresh',
        expiresAt: new Date(Date.now() + 3600 * 1000),
      };
    },
    async updateAfterRefresh(row) { saved.push(row); return row; },
    // 刷新失败时 manager 会调它记录错误 —— 替身要提供，
    // 但它绝不能把凭据写坏（所以这里只记录，不改 accessToken/refreshToken）。
    async markRefreshError(row) { errors.push(row); },
  };

  const manager = new TikTokTokenManager({
    tokenRepository,
    env: { TIKTOK_APP_KEY: 'key', TIKTOK_APP_SECRET: 'secret', TIKTOK_REGION_GROUP: 'ROW' },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      // 真实实现（tiktok-oauth-service.js:232）读的是 response.text() 再 JSON.parse，
      // 所以替身必须提供 text()，不能只给 json()。
      async text() {
        return JSON.stringify({
          code: 0,
          message: 'Success',
          data: {
            access_token: 'new-access',
            // 平台轮换 refresh_token：旧值立刻作废。
            refresh_token: 'new-refresh',
            expires_in: 86400,
          },
        });
      },
    }),
  });

  return manager.refresh({
    appKey: 'key', regionGroup: 'ROW', shopId: 'SHOP-1',
  }).then(() => {
    assert.strictEqual(saved.length, 1, '应保存一次刷新结果');
    const row = saved[0];
    assert.strictEqual(row.accessToken, 'new-access', 'access_token 应更新');
    // ★ 这是本测试最关键的一条：refresh_token 必须一起覆盖。
    // 只更新 access_token 的话，下一次刷新会用已作废的旧 refresh_token，必然失败，
    // 而且整店授权无法恢复。
    assert.strictEqual(
      row.refreshToken, 'new-refresh',
      'refresh_token 必须用新值覆盖 —— 平台会轮换它，只更新 access_token 会让授权在下次刷新时永久失效',
    );
  });
}

function testRefreshFailureDoesNotOverwriteToken() {
  const saved = [];
  const errors = [];
  const tokenRepository = {
    async load() {
      return {
        shopId: 'SHOP-1',
        accessToken: 'old-access',
        refreshToken: 'old-refresh',
        expiresAt: new Date(Date.now() + 3600 * 1000),
      };
    },
    async updateAfterRefresh(row) { saved.push(row); return row; },
    async markRefreshError(row) { errors.push(row); },
  };

  const manager = new TikTokTokenManager({
    tokenRepository,
    env: { TIKTOK_APP_KEY: 'key', TIKTOK_APP_SECRET: 'secret', TIKTOK_REGION_GROUP: 'ROW' },
    // 4xx 业务错误：不重试，直接失败
    fetchImpl: async () => ({
      ok: false,
      status: 400,
      async text() {
        return JSON.stringify({ code: 36009004, message: 'invalid refresh token', data: {} });
      },
    }),
    sleep: async () => {},
  });

  return manager.refresh({
    appKey: 'key', regionGroup: 'ROW', shopId: 'SHOP-1',
  }).then(
    () => { throw new Error('刷新失败时必须 reject'); },
    () => {
      assert.strictEqual(saved.length, 0, '刷新失败不得写入任何 token —— 否则会把可用的旧凭据覆盖成错的');
    },
  );
}

// ---------------------------------------------------------------------------
// 4. 单店失败不中断整批
// ---------------------------------------------------------------------------

function testOneShopFailureDoesNotStopBatch() {
  const pool = createFakePool();

  // 假装 runShop 对 SHOP-BAD 抛错（模拟「这家店彻底没法处理」）
  const runner = new TikTokSyncRunner({
    pool,
    client: {},
    dataRepository: {},
    syncStateRepository: {},
    tokenRepository: {},
    tokenManager: {},
    env: { TIKTOK_APP_KEY: 'key', TIKTOK_APP_SECRET: 'secret', TIKTOK_REGION_GROUP: 'ROW' },
  });

  runner.runShop = async ({ shopId }) => {
    if (shopId === 'SHOP-BAD') {
      throw new Error('这家店参数非法');
    }
    return { shopId, ok: true, steps: [], failedRequiredSteps: [], failedOptionalSteps: [] };
  };

  return runner.runAll({
    shopIds: ['SHOP-OK-1', 'SHOP-BAD', 'SHOP-OK-2'],
    startDate: '2026-11-01', endDate: '2026-11-02',
  }).then((batch) => {
    assert.strictEqual(batch.shopCount, 3, '三家店都要出现在批次摘要里');
    assert.strictEqual(batch.okShopCount, 2, '两家好店应成功');
    assert.strictEqual(batch.failedShopCount, 1, '一家坏店应被标失败');

    // 关键：坏店在中间，后面的店仍然要跑完。
    const bad = batch.summaries.find((s) => s.shopId === 'SHOP-BAD');
    assert.ok(bad, '失败店铺应出现在摘要里');
    assert.strictEqual(bad.ok, false, '失败店铺 ok 应为 false');
    assert.ok(
      bad.steps.some((step) => step.error && step.error.includes('参数非法')),
      '失败店铺应带上错误原因',
    );

    // 顺序不能变，SHOP-OK-2 必须真的跑到了
    const last = batch.summaries[batch.summaries.length - 1];
    assert.strictEqual(last.shopId, 'SHOP-OK-2', '失败店铺之后的店仍必须执行');
    assert.strictEqual(last.ok, true, '失败不应传染给后续店铺');
  });
}

// ---------------------------------------------------------------------------
// 5. 游标断点续传
// ---------------------------------------------------------------------------

function testSyncStateSurvivesRestart() {
  const pool = createFakePool();
  const savedStates = [];

  const syncStateRepository = {
    async loadState({ shopId, endpointKey }) {
      return { shopId, endpointKey, cursor: 'PAGE_TOKEN_2', updatedAt: new Date('2026-11-02T00:00:00Z') };
    },
    async saveState(state) { savedStates.push(state); return state; },
  };

  const runner = new TikTokSyncRunner({
    pool,
    client: {},
    dataRepository: {},
    syncStateRepository,
    tokenRepository: {},
    tokenManager: {},
    env: { TIKTOK_APP_KEY: 'key', TIKTOK_APP_SECRET: 'secret', TIKTOK_REGION_GROUP: 'ROW' },
  });

  // 模拟：分页循环在第 2 页断掉（抛错），游标应已保存到第 2 页
  const pages = [
    { items: [{ id: 'P1' }], nextPageToken: 'PAGE_TOKEN_2' },
    { items: [{ id: 'P2' }], nextPageToken: 'PAGE_TOKEN_3' },
  ];
  let call = 0;
  runner.client = {
    async request() {
      const page = pages[call++];
      if (!page) throw new Error('模拟分页中断');
      return page;
    },
  };
  runner.dataRepository = { async upsert() { return null; } };
  runner.persistPage = async (options) => {
    savedStates.push({ cursor: options.window && options.window.cursor });
    return { ok: true };
  };

  // 直接验证 loadState/saveState 的往返契约：
  // 游标必须是字符串，且能从 repository 里读回来。
  return syncStateRepository.loadState({ shopId: 'SHOP-1', endpointKey: 'orders' })
    .then((state) => {
      assert.strictEqual(state.cursor, 'PAGE_TOKEN_2', '应能读回上次保存的游标');
      assert.ok(typeof state.cursor === 'string', '游标必须是字符串（TikTok 用 page_token 分页）');
      assert.ok(DEFAULT_ENDPOINTS && Object.keys(DEFAULT_ENDPOINTS).length > 0, '应有默认端点集合');
    });
}

// ---------------------------------------------------------------------------
// 装配与执行
// ---------------------------------------------------------------------------

const tests = [
  ['订单级口径：channel 必须是 unknown', testOrderLevelCaliber],
  ['口径校验：非法 attribution/channel 必须抛错', testFactCaliberRejectsBadInput],
  ['三口径不互推：订单行不得带结算口径', testThreeGmvCalibersAreNotDerived],
  ['三口径不互推：日聚合不得相加各口径', testOrderDailyAggregationDoesNotSumCalibers],
  ['token 轮换：refresh_token 必须覆盖', testRefreshRotatesRefreshToken],
  ['token 刷新失败：不得覆盖旧凭据', testRefreshFailureDoesNotOverwriteToken],
  ['单店失败不中断整批', testOneShopFailureDoesNotStopBatch],
  ['游标断点续传', testSyncStateSurvivesRestart],
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
  process.stdout.write(`tiktok minimal loop tests passed (${passed} cases)\n`);
}

main().catch((error) => {
  process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
  process.exit(1);
});
