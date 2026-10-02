'use strict';

const { addDays } = require('./sync-cycle-utils');

function dailyAnalysisWindow(localDate, days = 14) {
  return { startDate: addDays(localDate, -(days - 1)), endDate: localDate };
}

function isDailyAnalysisCampaign(campaign) {
  const status = String(campaign && campaign.status || '').trim().toUpperCase();
  // Legacy fixtures and partially synchronized campaigns may not have a status yet.
  // Once Shopee supplies status, only ONGOING campaigns consume daily model calls.
  return !status || status === 'ONGOING';
}

async function runDailySkillReports({
  shops,
  queryRepository,
  runSkillAnalysis,
  localDateForShop,
  windowDays = 14,
}) {
  const results = [];
  for (const shop of shops) {
    const endDate = localDateForShop(shop);
    const { startDate } = dailyAnalysisWindow(endDate, windowDays);
    const campaigns = await queryRepository.listCampaignOverview({
      shopId: shop.shopId, startDate, endDate,
    });
    for (const campaign of campaigns.filter(isDailyAnalysisCampaign)) {
      const campaignId = campaign.campaignId ?? campaign.campaign_id;
      if (!campaignId) continue;
      try {
        const result = await runSkillAnalysis({
          shopId: shop.shopId,
          campaignId,
          startDate,
          endDate,
          triggerType: 'DAILY_AUTO',
          triggerReason: 'POST_DAILY_SYNC',
        });
        results.push({ shopId: shop.shopId, campaignId, ok: true, reportId: result.reportId });
      } catch (error) {
        results.push({ shopId: shop.shopId, campaignId, ok: false, error: error.message });
      }
    }
  }
  return results;
}

module.exports = { dailyAnalysisWindow, isDailyAnalysisCampaign, runDailySkillReports };
