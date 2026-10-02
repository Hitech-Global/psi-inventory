'use strict';

const { createAnalyticsPool } = require('../src/pg');
const { ShopeeQueryRepository } = require('../src/query-repository');
const { buildSystemWarnings, evaluateItemCoverage } = require('../src/data-quality');
const { previousPeriod, diagnoseRow } = require('../src/portfolio-diagnosis');

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function positiveInt(value, name) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer`);
  return n;
}

function isoDate(value, name) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) {
    throw new Error(`${name} must be YYYY-MM-DD`);
  }
  return String(value);
}

async function main() {
  const shopId = positiveInt(required('SHOPEE_VALIDATION_SHOP_ID'), 'SHOPEE_VALIDATION_SHOP_ID');
  const startDate = isoDate(required('SHOPEE_VALIDATION_START_DATE'), 'SHOPEE_VALIDATION_START_DATE');
  const endDate = isoDate(required('SHOPEE_VALIDATION_END_DATE'), 'SHOPEE_VALIDATION_END_DATE');
  if (startDate > endDate) throw new Error('validation start date must be <= end date');

  const pool = createAnalyticsPool();
  try {
    const query = new ShopeeQueryRepository({ pool });
    const shops = await query.listShops({ activeOnly: false });
    const shop = shops.find(row => row.shopId === shopId);
    if (!shop) throw new Error(`Shop ${shopId} is not configured`);

    const previous = previousPeriod(startDate, endDate);
    const [currentOverview, previousOverview, campaigns, status, trend, skus] = await Promise.all([
      query.getPortfolioOverview({ startDate, endDate, shopIds: [shopId] }),
      query.getPortfolioOverview({
        startDate: previous.startDate,
        endDate: previous.endDate,
        shopIds: [shopId],
      }),
      query.listCampaignOverview({ shopId, startDate, endDate }),
      query.getSystemStatus({ shopId }),
      query.getShopDailyTrend({ shopId, startDate, endDate }),
      query.getShopSkuOverview({ shopId, startDate, endDate, limit: 200 }),
    ]);

    const current = currentOverview.shops[0] || null;
    const prior = previousOverview.shops[0] || null;
    const storeDiagnosis = current ? diagnoseRow(current, prior) : null;

    const campaignChecks = [];
    for (const campaign of campaigns) {
      const coverage = await query.getCampaignCoverageContext({
        shopId,
        campaignId: campaign.campaignId,
        startDate,
        endDate,
      });
      const quality = evaluateItemCoverage({
        campaignExpense: campaign.performance.expense,
        itemExpense: coverage.itemExpense,
        membershipCount: coverage.membershipCount,
        performanceItemCount: coverage.performanceItemCount,
      });
      campaignChecks.push({
        campaignId: campaign.campaignId,
        status: campaign.status,
        biddingMethod: campaign.biddingMethod,
        targetRoas: campaign.targetRoas,
        campaignBudget: campaign.campaignBudget,
        performance: campaign.performance,
        latestPerformanceDate: campaign.latestPerformanceDate,
        coverage: {
          ...coverage,
          ...quality,
        },
      });
    }

    const warnings = buildSystemWarnings(status);
    const report = {
      generatedAt: new Date().toISOString(),
      purpose: 'READ_ONLY_FIRST_LIVE_DATA_ACCEPTANCE',
      shop: {
        shopId: shop.shopId,
        displayName: shop.displayName,
        countryCode: shop.countryCode,
        brandCode: shop.brandCode,
        currency: shop.currency,
        timezone: shop.timezone,
        apiShopName: shop.apiShopName,
        apiRegion: shop.apiRegion,
        apiStatus: shop.apiStatus,
      },
      period: {
        startDate,
        endDate,
        previousStartDate: previous.startDate,
        previousEndDate: previous.endDate,
      },
      dataHealth: {
        ok: !warnings.some(row => row.severity === 'error'),
        warnings,
        sources: status.sources,
        tokens: status.tokens.map(row => ({
          appRole: row.appRole,
          expiresAt: row.expiresAt,
          lastRefreshAt: row.lastRefreshAt,
          refreshError: row.refreshError,
        })),
      },
      store: {
        current,
        previous: prior,
        diagnosis: storeDiagnosis,
        dailyRows: trend.length,
        skuRows: skus.length,
        productCardRows: skus.filter(row => row.hasProductCard).length,
      },
      campaigns: campaignChecks,
      acceptanceChecklist: [
        'Shop ID / region / shop name matches Seller Centre.',
        'Shop BI sales and orders match the same date range and timezone.',
        'Campaign spend, Broad orders, Broad GMV and ROAS match Seller Centre.',
        'Direct orders / Direct GMV match the advertised-item attribution view.',
        'Campaign membership count matches current group contents.',
        'Item-level spend sum is within expected coverage of campaign spend.',
        'Target ROAS and budget match current campaign settings.',
        'Voucher / Discount / Returns timestamps align with the selected shop timezone.',
        'Product Card import uses the exact same start/end dates before CVR comparison.',
      ],
    };

    console.log(JSON.stringify(report, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
