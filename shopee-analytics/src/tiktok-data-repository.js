'use strict';

/**
 * TikTok 业务数据落库层。
 * ============================================================================================
 * 这一层负责把 TikTok 的原始响应变成"带着口径标记"的行，并且**守住三条口径铁律**：
 *
 *   1. GMV Max 的 GMV / 订单 / ROI **含自然流量** → 只能是 platform_attributed；
 *   2. 整合报表是**纯付费** → 只能是 paid_only；
 *   3. 订单侧**没有流量来源字段** → channel 只能是 unknown。
 *
 * 为什么铁律要在这里守，而不是只在注释里写
 * -----------------------------------------
 * 口径错了不会让程序报错，只会让某个数悄悄变大或变小。
 * 例如把 GMV Max 的归因 GMV 当成"广告带来的订单"，算出来的 ROI 会好看得离谱。
 * 所以这一层在写库前主动检查口径，**发现混用就拒绝写入**，
 * 让错误在落库那一刻就暴露，而不是等到看板上。
 *
 * 三个 GMV 口径互不推导
 * --------------------
 *   订单实付（gmv_order_total）来自订单 payment.total_amount；
 *   货款小计（gmv_subtotal）来自订单 payment.sub_total；
 *   结算收入（gmv_settled）只来自 finance 端点。
 * 三者是**三个独立的事实**，不是同一个数的三种算法。
 * 因此：
 *   * 订单行里根本没有 gmv_settled 这一列的来源（数据库层面用 CHECK 兜住）；
 *   * 同一行里不允许同时出现结算收入与订单口径的 GMV
 *     （否则就意味着有人用一个推另一个）。
 *
 * 为什么两个 repository 放在同一个文件
 * -----------------------------------
 * 业务表与游标表的**主键前缀完全一致**（region_group + shop_id），
 * 而"店铺身份"的三元组绑定（region_group / shop_id / shop_cipher）规则只有一份实现。
 * 拆成两个文件会让这套绑定规则被复制两遍 —— 复制出来的第二遍迟早漏掉某个字段。
 * 游标只是"同步到哪儿了"的元数据，与业务行同源同命，
 * 放在一起也能让"先写数据、再推进游标"的顺序在同一个文件里看得见。
 *
 * 只读约束：本模块只做本地持久化，不发起任何网络请求。
 */

const {
  ATTRIBUTION_BASES,
  ATTRIBUTION_BASIS_VALUES,
  CHANNELS,
  CHANNEL_VALUES,
  SOURCES,
  SOURCE_VALUES,
} = require('./platform-model');
const { mapOrder, mapStatementRow } = require('./platforms/tiktok-adapter');

/** 日汇总表里未知币种的占位值。主键列不允许 NULL，所以必须有这个哨兵。 */
const UNKNOWN_CURRENCY = 'UNKNOWN';

/**
 * 把 epoch 秒/毫秒或日期字符串读成 YYYY-MM-DD。
 *
 * TikTok 的订单时间戳是 epoch 秒；结算流水的时间字段形态不统一，
 * 有的给字符串日期、有的给 epoch。这里统一成 UTC 日期，
 * 理由是 TikTok 订单搜索接口本身就是按 UTC 时区请求的（time_zone=UTC），
 * 用本地时区换算会让同一条订单在不同时区的机器上落到不同的日子。
 *
 * @param {*} value
 * @returns {string|null}
 */
function readUtcDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    // 大于 1e11 的整数不可能是秒级 epoch（那已经是 5138 年），按毫秒处理。
    const millis = value > 1e11 ? value : value * 1000;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  if (/^\d+$/.test(text)) return readUtcDate(Number(text));
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

/**
 * 取第一个有值的字段。
 */
function pick(row, keys) {
  for (const key of keys) {
    const value = row ? row[key] : undefined;
    if (value === null || value === undefined || value === '') continue;
    return value;
  }
  return null;
}

/**
 * 取数值字段。
 */
function pickNumber(row, keys) {
  const value = pick(row, keys);
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * 校验一条事实的口径是否自洽。
 *
 * 这一段是整个落库层最重要的地方。检查项：
 *   1. 归因口径与来源必须是平台无关模型里已定义的值（否则下游无法解释这个数）；
 *   2. 订单级事实的 channel 只能是 unknown（TikTok Open API 根本没有这个字段）；
 *   3. **三个 GMV 口径不得同时出现** —— 出现即意味着有人用一个推另一个；
 *   4. 有增量必有基线 —— 否则读者无从判断这个增量怎么来的。
 *
 * @param {object} fact 平台无关事实
 * @throws {Error} 口径不自洽时抛出，错误信息指明哪一项
 */
function assertFactCaliber(fact) {
  if (!fact || typeof fact !== 'object') throw new Error('fact is required');
  if (!ATTRIBUTION_BASIS_VALUES.includes(fact.attributionBasis)) {
    throw new Error(`unknown attribution basis: ${fact.attributionBasis}`);
  }
  if (!CHANNEL_VALUES.includes(fact.channel)) {
    throw new Error(`unknown channel: ${fact.channel}`);
  }
  if (!SOURCE_VALUES.includes(fact.source)) {
    throw new Error(`unknown source: ${fact.source}`);
  }
  if (fact.attributionBasis === ATTRIBUTION_BASES.ORDER_LEVEL && fact.channel !== CHANNELS.UNKNOWN) {
    throw new Error(
      `order level facts must have channel=unknown, got ${fact.channel}`,
    );
  }
  const hasSettled = fact.gmvSettled !== null && fact.gmvSettled !== undefined;
  const hasOrderGmv =
    (fact.gmvOrderTotal !== null && fact.gmvOrderTotal !== undefined) ||
    (fact.gmvSubtotal !== null && fact.gmvSubtotal !== undefined);
  if (hasSettled && hasOrderGmv) {
    throw new Error(
      'refusing to mix GMV bases: settlement revenue and order GMV must not share one row',
    );
  }
  if (
    fact.incrementalGmv !== null && fact.incrementalGmv !== undefined &&
    (fact.baselineNaturalGmv === null || fact.baselineNaturalGmv === undefined)
  ) {
    throw new Error('incremental GMV without a baseline is not explainable');
  }
}

/**
 * 把订单原始对象映射成订单行。
 *
 * 口径字段全部来自平台无关映射器（src/platforms/tiktok-adapter.js），
 * 这一层不重新发明口径，只负责把标识与日期补齐。
 *
 * @param {object} options
 * @param {string} options.regionGroup
 * @param {string} options.shopId
 * @param {string} options.shopCipher
 * @param {object} options.order TikTok 订单对象
 * @returns {object} 可直接写库的行
 */
function mapOrderRow({ regionGroup, shopId, shopCipher, order }) {
  const fact = mapOrder({ order });
  assertFactCaliber(fact);

  const orderId = pick(order, ['id', 'order_id', 'orderId']);
  if (!orderId) throw new Error('TikTok order is missing its id');

  return {
    region_group: String(regionGroup),
    shop_id: String(shopId),
    shop_cipher: String(shopCipher),
    order_id: String(orderId),
    order_status: pick(order, ['order_status', 'status', 'orderStatus']),
    attribution_basis: fact.attributionBasis,
    channel: fact.channel,
    currency: fact.currency || UNKNOWN_CURRENCY,
    order_date: readUtcDate(pick(order, ['create_time', 'createTime', 'order_date', 'orderDate'])),
    units: fact.units,
    gmv_order_total: fact.gmvOrderTotal,
    gmv_subtotal: fact.gmvSubtotal,
    // 结算收入不来自订单端点。这里写死 null，而不是"顺便用订单金额算一个" ——
    // 数据库的 CHECK 约束也会挡住任何非 null 的值。
    gmv_settled: null,
    shipping_fee: fact.shipping,
    cancellations: fact.cancellations,
    raw_json: JSON.stringify(order || {}),
  };
}

/**
 * 把订单行明细映射成明细行。
 *
 * 明细是按商品查询的入口，所以单列成表而不是塞进订单行的 JSON 里。
 *
 * @param {object} options
 * @param {string} options.regionGroup
 * @param {string} options.shopId
 * @param {string} options.shopCipher
 * @param {string} options.orderId
 * @param {object} options.order TikTok 订单对象
 * @returns {Array<object>}
 */
function mapOrderItemRows({ regionGroup, shopId, shopCipher, orderId, order }) {
  const lineItems = Array.isArray(order && order.line_items) ? order.line_items : [];
  const rows = [];
  lineItems.forEach((item, index) => {
    if (!item) return;
    const lineItemId = pick(item, ['id', 'line_item_id', 'lineItemId'])
      // 没有行 ID 时用序号兜底：同一订单内序号唯一，足够定位一行。
      || `${orderId}#${index}`;
    rows.push({
      region_group: String(regionGroup),
      shop_id: String(shopId),
      shop_cipher: String(shopCipher),
      order_id: String(orderId),
      line_item_id: String(lineItemId),
      product_id: pick(item, ['product_id', 'productId']),
      sku_id: pick(item, ['sku_id', 'skuId']),
      product_name: pick(item, ['product_name', 'productName', 'title']),
      sku_name: pick(item, ['sku_name', 'skuName']),
      quantity: pickNumber(item, ['quantity']),
      unit_price: pickNumber(item, ['price', 'unit_price', 'original_price']),
      // 只存卖家自己承担的折扣（seller_discount）。
      // 平台补贴（platform_discount）留在 raw_json 里 —— 两者含义不同，混成一个数会算错毛利。
      discount_amount: pickNumber(item, ['seller_discount', 'sellerDiscount']),
      raw_json: JSON.stringify(item || {}),
    });
  });
  return rows;
}

/**
 * 把商品原始对象映射成商品行。
 *
 * 注意这是**当前状态**，不是历史快照：Product API 不返回历史属性。
 *
 * @param {object} options
 * @returns {object}
 */
function mapProductRow({ regionGroup, shopId, shopCipher, product }) {
  const productId = pick(product, ['id', 'product_id', 'productId']);
  if (!productId) throw new Error('TikTok product is missing its id');
  const category = product && product.category ? product.category : null;
  return {
    region_group: String(regionGroup),
    shop_id: String(shopId),
    shop_cipher: String(shopCipher),
    product_id: String(productId),
    product_name: pick(product, ['product_name', 'productName', 'name', 'title']),
    category_id: pick(product, ['category_id', 'categoryId']) || pick(category, ['id']),
    status: pick(product, ['status', 'product_status']),
    price: pickNumber(product, ['price', 'sale_price', 'min_price']),
    currency: pick(product, ['currency']) || UNKNOWN_CURRENCY,
    sku_count: pickNumber(product, ['sku_count', 'skuCount'])
      || (Array.isArray(product && product.skus) ? product.skus.length : null),
    raw_json: JSON.stringify(product || {}),
  };
}

/**
 * 把一条平台无关事实映射成日汇总行。
 *
 * 一条事实 = 一行。**同一天的不同口径是不同的行**，不是同一行的不同列：
 * 因为它们的含义不同，混在一行里迟早会被当成同一个数相加。
 *
 * @param {object} options
 * @param {string} options.regionGroup
 * @param {string} options.shopId
 * @param {string} options.shopCipher
 * @param {string} options.eventDate YYYY-MM-DD
 * @param {object} options.fact 平台无关事实
 * @returns {object}
 */
function mapDailyRow({ regionGroup, shopId, shopCipher, eventDate, fact }) {
  assertFactCaliber(fact);
  if (!eventDate) throw new Error('eventDate is required');
  return {
    region_group: String(regionGroup),
    shop_id: String(shopId),
    shop_cipher: String(shopCipher),
    event_date: String(eventDate).slice(0, 10),
    attribution_basis: fact.attributionBasis,
    source: fact.source,
    channel: fact.channel,
    currency: fact.currency || UNKNOWN_CURRENCY,
    orders: fact.orders,
    units: fact.units,
    spend: fact.spend,
    impressions: fact.impressions,
    clicks: fact.clicks,
    gmv_order_total: fact.gmvOrderTotal,
    gmv_subtotal: fact.gmvSubtotal,
    gmv_settled: fact.gmvSettled,
    refunds: fact.refunds,
    commission: fact.commission,
    shipping: fact.shipping,
    cancellations: fact.cancellations,
    baseline_natural_gmv: fact.baselineNaturalGmv,
    incremental_gmv: fact.incrementalGmv,
    raw_json: JSON.stringify({
      attributionBasis: fact.attributionBasis,
      source: fact.source,
      channel: fact.channel,
    }),
  };
}

/**
 * 把订单事实按天聚合成日汇总行。
 *
 * 聚合只做"同一天、同一口径、同一来源"的加总 ——
 * 订单实付与货款小计都来自订单，可以并存；
 * 结算收入来自 finance，是另一行。
 *
 * @param {object} options
 * @param {string} options.regionGroup
 * @param {string} options.shopId
 * @param {string} options.shopCipher
 * @param {Array<object>} options.rows 订单行（mapOrderRow 的输出）
 * @returns {Array<object>} 日汇总行
 */
function buildOrderDailyRows({ regionGroup, shopId, shopCipher, rows = [] }) {
  if (!regionGroup) throw new Error('regionGroup is required');
  if (!shopId) throw new Error('shopId is required');
  if (!shopCipher) throw new Error('shopCipher is required');
  const buckets = new Map();
  for (const row of rows) {
    const date = row.order_date;
    if (!date) continue;
    const currency = row.currency || UNKNOWN_CURRENCY;
    const key = `${date}::${currency}`;
    if (!buckets.has(key)) {
      buckets.set(key, {
        date,
        currency,
        orders: 0,
        units: 0,
        gmvOrderTotal: 0,
        gmvSubtotal: 0,
        shipping: 0,
        cancellations: 0,
        hasOrderTotal: false,
        hasSubtotal: false,
        hasShipping: false,
        hasCancellations: false,
      });
    }
    const bucket = buckets.get(key);
    bucket.orders += 1;
    bucket.units += Number(row.units || 0);
    if (row.gmv_order_total !== null && row.gmv_order_total !== undefined) {
      bucket.gmvOrderTotal += Number(row.gmv_order_total);
      bucket.hasOrderTotal = true;
    }
    if (row.gmv_subtotal !== null && row.gmv_subtotal !== undefined) {
      bucket.gmvSubtotal += Number(row.gmv_subtotal);
      bucket.hasSubtotal = true;
    }
    if (row.shipping_fee !== null && row.shipping_fee !== undefined) {
      bucket.shipping += Number(row.shipping_fee);
      bucket.hasShipping = true;
    }
    if (row.cancellations !== null && row.cancellations !== undefined) {
      bucket.cancellations += Number(row.cancellations);
      bucket.hasCancellations = true;
    }
  }

  return [...buckets.values()].map(bucket => ({
    region_group: String(regionGroup),
    shop_id: String(shopId),
    shop_cipher: String(shopCipher),
    event_date: bucket.date,
    attribution_basis: ATTRIBUTION_BASES.ORDER_LEVEL,
    source: SOURCES.SHOP_ORDER,
    channel: CHANNELS.UNKNOWN,
    currency: bucket.currency,
    orders: bucket.orders,
    units: bucket.units,
    spend: null,
    impressions: null,
    clicks: null,
    gmv_order_total: bucket.hasOrderTotal ? bucket.gmvOrderTotal : null,
    gmv_subtotal: bucket.hasSubtotal ? bucket.gmvSubtotal : null,
    // 订单侧没有结算收入。绝不用订单金额推一个出来。
    gmv_settled: null,
    refunds: null,
    commission: null,
    shipping: bucket.hasShipping ? bucket.shipping : null,
    cancellations: bucket.hasCancellations ? bucket.cancellations : null,
    baseline_natural_gmv: null,
    incremental_gmv: null,
    raw_json: JSON.stringify({ aggregation: 'order_daily' }),
  }));
}

/**
 * 把结算流水事实映射成日汇总行（derived_net 口径）。
 *
 * @param {object} options
 * @param {string} options.regionGroup
 * @param {string} options.shopId
 * @param {string} options.shopCipher
 * @param {Array<object>} options.rows 结算流水行
 * @returns {Array<object>}
 */
function buildStatementDailyRows({ regionGroup, shopId, shopCipher, rows = [] }) {
  if (!regionGroup) throw new Error('regionGroup is required');
  if (!shopId) throw new Error('shopId is required');
  if (!shopCipher) throw new Error('shopCipher is required');
  const buckets = new Map();
  for (const row of rows) {
    const fact = mapStatementRow({ row });
    assertFactCaliber(fact);
    const date = readUtcDate(pick(row, [
      'statement_time', 'settle_time', 'settlement_time', 'create_time', 'date',
    ]));
    if (!date) continue;
    const currency = fact.currency || UNKNOWN_CURRENCY;
    const key = `${date}::${currency}`;
    if (!buckets.has(key)) {
      buckets.set(key, {
        date,
        currency,
        gmvSettled: 0,
        refunds: 0,
        commission: 0,
        shipping: 0,
        hasSettled: false,
        hasRefunds: false,
        hasCommission: false,
        hasShipping: false,
      });
    }
    const bucket = buckets.get(key);
    if (fact.gmvSettled !== null && fact.gmvSettled !== undefined) {
      bucket.gmvSettled += Number(fact.gmvSettled);
      bucket.hasSettled = true;
    }
    if (fact.refunds !== null && fact.refunds !== undefined) {
      bucket.refunds += Number(fact.refunds);
      bucket.hasRefunds = true;
    }
    if (fact.commission !== null && fact.commission !== undefined) {
      bucket.commission += Number(fact.commission);
      bucket.hasCommission = true;
    }
    if (fact.shipping !== null && fact.shipping !== undefined) {
      bucket.shipping += Number(fact.shipping);
      bucket.hasShipping = true;
    }
  }

  return [...buckets.values()].map(bucket => ({
    region_group: String(regionGroup),
    shop_id: String(shopId),
    shop_cipher: String(shopCipher),
    event_date: bucket.date,
    attribution_basis: ATTRIBUTION_BASES.DERIVED_NET,
    source: SOURCES.FINANCE_STATEMENT,
    channel: CHANNELS.UNKNOWN,
    currency: bucket.currency,
    orders: null,
    units: null,
    spend: null,
    impressions: null,
    clicks: null,
    // 结算口径的行里**不允许**出现订单口径的 GMV：三者互不推导。
    gmv_order_total: null,
    gmv_subtotal: null,
    gmv_settled: bucket.hasSettled ? bucket.gmvSettled : null,
    refunds: bucket.hasRefunds ? bucket.refunds : null,
    commission: bucket.hasCommission ? bucket.commission : null,
    shipping: bucket.hasShipping ? bucket.shipping : null,
    cancellations: null,
    baseline_natural_gmv: null,
    incremental_gmv: null,
    raw_json: JSON.stringify({ aggregation: 'statement_daily' }),
  }));
}

/**
 * 构造一条 UPSERT 语句。
 *
 * 用多值 INSERT 而不是逐行 INSERT：订单一页 100 条，
 * 逐条往返会让一次同步产生几百次网络往返。
 *
 * @param {object} options
 * @param {string} options.table
 * @param {Array<string>} options.columns
 * @param {Array<string>} options.conflictColumns
 * @param {Array<string>} options.updateColumns
 * @param {Array<object>} options.rows
 * @param {Object<string,string>} [options.casts] 需要显式类型转换的列
 * @param {Object<string,string>} [options.literals] 直接写进 SQL 的列表达式，例如 synced_at → now()
 * @returns {{sql: string, params: Array<*>}|null}
 */
function buildUpsert({
  table,
  columns,
  conflictColumns,
  updateColumns,
  rows,
  casts = {},
  literals = {},
}) {
  if (!rows || !rows.length) return null;
  const tuples = [];
  const params = [];
  rows.forEach((row, rowIndex) => {
    const placeholders = columns.map((column, columnIndex) => {
      if (literals[column]) return literals[column];
      params.push(row[column] === undefined ? null : row[column]);
      const position = params.length;
      return `$${position}${casts[column] || ''}`;
    });
    tuples.push(`(${placeholders.join(', ')})`);
  });
  const updates = updateColumns
    .map(column => `${column}=EXCLUDED.${column}`)
    .join(', ');
  const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${tuples.join(', ')}
    ON CONFLICT (${conflictColumns.join(', ')}) DO UPDATE SET ${updates}`;
  return { sql, params };
}

/**
 * TikTok 业务数据仓储。
 */
class TikTokDataRepository {
  constructor({ pool }) {
    if (!pool || typeof pool.query !== 'function') {
      throw new Error('pg pool/query adapter is required');
    }
    this.pool = pool;
  }

  /**
   * 写入订单与订单行明细。
   *
   * 幂等：按 (region_group, shop_id, order_id) 覆盖写。
   * 重复同步同一页不会产生重复行 —— 这是"先写数据、再推进游标"能安全成立的前提。
   *
   * @param {object} options
   * @param {string} options.regionGroup
   * @param {string} options.shopId
   * @param {string} options.shopCipher
   * @param {Array<object>} options.orders TikTok 订单对象
   * @returns {Promise<{orders: number, items: number}>}
   */
  async upsertOrders({ regionGroup, shopId, shopCipher, orders = [] }) {
    if (!regionGroup) throw new Error('regionGroup is required');
    if (!shopId) throw new Error('shopId is required');
    if (!shopCipher) throw new Error('shopCipher is required: cipher and shop id are a pair');

    const orderRows = [];
    const itemRows = [];
    for (const order of orders) {
      if (!order) continue;
      const row = mapOrderRow({ regionGroup, shopId, shopCipher, order });
      orderRows.push(row);
      itemRows.push(...mapOrderItemRows({
        regionGroup, shopId, shopCipher, orderId: row.order_id, order,
      }));
    }

    const orderUpsert = buildUpsert({
      table: 'tiktok_orders',
      columns: [
        'region_group', 'shop_id', 'shop_cipher', 'order_id', 'order_status',
        'attribution_basis', 'channel', 'currency', 'order_date', 'units',
        'gmv_order_total', 'gmv_subtotal', 'gmv_settled', 'shipping_fee',
        'cancellations', 'raw_json', 'synced_at',
      ],
      conflictColumns: ['region_group', 'shop_id', 'order_id'],
      updateColumns: [
        'order_status', 'attribution_basis', 'channel', 'currency', 'order_date',
        'units', 'gmv_order_total', 'gmv_subtotal', 'gmv_settled', 'shipping_fee',
        'cancellations', 'raw_json', 'synced_at',
      ],
      rows: orderRows,
      casts: { raw_json: '::jsonb' },
      literals: { synced_at: 'now()' },
    });
    if (orderUpsert) await this.pool.query(orderUpsert.sql, orderUpsert.params);

    const itemUpsert = buildUpsert({
      table: 'tiktok_order_items',
      columns: [
        'region_group', 'shop_id', 'shop_cipher', 'order_id', 'line_item_id',
        'product_id', 'sku_id', 'product_name', 'sku_name', 'quantity',
        'unit_price', 'discount_amount', 'raw_json', 'synced_at',
      ],
      conflictColumns: ['region_group', 'shop_id', 'order_id', 'line_item_id'],
      updateColumns: [
        'shop_cipher', 'product_id', 'sku_id', 'product_name', 'sku_name',
        'quantity', 'unit_price', 'discount_amount', 'raw_json', 'synced_at',
      ],
      rows: itemRows,
      casts: { raw_json: '::jsonb' },
      literals: { synced_at: 'now()' },
    });
    if (itemUpsert) await this.pool.query(itemUpsert.sql, itemUpsert.params);

    return { orders: orderRows.length, items: itemRows.length };
  }

  /**
   * 写入商品当前状态。
   *
   * @param {object} options
   * @returns {Promise<number>} 写入行数
   */
  async upsertProducts({ regionGroup, shopId, shopCipher, products = [] }) {
    if (!regionGroup) throw new Error('regionGroup is required');
    if (!shopId) throw new Error('shopId is required');
    if (!shopCipher) throw new Error('shopCipher is required: cipher and shop id are a pair');

    const rows = [];
    for (const product of products) {
      if (!product) continue;
      rows.push(mapProductRow({ regionGroup, shopId, shopCipher, product }));
    }

    const upsert = buildUpsert({
      table: 'tiktok_products',
      columns: [
        'region_group', 'shop_id', 'shop_cipher', 'product_id', 'product_name',
        'category_id', 'status', 'price', 'currency', 'sku_count', 'raw_json', 'synced_at',
      ],
      conflictColumns: ['region_group', 'shop_id', 'product_id'],
      updateColumns: [
        'shop_cipher', 'product_name', 'category_id', 'status', 'price',
        'currency', 'sku_count', 'raw_json', 'synced_at',
      ],
      rows,
      casts: { raw_json: '::jsonb' },
      literals: { synced_at: 'now()' },
    });
    if (!upsert) return 0;
    await this.pool.query(upsert.sql, upsert.params);
    return rows.length;
  }

  /**
   * 从订单表重新聚合成日汇总行。
   *
   * 为什么是"重新聚合"而不是"累加"
   * ----------------------------
   * 同步是分页的，一页一页落库。如果日汇总靠累加，那么：
   *   * 中途失败重跑 → 同一笔订单被算两次；
   *   * 断点续传 → 前面几页的数没被算进去。
   * 重新聚合让日汇总**永远等于订单表的当前内容**，两种情况都不会错。
   *
   * 代价是每次落完一页都要重算一次该窗口的聚合。订单量不大时这笔开销可以接受，
   * 换来的是"日汇总与订单表永远一致"这个不变式 —— 这比省几次聚合重要得多。
   *
   * @param {object} options
   * @param {string} options.regionGroup
   * @param {string} options.shopId
   * @param {string} options.shopCipher
   * @param {string} options.startDate
   * @param {string} options.endDate
   * @returns {Promise<number>} 写入行数
   */
  async rebuildOrderDaily({ regionGroup, shopId, shopCipher, startDate, endDate }) {
    if (!regionGroup) throw new Error('regionGroup is required');
    if (!shopId) throw new Error('shopId is required');
    if (!shopCipher) throw new Error('shopCipher is required');

    const result = await this.pool.query(
      `SELECT order_date, currency, COUNT(*) AS orders,
              SUM(units) AS units,
              SUM(gmv_order_total) AS gmv_order_total,
              SUM(gmv_subtotal) AS gmv_subtotal,
              SUM(shipping_fee) AS shipping,
              SUM(cancellations) AS cancellations
       FROM tiktok_orders
       WHERE region_group=$1 AND shop_id=$2 AND order_date BETWEEN $3 AND $4
       GROUP BY order_date, currency`,
      [String(regionGroup), String(shopId), String(startDate), String(endDate)],
    );

    const rows = result.rows.map(row => ({
      region_group: String(regionGroup),
      shop_id: String(shopId),
      shop_cipher: String(shopCipher),
      event_date: row.order_date instanceof Date
        ? row.order_date.toISOString().slice(0, 10)
        : String(row.order_date).slice(0, 10),
      attribution_basis: ATTRIBUTION_BASES.ORDER_LEVEL,
      source: SOURCES.SHOP_ORDER,
      channel: CHANNELS.UNKNOWN,
      currency: row.currency || UNKNOWN_CURRENCY,
      orders: Number(row.orders || 0),
      units: row.units === null ? null : Number(row.units),
      spend: null,
      impressions: null,
      clicks: null,
      gmv_order_total: row.gmv_order_total === null ? null : Number(row.gmv_order_total),
      gmv_subtotal: row.gmv_subtotal === null ? null : Number(row.gmv_subtotal),
      // 订单侧没有结算收入。日汇总的订单口径行里也永远没有。
      gmv_settled: null,
      refunds: null,
      commission: null,
      shipping: row.shipping === null ? null : Number(row.shipping),
      cancellations: row.cancellations === null ? null : Number(row.cancellations),
      baseline_natural_gmv: null,
      incremental_gmv: null,
      raw_json: JSON.stringify({ aggregation: 'order_daily' }),
    }));
    return this.upsertShopDaily({ rows });
  }

  /**
   * 写入日汇总行。
   *
   * @param {object} options
   * @param {Array<object>} options.rows 日汇总行
   * @returns {Promise<number>} 写入行数
   */
  async upsertShopDaily({ rows = [] }) {
    if (!rows.length) return 0;
    for (const row of rows) {
      if (!row.region_group) throw new Error('region_group is required');
      if (!row.shop_id) throw new Error('shop_id is required');
      if (!row.shop_cipher) throw new Error('shop_cipher is required');
      if (!row.event_date) throw new Error('event_date is required');
      assertFactCaliber({
        attributionBasis: row.attribution_basis,
        channel: row.channel,
        source: row.source,
        gmvOrderTotal: row.gmv_order_total,
        gmvSubtotal: row.gmv_subtotal,
        gmvSettled: row.gmv_settled,
        baselineNaturalGmv: row.baseline_natural_gmv,
        incrementalGmv: row.incremental_gmv,
      });
    }

    const upsert = buildUpsert({
      table: 'tiktok_shop_daily',
      columns: [
        'region_group', 'shop_id', 'shop_cipher', 'event_date',
        'attribution_basis', 'source', 'channel', 'currency', 'orders', 'units',
        'spend', 'impressions', 'clicks', 'gmv_order_total', 'gmv_subtotal',
        'gmv_settled', 'refunds', 'commission', 'shipping', 'cancellations',
        'baseline_natural_gmv', 'incremental_gmv', 'raw_json', 'synced_at',
      ],
      conflictColumns: [
        'region_group', 'shop_id', 'event_date', 'attribution_basis', 'source', 'currency',
      ],
      updateColumns: [
        'shop_cipher', 'channel', 'orders', 'units', 'spend', 'impressions',
        'clicks', 'gmv_order_total', 'gmv_subtotal', 'gmv_settled',
        'refunds', 'commission', 'shipping', 'cancellations',
        'baseline_natural_gmv', 'incremental_gmv', 'raw_json', 'synced_at',
      ],
      rows,
      casts: { raw_json: '::jsonb' },
      literals: { synced_at: 'now()' },
    });
    await this.pool.query(upsert.sql, upsert.params);
    return rows.length;
  }
}

/**
 * 同步游标仓储。
 *
 * TikTok 用 page_token 游标分页，不是时间戳增量。
 * 所以这里存的是"下一次该用哪个 page_token"，以及它属于哪个时间窗。
 * 换了时间窗就必须换游标 —— 旧游标指向别的窗口，继续用它会拉到错的数据。
 */
class TikTokSyncStateRepository {
  constructor({ pool }) {
    if (!pool || typeof pool.query !== 'function') {
      throw new Error('pg pool/query adapter is required');
    }
    this.pool = pool;
  }

  /**
   * 读取游标。
   *
   * @param {object} options
   * @param {string} options.regionGroup
   * @param {string} options.endpointKey
   * @param {string} options.shopId
   * @returns {Promise<object|null>} { cursor, lastSuccessAt, lastError }
   */
  async getSyncState({ regionGroup, endpointKey, shopId }) {
    if (!regionGroup) throw new Error('regionGroup is required');
    if (!endpointKey) throw new Error('endpointKey is required');
    if (!shopId) throw new Error('shopId is required');
    const result = await this.pool.query(
      `SELECT cursor_json,last_success_at,last_error
       FROM tiktok_sync_state
       WHERE region_group=$1 AND endpoint_key=$2 AND shop_id=$3`,
      [String(regionGroup), String(endpointKey), String(shopId)],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      cursor: row.cursor_json || {},
      lastSuccessAt: row.last_success_at,
      lastError: row.last_error,
    };
  }

  /**
   * 记录成功并推进游标。
   *
   * @param {object} options
   */
  async markSyncSuccess({ regionGroup, endpointKey, shopId, cursor = {} }) {
    if (!regionGroup) throw new Error('regionGroup is required');
    if (!endpointKey) throw new Error('endpointKey is required');
    if (!shopId) throw new Error('shopId is required');
    await this.pool.query(
      `INSERT INTO tiktok_sync_state (region_group, endpoint_key, shop_id, cursor_json, last_success_at, last_error)
       VALUES ($1,$2,$3,$4::jsonb,now(),NULL)
       ON CONFLICT (region_group, endpoint_key, shop_id) DO UPDATE SET
         cursor_json=EXCLUDED.cursor_json,
         last_success_at=now(),
         last_error=NULL,
         updated_at=now()`,
      [String(regionGroup), String(endpointKey), String(shopId), JSON.stringify(cursor || {})],
    );
  }

  /**
   * 记录失败。**不覆盖游标** —— 失败时保留已推进到的位置，下次从那里继续。
   *
   * @param {object} options
   */
  async markSyncFailure({ regionGroup, endpointKey, shopId, error }) {
    if (!regionGroup) throw new Error('regionGroup is required');
    if (!endpointKey) throw new Error('endpointKey is required');
    if (!shopId) throw new Error('shopId is required');
    await this.pool.query(
      `INSERT INTO tiktok_sync_state (region_group, endpoint_key, shop_id, cursor_json, last_error)
       VALUES ($1,$2,$3,'{}'::jsonb,$4)
       ON CONFLICT (region_group, endpoint_key, shop_id) DO UPDATE SET
         last_error=EXCLUDED.last_error,
         updated_at=now()`,
      [
        String(regionGroup), String(endpointKey), String(shopId),
        String(error && error.message ? error.message : error).slice(0, 2000),
      ],
    );
  }
}

module.exports = {
  TikTokDataRepository,
  TikTokSyncStateRepository,
  UNKNOWN_CURRENCY,
  assertFactCaliber,
  buildOrderDailyRows,
  buildStatementDailyRows,
  buildUpsert,
  mapDailyRow,
  mapOrderItemRows,
  mapOrderRow,
  mapProductRow,
  pick,
  pickNumber,
  readUtcDate,
};
