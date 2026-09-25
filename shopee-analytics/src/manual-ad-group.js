'use strict';

const TYPES = new Set(['SHOP_GMV_MAX', 'AD_GROUP', 'INDIVIDUAL_AD']);
const SOURCES = new Set(['SHOPEE_API', 'MANUAL', 'MANUAL_IMPORT']);
const nullableNumber = value => value === '' || value === null || value === undefined ? null : (Number.isFinite(Number(value)) ? Number(value) : null);
const nullableInt = value => value === '' || value === null || value === undefined ? null : (Number.isSafeInteger(Number(value)) ? Number(value) : null);
function derived({ impressions, clicks, expense, orders, gmv }) {
  return {
    ctr: impressions !== null && impressions > 0 && clicks !== null ? clicks / impressions : null,
    cvr: clicks !== null && clicks > 0 && orders !== null ? orders / clicks : null,
    roas: expense !== null && expense > 0 && gmv !== null ? gmv / expense : null,
  };
}
function normalizeManualPromotion(input = {}, { source = 'MANUAL' } = {}) {
  const promotionType = String(input.promotionType || input.promotion_type || 'AD_GROUP').trim();
  if (!TYPES.has(promotionType)) throw new Error('promotionType is invalid');
  if (!SOURCES.has(source)) throw new Error('data source is invalid');
  const shopId = nullableInt(input.shopId ?? input.shop_id);
  const periodStart = String(input.periodStart ?? input.period_start ?? input.eventDate ?? input.event_date ?? '');
  const periodEnd = String(input.periodEnd ?? input.period_end ?? periodStart);
  const campaignName = String(input.campaignName ?? input.campaign_name ?? '').trim();
  if (!shopId || !/^\d{4}-\d{2}-\d{2}$/.test(periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd) || periodStart > periodEnd || !campaignName) throw new Error('shopId, periodStart, periodEnd, and campaignName are required');
  const impressions = nullableInt(input.impressions); const clicks = nullableInt(input.clicks); const expense = nullableNumber(input.expense);
  const orders = nullableInt(input.orders); const gmv = nullableNumber(input.gmv);
  const supplied = { ctr: nullableNumber(input.ctr), cvr: nullableNumber(input.cvr), roas: nullableNumber(input.roas) };
  const calc = derived({ impressions, clicks, expense, orders, gmv });
  const flags = [];
  for (const key of ['ctr','cvr','roas']) if (supplied[key] !== null && calc[key] !== null && Math.abs(supplied[key] - calc[key]) > 0.01) flags.push(`DATA_MISMATCH_${key.toUpperCase()}`);
  const required = [expense, orders, gmv];
  const quality = flags.length ? 'DATA_MISMATCH' : required.some(value => value === null) ? 'PARTIAL' : 'COMPLETE';
  return { shopId,periodStart,periodEnd,eventDate:periodStart,granularity: periodStart === periodEnd ? 'DAY' : 'RANGE',promotionType,dataSource:source, campaignId: nullableInt(input.campaignId ?? input.campaign_id), campaignName,
    campaignStatus: input.campaignStatus ?? input.campaign_status ?? null, campaignBudget: nullableNumber(input.campaignBudget ?? input.campaign_budget), targetRoas: nullableNumber(input.targetRoas ?? input.target_roas), estimatedRoas: nullableNumber(input.estimatedRoas ?? input.estimated_roas),
    impressions,clicks,expense,orders,gmv,sourceRoas: supplied.roas,ctr: supplied.ctr ?? calc.ctr,cvr: supplied.cvr ?? calc.cvr,addToCart: nullableInt(input.addToCart ?? input.add_to_cart),itemCount: nullableInt(input.itemCount ?? input.item_count),dataQualityStatus:quality,qualityFlags:flags,remark:input.remark ?? null };
}
function normalizeManualItem(input = {}) {
  const itemId = nullableInt(input.itemId ?? input.item_id ?? input.productId ?? input.product_id);
  if (!itemId) throw new Error('manual item itemId is required');
  const impressions = nullableInt(input.impressions); const clicks = nullableInt(input.clicks);
  const expense = nullableNumber(input.expense); const orders = nullableInt(input.orders); const gmv = nullableNumber(input.gmv);
  const suppliedRoas = nullableNumber(input.roas ?? input.sourceRoas ?? input.source_roas);
  const calculated = derived({ impressions, clicks, expense, orders, gmv });
  const flags = suppliedRoas !== null && calculated.roas !== null && Math.abs(suppliedRoas - calculated.roas) > 0.01 ? ['DATA_MISMATCH_ROAS'] : [];
  return { itemId, itemSku: input.itemSku ?? input.item_sku ?? null, productName: input.productName ?? input.product_name ?? null,
    impressions, clicks, expense, orders, gmv, sourceRoas: suppliedRoas, ctr: nullableNumber(input.ctr) ?? calculated.ctr,
    cvr: nullableNumber(input.cvr) ?? calculated.cvr, addToCart: nullableInt(input.addToCart ?? input.add_to_cart), weeklySales: nullableNumber(input.weeklySales ?? input.weekly_sales),
    dataQualityStatus: flags.length ? 'DATA_MISMATCH' : [expense, orders, gmv].some(value => value === null) ? 'PARTIAL' : 'COMPLETE', qualityFlags: flags,
    remark: input.remark ?? null, raw: input.raw ?? {} };
}
module.exports = { TYPES, SOURCES, nullableNumber, nullableInt, derived, normalizeManualPromotion, normalizeManualItem };
