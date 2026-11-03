'use strict';

/**
 * TikTok 查询接口的端到端验证。
 *
 * 用真实的 Express 路由 + 真实的 TikTokQueryRepository，配一个假 pool，
 * 真的发 HTTP 请求，检查状态码、返回结构与权限隔离。
 *
 * 为什么值得单独测：路由里有一处特别容易写错的权限逻辑 ——
 * TikTok 的 shop_id 是**字符串**，而 Shopee 的授权名单里存的是数字，
 * 直接用 === 比较会让 operator 看不到任何店铺（数字 !== 字符串）。
 */

const assert = require('assert');
const http = require('http');
const express = require('express');

const { createShopeeAnalyticsRouter } = require('../src/http-router');
const { TikTokQueryRepository } = require('../src/tiktok-query-repository');

/**
 * 假 pool：按 SQL 里的表名返回对应的假数据。
 */
function createFakePool() {
  return {
    async query(text) {
      if (/FROM tiktok_shop_tokens/.test(text)) {
        return {
          rows: [
            { regionGroup: 'ROW', shopId: '7523xxxx', connectedAt: new Date('2026-10-01T00:00:00Z'), expiresAt: new Date('2026-12-01T00:00:00Z'), tokenCount: 1 },
            { regionGroup: 'ROW', shopId: '8899yyyy', connectedAt: new Date('2026-10-02T00:00:00Z'), expiresAt: new Date('2026-12-02T00:00:00Z'), tokenCount: 1 },
          ],
        };
      }
      if (/FROM tiktok_shop_daily/.test(text) && /GROUP BY/.test(text)) {
        return {
          rows: [{
            attributionBasis: 'order_level', source: 'shop_order', currency: 'USD', dayCount: 2,
            orders: '4', units: '8', spend: null, impressions: null, clicks: null,
            gmvOrderTotal: '300', gmvSubtotal: '250', gmvSettled: null,
            refunds: null, commission: null, shipping: null, cancellations: null,
            incrementalGmv: null, firstDate: '2026-11-01', lastDate: '2026-11-02',
          }],
        };
      }
      if (/FROM tiktok_shop_daily/.test(text)) {
        return {
          rows: [{
            eventDate: '2026-11-01', attributionBasis: 'order_level', source: 'shop_order',
            channel: 'unknown', currency: 'USD', orders: '4', units: '8', spend: null,
            impressions: null, clicks: null, gmvOrderTotal: '300', gmvSubtotal: '250',
            gmvSettled: null, refunds: null, commission: null, shipping: null,
            cancellations: '0', baselineNaturalGmv: null, incrementalGmv: null,
          }],
        };
      }
      if (/FROM tiktok_order_items/.test(text)) {
        return {
          rows: [{ productId: 'P-1', productName: '鼠标', orderCount: 2, units: 5, grossAmount: '100', discounts: '0' }],
        };
      }
      if (/FROM tiktok_orders/.test(text)) {
        return {
          rows: [{
            orderId: 'O-1', orderStatus: 'COMPLETED', attributionBasis: 'order_level',
            channel: 'unknown', currency: 'USD', orderDate: '2026-11-01', units: '2',
            gmvOrderTotal: '150', gmvSubtotal: '120', gmvSettled: null, shippingFee: '10',
          }],
        };
      }
      if (/tiktok_sync_state/.test(text)) {
        return {
          rows: [{
            orderCount: 1, productCount: 1, coveredDayCount: 1, syncStateCount: 2,
            firstOrderDate: '2026-11-01', lastOrderDate: '2026-11-01',
          }],
        };
      }
      return { rows: [] };
    },
  };
}

/** 起一个临时服务并返回 base URL。 */
function startServer(authOverride = null) {
  return new Promise((resolve, reject) => {
    const app = express();
    app.use(express.json());
    const pool = createFakePool();
    const router = createShopeeAnalyticsRouter({
      repository: { pool },
      strategyRepository: null,
      queryRepository: { listShops: async () => [], pool },
      tiktokQueryRepository: new TikTokQueryRepository({ pool }),
    });
    app.use('/api/shopee-analytics', (req, res, next) => {
      // 模拟登录态：req.auth 由上游中间件注入。
      if (authOverride) req.auth = authOverride;
      router(req, res, next);
    });
    app.use((error, req, res, next) => { // eslint-disable-line no-unused-vars
      res.status(error.status || 500).json({ error: error.code || 'ERROR', message: error.message });
    });
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
    server.on('error', reject);
  });
}

/** 发一个 GET 并解析 JSON。 */
function get(base, path) {
  return new Promise((resolve, reject) => {
    http.get(`${base}${path}`, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        let payload = null;
        try { payload = JSON.parse(body); } catch { payload = body; }
        resolve({ status: res.statusCode, body: payload });
      });
    }).on('error', reject);
  });
}

async function main() {
  // ---- 未登录（req.auth 不存在）应看到全部店铺 ----
  const anon = await startServer(null);
  try {
    const shops = await get(anon.base, '/api/shopee-analytics/tiktok/shops');
    assert.strictEqual(shops.status, 200, '店铺列表应返回 200');
    assert.strictEqual(shops.body.shops.length, 2, '未登录应看到全部 TikTok 店铺');
    // ★ shop_id 必须是字符串，不能被转成数字
    assert.strictEqual(typeof shops.body.shops[0].shopId, 'string', 'shopId 必须是字符串');

    const overview = await get(anon.base, '/api/shopee-analytics/tiktok/shops/7523xxxx/overview');
    assert.strictEqual(overview.status, 200, '概览应返回 200');
    assert.ok(overview.body.byBasis, '概览应按口径返回');
    assert.ok(overview.body.byBasis.order_level, '应有订单口径');
    // ★ 结算口径在订单口径下必须是 null
    assert.strictEqual(overview.body.byBasis.order_level.gmvSettled, null, '订单口径的结算收入必须为 null');
    assert.strictEqual(overview.body.byBasis.order_level.gmvOrderTotal, 300, '订单实付应为数字 300');
    assert.ok(overview.body.daily, '概览应带日粒度');
    assert.ok(overview.body.coverage, '概览应带覆盖情况');

    const products = await get(anon.base, '/api/shopee-analytics/tiktok/shops/7523xxxx/products');
    assert.strictEqual(products.status, 200);
    assert.strictEqual(products.body.products.length, 1, '应返回 1 个商品');
    assert.strictEqual(products.body.products[0].productName, '鼠标');

    const orders = await get(anon.base, '/api/shopee-analytics/tiktok/shops/7523xxxx/orders');
    assert.strictEqual(orders.status, 200);
    assert.strictEqual(orders.body.orders.length, 1, '应返回 1 笔订单');
  } finally {
    anon.server.close();
  }

  // ---- operator：授权名单里存的是店铺 ID，TikTok 的 shop_id 是**字符串** ----
  // 关键点：Shopee 侧的 shop_id 是数字（如 1101364305），TikTok 侧是字符串
  // （如 '7523xxxx'）。如果权限比较直接用 ===，两边永远不相等 ——
  // operator 会看不到任何店铺（授权失效），或反过来看到不该看的。
  // 所以必须字符串化后比较。这里让授权名单里放字符串 '8899yyyy'，
  // 验证它能匹配上；同时放一个数字形态的 ID，验证不会误匹配。
  const operator = await startServer({
    enabled: true,
    role: 'OPERATOR',
    shopIds: ['8899yyyy'],
  });
  try {
    const shops = await get(operator.base, '/api/shopee-analytics/tiktok/shops');
    assert.strictEqual(shops.status, 200);
    assert.strictEqual(
      shops.body.shops.length, 1,
      `operator 只应看到被分配到的店铺，实际看到 ${shops.body.shops.length} 家`,
    );
    assert.strictEqual(
      String(shops.body.shops[0].shopId), '8899yyyy',
      'operator 看到的应是其被分配的那家店',
    );

    // 未分配的店铺应被拒绝
    const forbidden = await get(operator.base, '/api/shopee-analytics/tiktok/shops/7523xxxx/overview');
    assert.strictEqual(forbidden.status, 403, '未分配的店铺应返回 403');
  } finally {
    operator.server.close();
  }

  // ---- 数字形态的 Shopee 店铺 ID 不能匹配 TikTok 店铺 ----
  // 这是真正的串店风险：Shopee 的 7523 与 TikTok 的 '7523' 不是同一家店。
  const numericOperator = await startServer({
    enabled: true,
    role: 'OPERATOR',
    shopIds: [7523],
  });
  try {
    const shops = await get(numericOperator.base, '/api/shopee-analytics/tiktok/shops');
    assert.strictEqual(
      shops.body.shops.length, 0,
      'Shopee 的数字 shop_id 不应匹配到 TikTok 店铺 —— 两个平台的 ID 体系不同',
    );
  } finally {
    numericOperator.server.close();
  }

  // ---- super admin 看到全部 ----
  const admin = await startServer({ enabled: true, role: 'SUPER_ADMIN', shopIds: [] });
  try {
    const shops = await get(admin.base, '/api/shopee-analytics/tiktok/shops');
    assert.strictEqual(shops.body.shops.length, 2, 'super admin 应看到全部店铺');
  } finally {
    admin.server.close();
  }

  process.stdout.write('tiktok query api e2e test passed\n');
}

main().catch((error) => {
  process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
  process.exit(1);
});
