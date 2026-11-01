'use strict';

/**
 * TikTok Shop 凭据存储。
 * ============================================================================================
 * 与 Shopee 的差异（src/token-repository.js）：
 *
 *   1. **标识是 (shop_id, shop_cipher) 二元组**，不是单独的 shop_id。
 *      一个 access token 可覆盖卖家名下多个店铺（跨境"一商卖全球"的直接结果），
 *      每店有自己的 cipher。官方要求 cipher 从 Get Authorized Shops 取得。
 *      → **只存 shop_id 会导致 cipher 串店**：请求打到 A 店却带着 B 店的 cipher，
 *        读到别的品牌的数据。这是本次接入里最高危的坑，因此：
 *        - 表结构上 cipher 与 shop_id 存在同一行，**成对写入、成对读取**；
 *        - 读取时校验 cipher 与 shop_id 的绑定关系，不匹配直接拒绝。
 *
 *   2. **Marketing API 的凭据域完全独立**。
 *      Marketing API 需要自己的 app_id/secret 与 advertiser OAuth token，
 *      与 Shop Open API 的凭据没有交集；token **24 小时过期**，
 *      所以刷新调度、过期判定、存储分区都要分开。
 *
 *   3. **refresh token 会轮换**：刷新后必须用新值覆盖旧值，
 *      旧值立即失效。存旧值会导致下次刷新失败并连锁失效。
 *
 * 只读约束：本模块只做凭据的存取，不发起任何业务请求。
 */

const { encryptTokenBundle, decryptTokenBundle } = require('./token-crypto');

/** Marketing API 的 token 有效期（秒）。官方口径为 24 小时。 */
const MARKETING_TOKEN_TTL_SECONDS = 24 * 60 * 60;

/**
 * Marketing API token 的过期余量（秒）。
 * 提前刷新，避免请求发出时刚好过期。
 */
const MARKETING_TOKEN_REFRESH_MARGIN_SECONDS = 60 * 60;

/**
 * Shop Open API token 的过期余量（秒）。
 * 与既有 Shopee 实现保持一致的提前量。
 */
const SHOP_TOKEN_REFRESH_MARGIN_SECONDS = 300;

/**
 * 判断 token 是否已过期或即将过期。
 *
 * @param {Date|string|number|null} expiresAt 过期时间
 * @param {number} marginSeconds 提前量
 * @param {number} [now] 当前时间戳（毫秒），便于测试注入
 * @returns {boolean}
 */
function isExpired(expiresAt, marginSeconds, now = Date.now()) {
  // 注意：不能用 !expiresAt 判空 —— 数字 0 是合法的时间戳（1970 年，确实已过期）。
  if (expiresAt === null || expiresAt === undefined || expiresAt === '') return true;
  const timestamp = expiresAt instanceof Date
    ? expiresAt.getTime()
    : (typeof expiresAt === 'number' ? expiresAt : new Date(expiresAt).getTime());
  if (!Number.isFinite(timestamp)) return true;
  return timestamp - marginSeconds * 1000 <= now;
}

/**
 * Shop Open API 凭据仓储。
 */
class TikTokTokenRepository {
  constructor({ pool, masterKey }) {
    if (!pool || typeof pool.query !== 'function') {
      throw new Error('pg pool/query adapter is required');
    }
    if (!masterKey || masterKey.length !== 32) {
      throw new Error('32-byte token master key is required');
    }
    this.pool = pool;
    this.masterKey = masterKey;
  }

  /**
   * 保存 Shop Open API 凭据。
   *
   * cipher 与 shop_id 必须同时提供 —— 二者是一体的，缺一不可。
   *
   * @param {object} options
   * @param {string} options.appKey      应用标识（同一区域组共用一套）
   * @param {string} options.regionGroup 区域组（ROW / US）
   * @param {string} options.shopId      店铺 ID
   * @param {string} options.shopCipher  店铺 cipher
   * @param {string} options.accessToken
   * @param {string} options.refreshToken
   * @param {Date}   options.expiresAt
   * @param {Date|null} [options.lastRefreshAt]
   * @param {string|null} [options.refreshError]
   * @param {string} [options.sellerType] LOCAL / CROSS_BORDER
   * @param {string} [options.region]    店铺所属区域
   */
  async save({
    appKey,
    regionGroup,
    shopId,
    shopCipher,
    accessToken,
    refreshToken,
    expiresAt,
    lastRefreshAt = null,
    refreshError = null,
    sellerType = null,
    region = null,
  }) {
    if (!appKey) throw new Error('appKey is required');
    if (!regionGroup) throw new Error('regionGroup is required');
    if (!shopId) throw new Error('shopId is required');
    if (!shopCipher) {
      throw new Error('shopCipher is required: cipher and shop id are a pair');
    }
    if (!accessToken) throw new Error('accessToken is required');
    if (!refreshToken) throw new Error('refreshToken is required');

    const encrypted = encryptTokenBundle({ accessToken, refreshToken }, this.masterKey);
    await this.pool.query(
      `INSERT INTO tiktok_shop_tokens
       (app_key, region_group, shop_id, shop_cipher, token_blob, token_iv, token_tag,
        expires_at, last_refresh_at, refresh_error, seller_type, region, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())
       ON CONFLICT (app_key, region_group, shop_id) DO UPDATE SET
        shop_cipher=EXCLUDED.shop_cipher,
        token_blob=EXCLUDED.token_blob,
        token_iv=EXCLUDED.token_iv,
        token_tag=EXCLUDED.token_tag,
        expires_at=EXCLUDED.expires_at,
        last_refresh_at=EXCLUDED.last_refresh_at,
        refresh_error=EXCLUDED.refresh_error,
        seller_type=EXCLUDED.seller_type,
        region=EXCLUDED.region,
        updated_at=now()`,
      [
        appKey, regionGroup, shopId, shopCipher,
        encrypted.tokenBlob, encrypted.tokenIv, encrypted.tokenTag,
        expiresAt, lastRefreshAt, refreshError, sellerType, region,
      ],
    );
  }

  /**
   * 读取 Shop Open API 凭据。
   *
   * @param {object} options
   * @param {string} options.appKey
   * @param {string} options.regionGroup
   * @param {string} options.shopId
   * @param {string} [options.expectedCipher] 若提供，校验取出的 cipher 与其一致
   * @returns {Promise<object|null>}
   */
  async load({ appKey, regionGroup, shopId, expectedCipher }) {
    const result = await this.pool.query(
      `SELECT shop_cipher, token_blob, token_iv, token_tag, expires_at,
              last_refresh_at, refresh_error, seller_type, region, updated_at
       FROM tiktok_shop_tokens
       WHERE app_key=$1 AND region_group=$2 AND shop_id=$3`,
      [appKey, regionGroup, shopId],
    );
    const row = result.rows[0];
    if (!row) return null;

    // 串店防护：调用方若声明了期望的 cipher，取出的必须一致。
    if (expectedCipher && row.shop_cipher !== expectedCipher) {
      const error = new Error('shop cipher does not match the stored binding');
      error.kind = 'SHOP_CIPHER_MISMATCH';
      throw error;
    }

    const bundle = decryptTokenBundle({
      tokenBlob: row.token_blob,
      tokenIv: row.token_iv,
      tokenTag: row.token_tag,
    }, this.masterKey);

    return {
      ...bundle,
      appKey,
      regionGroup,
      shopId: String(shopId),
      shopCipher: row.shop_cipher,
      sellerType: row.seller_type,
      region: row.region,
      expiresAt: row.expires_at ? new Date(row.expires_at) : null,
      lastRefreshAt: row.last_refresh_at ? new Date(row.last_refresh_at) : null,
      refreshError: row.refresh_error,
      updatedAt: row.updated_at ? new Date(row.updated_at) : null,
    };
  }

  /**
   * 列出某区域组下全部已授权店铺的台账（shop_id 与 cipher 的配对关系）。
   *
   * @param {object} options
   * @param {string} options.appKey
   * @param {string} options.regionGroup
   * @returns {Promise<Array<object>>}
   */
  async listShops({ appKey, regionGroup }) {
    const result = await this.pool.query(
      `SELECT shop_id, shop_cipher, seller_type, region, expires_at, updated_at
       FROM tiktok_shop_tokens
       WHERE app_key=$1 AND region_group=$2
       ORDER BY shop_id`,
      [appKey, regionGroup],
    );
    return result.rows.map(row => ({
      shopId: String(row.shop_id),
      shopCipher: row.shop_cipher,
      sellerType: row.seller_type,
      region: row.region,
      expiresAt: row.expires_at ? new Date(row.expires_at) : null,
      updatedAt: row.updated_at ? new Date(row.updated_at) : null,
    }));
  }

  /**
   * 标记刷新失败。
   */
  async markRefreshError({ appKey, regionGroup, shopId, error }) {
    await this.pool.query(
      `UPDATE tiktok_shop_tokens
       SET refresh_error=$4, updated_at=now()
       WHERE app_key=$1 AND region_group=$2 AND shop_id=$3`,
      [appKey, regionGroup, shopId, sanitizeTikTokError(error)],
    );
  }
}

/**
 * Marketing API 凭据仓储。
 *
 * 与 Shop API 凭据**完全分开存储**：不同的 app 体系、不同的过期节奏
 * （24 小时 vs Shopee 的数月）、不同的刷新流程。
 */
class TikTokMarketingTokenRepository {
  constructor({ pool, masterKey }) {
    if (!pool || typeof pool.query !== 'function') {
      throw new Error('pg pool/query adapter is required');
    }
    if (!masterKey || masterKey.length !== 32) {
      throw new Error('32-byte token master key is required');
    }
    this.pool = pool;
    this.masterKey = masterKey;
  }

  /**
   * 保存 advertiser 凭据。
   *
   * @param {object} options
   * @param {string} options.appId      Marketing API 的应用 ID（与 Shop API 的 app_key 不同）
   * @param {string} options.advertiserId 广告账户 ID
   * @param {string} options.accessToken
   * @param {string} options.refreshToken
   * @param {Date}   options.expiresAt
   * @param {Date|null} [options.lastRefreshAt]
   * @param {string|null} [options.refreshError]
   */
  async save({
    appId,
    advertiserId,
    accessToken,
    refreshToken,
    expiresAt,
    lastRefreshAt = null,
    refreshError = null,
  }) {
    if (!appId) throw new Error('appId is required');
    if (!advertiserId) throw new Error('advertiserId is required');
    if (!accessToken) throw new Error('accessToken is required');
    if (!refreshToken) throw new Error('refreshToken is required');

    const encrypted = encryptTokenBundle({ accessToken, refreshToken }, this.masterKey);
    await this.pool.query(
      `INSERT INTO tiktok_marketing_tokens
       (app_id, advertiser_id, token_blob, token_iv, token_tag,
        expires_at, last_refresh_at, refresh_error, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
       ON CONFLICT (app_id, advertiser_id) DO UPDATE SET
        token_blob=EXCLUDED.token_blob,
        token_iv=EXCLUDED.token_iv,
        token_tag=EXCLUDED.token_tag,
        expires_at=EXCLUDED.expires_at,
        last_refresh_at=EXCLUDED.last_refresh_at,
        refresh_error=EXCLUDED.refresh_error,
        updated_at=now()`,
      [
        appId, advertiserId,
        encrypted.tokenBlob, encrypted.tokenIv, encrypted.tokenTag,
        expiresAt, lastRefreshAt, refreshError,
      ],
    );
  }

  /**
   * 读取 advertiser 凭据。
   */
  async load({ appId, advertiserId }) {
    const result = await this.pool.query(
      `SELECT token_blob, token_iv, token_tag, expires_at, last_refresh_at, refresh_error, updated_at
       FROM tiktok_marketing_tokens
       WHERE app_id=$1 AND advertiser_id=$2`,
      [appId, advertiserId],
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
      appId,
      advertiserId: String(advertiserId),
      expiresAt: row.expires_at ? new Date(row.expires_at) : null,
      lastRefreshAt: row.last_refresh_at ? new Date(row.last_refresh_at) : null,
      refreshError: row.refresh_error,
      updatedAt: row.updated_at ? new Date(row.updated_at) : null,
    };
  }

  /**
   * 列出需要刷新的 advertiser 凭据。
   *
   * Marketing API 的 token 只有 24 小时有效，因此这个查询是刷新调度的入口。
   *
   * @param {object} options
   * @param {string} options.appId
   * @param {number} [options.marginSeconds] 提前量
   * @param {number} [options.now] 当前时间戳（毫秒），便于测试注入
   * @returns {Promise<Array<object>>}
   */
  async listExpiring({ appId, marginSeconds = MARKETING_TOKEN_REFRESH_MARGIN_SECONDS, now = Date.now() }) {
    const result = await this.pool.query(
      `SELECT advertiser_id, expires_at
       FROM tiktok_marketing_tokens
       WHERE app_id=$1 AND expires_at IS NOT NULL
       ORDER BY expires_at`,
      [appId],
    );
    return result.rows
      .filter(row => isExpired(row.expires_at, marginSeconds, now))
      .map(row => ({
        advertiserId: String(row.advertiser_id),
        expiresAt: row.expires_at ? new Date(row.expires_at) : null,
      }));
  }

  /**
   * 标记刷新失败。
   */
  async markRefreshError({ appId, advertiserId, error }) {
    await this.pool.query(
      `UPDATE tiktok_marketing_tokens
       SET refresh_error=$3, updated_at=now()
       WHERE app_id=$1 AND advertiser_id=$2`,
      [appId, advertiserId, sanitizeTikTokError(error)],
    );
  }
}

/**
 * 错误信息落库前脱敏。
 * TikTok 的错误描述里可能带上 shop_cipher 或 token，必须先脱敏。
 */
function sanitizeTikTokError(error) {
  const message = error && error.message ? error.message : String(error || '');
  return message
    .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(/((?:shop_cipher|app_secret|access_token|refresh_token|sign)\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .slice(0, 2000) || 'TIKTOK_OPERATION_FAILED';
}

module.exports = {
  MARKETING_TOKEN_REFRESH_MARGIN_SECONDS,
  MARKETING_TOKEN_TTL_SECONDS,
  SHOP_TOKEN_REFRESH_MARGIN_SECONDS,
  TikTokMarketingTokenRepository,
  TikTokTokenRepository,
  isExpired,
  sanitizeTikTokError,
};
