'use strict';

const { encryptTokenBundle, decryptTokenBundle } = require('./token-crypto');

class ShopeeTokenRepository {
  constructor({ pool, masterKey }) {
    if (!pool || typeof pool.query !== 'function') throw new Error('pg pool/query adapter is required');
    if (!masterKey || masterKey.length !== 32) throw new Error('32-byte token master key is required');
    this.pool = pool;
    this.masterKey = masterKey;
  }

  async save({
    appRole,
    shopId,
    accessToken,
    refreshToken,
    expiresAt,
    lastRefreshAt = null,
    refreshError = null,
  }) {
    const encrypted = encryptTokenBundle({ accessToken, refreshToken }, this.masterKey);
    await this.pool.query(
      `INSERT INTO shopee_app_tokens
       (app_role, shop_id, token_blob, token_iv, token_tag, expires_at, last_refresh_at, refresh_error, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
       ON CONFLICT (app_role, shop_id) DO UPDATE SET
        token_blob=EXCLUDED.token_blob,
        token_iv=EXCLUDED.token_iv,
        token_tag=EXCLUDED.token_tag,
        expires_at=EXCLUDED.expires_at,
        last_refresh_at=EXCLUDED.last_refresh_at,
        refresh_error=EXCLUDED.refresh_error,
        updated_at=now()`,
      [
        appRole, shopId, encrypted.tokenBlob, encrypted.tokenIv, encrypted.tokenTag,
        expiresAt, lastRefreshAt, refreshError,
      ],
    );
  }

  async load({ appRole, shopId }) {
    const result = await this.pool.query(
      `SELECT token_blob, token_iv, token_tag, expires_at, last_refresh_at, refresh_error, updated_at
       FROM shopee_app_tokens
       WHERE app_role=$1 AND shop_id=$2`,
      [appRole, shopId],
    );
    const row = result.rows[0];
    if (!row) return null;
    const bundle = decryptTokenBundle({
      tokenBlob: row.token_blob,
      tokenIv: row.token_iv,
      tokenTag: row.token_tag,
    }, this.masterKey);
    return {
      ...bundle,
      expiresAt: new Date(row.expires_at),
      lastRefreshAt: row.last_refresh_at ? new Date(row.last_refresh_at) : null,
      refreshError: row.refresh_error,
      updatedAt: row.updated_at ? new Date(row.updated_at) : null,
    };
  }

  async markRefreshError({ appRole, shopId, error }) {
    await this.pool.query(
      `UPDATE shopee_app_tokens
       SET refresh_error=$3, updated_at=now()
       WHERE app_role=$1 AND shop_id=$2`,
      [appRole, shopId, String(error && error.message || error).slice(0, 2000)],
    );
  }
}

module.exports = { ShopeeTokenRepository };
