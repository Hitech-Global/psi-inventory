'use strict';

const { normalizePerformance } = require('./metrics');
const { assertPilotTypedCampaignAllowed, isPilotGmvMax } = require('./deployment-mode');

function quality(performance) {
  const flags = performance.dataQualityFlags || [];
  return { dataQualityStatus: flags.length ? 'PARTIAL' : 'COMPLETE', qualityFlags: flags };
}

function gmsPromotionRow({ shopId, campaignId, eventDate, performance, raw = {} }) {
  const p = normalizePerformance(performance);
  return {
    shopId, eventDate, periodStart: eventDate, periodEnd: eventDate, granularity: 'DAY', promotionType: 'SHOP_GMV_MAX', dataSource: 'SHOPEE_API', campaignId,
    campaignName: raw.ad_name ?? null, sourceAdType: 'gms', campaignStatus: raw.status ?? null, campaignBudget: raw.campaign_budget ?? null, targetRoas: raw.target_roi ?? null,
    impressions: p.impressions, clicks: p.clicks, expense: p.expense, orders: p.broadOrders, gmv: p.broadGmv, sourceRoas: p.broadRoas, ctr: p.ctr, cvr: p.broadCvr,
    itemCount: null, ...quality(p), raw: { source: 'GMS', response: raw, directGmv: p.directGmv, directRoas: p.directRoas, sourceDirectGmvPresent: p.sourceDirectGmvPresent },
  };
}

function gmsItemRows(rows = []) {
  return rows.map(row => {
    const p = normalizePerformance(row);
    return { itemId: Number(row.itemId ?? row.item_id), productName: row.productName ?? null, impressions: p.impressions, clicks: p.clicks, expense: p.expense, orders: p.broadOrders, gmv: p.broadGmv, sourceRoas: p.broadRoas, ctr: p.ctr, cvr: p.broadCvr, ...quality(p), raw: { source: 'GMS_ITEM', raw: row, directGmv: p.directGmv, directRoas: p.directRoas, sourceDirectGmvPresent: p.sourceDirectGmvPresent } };
  }).filter(row => Number.isSafeInteger(row.itemId) && row.itemId > 0);
}

function individualPromotionRow({ shopId, campaign, eventDate, performance, raw = {} }) {
  const p = normalizePerformance(performance);
  return {
    shopId, eventDate, periodStart: eventDate, periodEnd: eventDate, granularity: 'DAY', promotionType: 'INDIVIDUAL_AD', dataSource: 'SHOPEE_API', campaignId: Number(campaign.campaignId ?? campaign.campaign_id), campaignName: campaign.adName ?? campaign.ad_name ?? null,
    sourceAdType: campaign.adType ?? campaign.ad_type ?? null, campaignStatus: campaign.campaignStatus ?? campaign.status ?? null, campaignBudget: campaign.campaignBudget ?? campaign.campaign_budget ?? null, targetRoas: campaign.targetRoas ?? campaign.target_roi ?? null,
    impressions: p.impressions, clicks: p.clicks, expense: p.expense, orders: p.broadOrders, gmv: p.broadGmv, sourceRoas: p.broadRoas, ctr: p.ctr, cvr: p.broadCvr, itemCount: 1, ...quality(p), raw: { source: 'PRODUCT_ADS', response: raw, directGmv: p.directGmv, directRoas: p.directRoas, sourceDirectGmvPresent: p.sourceDirectGmvPresent },
  };
}

async function persistPilotGmsDay({ repository, shopId, campaignId, eventDate, performance, items = [], raw = {}, env = process.env }) {
  if (isPilotGmvMax(env)) assertPilotTypedCampaignAllowed('SHOP_GMV_MAX', campaignId, env);
  const row = gmsPromotionRow({ shopId, campaignId, eventDate, performance, raw });
  return repository.saveWithItems(row, gmsItemRows(items));
}

async function persistPilotIndividualAdDay({ repository, shopId, campaign, eventDate, performance, item, raw = {}, env = process.env }) {
  const campaignId = Number(campaign.campaignId ?? campaign.campaign_id);
  if (isPilotGmvMax(env)) assertPilotTypedCampaignAllowed('INDIVIDUAL_AD', campaignId, env);
  const itemId = Number(item && (item.itemId ?? item.item_id));
  if (!Number.isSafeInteger(itemId) || itemId <= 0) throw new Error('INDIVIDUAL_AD requires exactly one valid item');
  const row = individualPromotionRow({ shopId, campaign, eventDate, performance, raw });
  return repository.saveWithItems(row, gmsItemRows([item]));
}

module.exports = { gmsPromotionRow, gmsItemRows, individualPromotionRow, persistPilotGmsDay, persistPilotIndividualAdDay };
