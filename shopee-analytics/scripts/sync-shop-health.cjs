'use strict';

/**
 * Fetch each shop's score and fulfilment now.
 *
 * The daily cycle collects these on its own, but waiting a cycle to see
 * whether a new connection works is a long wait. This does it at once.
 *
 *   node scripts/sync-shop-health.cjs [--shop 1326456001]
 */

const { createAnalyticsPool } = require('../src/pg');
const { createSyncRuntime } = require('../src/sync-runtime');
const { ShopeeShopProfileRepository } = require('../src/shop-profile-repository');
const { fetchShopHealth } = require('../src/sync-account-health');
const { fetchHealthEvents } = require('../src/sync-account-health-events');
const { localIsoDate } = require('../src/sync-cycle-utils');

function parseShopId(argv) {
  const index = argv.indexOf('--shop');
  if (index < 0) return null;
  const value = Number(argv[index + 1]);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('--shop needs a positive shop id');
  }
  return value;
}

async function main() {
  const only = parseShopId(process.argv.slice(2));
  const pool = createAnalyticsPool();
  try {
    const runtime = createSyncRuntime({ pool });
    const profiles = await new ShopeeShopProfileRepository({ pool }).list({ activeOnly: true });
    const shops = only ? profiles.filter(shop => shop.shopId === only) : profiles;
    if (!shops.length) {
      console.log(only ? `Shop ${only} is not configured.` : 'No shops are configured.');
      return;
    }
    if (!runtime.roleClients.ERP) {
      console.log('No ERP application is configured, so there is nothing to ask.');
      return;
    }
    const today = localIsoDate(new Date(), 'Asia/Jakarta');
    let fetched = 0;
    let skipped = 0;
    for (const shop of shops) {
      const hasToken = runtime.tokenRepository && typeof runtime.tokenRepository.exists === 'function'
        ? await runtime.tokenRepository.exists({ appRole: 'ERP', shopId: shop.shopId })
        : false;
      if (!hasToken) {
        console.log(`- ${shop.shopId} ${shop.displayName || ''}: skipped (no ERP connection)`);
        skipped += 1;
        continue;
      }
      try {
        const { client } = runtime.roleClients.ERP;
        const accessToken = await runtime.roleClients.ERP.getAccessToken(shop.shopId);
        const result = await fetchShopHealth({ client, shopId: shop.shopId, accessToken });
        await runtime.shopHealthRepository.upsertDaily({
          eventDate: today,
          health: { ...result.health, shopId: shop.shopId },
        });
        // The figures say a shop's cancellation rate is this; the detail
        // says which order was cancelled and why. Both are kept.
        const events = await fetchHealthEvents({
          client, shopId: shop.shopId, accessToken,
          metricKeys: Object.values(result.health.metricIds || {}),
        });
        if (events.events.length) {
          await runtime.shopHealthRepository.upsertEvents({
            eventDate: today,
            events: events.events.map(event => ({ ...event, shopId: shop.shopId })),
          });
        }
        const rating = result.health.shopRating;
        const refundRate = result.health.returnRefundRate;
        console.log(`- ${shop.shopId} ${shop.displayName || ''}: `
          + `rating ${rating ?? '—'}`
          + `${events.events.length ? `, 明细 ${events.events.length} 条` : ''}`
          + `${refundRate === null || refundRate === undefined ? '' : `, return rate ${(refundRate * 100).toFixed(2)}%`}`
          + `${result.health.csatRate === null || result.health.csatRate === undefined ? '' : `, csat ${(result.health.csatRate * 100).toFixed(1)}%`}`);
        fetched += 1;
      } catch (error) {
        console.log(`- ${shop.shopId} ${shop.displayName || ''}: failed — ${error.message}`);
        skipped += 1;
      }
    }
    console.log(`\nFetched ${fetched}, skipped ${skipped}.`);
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
