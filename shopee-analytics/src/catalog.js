'use strict';

const ENDPOINTS = Object.freeze({
  adsCampaignIds: { app: 'ADS', method: 'GET', path: '/api/v2/ads/get_product_level_campaign_id_list' },
  adsCampaignSettings: { app: 'ADS', method: 'GET', path: '/api/v2/ads/get_product_level_campaign_setting_info' },
  adsGmsCampaignPerformance: { app: 'ADS', method: 'POST', path: '/api/v2/ads/get_gms_campaign_performance' },
  adsGmsItemPerformance: { app: 'ADS', method: 'POST', path: '/api/v2/ads/get_gms_item_performance' },
  adsDailyPerformance: { app: 'ADS', method: 'GET', path: '/api/v2/ads/get_product_campaign_daily_performance' },
  adsHourlyPerformance: { app: 'ADS', method: 'GET', path: '/api/v2/ads/get_product_campaign_hourly_performance' },
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
  marketingHotListing: { app: 'ERP', method: 'GET', path: '/api/v2/business_insights/get_marketing_hot_listing' },
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
});

module.exports = { ENDPOINTS, SYNC_POLICY };
