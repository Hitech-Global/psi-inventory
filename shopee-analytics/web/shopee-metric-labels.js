'use strict';

(() => {
  const LABELS = Object.freeze({
    sequence: { zh: '排序', en: 'Sequence' },
    adProductName: { zh: '广告 / 商品名称', en: 'Ad / Product Name' },
    status: { zh: '状态', en: 'Status' },
    adsType: { zh: '广告类型', en: 'Ads Type' },
    productId: { zh: '商品编号', en: 'Product ID' },
    biddingMethod: { zh: '竞价方式', en: 'Bidding Method' },
    startDate: { zh: '开始日期', en: 'Start Date' },
    endDate: { zh: '结束日期', en: 'End Date' },
    impressions: { zh: '展示次数', en: 'Impression' },
    clicks: { zh: '点击数', en: 'Clicks' },
    ctr: { zh: '点击率', en: 'CTR' },
    addToCart: { zh: '加入购物车', en: 'Add To Cart' },
    addToCartRate: { zh: '加入购物车频率', en: 'Add To Cart Rate' },
    conversions: { zh: '转化', en: 'Conversions' },
    directConversions: { zh: '直接转化', en: 'Direct Conversions' },
    conversionRate: { zh: '转化率', en: 'Conversion Rate' },
    directConversionRate: { zh: '直接转化率', en: 'Direct Conversion Rate' },
    costPerConversion: { zh: '每转化成本', en: 'Cost per Conversion' },
    costPerDirectConversion: { zh: '每一直接转化的成本', en: 'Cost per Direct Conversion' },
    itemsSold: { zh: '商品已出售', en: 'Items Sold' },
    directItemsSold: { zh: '直接已售商品', en: 'Direct Items Sold' },
    gmv: { zh: '销售金额', en: 'GMV' },
    directGmv: { zh: '直接销售金额', en: 'Direct GMV' },
    expense: { zh: '花费', en: 'Expense' },
    roas: { zh: '广告支出回报率', en: 'ROAS' },
    directRoas: { zh: '直接广告支出回报率', en: 'Direct ROAS' },
    acos: { zh: '广告销售成本', en: 'ACOS' },
    directAcos: { zh: '直接广告销售成本', en: 'Direct ACOS' },
    voucherAmount: { zh: '优惠券金额', en: 'Voucher Amount' },
    voucheredSales: { zh: '优惠券带来的销售额', en: 'Vouchered Sales' },
    campaignApi: { zh: 'Campaign（API）', en: 'Campaign (API)' },
    budgetApi: { zh: '预算（API）', en: 'Budget (API)' },
    targetRoas: { zh: 'Target ROAS', en: 'Target ROAS' },
    averageRank: { zh: '平均排名', en: 'Average Rank' },
    keywordPlacement: { zh: '关键字/位置', en: 'Keyword / Placement' },
    matchType: { zh: '匹配类型', en: 'Match Type' },
    searchVolume: { zh: '搜寻次数', en: 'Search Volume' },
    placement: { zh: '版位', en: 'Placement' },
    productName: { zh: '商品名称', en: 'Product Name' },
    dataDateSystem: { zh: '数据日期（系统）', en: 'Data Date (System)' },
    productCountSystem: { zh: '商品数（系统）', en: 'Product Count (System)' },
    dataQuality: { zh: '数据质量', en: 'Data Quality' },
  });

  function localeFromDocument() {
    const lang = String(document.documentElement.lang || '').toLowerCase();
    return lang.startsWith('zh') ? 'zh' : 'en';
  }

  function label(key, locale = localeFromDocument()) {
    const entry = LABELS[key];
    return entry ? entry[locale] || entry.en : key;
  }

  function apply(root = document) {
    root.querySelectorAll('[data-shopee-metric]').forEach(node => {
      const key = node.getAttribute('data-shopee-metric');
      node.textContent = label(key);
      node.setAttribute('data-shopee-label-en', label(key, 'en'));
      node.setAttribute('data-shopee-label-zh', label(key, 'zh'));
    });
  }

  window.ShopeeMetricLabels = Object.freeze({ LABELS, label, apply, localeFromDocument });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => apply());
  else apply();
})();
