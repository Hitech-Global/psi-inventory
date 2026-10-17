'use strict';
const fs = require('fs');
const { createAnalyticsPool } = require('../src/pg');
const { loadMasterKey } = require('../src/token-crypto');
const { loadAppCredential } = require('../src/config');
const { ShopeeTokenRepository } = require('../src/token-repository');

function positiveId(value, name) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`${name} must be a positive integer`);
  return id;
}

function loadBundle() {
  const file = process.env.SHOPEE_BRAND_PORTAL_TOKEN_FILE;
  if (!file) throw new Error('SHOPEE_BRAND_PORTAL_TOKEN_FILE is required');
  const row = JSON.parse(fs.readFileSync(file, 'utf8'));
  const principalId = positiveId(row.principalId ?? row.principal_id, 'principalId');
  const accessToken = String(row.accessToken ?? row.access_token ?? '').trim();
  const refreshToken = String(row.refreshToken ?? row.refresh_token ?? '').trim();
  const expiresAt = new Date(row.expiresAt ?? row.expires_at);
  const shopIds = [...new Set((row.shopIds ?? row.shop_ids ?? []).map(value => positiveId(value, 'shopId')))];
  if (!accessToken || !refreshToken) throw new Error('Brand Portal accessToken and refreshToken are required');
  if (Number.isNaN(expiresAt.getTime())) throw new Error('Brand Portal expiresAt is invalid');
  if (!shopIds.length) throw new Error('At least one shopId mapping is required');
  return { file, principalId, accessToken, refreshToken, expiresAt, shopIds };
}

async function main() {
  if (process.env.SHOPEE_ANALYTICS_BOOTSTRAP_BRAND_PORTAL !== 'YES') {
    throw new Error('Refusing Brand Portal bootstrap. Set SHOPEE_ANALYTICS_BOOTSTRAP_BRAND_PORTAL=YES explicitly.');
  }
  loadAppCredential('BRAND_PORTAL', { requireToken: false });
  const bundle = loadBundle();
  const pool = createAnalyticsPool();
  const tokens = new ShopeeTokenRepository({ pool, masterKey: loadMasterKey() });
  try {
    await pool.query('BEGIN');
    try {
      // Compatibility note: shopee_app_tokens.shop_id stores the authorization subject id.
      // For BRAND_PORTAL that subject is principal_id, not a seller shop_id.
      await tokens.save({
        appRole: 'BRAND_PORTAL', shopId: bundle.principalId,
        accessToken: bundle.accessToken, refreshToken: bundle.refreshToken, expiresAt: bundle.expiresAt,
      });
      const mapped = await pool.query(
        `UPDATE shopee_shop_profiles
         SET brand_portal_principal_id=$1,updated_at=now()
         WHERE shop_id=ANY($2::bigint[])
         RETURNING shop_id`,
        [bundle.principalId, bundle.shopIds],
      );
      if (mapped.rows.length !== bundle.shopIds.length) {
        throw new Error(`Only ${mapped.rows.length}/${bundle.shopIds.length} requested shops exist in shopee_shop_profiles`);
      }
      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
    console.log(JSON.stringify({
      ok: true,
      principalId: bundle.principalId,
      mappedShopIds: bundle.shopIds,
      tokenStoredEncrypted: true,
      reminder: 'No token value was printed. Delete the plaintext bootstrap file after verification.',
    }, null, 2));
  } finally { await pool.end(); }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { positiveId, loadBundle };
