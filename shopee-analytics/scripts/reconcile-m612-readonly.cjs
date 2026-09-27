'use strict';

const { createAnalyticsPool } = require('../src/pg');
const { listProductAdsSourceAccurate } = require('../src/product-ads-source-router');
const { evaluateProductAdCampaignReconciliation } = require('../src/product-ad-campaign-reconciliation');

const CAMPAIGN_ID = 165010976;
const ITEM_ID = 55107532325;
const EVENT_DATE = '2026-09-21';

const EXPECTED = {
  impressions: 697,
  clicks: 36,
  broadOrders: 1,
  directOrders: 1,
  broadUnits: 1,
  directUnits: 1,
  broadGmv: 98,
  directGmv: 98,
  expense: 21.89,
  ctr: 0.0516,
  broadCvr: 0.0278,
  directCvr: 0.0278,
  broadRoas: 4.48,
  directRoas: 4.48,
  addToCart: 2,
  addToCartRate: 2 / 36,
  costPerConversion: 21.89,
  costPerDirectConversion: 21.89,
  cpc: 21.89 / 36,
  broadAcos: 21.89 / 98,
  directAcos: 21.89 / 98,
};

function requiredPositiveInt(name) {
  const value = Number(process.env[name]);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function collectAtcValues(value, path = '$', out = []) {
  if (out.length >= 50 || value === null || value === undefined) return out;
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectAtcValues(item, `${path}[${index}]`, out));
    return out;
  }
  if (typeof value !== 'object') return out;

  const atcKeys = new Set(['add_to_cart', 'add_to_cart_num', 'add_to_cart_count', 'addToCart']);
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (atcKeys.has(key)) out.push({ path: childPath, value: child });
    collectAtcValues(child, childPath, out);
    if (out.length >= 50) break;
  }
  return out;
}

async function findStoredAtcCandidates(pool, { shopId, campaignId, itemId, eventDate }) {
  const itemRows = await pool.query(
    `SELECT raw_json
       FROM shopee_ad_item_daily
      WHERE shop_id=$1 AND campaign_id=$2 AND item_id=$3 AND event_date=$4::date`,
    [shopId, campaignId, itemId, eventDate],
  );

  const itemDaily = itemRows.rows.map((row, index) => ({
    source: `shopee_ad_item_daily[${index}]`,
    atcValues: collectAtcValues(row.raw_json),
  })).filter(row => row.atcValues.length > 0);

  const snapshots = await pool.query(
    `SELECT id, endpoint_key, event_date_from, event_date_to, synced_at, response_json
       FROM shopee_raw_api_snapshots
      WHERE shop_id=$1
        AND (event_date_from IS NULL OR event_date_from <= $2::date)
        AND (event_date_to IS NULL OR event_date_to >= $2::date)
        AND response_json::text LIKE $3
        AND (
          response_json::text ILIKE '%add_to_cart%'
          OR response_json::text ILIKE '%addToCart%'
        )
      ORDER BY synced_at DESC
      LIMIT 25`,
    [shopId, eventDate, `%${campaignId}%`],
  );

  const rawSnapshots = snapshots.rows.map(row => ({
    id: Number(row.id),
    endpointKey: row.endpoint_key,
    eventDateFrom: row.event_date_from,
    eventDateTo: row.event_date_to,
    syncedAt: row.synced_at,
    atcValues: collectAtcValues(row.response_json),
  })).filter(row => row.atcValues.length > 0);

  return { itemDaily, rawSnapshots };
}

async function main() {
  const shopId = requiredPositiveInt('SHOPEE_VERIFY_SHOP_ID');
  const pool = createAnalyticsPool();
  try {
    const campaigns = await listProductAdsSourceAccurate(pool, {
      shopId,
      startDate: EVENT_DATE,
      endDate: EVENT_DATE,
      adType: 'manual',
    });
    const campaign = campaigns.find(row => Number(row.campaignId) === CAMPAIGN_ID);
    if (!campaign) throw new Error(`M612 campaign ${CAMPAIGN_ID} not found for shop ${shopId}`);

    const reconciliation = evaluateProductAdCampaignReconciliation({
      actual: campaign.performance,
      expected: EXPECTED,
    });

    const atcCandidates = await findStoredAtcCandidates(pool, {
      shopId,
      campaignId: CAMPAIGN_ID,
      itemId: ITEM_ID,
      eventDate: EVENT_DATE,
    });

    const report = {
      purpose: 'M612_2026_09_21_READ_ONLY_RECONCILIATION',
      generatedAt: new Date().toISOString(),
      shopId,
      campaign: {
        campaignId: campaign.campaignId,
        adType: campaign.adType,
        normalized: campaign.campaignTypeNormalized,
        status: campaign.status,
        biddingMethod: campaign.biddingMethod,
        targetRoas: campaign.targetRoas,
        latestPerformanceDate: campaign.latestPerformanceDate,
      },
      reconciliation,
      storedAtcCandidates: atcCandidates,
      safety: {
        shopeeApiCalls: 0,
        syncCalls: 0,
        businessWrites: 0,
        databaseOperations: 'SELECT_ONLY',
      },
    };

    console.log(JSON.stringify(report, null, 2));
    if (reconciliation.status === 'FAIL') process.exitCode = 1;
    else if (reconciliation.status === 'INCOMPLETE') process.exitCode = 3;
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 2;
});
