'use strict';

const { normalizePerformance } = require('./metrics');

class ShopeeQueryRepository {
  constructor({ pool }) {
    if (!pool || typeof pool.query !== 'function') throw new Error('pg pool/query adapter is required');
    this.pool = pool;
  }

  async listShops({ activeOnly = true } = {}) {
    const result = await this.pool.query(
      `SELECT
         p.shop_id,p.display_name,p.country_code,p.country_name,p.brand_code,p.brand_name,
         p.currency,p.timezone,p.brand_portal_timezone,p.marketplace_region,
         to_char(p.analytics_start_date,'YYYY-MM-DD') AS analytics_start_date,
         p.active,p.sort_order,p.note,p.updated_at,
         s.shop_name AS api_shop_name,s.region AS api_region,s.status AS api_status,s.synced_at AS api_synced_at
       FROM shopee_shop_profiles p
       LEFT JOIN shopee_shops s ON s.shop_id=p.shop_id
       WHERE ($1::boolean=false OR p.active=true)
       ORDER BY p.country_code,p.brand_code,p.sort_order,p.display_name,p.shop_id`,
      [activeOnly],
    );
    return result.rows.map(row => ({
      shopId: Number(row.shop_id),
      displayName: row.display_name,
      countryCode: row.country_code,
      countryName: row.country_name,
      brandCode: row.brand_code,
      brandName: row.brand_name,
      currency: row.currency,
      timezone: row.timezone,
      brandPortalTimezone: row.brand_portal_timezone,
      marketplaceRegion: row.marketplace_region,
      analyticsStartDate: row.analytics_start_date ? String(row.analytics_start_date).slice(0, 10) : null,
      active: row.active,
      sortOrder: Number(row.sort_order || 0),
      note: row.note,
      updatedAt: row.updated_at,
      apiShopName: row.api_shop_name,
      apiRegion: row.api_region,
      apiStatus: row.api_status,
      apiSyncedAt: row.api_synced_at,
    }));
  }


  async loadCampaignOperations({ shopId, campaignId, startDate, endDate }) {
    const result = await this.pool.query(
      `SELECT operation_type,reason,before_json,after_json,effective_from,effective_to,item_id
       FROM shopee_operation_history
       WHERE shop_id=$1 AND campaign_id=$2
         AND effective_from >= $3::date
         AND effective_from < ($4::date + interval '1 day')
       ORDER BY effective_from ASC`,
      [shopId, campaignId, startDate, endDate],
    );
    return result.rows.map(row => ({
      operationType: row.operation_type,
      reason: row.reason,
      before: row.before_json,
      after: row.after_json,
      effectiveFrom: row.effective_from,
      effectiveTo: row.effective_to,
      itemId: row.item_id == null ? null : Number(row.item_id),
    }));
  }

  async getPortfolioOverview({
    startDate,
    endDate,
    countryCode = null,
    brandCode = null,
    shopIds = [],
  }) {
    const ids = (shopIds || []).map(Number).filter(Number.isSafeInteger);
    const result = await this.pool.query(
      `WITH selected AS (
         SELECT *
         FROM shopee_shop_profiles p
         WHERE p.active=true
           AND ($3::text IS NULL OR p.country_code=$3)
           AND ($4::text IS NULL OR p.brand_code=$4)
           AND (cardinality($5::bigint[])=0 OR p.shop_id=ANY($5::bigint[]))
       ),
       bi AS (
         SELECT
           b.shop_id,
           COALESCE(SUM(b.sales),0) AS sales,
           COALESCE(SUM(b.orders),0) AS orders,
           COALESCE(SUM(b.units_sold),0) AS units_sold,
           COALESCE(SUM(b.product_clicks),0) AS product_clicks,
           COALESCE(SUM(b.product_views),0) AS product_views,
           COALESCE(SUM(b.unique_visitors),0) AS visitor_days,
           AVG(b.item_conversion_rate) AS avg_item_conversion_rate,
           AVG(b.order_conversion_rate) AS avg_order_conversion_rate,
           COALESCE(SUM(b.voucher_sales),0) AS voucher_sales,
           COALESCE(SUM(b.voucher_buyers),0) AS voucher_buyers,
           COALESCE(SUM(b.voucher_cost),0) AS voucher_cost
         FROM shopee_shop_bi_daily b
         JOIN selected s ON s.shop_id=b.shop_id
         WHERE b.event_date BETWEEN $1 AND $2
         GROUP BY b.shop_id
       ),
       ads AS (
         SELECT
           d.shop_id,
           COALESCE(SUM(d.impressions),0) AS ad_impressions,
           COALESCE(SUM(d.clicks),0) AS ad_clicks,
           COALESCE(SUM(d.expense),0) AS ad_expense,
           COALESCE(SUM(d.broad_gmv),0) AS broad_gmv,
           COALESCE(SUM(d.broad_orders),0) AS broad_orders,
           COALESCE(SUM(d.direct_gmv),0) AS direct_gmv,
           COALESCE(SUM(d.direct_orders),0) AS direct_orders
         FROM shopee_ad_campaign_daily d
         JOIN selected s ON s.shop_id=d.shop_id
         WHERE d.event_date BETWEEN $1 AND $2
         GROUP BY d.shop_id
       ),
       returns AS (
         SELECT
           r.shop_id,
           COUNT(*)::bigint AS return_count,
           COALESCE(SUM(r.refund_amount),0) AS refund_amount
         FROM shopee_returns r
         JOIN selected s ON s.shop_id=r.shop_id
         WHERE (to_timestamp(r.create_time) AT TIME ZONE s.timezone)::date BETWEEN $1 AND $2
         GROUP BY r.shop_id
       )
       SELECT
         s.shop_id,s.display_name,s.country_code,s.country_name,s.brand_code,s.brand_name,
         s.currency,s.timezone,s.marketplace_region,
         COALESCE(cfg.ad_spend_ratio_limit,0.15) AS ad_spend_ratio_limit,
         COALESCE(bi.sales,0) AS sales,
         COALESCE(bi.orders,0) AS orders,
         COALESCE(bi.units_sold,0) AS units_sold,
         COALESCE(bi.product_clicks,0) AS product_clicks,
         COALESCE(bi.product_views,0) AS product_views,
         COALESCE(bi.visitor_days,0) AS visitor_days,
         bi.avg_item_conversion_rate,
         bi.avg_order_conversion_rate,
         COALESCE(bi.voucher_sales,0) AS voucher_sales,
         COALESCE(bi.voucher_buyers,0) AS voucher_buyers,
         COALESCE(bi.voucher_cost,0) AS voucher_cost,
         COALESCE(ads.ad_impressions,0) AS ad_impressions,
         COALESCE(ads.ad_clicks,0) AS ad_clicks,
         COALESCE(ads.ad_expense,0) AS ad_expense,
         COALESCE(ads.broad_gmv,0) AS broad_gmv,
         COALESCE(ads.broad_orders,0) AS broad_orders,
         COALESCE(ads.direct_gmv,0) AS direct_gmv,
         COALESCE(ads.direct_orders,0) AS direct_orders,
         COALESCE(returns.return_count,0) AS return_count,
         COALESCE(returns.refund_amount,0) AS refund_amount
       FROM selected s
       LEFT JOIN shopee_shop_strategy_config cfg ON cfg.shop_id=s.shop_id
       LEFT JOIN bi ON bi.shop_id=s.shop_id
       LEFT JOIN ads ON ads.shop_id=s.shop_id
       LEFT JOIN returns ON returns.shop_id=s.shop_id
       ORDER BY s.country_code,s.brand_code,s.sort_order,s.display_name,s.shop_id`,
      [
        startDate,
        endDate,
        countryCode || null,
        brandCode || null,
        ids,
      ],
    );

    const shops = result.rows.map(row => {
      const adExpense = Number(row.ad_expense || 0);
      const broadGmv = Number(row.broad_gmv || 0);
      const sales = Number(row.sales || 0);
      const productClicks = Number(row.product_clicks || 0);
      const orders = Number(row.orders || 0);
      return {
        shopId: Number(row.shop_id),
        displayName: row.display_name,
        countryCode: row.country_code,
        countryName: row.country_name,
        brandCode: row.brand_code,
        brandName: row.brand_name,
        currency: row.currency,
        timezone: row.timezone,
        marketplaceRegion: row.marketplace_region,
        adSpendRatioLimit: Number(row.ad_spend_ratio_limit || 0.15),
        sales,
        orders,
        unitsSold: Number(row.units_sold || 0),
        productClicks,
        productViews: Number(row.product_views || 0),
        visitorDays: Number(row.visitor_days || 0),
        avgItemConversionRate: row.avg_item_conversion_rate === null ? null : Number(row.avg_item_conversion_rate),
        avgOrderConversionRate: row.avg_order_conversion_rate === null ? null : Number(row.avg_order_conversion_rate),
        voucherSales: Number(row.voucher_sales || 0),
        voucherBuyers: Number(row.voucher_buyers || 0),
        voucherCost: Number(row.voucher_cost || 0),
        adImpressions: Number(row.ad_impressions || 0),
        adClicks: Number(row.ad_clicks || 0),
        adExpense,
        broadGmv,
        broadOrders: Number(row.broad_orders || 0),
        directGmv: Number(row.direct_gmv || 0),
        directOrders: Number(row.direct_orders || 0),
        returnCount: Number(row.return_count || 0),
        refundAmount: Number(row.refund_amount || 0),
        adSpendRatioToBiSales: sales > 0 ? adExpense / sales : null,
        adGmvShareOfBiSales: sales > 0 ? broadGmv / sales : null,
        estimatedNaturalSales: sales - broadGmv,
        adAttributionExceedsBiSales: broadGmv > sales,
        broadRoas: adExpense > 0 ? broadGmv / adExpense : 0,
        adCtr: Number(row.ad_impressions || 0) > 0
          ? Number(row.ad_clicks || 0) / Number(row.ad_impressions || 0)
          : 0,
        orderPerProductClick: productClicks > 0 ? orders / productClicks : null,
      };
    });

    const byCurrency = new Map();
    for (const shop of shops) {
      if (!byCurrency.has(shop.currency)) {
        byCurrency.set(shop.currency, {
          currency: shop.currency,
          shopCount: 0,
          sales: 0,
          adExpense: 0,
          broadGmv: 0,
          voucherSales: 0,
          voucherCost: 0,
          refundAmount: 0,
          estimatedNaturalSales: 0,
          adSpendRatioLimitMin: null,
          adSpendRatioLimitMax: null,
          orders: 0,
          broadOrders: 0,
          directOrders: 0,
        });
      }
      const group = byCurrency.get(shop.currency);
      group.shopCount += 1;
      group.sales += shop.sales;
      group.adExpense += shop.adExpense;
      group.broadGmv += shop.broadGmv;
      group.voucherSales += shop.voucherSales;
      group.voucherCost += shop.voucherCost;
      group.refundAmount += shop.refundAmount;
      group.estimatedNaturalSales += shop.estimatedNaturalSales;
      group.adSpendRatioLimitMin = group.adSpendRatioLimitMin === null
        ? shop.adSpendRatioLimit
        : Math.min(group.adSpendRatioLimitMin, shop.adSpendRatioLimit);
      group.adSpendRatioLimitMax = group.adSpendRatioLimitMax === null
        ? shop.adSpendRatioLimit
        : Math.max(group.adSpendRatioLimitMax, shop.adSpendRatioLimit);
      group.orders += shop.orders;
      group.broadOrders += shop.broadOrders;
      group.directOrders += shop.directOrders;
    }

    const currencyGroups = Array.from(byCurrency.values()).map(group => ({
      ...group,
      broadRoas: group.adExpense > 0 ? group.broadGmv / group.adExpense : 0,
      adSpendRatioToBiSales: group.sales > 0 ? group.adExpense / group.sales : null,
      adGmvShareOfBiSales: group.sales > 0 ? group.broadGmv / group.sales : null,
    }));

    const byBusinessGroup = new Map();
    for (const shop of shops) {
      const key = [shop.countryCode, shop.brandCode, shop.currency].join('|');
      if (!byBusinessGroup.has(key)) {
        byBusinessGroup.set(key, {
          countryCode: shop.countryCode,
          countryName: shop.countryName,
          brandCode: shop.brandCode,
          brandName: shop.brandName,
          currency: shop.currency,
          shopCount: 0,
          sales: 0,
          orders: 0,
          unitsSold: 0,
          productClicks: 0,
          productViews: 0,
          adExpense: 0,
          broadGmv: 0,
          directGmv: 0,
          broadOrders: 0,
          directOrders: 0,
          refundAmount: 0,
          returnCount: 0,
          estimatedNaturalSales: 0,
        });
      }
      const group = byBusinessGroup.get(key);
      group.shopCount += 1;
      group.sales += shop.sales;
      group.orders += shop.orders;
      group.unitsSold += shop.unitsSold;
      group.productClicks += shop.productClicks;
      group.productViews += shop.productViews;
      group.adExpense += shop.adExpense;
      group.broadGmv += shop.broadGmv;
      group.directGmv += shop.directGmv;
      group.broadOrders += shop.broadOrders;
      group.directOrders += shop.directOrders;
      group.refundAmount += shop.refundAmount;
      group.returnCount += shop.returnCount;
      group.estimatedNaturalSales += shop.estimatedNaturalSales;
    }
    const businessGroups = Array.from(byBusinessGroup.values())
      .map(group => {
        const {
          adSpendRatioLimitMin,
          adSpendRatioLimitMax,
          ...base
        } = group;
        const sameLimit = adSpendRatioLimitMin !== null &&
          adSpendRatioLimitMax !== null &&
          Math.abs(adSpendRatioLimitMin - adSpendRatioLimitMax) < 1e-12;
        return {
          ...base,
          adSpendRatioLimit: sameLimit ? adSpendRatioLimitMin : null,
          mixedAdSpendRatioLimits: !sameLimit,
          adSpendRatioToBiSales: group.sales > 0 ? group.adExpense / group.sales : null,
          adGmvShareOfBiSales: group.sales > 0 ? group.broadGmv / group.sales : null,
          broadRoas: group.adExpense > 0 ? group.broadGmv / group.adExpense : 0,
        };
      })
      .sort((a, b) =>
        a.countryCode.localeCompare(b.countryCode) ||
        a.brandCode.localeCompare(b.brandCode) ||
        a.currency.localeCompare(b.currency)
      );

    const countries = Array.from(new Set(shops.map(shop => shop.countryCode))).sort();
    const brands = Array.from(new Set(shops.map(shop => shop.brandCode))).sort();
    const currencies = Array.from(new Set(shops.map(shop => shop.currency))).sort();

    return {
      shops,
      businessGroups,
      currencyGroups,
      dimensions: {
        countries,
        brands,
        currencies,
        multiCurrency: currencies.length > 1,
      },
      totals: {
        shopCount: shops.length,
        orders: shops.reduce((sum, shop) => sum + shop.orders, 0),
        unitsSold: shops.reduce((sum, shop) => sum + shop.unitsSold, 0),
        broadOrders: shops.reduce((sum, shop) => sum + shop.broadOrders, 0),
        directOrders: shops.reduce((sum, shop) => sum + shop.directOrders, 0),
        returnCount: shops.reduce((sum, shop) => sum + shop.returnCount, 0),
      },
    };
  }

  async getShopDailyTrend({ shopId, startDate, endDate }) {
    const result = await this.pool.query(
      `WITH dates AS (
         SELECT generate_series($2::date,$3::date,interval '1 day')::date AS event_date
       ),
       ads AS (
         SELECT event_date,
                COALESCE(SUM(impressions),0) AS impressions,
                COALESCE(SUM(clicks),0) AS clicks,
                COALESCE(SUM(expense),0) AS expense,
                COALESCE(SUM(broad_gmv),0) AS broad_gmv,
                COALESCE(SUM(broad_orders),0) AS broad_orders,
                COALESCE(SUM(direct_gmv),0) AS direct_gmv,
                COALESCE(SUM(direct_orders),0) AS direct_orders
         FROM shopee_ad_campaign_daily
         WHERE shop_id=$1 AND event_date BETWEEN $2 AND $3
         GROUP BY event_date
       )
       SELECT
         d.event_date,
         bi.sales,bi.orders,bi.units_sold,bi.product_clicks,bi.product_views,bi.unique_visitors,
         bi.item_conversion_rate,bi.order_conversion_rate,bi.voucher_sales,bi.voucher_cost,
         COALESCE(a.impressions,0) AS ad_impressions,
         COALESCE(a.clicks,0) AS ad_clicks,
         COALESCE(a.expense,0) AS ad_expense,
         COALESCE(a.broad_gmv,0) AS broad_gmv,
         COALESCE(a.broad_orders,0) AS broad_orders,
         COALESCE(a.direct_gmv,0) AS direct_gmv,
         COALESCE(a.direct_orders,0) AS direct_orders
       FROM dates d
       LEFT JOIN shopee_shop_bi_daily bi
         ON bi.shop_id=$1 AND bi.event_date=d.event_date
       LEFT JOIN ads a ON a.event_date=d.event_date
       ORDER BY d.event_date`,
      [shopId, startDate, endDate],
    );

    return result.rows.map(row => {
      const sales = row.sales === null ? null : Number(row.sales);
      const orders = row.orders === null ? null : Number(row.orders);
      const productClicks = row.product_clicks === null ? null : Number(row.product_clicks);
      const adExpense = Number(row.ad_expense || 0);
      const broadGmv = Number(row.broad_gmv || 0);
      const directGmv = Number(row.direct_gmv || 0);
      return {
        eventDate: String(row.event_date).slice(0, 10),
        sales,
        orders,
        unitsSold: row.units_sold === null ? null : Number(row.units_sold),
        productClicks,
        productViews: row.product_views === null ? null : Number(row.product_views),
        uniqueVisitors: row.unique_visitors === null ? null : Number(row.unique_visitors),
        itemConversionRate: row.item_conversion_rate === null ? null : Number(row.item_conversion_rate),
        orderConversionRate: row.order_conversion_rate === null ? null : Number(row.order_conversion_rate),
        voucherSales: row.voucher_sales === null ? null : Number(row.voucher_sales),
        voucherCost: row.voucher_cost === null ? null : Number(row.voucher_cost),
        adImpressions: Number(row.ad_impressions || 0),
        adClicks: Number(row.ad_clicks || 0),
        adExpense,
        broadGmv,
        broadOrders: Number(row.broad_orders || 0),
        directGmv: Number(row.direct_gmv || 0),
        directOrders: Number(row.direct_orders || 0),
        broadRoas: adExpense > 0 ? broadGmv / adExpense : 0,
        adSpendRatioToSales: sales && sales > 0 ? adExpense / sales : null,
        estimatedNaturalSales: sales === null ? null : sales - broadGmv,
        adAttributionExceedsBiSales: sales !== null && broadGmv > sales,
        clickToOrder: productClicks && productClicks > 0 && orders !== null ? orders / productClicks : null,
        aov: orders && orders > 0 && sales !== null ? sales / orders : null,
      };
    });
  }

  async getShopSkuOverview({ shopId, startDate, endDate, limit = 100 }) {
    const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
    const result = await this.pool.query(
      `WITH ads AS (
         SELECT item_id,
                COALESCE(SUM(impressions),0) AS ad_impressions,
                COALESCE(SUM(clicks),0) AS ad_clicks,
                COALESCE(SUM(expense),0) AS ad_expense,
                COALESCE(SUM(broad_gmv),0) AS broad_gmv,
                COALESCE(SUM(broad_orders),0) AS broad_orders,
                COALESCE(SUM(direct_gmv),0) AS direct_gmv,
                COALESCE(SUM(direct_orders),0) AS direct_orders
         FROM shopee_ad_item_daily
         WHERE shop_id=$1 AND event_date BETWEEN $2 AND $3
         GROUP BY item_id
       ),
       pc AS (
         SELECT *
         FROM shopee_product_card_period
         WHERE shop_id=$1 AND start_date=$2 AND end_date=$3
       ),
       ids AS (
         SELECT item_id FROM ads
         UNION
         SELECT item_id FROM pc
       )
       SELECT
         ids.item_id,
         COALESCE(pc.item_name,p.item_name) AS item_name,
         COALESCE(pc.item_sku,p.item_sku) AS item_sku,
         pc.parent_sku,
         pc.impressions AS total_impressions,
         pc.clicks AS total_clicks,
         pc.ctr AS total_ctr,
         pc.visitors,
         pc.page_views,
         pc.add_to_cart_visitors,
         pc.add_to_cart_units,
         pc.add_to_cart_rate,
         pc.orders AS total_orders,
         pc.buyers,
         pc.units AS total_units,
         pc.sales AS total_sales,
         pc.conversion_rate AS total_conversion_rate,
         COALESCE(a.ad_impressions,0) AS ad_impressions,
         COALESCE(a.ad_clicks,0) AS ad_clicks,
         COALESCE(a.ad_expense,0) AS ad_expense,
         COALESCE(a.broad_gmv,0) AS broad_gmv,
         COALESCE(a.broad_orders,0) AS broad_orders,
         COALESCE(a.direct_gmv,0) AS direct_gmv,
         COALESCE(a.direct_orders,0) AS direct_orders,
         strategy.break_even_roas
       FROM ids
       LEFT JOIN pc ON pc.item_id=ids.item_id
       LEFT JOIN ads a ON a.item_id=ids.item_id
       LEFT JOIN shopee_products p ON p.shop_id=$1 AND p.item_id=ids.item_id
       LEFT JOIN shopee_item_strategy_config strategy
         ON strategy.shop_id=$1 AND strategy.item_id=ids.item_id
       ORDER BY COALESCE(pc.sales,a.broad_gmv,0) DESC, ids.item_id
       LIMIT $4`,
      [shopId, startDate, endDate, safeLimit],
    );

    return result.rows.map(row => {
      const totalSales = row.total_sales === null ? null : Number(row.total_sales);
      const adExpense = Number(row.ad_expense || 0);
      const broadGmv = Number(row.broad_gmv || 0);
      const directGmv = Number(row.direct_gmv || 0);
      return {
        itemId: Number(row.item_id),
        itemName: row.item_name,
        itemSku: row.item_sku,
        parentSku: row.parent_sku,
        totalImpressions: row.total_impressions === null ? null : Number(row.total_impressions),
        totalClicks: row.total_clicks === null ? null : Number(row.total_clicks),
        totalCtr: row.total_ctr === null ? null : Number(row.total_ctr),
        visitors: row.visitors === null ? null : Number(row.visitors),
        pageViews: row.page_views === null ? null : Number(row.page_views),
        addToCartVisitors: row.add_to_cart_visitors === null ? null : Number(row.add_to_cart_visitors),
        addToCartUnits: row.add_to_cart_units === null ? null : Number(row.add_to_cart_units),
        addToCartRate: row.add_to_cart_rate === null ? null : Number(row.add_to_cart_rate),
        totalOrders: row.total_orders === null ? null : Number(row.total_orders),
        buyers: row.buyers === null ? null : Number(row.buyers),
        totalUnits: row.total_units === null ? null : Number(row.total_units),
        totalSales,
        totalConversionRate: row.total_conversion_rate === null ? null : Number(row.total_conversion_rate),
        breakEvenRoas: row.break_even_roas === null || row.break_even_roas === undefined
          ? null
          : Number(row.break_even_roas),
        adImpressions: Number(row.ad_impressions || 0),
        adClicks: Number(row.ad_clicks || 0),
        adExpense,
        broadGmv,
        broadOrders: Number(row.broad_orders || 0),
        directGmv,
        directOrders: Number(row.direct_orders || 0),
        broadRoas: adExpense > 0 ? broadGmv / adExpense : 0,
        directRoas: adExpense > 0 ? directGmv / adExpense : 0,
        adSpendRatioToSales: totalSales && totalSales > 0 ? adExpense / totalSales : null,
        directGmvShareOfSales: totalSales && totalSales > 0 ? directGmv / totalSales : null,
        // Backward-compatible alias. Item-level total sales must be reconciled with
        // Direct GMV, not Broad GMV, because Broad attribution can include other shop items.
        adGmvShareOfSales: totalSales && totalSales > 0 ? directGmv / totalSales : null,
        estimatedNaturalSales: totalSales === null ? null : totalSales - directGmv,
        adAttributionExceedsTotalSales: totalSales !== null && directGmv > totalSales,
        hasProductCard: totalSales !== null,
      };
    });
  }

  async listCampaignOverview({ shopId, startDate, endDate, campaignTypeNormalized = null }) {
    const result = await this.pool.query(
      `SELECT
         c.campaign_id,
         c.ad_type,
         c.campaign_type_raw,
         c.campaign_type_normalized,
         c.region,
         s.status,
         s.bidding_method,
         s.campaign_budget,
         s.target_roas,
         s.ad_name,
         s.campaign_placement,
         s.observed_at AS setting_observed_at,
         COALESCE(SUM(d.impressions),0) AS impressions,
         COALESCE(SUM(d.clicks),0) AS clicks,
         COALESCE(SUM(d.expense),0) AS expense,
         COALESCE(SUM(d.broad_gmv),0) AS broad_gmv,
         COALESCE(SUM(d.broad_orders),0) AS broad_orders,
         COALESCE(SUM(d.broad_units),0) AS broad_units,
         COALESCE(SUM(d.direct_gmv),0) AS direct_gmv,
         COALESCE(SUM(d.direct_orders),0) AS direct_orders,
         COALESCE(SUM(d.direct_units),0) AS direct_units,
         MAX(d.event_date) AS latest_performance_date
       FROM shopee_ad_campaigns c
       LEFT JOIN LATERAL (
         SELECT
           status,bidding_method,campaign_budget,target_roas,observed_at,
           raw_json->'common_info'->>'ad_name' AS ad_name,
           raw_json->'common_info'->>'campaign_placement' AS campaign_placement
         FROM shopee_ad_campaign_setting_history s0
         WHERE s0.shop_id=c.shop_id AND s0.campaign_id=c.campaign_id
         ORDER BY observed_at DESC
         LIMIT 1
       ) s ON true
       LEFT JOIN shopee_ad_campaign_daily d
         ON d.shop_id=c.shop_id
        AND d.campaign_id=c.campaign_id
        AND d.event_date BETWEEN $2 AND $3
       WHERE c.shop_id=$1
         AND ($4::text IS NULL OR c.campaign_type_normalized=$4)
       GROUP BY
         c.campaign_id,c.ad_type,c.campaign_type_raw,c.campaign_type_normalized,c.region,
         s.status,s.bidding_method,s.campaign_budget,s.target_roas,s.ad_name,s.campaign_placement,s.observed_at
       ORDER BY COALESCE(SUM(d.expense),0) DESC, c.campaign_id`,
      [shopId, startDate, endDate, campaignTypeNormalized],
    );

    return result.rows.map(row => ({
      campaignId: Number(row.campaign_id),
      adType: row.ad_type,
      campaignTypeRaw: row.campaign_type_raw,
      campaignTypeNormalized: row.campaign_type_normalized,
      region: row.region,
      status: row.status,
      biddingMethod: row.bidding_method,
      campaignBudget: row.campaign_budget === null ? null : Number(row.campaign_budget),
      targetRoas: row.target_roas === null ? null : Number(row.target_roas),
      adName: row.ad_name,
      campaignPlacement: row.campaign_placement,
      settingObservedAt: row.setting_observed_at,
      latestPerformanceDate: row.latest_performance_date,
      performance: normalizePerformance(row),
    }));
  }

  async listProductAdsOverview({ shopId, startDate, endDate, adType }) {
    const normalized = String(adType || '').toLowerCase();
    if (!['manual', 'auto'].includes(normalized)) throw new Error('adType must be manual or auto');
    return this.listCampaignOverview({
      shopId,
      startDate,
      endDate,
      campaignTypeNormalized: normalized === 'manual' ? 'MANUAL_PRODUCT_AD' : 'AUTO_PRODUCT_AD',
    });
  }

  async listProductAdItems({ shopId, campaignId, endDate }) {
    const result = await this.pool.query(
      `WITH latest AS (
         SELECT MAX(event_date) AS event_date
         FROM shopee_ad_campaign_membership_daily
         WHERE shop_id=$1 AND campaign_id=$2 AND event_date <= $3
       )
       SELECT m.item_id,p.item_name,p.item_sku,m.membership_state,m.event_date
       FROM shopee_ad_campaign_membership_daily m
       JOIN latest l ON l.event_date=m.event_date
       LEFT JOIN shopee_products p ON p.shop_id=m.shop_id AND p.item_id=m.item_id
       WHERE m.shop_id=$1 AND m.campaign_id=$2
       ORDER BY m.item_id`,
      [shopId, campaignId, endDate],
    );
    return result.rows.map(row => ({
      itemId: Number(row.item_id),
      itemName: row.item_name,
      itemSku: row.item_sku,
      membershipState: row.membership_state,
      eventDate: row.event_date,
    }));
  }

  async getLatestCampaignSetting({ shopId, campaignId }) {
    const result = await this.pool.query(
      `SELECT status,bidding_method,campaign_budget,target_roas,observed_at,raw_json
       FROM shopee_ad_campaign_setting_history
       WHERE shop_id=$1 AND campaign_id=$2
       ORDER BY observed_at DESC
       LIMIT 1`,
      [shopId, campaignId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      status: row.status,
      biddingMethod: row.bidding_method,
      campaignBudget: row.campaign_budget === null ? null : Number(row.campaign_budget),
      targetRoas: row.target_roas === null ? null : Number(row.target_roas),
      observedAt: row.observed_at,
      raw: row.raw_json || {},
    };
  }

  async getLatestRecommendedRoiMap({ shopId, itemIds }) {
    const ids = (itemIds || []).map(Number).filter(Number.isSafeInteger);
    if (!ids.length) return new Map();
    const result = await this.pool.query(
      `SELECT DISTINCT ON (item_id)
         item_id, observed_at, lower_value, lower_percentile,
         exact_value, exact_percentile, upper_value, upper_percentile
       FROM shopee_recommended_roi_history
       WHERE shop_id=$1 AND item_id = ANY($2::bigint[])
       ORDER BY item_id, observed_at DESC`,
      [shopId, ids],
    );
    return new Map(result.rows.map(row => [
      String(row.item_id),
      {
        observedAt: row.observed_at,
        lower: { value: row.lower_value === null ? null : Number(row.lower_value), percentile: row.lower_percentile },
        exact: { value: row.exact_value === null ? null : Number(row.exact_value), percentile: row.exact_percentile },
        upper: { value: row.upper_value === null ? null : Number(row.upper_value), percentile: row.upper_percentile },
      },
    ]));
  }

  async getProductCardPeriodMap({ shopId, startDate, endDate, itemIds }) {
    const ids = (itemIds || []).map(Number).filter(Number.isSafeInteger);
    if (!ids.length) return new Map();
    const result = await this.pool.query(
      `SELECT item_id,item_name,parent_sku,item_sku,impressions,clicks,ctr,visitors,page_views,
              add_to_cart_visitors,add_to_cart_units,add_to_cart_rate,orders,buyers,units,sales,
              conversion_rate,source_file,imported_at
       FROM shopee_product_card_period
       WHERE shop_id=$1 AND start_date=$2 AND end_date=$3
         AND item_id = ANY($4::bigint[])`,
      [shopId, startDate, endDate, ids],
    );
    return new Map(result.rows.map(row => [
      String(row.item_id),
      {
        itemName: row.item_name,
        parentSku: row.parent_sku,
        itemSku: row.item_sku,
        impressions: row.impressions === null ? null : Number(row.impressions),
        clicks: row.clicks === null ? null : Number(row.clicks),
        ctr: row.ctr === null ? null : Number(row.ctr),
        visitors: row.visitors === null ? null : Number(row.visitors),
        pageViews: row.page_views === null ? null : Number(row.page_views),
        addToCartVisitors: row.add_to_cart_visitors === null ? null : Number(row.add_to_cart_visitors),
        addToCartUnits: row.add_to_cart_units === null ? null : Number(row.add_to_cart_units),
        addToCartRate: row.add_to_cart_rate === null ? null : Number(row.add_to_cart_rate),
        orders: row.orders === null ? null : Number(row.orders),
        buyers: row.buyers === null ? null : Number(row.buyers),
        units: row.units === null ? null : Number(row.units),
        sales: row.sales === null ? null : Number(row.sales),
        conversionRate: row.conversion_rate === null ? null : Number(row.conversion_rate),
        sourceFile: row.source_file,
        importedAt: row.imported_at,
      },
    ]));
  }

  async getItemTimeline({ shopId, itemId, startDate, endDate }) {
    const startEpoch = Math.floor(new Date(`${startDate}T00:00:00Z`).getTime() / 1000);
    const endEpoch = Math.floor(new Date(`${endDate}T23:59:59Z`).getTime() / 1000);

    const [voucherRows, discountRows, returnRows, roiRows, operationRows] = await Promise.all([
      this.pool.query(
        `SELECT v.voucher_id,v.voucher_name,v.percentage,v.discount_amount,v.min_basket_price,
                v.start_time,v.end_time,v.current_usage,v.usage_quantity
         FROM shopee_vouchers v
         JOIN shopee_voucher_items i
           ON i.shop_id=v.shop_id AND i.voucher_id=v.voucher_id
         WHERE v.shop_id=$1 AND i.item_id=$2
           AND COALESCE(v.end_time,0) >= $3 AND COALESCE(v.start_time,0) <= $4
         ORDER BY v.start_time`,
        [shopId, itemId, startEpoch, endEpoch],
      ),
      this.pool.query(
        `SELECT d.discount_id,d.discount_name,d.status,d.start_time,d.end_time,
                i.model_id,i.original_price,i.promotion_price
         FROM shopee_discounts d
         JOIN shopee_discount_items i
           ON i.shop_id=d.shop_id AND i.discount_id=d.discount_id
         WHERE d.shop_id=$1 AND i.item_id=$2
           AND COALESCE(d.end_time,0) >= $3 AND COALESCE(d.start_time,0) <= $4
         ORDER BY d.start_time,i.model_id`,
        [shopId, itemId, startEpoch, endEpoch],
      ),
      this.pool.query(
        `SELECT r.return_sn,r.order_sn,r.status,r.reason,r.refund_amount,r.currency,r.create_time,
                i.model_id,i.quantity,i.item_price,i.refund_amount AS item_refund_amount
         FROM shopee_returns r
         JOIN shopee_return_items i
           ON i.shop_id=r.shop_id AND i.return_sn=r.return_sn
         WHERE r.shop_id=$1 AND i.item_id=$2
           AND r.create_time BETWEEN $3 AND $4
         ORDER BY r.create_time`,
        [shopId, itemId, startEpoch, endEpoch],
      ),
      this.pool.query(
        `SELECT observed_at,lower_value,exact_value,upper_value
         FROM shopee_recommended_roi_history
         WHERE shop_id=$1 AND item_id=$2
           AND observed_at >= $3::date AND observed_at < ($4::date + interval '1 day')
         ORDER BY observed_at`,
        [shopId, itemId, startDate, endDate],
      ),
      this.pool.query(
        `SELECT operation_type,reason,before_json,after_json,effective_from,effective_to
         FROM shopee_operation_history
         WHERE shop_id=$1 AND item_id=$2
           AND effective_from >= $3::date AND effective_from < ($4::date + interval '1 day')
         ORDER BY effective_from`,
        [shopId, itemId, startDate, endDate],
      ),
    ]);

    const events = [];
    const epochIso = value => value ? new Date(Number(value) * 1000).toISOString() : null;
    for (const row of voucherRows.rows) {
      events.push({
        at: epochIso(row.start_time),
        type: 'VOUCHER_START',
        title: row.voucher_name || `Voucher #${row.voucher_id}`,
        detail: {
          voucherId: Number(row.voucher_id),
          percentage: row.percentage === null ? null : Number(row.percentage),
          discountAmount: row.discount_amount === null ? null : Number(row.discount_amount),
          minBasketPrice: row.min_basket_price === null ? null : Number(row.min_basket_price),
          currentUsage: row.current_usage,
          usageQuantity: row.usage_quantity,
          endAt: epochIso(row.end_time),
        },
      });
    }
    for (const row of discountRows.rows) {
      events.push({
        at: epochIso(row.start_time),
        type: 'DISCOUNT_START',
        title: row.discount_name || `Discount #${row.discount_id}`,
        detail: {
          discountId: Number(row.discount_id),
          status: row.status,
          modelId: Number(row.model_id || 0),
          originalPrice: row.original_price === null ? null : Number(row.original_price),
          promotionPrice: row.promotion_price === null ? null : Number(row.promotion_price),
          endAt: epochIso(row.end_time),
        },
      });
    }
    for (const row of returnRows.rows) {
      events.push({
        at: epochIso(row.create_time),
        type: 'RETURN',
        title: row.reason || 'Return / Refund',
        detail: {
          returnSn: row.return_sn,
          orderSn: row.order_sn,
          status: row.status,
          quantity: row.quantity,
          refundAmount: row.item_refund_amount === null
            ? (row.refund_amount === null ? null : Number(row.refund_amount))
            : Number(row.item_refund_amount),
          currency: row.currency,
        },
      });
    }
    for (const row of roiRows.rows) {
      events.push({
        at: new Date(row.observed_at).toISOString(),
        type: 'RECOMMENDED_ROAS',
        title: '平台预估 ROAS 更新',
        detail: {
          lower: row.lower_value === null ? null : Number(row.lower_value),
          exact: row.exact_value === null ? null : Number(row.exact_value),
          upper: row.upper_value === null ? null : Number(row.upper_value),
        },
      });
    }
    for (const row of operationRows.rows) {
      events.push({
        at: new Date(row.effective_from).toISOString(),
        type: row.operation_type,
        title: row.reason || row.operation_type,
        detail: {
          before: row.before_json,
          after: row.after_json,
          effectiveTo: row.effective_to,
        },
      });
    }

    return events.filter(event => event.at).sort((a, b) => a.at.localeCompare(b.at));
  }

  async listKnownGmsCampaignIds({ shopId }) {
    const result = await this.pool.query(
      `SELECT campaign_id
       FROM shopee_ad_campaigns
       WHERE shop_id=$1
         AND (campaign_type_normalized='GMS' OR campaign_type_raw='GMS')
       ORDER BY campaign_id`,
      [shopId],
    );
    return result.rows.map(row => Number(row.campaign_id));
  }

  async listLatestMembershipItemIds({ shopId }) {
    const result = await this.pool.query(
      `WITH latest AS (
         SELECT MAX(event_date) AS event_date
         FROM shopee_ad_campaign_membership_daily
         WHERE shop_id=$1
       )
       SELECT DISTINCT m.item_id
       FROM shopee_ad_campaign_membership_daily m
       JOIN latest l ON l.event_date=m.event_date
       WHERE m.shop_id=$1
       ORDER BY m.item_id`,
      [shopId],
    );
    return result.rows.map(row => Number(row.item_id));
  }

  async getCampaignCoverageContext({ shopId, campaignId, startDate, endDate }) {
    const [membership, items] = await Promise.all([
      this.pool.query(
        `WITH latest AS (
           SELECT MAX(event_date) AS event_date
           FROM shopee_ad_campaign_membership_daily
           WHERE shop_id=$1 AND campaign_id=$2 AND event_date <= $3
         )
         SELECT COUNT(*)::int AS membership_count
         FROM shopee_ad_campaign_membership_daily m
         JOIN latest l ON l.event_date=m.event_date
         WHERE m.shop_id=$1 AND m.campaign_id=$2`,
        [shopId, campaignId, endDate],
      ),
      this.pool.query(
        `SELECT
           COALESCE(SUM(expense),0) AS item_expense,
           COUNT(DISTINCT item_id) FILTER (
             WHERE expense <> 0 OR impressions <> 0 OR clicks <> 0 OR
                   broad_orders <> 0 OR direct_orders <> 0
           )::int AS performance_item_count,
           COUNT(DISTINCT item_id)::int AS stored_item_count
         FROM shopee_ad_item_daily
         WHERE shop_id=$1 AND campaign_id=$2
           AND event_date BETWEEN $3 AND $4`,
        [shopId, campaignId, startDate, endDate],
      ),
    ]);
    const itemRow = items.rows[0] || {};
    return {
      membershipCount: Number(membership.rows[0] && membership.rows[0].membership_count || 0),
      performanceItemCount: Number(itemRow.performance_item_count || 0),
      storedItemCount: Number(itemRow.stored_item_count || 0),
      itemExpense: Number(itemRow.item_expense || 0),
    };
  }

  async getBackfillCoverage({ shopId, startDate, endDate, timezone }) {
    const result = await this.pool.query(
      `SELECT
         (SELECT COUNT(*)::int
          FROM shopee_ad_campaign_daily
          WHERE shop_id=$1 AND event_date BETWEEN $2 AND $3) AS campaign_day_rows,
         (SELECT COUNT(DISTINCT campaign_id)::int
          FROM shopee_ad_campaign_daily
          WHERE shop_id=$1 AND event_date BETWEEN $2 AND $3) AS campaign_count,
         (SELECT COUNT(DISTINCT event_date)::int
          FROM shopee_ad_campaign_daily
          WHERE shop_id=$1 AND event_date BETWEEN $2 AND $3) AS gms_distinct_days,
         (SELECT COUNT(*)::int
          FROM shopee_shop_bi_daily
          WHERE shop_id=$1 AND event_date BETWEEN $2 AND $3) AS shop_bi_days,
         (SELECT COUNT(*)::int
          FROM shopee_orders
          WHERE shop_id=$1
            AND (to_timestamp(create_time) AT TIME ZONE $4)::date BETWEEN $2 AND $3) AS orders,
         (SELECT COUNT(*)::int
          FROM shopee_returns
          WHERE shop_id=$1
            AND (to_timestamp(create_time) AT TIME ZONE $4)::date BETWEEN $2 AND $3) AS returns,
         (SELECT COUNT(*)::int
          FROM shopee_products
          WHERE shop_id=$1) AS products,
         (SELECT COUNT(*)::int
          FROM shopee_vouchers
          WHERE shop_id=$1) AS vouchers,
         (SELECT COUNT(*)::int
          FROM shopee_discounts
          WHERE shop_id=$1) AS discounts,
         (SELECT COUNT(*)::int
          FROM shopee_product_card_period
          WHERE shop_id=$1 AND start_date=$2 AND end_date=$3) AS product_card_period_rows,
         (SELECT COUNT(DISTINCT event_date)::int
          FROM shopee_ad_campaign_membership_daily
          WHERE shop_id=$1 AND event_date BETWEEN $2 AND $3) AS membership_snapshot_days`,
      [shopId, startDate, endDate, timezone],
    );
    const row = result.rows[0] || {};
    return {
      campaignDayRows: Number(row.campaign_day_rows || 0),
      campaignCount: Number(row.campaign_count || 0),
      gmsDistinctDays: Number(row.gms_distinct_days || 0),
      shopBiDays: Number(row.shop_bi_days || 0),
      orders: Number(row.orders || 0),
      returns: Number(row.returns || 0),
      products: Number(row.products || 0),
      vouchers: Number(row.vouchers || 0),
      discounts: Number(row.discounts || 0),
      productCardPeriodRows: Number(row.product_card_period_rows || 0),
      membershipSnapshotDays: Number(row.membership_snapshot_days || 0),
    };
  }

  async getSystemStatus({ shopId }) {
    const [sourcesResult, tokensResult, syncResult] = await Promise.all([
      this.pool.query(
        `SELECT source, last_synced_at, latest_data_date
         FROM (
           SELECT 'GMS_ADS'::text AS source,
                  MAX(synced_at) AS last_synced_at,
                  MAX(event_date)::text AS latest_data_date
           FROM shopee_ad_campaign_daily WHERE shop_id=$1
           UNION ALL
           SELECT 'ORDERS', MAX(synced_at),
                  to_char(to_timestamp(MAX(update_time)), 'YYYY-MM-DD')
           FROM shopee_orders WHERE shop_id=$1
           UNION ALL
           SELECT 'RETURNS', MAX(synced_at),
                  to_char(to_timestamp(MAX(update_time)), 'YYYY-MM-DD')
           FROM shopee_returns WHERE shop_id=$1
           UNION ALL
           SELECT 'SHOP_BI', MAX(synced_at), MAX(event_date)::text
           FROM shopee_shop_bi_daily WHERE shop_id=$1
           UNION ALL
           SELECT 'PRODUCT_CARD', MAX(imported_at), MAX(end_date)::text
           FROM shopee_product_card_period WHERE shop_id=$1
           UNION ALL
           SELECT 'PRODUCTS', MAX(synced_at),
                  to_char(to_timestamp(MAX(update_time)), 'YYYY-MM-DD')
           FROM shopee_products WHERE shop_id=$1
           UNION ALL
           SELECT 'PROMOTIONS', MAX(synced_at),
                  to_char(to_timestamp(GREATEST(MAX(voucher_end),MAX(discount_end))), 'YYYY-MM-DD')
           FROM (
             SELECT MAX(synced_at) AS synced_at, MAX(end_time) AS voucher_end, NULL::bigint AS discount_end
             FROM shopee_vouchers WHERE shop_id=$1
             UNION ALL
             SELECT MAX(synced_at), NULL::bigint, MAX(end_time)
             FROM shopee_discounts WHERE shop_id=$1
           ) p
         ) s
         ORDER BY source`,
        [shopId],
      ),
      this.pool.query(
        `SELECT app_role, expires_at, last_refresh_at, refresh_error, updated_at
         FROM shopee_app_tokens
         WHERE shop_id=$1
         ORDER BY app_role`,
        [shopId],
      ),
      this.pool.query(
        `SELECT app_role,endpoint_key,last_success_at,last_error,cursor_json
         FROM shopee_sync_state
         WHERE shop_id=$1
         ORDER BY app_role,endpoint_key`,
        [shopId],
      ),
    ]);

    return {
      sources: sourcesResult.rows.map(row => ({
        source: row.source,
        lastSyncedAt: row.last_synced_at,
        latestDataDate: row.latest_data_date,
      })),
      tokens: tokensResult.rows.map(row => ({
        appRole: row.app_role,
        expiresAt: row.expires_at,
        lastRefreshAt: row.last_refresh_at,
        refreshError: row.refresh_error,
        updatedAt: row.updated_at,
      })),
      syncStates: syncResult.rows.map(row => ({
        appRole: row.app_role,
        endpointKey: row.endpoint_key,
        lastSuccessAt: row.last_success_at,
        lastError: row.last_error,
        cursor: row.cursor_json || {},
      })),
    };
  }

  async getCampaignItemNames({ shopId, itemIds }) {
    const ids = (itemIds || []).map(Number).filter(Number.isSafeInteger);
    if (!ids.length) return new Map();
    const result = await this.pool.query(
      `SELECT item_id,item_name,item_sku
       FROM shopee_products
       WHERE shop_id=$1 AND item_id = ANY($2::bigint[])`,
      [shopId, ids],
    );
    return new Map(result.rows.map(row => [
      String(row.item_id),
      { itemName: row.item_name, itemSku: row.item_sku },
    ]));
  }
}

module.exports = { ShopeeQueryRepository };
