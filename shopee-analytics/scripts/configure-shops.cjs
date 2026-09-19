'use strict';

const fs = require('fs');
const { createAnalyticsPool } = require('../src/pg');
const { ShopeeShopProfileRepository } = require('../src/shop-profile-repository');

function loadProfiles() {
  const inline = process.env.SHOPEE_SHOP_PROFILES_JSON;
  const file = process.env.SHOPEE_SHOP_PROFILES_FILE;
  if (!inline && !file) {
    throw new Error('Set SHOPEE_SHOP_PROFILES_JSON or SHOPEE_SHOP_PROFILES_FILE');
  }
  const raw = inline || fs.readFileSync(file, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || !parsed.length) throw new Error('Shop profiles must be a non-empty JSON array');
  return parsed;
}

async function main() {
  if (process.env.SHOPEE_ANALYTICS_CONFIGURE_SHOPS !== 'YES') {
    throw new Error('Refusing shop profile write. Set SHOPEE_ANALYTICS_CONFIGURE_SHOPS=YES explicitly.');
  }

  const pool = createAnalyticsPool();
  try {
    const repository = new ShopeeShopProfileRepository({ pool });
    const profiles = loadProfiles();
    const result = await repository.upsertMany(profiles);
    const listed = await repository.list({ activeOnly: false });
    console.log(JSON.stringify({
      ...result,
      shops: listed.map(shop => ({
        shopId: shop.shopId,
        displayName: shop.displayName,
        countryCode: shop.countryCode,
        brandCode: shop.brandCode,
        currency: shop.currency,
        timezone: shop.timezone,
        active: shop.active,
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
