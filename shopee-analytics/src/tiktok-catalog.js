'use strict';

/**
 * TikTok Shop 端点目录。
 * ============================================================================================
 * 与 Shopee 端点目录（src/catalog.js）的差异：
 *   - Shopee 用 `app` 区分四套 App 凭据；TikTok 的 Shop Open API 是一套凭据，
 *     差异体现在**区域**（ROW / US 各一套 app_key/app_secret）与**店铺标识**（shop_cipher）。
 *   - Shopee 的端点是否需要 shop_id 是隐含的；TikTok 的是**端点级显式标志**
 *     `requiresShopCipher`，必须逐端点读文档，不能猜。
 *   - 版本号写死在路径里。促销域已确认存在版本分裂：
 *     `promotion/202309/activities` 与 `promotion/202406/coupons` 各用各的版本。
 *
 * 端点清单的取舍
 * --------------
 * 只收录 M1 所需范围（店铺经营 + 广告效果 + 达人），不铺开全量端点。
 * 依据：官方对 scope 申请的建议是"只申请所需 scope"，端点同理 ——
 * 端点越多，审核与维护成本越高。
 *
 * 只读约束：全部为查询类端点，不含任何写操作。
 */

/** 区域分组。一套 app 凭据只覆盖一个区域组。 */
const REGION_GROUPS = Object.freeze({
  ROW: 'ROW',
  US: 'US',
});

/**
 * 端点定义。
 *
 * requiresShopCipher: 该端点是否要求 shop_cipher 作为 query 参数。
 *   - 官方错误码 36009004 有两种相反含义：
 *     `Missing identifier.` 表示缺少 shop_cipher，
 *     `Unexpected identifier.` 表示带了多余的 shop_cipher。
 *     两种含义共用一个数字码，且该码还用于其他校验失败，
 *     所以**禁止靠错误反推**，必须在这里声明。
 */
const ENDPOINTS = Object.freeze({
  /** 授权店铺台账：一个 access token 可覆盖卖家名下多个店铺，每店有自己的 cipher。 */
  authorizedShops: {
    method: 'GET',
    path: '/authorization/202309/shops',
    requiresShopCipher: false,
    regionGroups: [REGION_GROUPS.ROW, REGION_GROUPS.US],
    scope: 'Shop Authorized Information',
  },

  // ---- 订单 ----
  orderSearch: {
    method: 'POST',
    path: '/order/202309/orders/search',
    requiresShopCipher: true,
    regionGroups: [REGION_GROUPS.ROW, REGION_GROUPS.US],
    scope: 'Order Information',
    cursor: true,
  },
  orderDetail: {
    method: 'GET',
    path: '/order/202507/orders',
    requiresShopCipher: true,
    regionGroups: [REGION_GROUPS.ROW, REGION_GROUPS.US],
    scope: 'Order Information',
  },
  orderPriceDetail: {
    method: 'GET',
    path: '/order/202407/orders/{order_id}/price_detail',
    requiresShopCipher: true,
    regionGroups: [REGION_GROUPS.ROW, REGION_GROUPS.US],
    scope: 'Order Information',
  },

  // ---- 商品 ----
  productSearch: {
    method: 'POST',
    path: '/product/202502/products/search',
    requiresShopCipher: true,
    regionGroups: [REGION_GROUPS.ROW, REGION_GROUPS.US],
    scope: 'Product Basic',
    cursor: true,
  },
  productDetail: {
    method: 'GET',
    path: '/product/202309/products/{product_id}',
    requiresShopCipher: true,
    regionGroups: [REGION_GROUPS.ROW, REGION_GROUPS.US],
    scope: 'Product Basic',
  },
  inventorySearch: {
    method: 'POST',
    path: '/product/202309/inventory/search',
    requiresShopCipher: true,
    regionGroups: [REGION_GROUPS.ROW, REGION_GROUPS.US],
    scope: 'Product Basic',
    cursor: true,
  },

  // ---- 优惠（版本分裂：activities 与 coupons 各用各的版本号）----
  promotionActivities: {
    method: 'POST',
    path: '/promotion/202309/activities/search',
    requiresShopCipher: true,
    regionGroups: [REGION_GROUPS.ROW, REGION_GROUPS.US],
    scope: 'Promotion Information',
    cursor: true,
  },
  promotionCoupons: {
    method: 'POST',
    path: '/promotion/202406/coupons/search',
    requiresShopCipher: true,
    regionGroups: [REGION_GROUPS.ROW, REGION_GROUPS.US],
    scope: 'Promotion Information',
    cursor: true,
  },

  // ---- 退货 ----
  returnSearch: {
    method: 'POST',
    path: '/return_refund/202602/returns/search',
    requiresShopCipher: true,
    regionGroups: [REGION_GROUPS.ROW, REGION_GROUPS.US],
    scope: 'Return & Refund Basic',
    cursor: true,
  },

  // ---- 结算（净收益与结算净 ROAS 的数据来源）----
  statements: {
    method: 'GET',
    path: '/finance/202309/statements',
    requiresShopCipher: true,
    regionGroups: [REGION_GROUPS.ROW, REGION_GROUPS.US],
    scope: 'Finance Information',
  },
  statementTransactions: {
    method: 'GET',
    path: '/finance/202501/orders/{order_id}/statement_transactions',
    requiresShopCipher: true,
    regionGroups: [REGION_GROUPS.ROW, REGION_GROUPS.US],
    scope: 'Finance Information',
  },

  // ---- 店铺分析（漏斗与 SKU 结构）----
  shopPerformance: {
    method: 'GET',
    path: '/analytics/202609/shop/performance',
    requiresShopCipher: true,
    regionGroups: [REGION_GROUPS.ROW, REGION_GROUPS.US],
    scope: 'TikTok Shop Analytics',
  },
  shopSkuPerformance: {
    method: 'GET',
    path: '/analytics/202509/shop_skus/performance',
    requiresShopCipher: true,
    regionGroups: [REGION_GROUPS.ROW, REGION_GROUPS.US],
    scope: 'TikTok Shop Analytics',
  },

  // ---- 达人（TikTok 版的渠道结构）----
  affiliateOrders: {
    method: 'POST',
    path: '/affiliate_seller/202410/orders/search',
    requiresShopCipher: true,
    regionGroups: [REGION_GROUPS.ROW, REGION_GROUPS.US],
    scope: 'Read Seller Affiliate Collaboration',
    cursor: true,
  },
  affiliateCreator: {
    method: 'GET',
    path: '/affiliate_seller/202505/marketplace_creators/{creator_id}',
    requiresShopCipher: true,
    regionGroups: [REGION_GROUPS.ROW, REGION_GROUPS.US],
    scope: 'Read Seller Affiliate Collaboration',
  },
});

/**
 * Marketing API 端点（广告效果）。
 *
 * 与 Shop Open API **完全独立的凭据体系**：
 *   - 独立的 app_id / app_secret
 *   - advertiser OAuth token，放在 `Access-Token` 头里，**不签名**
 *   - token **24 小时过期**，需独立刷新调度
 *
 * 归因口径警告：
 *   - gmvMaxReport 的 gross_revenue / orders / roi **混合自然流量**，1 天点击窗口
 *   - integratedReport 的 spend / impressions / clicks / conversions 是**纯付费**数据
 *   - 两者语义不同，不可互换使用
 */
const MARKETING_ENDPOINTS = Object.freeze({
  /** GMV Max 报表：花费 + 混合归因的 GMV/订单/ROI。 */
  gmvMaxReport: {
    method: 'GET',
    path: '/open_api/v1.3/gmv_max/report/get/',
    requiresAdvertiserId: true,
    requiresStoreIds: true,
    dateSpanMaxDays: 30,
    attributionBasis: 'platform_attributed',
  },
  /** 整合报表：纯付费漏斗（spend/impressions/clicks/conversions）。 */
  integratedReport: {
    method: 'GET',
    path: '/open_api/v1.3/report/integrated/get/',
    requiresAdvertiserId: true,
    dateSpanMaxDays: 30,
    attributionBasis: 'paid_only',
  },
});

/**
 * 同步节奏。数值参考各端点的数据延迟与刷新需求。
 * 与 Shopee 的 SYNC_POLICY 结构一致：minutes 为最小刷新间隔。
 */
const SYNC_POLICY = Object.freeze({
  authorizedShops: { minutes: 1440 },
  orderSearch: { minutes: 15, refreshDays: 15 },
  orderDetail: { minutes: 60, refreshDays: 15 },
  productSearch: { minutes: 360 },
  productDetail: { minutes: 360 },
  inventorySearch: { minutes: 360 },
  promotionActivities: { minutes: 60 },
  promotionCoupons: { minutes: 60 },
  returnSearch: { minutes: 30, refreshDays: 30 },
  statements: { minutes: 1440 },
  statementTransactions: { minutes: 1440 },
  shopPerformance: { minutes: 60, refreshDays: 7 },
  shopSkuPerformance: { minutes: 60, refreshDays: 7 },
  affiliateOrders: { minutes: 60, refreshDays: 7 },
  affiliateCreator: { minutes: 1440 },
});

/**
 * 取端点定义，并把路径里的 {placeholder} 填上。
 *
 * @param {string} key 端点键
 * @param {object} [params] 路径参数
 * @returns {object} 含最终 path 的端点定义
 */
function resolveEndpoint(key, params = {}) {
  const endpoint = ENDPOINTS[key];
  if (!endpoint) throw new Error(`unknown TikTok endpoint: ${key}`);
  let path = endpoint.path;
  for (const [name, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    path = path.replace(`{${name}}`, encodeURIComponent(String(value)));
  }
  // 未被替换的占位符说明调用方漏传了参数，要指出具体是哪个。
  const missing = [...path.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map(match => match[1]);
  if (missing.length > 0) {
    throw new Error(`missing path parameter ${missing[0]} for endpoint ${key}`);
  }
  return { ...endpoint, path };
}

/**
 * 取 Marketing API 端点定义。
 *
 * @param {string} key 端点键
 * @returns {object}
 */
function resolveMarketingEndpoint(key) {
  const endpoint = MARKETING_ENDPOINTS[key];
  if (!endpoint) throw new Error(`unknown TikTok marketing endpoint: ${key}`);
  return endpoint;
}

/**
 * 汇总 M1 所需的 scope，用于申请清单。
 * @returns {string[]} 去重后的 scope 名
 */
function requiredScopes() {
  const scopes = new Set();
  for (const endpoint of Object.values(ENDPOINTS)) {
    if (endpoint.scope) scopes.add(endpoint.scope);
  }
  return [...scopes].sort();
}

module.exports = {
  ENDPOINTS,
  MARKETING_ENDPOINTS,
  REGION_GROUPS,
  SYNC_POLICY,
  requiredScopes,
  resolveEndpoint,
  resolveMarketingEndpoint,
};

// TikTok 接入进度：M0 底座已完成（签名器 / 中间模型 / client+catalog / 凭据存储 / 快照表）
// M1 待办：店铺经营 + Marketing API 广告效果 + 增量 GMV 与结算净 ROAS
