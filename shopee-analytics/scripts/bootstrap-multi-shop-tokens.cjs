'use strict';

const fs = require('fs');
const { createAnalyticsPool } = require('../src/pg');
const { APP_ENV, loadAppCredential } = require('../src/config');
const { loadMasterKey } = require('../src/token-crypto');
const { ShopeeTokenRepository } = require('../src/token-repository');
const { rolesForDeploymentMode, isPilotGmvMax, loadPilotGmvMaxConfig } = require('../src/deployment-mode');

function loadBundleFile() {
  const file = process.env.SHOPEE_MULTI_SHOP_TOKEN_FILE;
  if (!file) throw new Error('SHOPEE_MULTI_SHOP_TOKEN_FILE is required');
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(parsed) || !parsed.length) {
    throw new Error('Token bootstrap file must be a non-empty JSON array');
  }
  return { file, rows: parsed };
}

function normalizeToken(token, role, shopId) {
  if (!token || typeof token !== 'object') {
    throw new Error(`Missing ${role} token for shop ${shopId}`);
  }
  const accessToken = String(token.accessToken || '').trim();
  const refreshToken = String(token.refreshToken || '').trim();
  const expiresAt = new Date(token.expiresAt);
  if (!accessToken || !refreshToken) {
    throw new Error(`Incomplete ${role} token for shop ${shopId}`);
  }
  if (Number.isNaN(expiresAt.getTime())) {
    throw new Error(`Invalid ${role}.expiresAt for shop ${shopId}`);
  }
  return { accessToken, refreshToken, expiresAt };
}

async function main() {
  if (process.env.SHOPEE_ANALYTICS_BOOTSTRAP_MULTI_SHOP_TOKENS !== 'YES') {
    throw new Error(
      'Refusing multi-shop token bootstrap. Set SHOPEE_ANALYTICS_BOOTSTRAP_MULTI_SHOP_TOKENS=YES explicitly.',
    );
  }

  // Validate app credentials without ever logging their values.
  const rolesForMode = rolesForDeploymentMode();
  for (const role of rolesForMode) {
    loadAppCredential(role, { requireToken: false });
  }

  const { file, rows } = loadBundleFile();
  const pilotConfig = loadPilotGmvMaxConfig();
  if (isPilotGmvMax() && (rows.length !== 1 || Number(rows[0].shopId ?? rows[0].shop_id) !== pilotConfig.shopId)) {
    throw new Error('PILOT_GMV_MAX token bootstrap requires exactly the configured pilot shop');
  }
  const pool = createAnalyticsPool();
  const repository = new ShopeeTokenRepository({ pool, masterKey: loadMasterKey() });

  try {
    let bundleCount = 0;
    const shops = [];

    for (const row of rows) {
      const shopId = Number(row.shopId ?? row.shop_id);
      if (!Number.isSafeInteger(shopId) || shopId <= 0) {
        throw new Error('Every token row requires a positive shopId');
      }
      const roles = [];
      if (isPilotGmvMax() && Object.keys(row.tokens || {}).some(role => role !== 'ADS')) {
        throw new Error('PILOT_GMV_MAX token bootstrap accepts ADS token only');
      }
      for (const role of rolesForMode) {
        if (!row.tokens || !row.tokens[role]) continue;
        const token = normalizeToken(row.tokens[role], role, shopId);
        await repository.save({
          appRole: role,
          shopId,
          accessToken: token.accessToken,
          refreshToken: token.refreshToken,
          expiresAt: token.expiresAt,
        });
        bundleCount += 1;
        roles.push(role);
      }
      if (!roles.length) throw new Error(`Shop ${shopId} has no token bundles`);
      shops.push({ shopId, roles });
    }

    console.log(JSON.stringify({
      sourceFile: file,
      shopCount: shops.length,
      encryptedBundleCount: bundleCount,
      shops,
      reminder: 'No token value was printed. Delete the plaintext bootstrap file after verification.',
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
