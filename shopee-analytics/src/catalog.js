'use strict';

const ENDPOINTS = Object.freeze({
  adsCampaignIds: { app: 'ADS', method: 'GET', path: '/api/v2/ads/get_product_level_campaign_id_list' },
  adsCampaignSettings: { app: 'ADS', method: 'GET', path: '/api/v2/ads/get_product_level_campaign_setting_info' },
  adsGmsCampaignPerformance: { app: 'ADS', method: 'POST', path: '/api/v2/ads/get_gms_campaign_performance' },
  adsGmsItemPerformance: { app: 'ADS', method: 'POST', path: '/api/v2/ads/get_gms_item_performance' },
  adsDailyPerformance: { app: 'ADS', method: 'GET', path: '/api/v2/ads/get_product_campaign_daily_performance' },
  adsHourlyPerformance: { app: 'ADS', method: 'GET', path: '/api/v2/ads/get_product_campaign_hourly_performance' },
  adsAllCpcDailyPerformance: { app: 'ADS', method: 'GET', path: '/api/v2/ads/get_all_cpc_ads_daily_performance' },
  adsRecommendedRoi: { app: 'ADS', method: 'GET', path: '/api/v2/ads/get_product_recommended_roi_target' },
  adsDeletedGmsItems: { app: 'ADS', method: 'POST', path: '/api/v2/ads/list_gms_user_deleted_item' },
  products: { app: 'ADS', method: 'GET', path: '/api/v2/product/get_item_list' },
  productBaseInfo: { app: 'ADS', method: 'GET', path: '/api/v2/product/get_item_base_info' },
  productModels: { app: 'ADS', method: 'GET', path: '/api/v2/product/get_model_list' },
  productPromotions: { app: 'ADS', method: 'GET', path: '/api/v2/product/get_item_promotion' },
  orders: { app: 'ADS', method: 'GET', path: '/api/v2/order/get_order_list' },
  orderDetail: { app: 'ADS', method: 'GET', path: '/api/v2/order/get_order_detail' },
  shopInfo: { app: 'ADS', method: 'GET', path: '/api/v2/shop/get_shop_info' },
  vouchers: { app: 'STORE_OPS', method: 'GET', path: '/api/v2/voucher/get_voucher_list' },
  voucherDetail: { app: 'STORE_OPS', method: 'GET', path: '/api/v2/voucher/get_voucher' },
  discounts: { app: 'STORE_OPS', method: 'GET', path: '/api/v2/discount/get_discount_list' },
  discountDetail: { app: 'STORE_OPS', method: 'GET', path: '/api/v2/discount/get_discount' },
  returns: { app: 'ERP', method: 'GET', path: '/api/v2/returns/get_return_list' },
  returnDetail: { app: 'ERP', method: 'GET', path: '/api/v2/returns/get_return_detail' },
  shopSalesPerformance: { app: 'BRAND_PORTAL', method: 'POST', path: '/api/v2/principal/get_shop_sales_performance_detail' },
  shopLivestreamPerformance: { app: 'BRAND_PORTAL', method: 'POST', path: '/api/v2/principal/get_shop_livestream_performance' },
  // 店铺自然流量与转化：访客、浏览、点击、加购、订单、转化率。
  //
  // These two are the Business Insights endpoints, and they are the only
  // ones that carry a single shop's own traffic. They belong to the
  // Business Insights permission pool of an ERP System application — an
  // advertising application is refused, and a Brand Portal application
  // reads the brand's dashboard rather than a shop's own figures.
  //
  // An application that has not had the permission pool turned on answers
  // "error_not_found" for them, which is why they are kept apart from the
  // endpoints that every application may call.
  marketingOverview: { app: 'ERP', method: 'POST', path: '/api/v2/business_insights/get_marketing_overview' },
  marketingHotListing: { app: 'ERP', method: 'POST', path: '/api/v2/business_insights/get_marketing_hot_listing' },
  // 店铺评分与履约质量。ERP System 类应用才有这个权限 —— 广告类应用调它会被拒。
  accountHealth: { app: 'ERP', method: 'GET', path: '/api/v2/account_health/get_shop_performance' },
  // 罚分、处罚、有问题的商品、迟发订单：绩效与违规这一块。
  penaltyPointHistory: { app: 'ERP', method: 'GET', path: '/api/v2/account_health/get_penalty_point_history' },
  punishmentHistory: { app: 'ERP', method: 'GET', path: '/api/v2/account_health/get_punishment_history' },
  listingsWithIssues: { app: 'ERP', method: 'GET', path: '/api/v2/account_health/get_listings_with_issues' },
  lateOrders: { app: 'ERP', method: 'GET', path: '/api/v2/account_health/get_late_orders' },
  // 某个指标背后具体是哪些订单、什么原因码。指标本身只给比例，明细给原因。
  metricSourceDetail: { app: 'ERP', method: 'GET', path: '/api/v2/account_health/get_metric_source_detail' },

  // ── 联盟营销（AMS）──────────────────────────────────────────────────
  // 只有 Affiliate Marketing Solution 类应用能调这组接口。绩效、转换
  // 报告和对账账单都在这里 —— 佣金和投产比不必再从卖家中心导出了。
  amsPerformanceUpdateTime: { app: 'MARKETING', method: 'GET', path: '/api/v2/ams/get_performance_data_update_time' },
  amsShopPerformance: { app: 'MARKETING', method: 'GET', path: '/api/v2/ams/get_shop_performance' },
  amsProductPerformance: { app: 'MARKETING', method: 'GET', path: '/api/v2/ams/get_product_performance' },
  amsAffiliatePerformance: { app: 'MARKETING', method: 'GET', path: '/api/v2/ams/get_affiliate_performance' },
  amsContentPerformance: { app: 'MARKETING', method: 'GET', path: '/api/v2/ams/get_content_performance' },
  amsCampaignKeyMetrics: { app: 'MARKETING', method: 'GET', path: '/api/v2/ams/get_campaign_key_metrics_performance' },
  amsOpenCampaignPerformance: { app: 'MARKETING', method: 'GET', path: '/api/v2/ams/get_open_campaign_performance' },
  amsTargetedCampaignPerformance: { app: 'MARKETING', method: 'GET', path: '/api/v2/ams/get_targeted_campaign_performance' },
  amsConversionReport: { app: 'MARKETING', method: 'GET', path: '/api/v2/ams/get_conversion_report' },
  amsValidationList: { app: 'MARKETING', method: 'GET', path: '/api/v2/ams/get_validation_list' },
  amsValidationReport: { app: 'MARKETING', method: 'GET', path: '/api/v2/ams/get_validation_report' },
  amsOpenCampaignAddedProduct: { app: 'MARKETING', method: 'GET', path: '/api/v2/ams/get_open_campaign_added_product' },

  // ── 视频与直播──────────────────────────────────────────────────────
  videoList: { app: 'VIDEO', method: 'GET', path: '/api/v2/video/get_video_list' },
  liveSessionList: { app: 'VIDEO', method: 'GET', path: '/api/v2/live/get_live_session_list' },

  // ── 线上店铺────────────────────────────────────────────────────────
  onlineShopList: { app: 'ONLINE', method: 'GET', path: '/api/v2/online/get_online_shop_list' },

  // ── 运营大脑与订单分析──────────────────────────────────────────────
  storeOpsBrainOverview: { app: 'STORE_OPS_BRAIN', method: 'GET', path: '/api/v2/store_ops_brain/get_overview' },
  orderAnalysis: { app: 'ORDER_ANALYSIS', method: 'GET', path: '/api/v2/order_analysis/get_order_analysis' },
});

const SYNC_POLICY = Object.freeze({
  adsCampaignIds: { minutes: 60 },
  adsCampaignSettings: { minutes: 60 },
  adsGmsCampaignPerformance: { minutes: 60, refreshDays: 7 },
  adsGmsItemPerformance: { minutes: 60, refreshDays: 7 },
  adsDailyPerformance: { minutes: 60, refreshDays: 7 },
  adsHourlyPerformance: { minutes: 60, refreshDays: 2 },
  adsRecommendedRoi: { minutes: 1440 },
  products: { minutes: 360 },
  productBaseInfo: { minutes: 360 },
  productModels: { minutes: 360 },
  productPromotions: { minutes: 60 },
  orders: { minutes: 15, refreshDays: 15 },
  vouchers: { minutes: 60 },
  discounts: { minutes: 60 },
  returns: { minutes: 30 },
  shopInfo: { minutes: 1440 },
  shopSalesPerformance: { minutes: 1440 },
  accountHealth: { minutes: 360 },
  penaltyPointHistory: { minutes: 360 },
  listingsWithIssues: { minutes: 360 },
  lateOrders: { minutes: 360 },
  // 联盟绩效每天更新一次，账单也是。
  amsPerformanceUpdateTime: { minutes: 1440 },
  amsShopPerformance: { minutes: 360 },
  amsProductPerformance: { minutes: 360 },
  amsAffiliatePerformance: { minutes: 360 },
  amsContentPerformance: { minutes: 360 },
  amsCampaignKeyMetrics: { minutes: 360 },
  amsOpenCampaignPerformance: { minutes: 360 },
  amsConversionReport: { minutes: 360 },
  amsValidationList: { minutes: 1440 },
  amsValidationReport: { minutes: 1440 },
  amsOpenCampaignAddedProduct: { minutes: 1440 },
  videoList: { minutes: 360 },
  liveSessionList: { minutes: 360 },
  onlineShopList: { minutes: 1440 },
  storeOpsBrainOverview: { minutes: 360 },
  orderAnalysis: { minutes: 360 },
});

module.exports = { ENDPOINTS, SYNC_POLICY };
