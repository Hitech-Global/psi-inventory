'use strict';

const { createAnalyticsPool } = require('../src/pg');
const { APP_ENV, loadAppCredential, loadBootstrapToken, loadShopId } = require('../src/config');
const { loadMasterKey } = require('../src/token-crypto');
const { ShopeeTokenRepository } = require('../src/token-repository');

async function main() {
  if (process.env.SHOPEE_ANALYTICS_BOOTSTRAP_TOKENS !== 'YES') {
    throw new Error('Refusing token bootstrap. Set SHOPEE_ANALYTICS_BOOTSTRAP_TOKENS=YES explicitly.');
  }

  const shopId = loadShopId();
  const pool = createAnalyticsPool();
  const repository = new ShopeeTokenRepository({ pool, masterKey: loadMasterKey() });

  try {
    const stored = [];
    for (const role of Object.keys(APP_ENV)) {
      loadAppCredential(role, { requireToken: false });
      const token = loadBootstrapToken(role);
      await repository.save({
        appRole: role,
        shopId,
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        expiresAt: token.expiresAt,
      });
      stored.push(role);
    }
    console.log(`Stored encrypted token bundles for: ${stored.join(', ')}`);
    console.log('No token value was printed. Remove bootstrap token env vars after verification.');
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
