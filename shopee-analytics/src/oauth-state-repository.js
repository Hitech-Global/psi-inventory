'use strict';

class ShopeeOAuthStateRepository {
  constructor({ pool }) {
    if (!pool || typeof pool.query !== 'function') throw new Error('pg pool/query adapter is required');
    this.pool = pool;
  }

  async create({ stateHash, appRole, expectedShopId, redirectUri, expiresAt }) {
    await this.pool.query(
      `INSERT INTO shopee_oauth_states
       (state_hash,app_role,expected_shop_id,redirect_uri,expires_at)
       VALUES ($1,$2,$3,$4,$5)`,
      [stateHash, appRole, expectedShopId, redirectUri, expiresAt],
    );
  }

  async findActive({ stateHash, now }) {
    const result = await this.pool.query(
      `SELECT state_hash,app_role,expected_shop_id,redirect_uri,created_at,expires_at,consumed_at
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
       RETURNING state_hash,app_role,expected_shop_id,redirect_uri,created_at,expires_at,consumed_at`,
      [stateHash, now],
    );
    return result.rows[0] || null;
  }
}

module.exports = { ShopeeOAuthStateRepository };
