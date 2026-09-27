'use strict';

const { runBackfillShop } = require('./backfill-runner');
const { localIsoDate, addDays } = require('./sync-cycle-utils');

function defaultAnalyticsStartDate(localToday) {
  const text = String(localToday || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error('localToday must be YYYY-MM-DD');
  return `${text.slice(0, 7)}-01`;
}

async function ensureAutomaticHistory({
  runtime,
  profileRepository,
  shop,
  seededGmsCampaignIds = [],
  now = new Date(),
  backfillRunner = runBackfillShop,
} = {}) {
  if (!runtime) throw new Error('runtime is required');
  if (!profileRepository) throw new Error('profileRepository is required');
  if (!shop || !shop.shopId) throw new Error('shop is required');

  if (!shop.oauthAuthorized) {
    return { ok: true, skipped: 'NO_ADS_TOKEN' };
  }
  if (!shop.timezone) {
    return { ok: false, skipped: 'NO_TIMEZONE' };
  }

  const today = localIsoDate(now, shop.timezone);
  const endDate = addDays(today, -1);
  let startDate = shop.analyticsStartDate || null;
  let initializedStartDate = false;
  if (!startDate) {
    const candidate = defaultAnalyticsStartDate(today);
    startDate = await profileRepository.ensureAnalyticsStartDate({
      shopId: shop.shopId,
      startDate: candidate,
    });
    shop.analyticsStartDate = startDate;
    initializedStartDate = true;
  }

  if (startDate > endDate) {
    return {
      ok: true,
      startDate,
      endDate,
      initializedStartDate,
      skipped: 'NO_COMPLETE_HISTORY_DAY_YET',
    };
  }

  const result = await backfillRunner({
    runtime,
    shop,
    startDate,
    endDate,
    sources: ['product-ads', 'gms'],
    seededGmsCampaignIds,
    now,
  });

  return {
    ok: Boolean(result && result.ok),
    startDate,
    endDate,
    initializedStartDate,
    result,
  };
}

module.exports = { defaultAnalyticsStartDate, ensureAutomaticHistory };
