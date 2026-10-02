'use strict';

const fs = require('fs');
const { createAnalyticsPool } = require('../src/pg');
const { ShopeeStrategyRepository } = require('../src/strategy-repository');

function loadRows() {
  const file = process.env.SHOPEE_ITEM_STRATEGY_FILE;
  const inline = process.env.SHOPEE_ITEM_STRATEGY_JSON;
  if (!file && !inline) {
    throw new Error('Set SHOPEE_ITEM_STRATEGY_FILE or SHOPEE_ITEM_STRATEGY_JSON');
  }
  const raw = inline || fs.readFileSync(file, 'utf8');
  const rows = JSON.parse(raw);
  if (!Array.isArray(rows) || !rows.length) {
    throw new Error('Item strategy config must be a non-empty JSON array');
  }
  return rows;
}

function normalize(row) {
  const shopId = Number(row.shopId ?? row.shop_id);
  const itemId = Number(row.itemId ?? row.item_id);
  const breakEvenRoas = Number(row.breakEvenRoas ?? row.break_even_roas);
  if (!Number.isSafeInteger(shopId) || shopId <= 0) throw new Error('shopId must be a positive integer');
  if (!Number.isSafeInteger(itemId) || itemId <= 0) throw new Error('itemId must be a positive integer');
  if (!Number.isFinite(breakEvenRoas) || breakEvenRoas <= 0) {
    throw new Error(`Shop ${shopId} item ${itemId}: breakEvenRoas must be > 0`);
  }
  return {
    shopId,
    itemId,
    breakEvenRoas,
    note: row.note ?? null,
  };
}

async function main() {
  if (process.env.SHOPEE_ANALYTICS_CONFIGURE_ITEM_STRATEGY !== 'YES') {
    throw new Error(
      'Refusing item strategy write. Set SHOPEE_ANALYTICS_CONFIGURE_ITEM_STRATEGY=YES explicitly.',
    );
  }

  const pool = createAnalyticsPool();
  try {
    const repository = new ShopeeStrategyRepository({ pool });
    const rows = loadRows().map(normalize);
    for (const row of rows) await repository.upsertItemBreakEven(row);

    console.log(JSON.stringify({
      configured: rows.length,
      items: rows.map(row => ({
        shopId: row.shopId,
        itemId: row.itemId,
        breakEvenRoas: row.breakEvenRoas,
      })),
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
