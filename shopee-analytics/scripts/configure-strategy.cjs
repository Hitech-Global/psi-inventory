'use strict';

const fs = require('fs');
const { createAnalyticsPool } = require('../src/pg');
const { ShopeeStrategyRepository } = require('../src/strategy-repository');

function loadConfig() {
  const file = process.env.SHOPEE_STRATEGY_CONFIG_FILE;
  const inline = process.env.SHOPEE_STRATEGY_CONFIG_JSON;
  if (!file && !inline) {
    throw new Error('Set SHOPEE_STRATEGY_CONFIG_FILE or SHOPEE_STRATEGY_CONFIG_JSON');
  }
  const raw = inline || fs.readFileSync(file, 'utf8');
  const rows = JSON.parse(raw);
  if (!Array.isArray(rows) || !rows.length) {
    throw new Error('Strategy config must be a non-empty JSON array');
  }
  return rows;
}

function normalize(row) {
  const shopId = Number(row.shopId ?? row.shop_id);
  if (!Number.isSafeInteger(shopId) || shopId <= 0) {
    throw new Error('Each strategy row requires a positive shopId');
  }

  const adSpendRatioLimit = Number(row.adSpendRatioLimit ?? row.ad_spend_ratio_limit ?? 0.15);
  if (!Number.isFinite(adSpendRatioLimit) || adSpendRatioLimit <= 0 || adSpendRatioLimit >= 1) {
    throw new Error(`Shop ${shopId}: adSpendRatioLimit must be between 0 and 1`);
  }

  const weeklyOrderReference = Number(row.weeklyOrderReference ?? row.weekly_order_reference ?? 25);
  if (!Number.isSafeInteger(weeklyOrderReference) || weeklyOrderReference <= 0) {
    throw new Error(`Shop ${shopId}: weeklyOrderReference must be a positive integer`);
  }

  return { shopId, adSpendRatioLimit, weeklyOrderReference };
}

async function main() {
  if (process.env.SHOPEE_ANALYTICS_CONFIGURE_STRATEGY !== 'YES') {
    throw new Error(
      'Refusing strategy write. Set SHOPEE_ANALYTICS_CONFIGURE_STRATEGY=YES explicitly.',
    );
  }

  const pool = createAnalyticsPool();
  try {
    const repository = new ShopeeStrategyRepository({ pool });
    const rows = loadConfig().map(normalize);
    for (const row of rows) await repository.upsertShopStrategy(row);

    console.log(JSON.stringify({
      configured: rows.length,
      shops: rows,
      note: 'Limits are shop-specific; no cross-store hardcoded 15% threshold is applied when stores differ.',
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
