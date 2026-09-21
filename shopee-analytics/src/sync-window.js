'use strict';

const { syncGmsDay } = require('./sync-gms');
const { assertPilotCampaignAllowed } = require('./deployment-mode');

function toIsoDate(date) {
  const d = date instanceof Date ? new Date(date.getTime()) : new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${date}`);
  return d.toISOString().slice(0, 10);
}

function dateRangeInclusive(startDate, endDate) {
  const start = new Date(`${toIsoDate(startDate)}T00:00:00Z`);
  const end = new Date(`${toIsoDate(endDate)}T00:00:00Z`);
  if (start > end) throw new Error('startDate must be <= endDate');
  const out = [];
  for (let d = start; d <= end; d = new Date(d.getTime() + 86400000)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function trailingWindow(endDate, days = 7) {
  if (!Number.isInteger(days) || days <= 0 || days > 180) throw new Error('days must be 1..180');
  const end = new Date(`${toIsoDate(endDate)}T00:00:00Z`);
  const start = new Date(end.getTime() - (days - 1) * 86400000);
  return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
}

async function resolveMembership({ repository, shopId, campaignId, eventDate, membershipProvider }) {
  if (membershipProvider) {
    const ids = await membershipProvider({ shopId, campaignId, eventDate });
    return Array.isArray(ids) ? ids : [];
  }
  if (repository && typeof repository.loadMembershipItemIds === 'function') {
    return repository.loadMembershipItemIds({ shopId, campaignId, eventDate });
  }
  return [];
}

async function syncGmsWindow({
  client,
  repository,
  shopId,
  accessToken,
  campaignId,
  startDate,
  endDate,
  membershipProvider,
}) {
  if (!repository || typeof repository.saveGmsDay !== 'function') {
    throw new Error('repository.saveGmsDay is required');
  }
  assertPilotCampaignAllowed(campaignId);

  const dates = dateRangeInclusive(startDate, endDate);
  const results = [];

  try {
    for (const eventDate of dates) {
      const membershipItemIds = await resolveMembership({
        repository,
        shopId,
        campaignId,
        eventDate,
        membershipProvider,
      });
      const day = await syncGmsDay({
        client,
        shopId,
        accessToken,
        campaignId,
        date: eventDate,
        membershipItemIds,
      });
      await repository.saveGmsDay({
        shopId,
        campaignId,
        eventDate,
        campaign: day.campaign,
        items: day.items,
        membershipItemIds,
        rawSnapshots: day.rawSnapshots,
      });
      results.push({
        eventDate,
        campaignOrders: day.campaign.broadOrders,
        campaignRoas: day.campaign.broadRoas,
        itemCount: day.items.length,
      });
    }

    if (typeof repository.markSyncSuccess === 'function') {
      await repository.markSyncSuccess({
        appRole: 'ADS',
        endpointKey: 'GMS_WINDOW',
        shopId,
        cursor: { campaignId, startDate: dates[0], endDate: dates[dates.length - 1] },
      });
    }
    return results;
  } catch (error) {
    if (typeof repository.markSyncFailure === 'function') {
      await repository.markSyncFailure({
        appRole: 'ADS',
        endpointKey: 'GMS_WINDOW',
        shopId,
        error,
      });
    }
    throw error;
  }
}

module.exports = { toIsoDate, dateRangeInclusive, trailingWindow, syncGmsWindow };
