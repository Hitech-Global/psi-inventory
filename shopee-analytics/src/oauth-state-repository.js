'use strict';

class ShopeeOAuthStateRepository {
  constructor({ pool }) {
    if (!pool || typeof pool.query !== 'function') throw new Error('pg pool/query adapter is required');
    this.pool = pool;
  }

  /**
   * Record an authorization in progress.
   *
   * When the reader is adding a shop that is not known yet, the details
   * they gave — where it trades, which brand it belongs to, what to call
   * it — travel with the request. The shop's own number is not known until
   * the code is exchanged, so it cannot be part of the request.
   */
  async create({
    stateHash,
    appRole,
    expectedShopId,
    redirectUri,
    expiresAt,
    registerMode = null,
    registerCountryCode = null,
    registerBrandCode = null,
    registerDisplayName = null,
  }) {
    await this.pool.query(
      `INSERT INTO shopee_oauth_states
       (state_hash,app_role,expected_shop_id,redirect_uri,expires_at,
        register_mode,register_country_code,register_brand_code,register_display_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        stateHash, appRole, expectedShopId, redirectUri, expiresAt,
        registerMode, registerCountryCode, registerBrandCode, registerDisplayName,
      ],
    );
  }

  async findActive({ stateHash, now }) {
    const result = await this.pool.query(
      `SELECT state_hash,app_role,expected_shop_id,redirect_uri,created_at,expires_at,consumed_at,
              register_mode,register_country_code,register_brand_code,register_display_name
       FROM shopee_oauth_states
       WHERE state_hash=$1 AND consumed_at IS NULL AND expires_at>$2`,
      [stateHash, now],
    );
    return result.rows[0] || null;
  }

  async consume({ stateHash, now }) {
    const result = await this.pool.query(
      `UPDATE shopee_oauth_states
       SET consumed_at=$2
       WHERE state_hash=$1 AND consumed_at IS NULL AND expires_at>$2
       RETURNING state_hash,app_role,expected_shop_id,redirect_uri,created_at,expires_at,consumed_at,
                 register_mode,register_country_code,register_brand_code,register_display_name`,
      [stateHash, now],
    );
    return result.rows[0] || null;
  }
}

module.exports = { ShopeeOAuthStateRepository };
