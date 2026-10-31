'use strict';

const fs = require('fs');
const path = require('path');
const { createAnalyticsPool } = require('../src/pg');
const {
  parseGmsSellerCentreFile,
  reconcileGmsCampaign,
} = require('../src/gms-seller-centre-reconciliation');

function positiveInt(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error(`${label} must be a positive integer`);
  return number;
}

function resolveArgs(argv = process.argv.slice(2), env = process.env) {
  const campaignId = positiveInt(argv[0] || env.GMS_VERIFY_CAMPAIGN_ID, 'campaignId');
  const filePath = String(argv[1] || env.GMS_SELLER_CENTRE_FILE || '').trim();
  if (!filePath) throw new Error('Seller Centre file path is required as argv[1] or GMS_SELLER_CENTRE_FILE');
  return { campaignId, filePath };
}

function statusCounts(rows) {
  return (rows || []).reduce((out, row) => {
    const key = row.status || 'UNKNOWN';
    out[key] = (out[key] || 0) + 1;
    return out;
  }, {});
}

async function main() {
  const { campaignId, filePath } = resolveArgs();
  const buffer = fs.readFileSync(filePath);
  const sellerReport = parseGmsSellerCentreFile({ buffer, filename: path.basename(filePath) });
  const pool = createAnalyticsPool();

  try {
    const campaignResult = await pool.query(
      `SELECT *
         FROM shopee_ad_campaign_daily
        WHERE shop_id=$1 AND campaign_id=$2 AND event_date=$3::date`,
      [sellerReport.shopId, campaignId, sellerReport.eventDate],
    );
    if (campaignResult.rowCount !== 1) {
      throw new Error(`Expected exactly one GMS campaign daily row; found ${campaignResult.rowCount}`);
    }

    const itemResult = await pool.query(
      `SELECT *
         FROM shopee_ad_item_daily
        WHERE shop_id=$1 AND campaign_id=$2 AND event_date=$3::date
        ORDER BY item_id`,
      [sellerReport.shopId, campaignId, sellerReport.eventDate],
    );

    const reconciliation = reconcileGmsCampaign({
      sellerReport,
      apiCampaign: campaignResult.rows[0],
      apiItems: itemResult.rows,
    });
    const failedItems = reconciliation.itemChecks
      .filter(row => row.status !== 'PASS')
      .map(row => ({
        itemId: row.itemId,
        productName: row.productName,
        status: row.status,
        failedOrUnavailable: row.checks.filter(check => check.status !== 'PASS'),
      }));

    const campaignRaw = campaignResult.rows[0].raw_json || null;
    const report = {
      purpose: 'GMS_SELLER_CENTRE_READ_ONLY_RECONCILIATION',
      generatedAt: new Date().toISOString(),
      shopId: sellerReport.shopId,
      campaignId,
      eventDate: sellerReport.eventDate,
      sellerCentre: {
        reportSource: sellerReport.reportSource,
        shopName: sellerReport.shopName,
        reportCreatedAt: sellerReport.reportCreatedAt,
        summary: sellerReport.summary,
        itemCount: sellerReport.items.length,
        childSumChecks: sellerReport.childSumChecks,
      },
      apiStored: {
        campaignSyncedAt: campaignResult.rows[0].synced_at,
        itemCount: itemResult.rowCount,
        campaignRaw,
      },
      reconciliation: {
        status: reconciliation.status,
        campaignStatusCounts: statusCounts(reconciliation.checks),
        campaignChecks: reconciliation.checks,
        itemCoverage: reconciliation.itemCoverage,
        itemStatusCounts: statusCounts(reconciliation.itemChecks),
        itemDirectGmvAggregate: reconciliation.itemDirectGmvAggregate,
        failedItems,
      },
      safety: {
        shopeeApiCalls: 0,
        syncCalls: 0,
        databaseWrites: 0,
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
