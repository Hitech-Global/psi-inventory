'use strict';

/**
 * TikTok Marketing API 凭据存储。
 * ============================================================================================
 * 为什么与 Shop 凭据完全分开存
 * ------------------------------
 * 不是"为了整洁"，是**两套凭据的语义不同，混存会出事**：
 *
 *   - 身份维度不同：Shop 是 (app_key, region_group, shop_id)，
 *     Marketing 是 (app_id, advertiser_id)。一个广告主 token 可能覆盖多个广告账户，
 *     而一个卖家 token 也可能覆盖多个店铺 —— 但它们不是同一个东西。
 *   - 有效期不同：Shop token 7 天，Marketing token **24 小时**。
 *     放在同一张表里，刷新调度会把两个当成同一种节奏，
 *     结果是 Marketing token 总是过期，而 Shop token 被无谓地刷新。
 *   - 授权来源不同：Shop 是卖家授权，Marketing 是广告主授权。
 *     一个店铺可能没有对应的广告主（没投过广告），反之亦然。
 *
 * 所以独立一张表（tiktok_marketing_tokens），独立一套刷新调度。
 *
 * ★ 密文成对写入
 * access_token 与 refresh_token **一起加密、一起存**。
 * decryptTokenBundle 要求两个都在，缺一个就解不开 —— 这是故意的：
 * 半套凭据比没有凭据更危险（看起来能用，一调就 40001）。
 */

const { decryptTokenBundle, encryptTokenBundle, loadMasterKey } = require('./token-crypto');

/** Marketing token 的有效期：24 小时。 */
const MARKETING_TOKEN_TTL_SECONDS = 24 * 60 * 60;

/**
 * 提前多久刷新。
 *
 * 留出缓冲是因为同步任务本身要跑一会儿 —— token 在调用途中过期会让
 * 一整批数据白拉。提前 30 分钟刷新，留足余量。
 */
const MARKETING_TOKEN_REFRESH_MARGIN_SECONDS = 30 * 60;

/**
 * Marketing API 凭据存取。
 */
class TikTokMarketingTokenRepository {
  /**
   * @param {object} options
   * @param {object} options.pool
   * @param {Buffer} [options.masterKey] 32 字节主密钥；不给就从 env 取
   */
  constructor({ pool, masterKey = null }) {
    if (!pool || typeof pool.query !== 'function') throw new Error('pool is required');
    this.pool = pool;
    this.masterKey = masterKey || loadMasterKey(process.env);
  }

  /**
   * 保存（或更新）一个广告主的凭据。
   *
   * @param {object} options
   * @param {string} options.appId
   * @param {string} options.advertiserId
   * @param {string} options.accessToken
   * @param {string} options.refreshToken
   * @param {Date} options.expiresAt
   * @param {Date} [options.lastRefreshAt]
   * @returns {Promise<void>}
   */
  async save({
    appId,
    advertiserId,
    accessToken,
    refreshToken,
    expiresAt,
    lastRefreshAt = null,
  }) {
    if (!appId) throw new Error('appId is required');
    if (!advertiserId) throw new Error('advertiserId is required');
    if (!accessToken) throw new Error('accessToken is required');
    if (!refreshToken) throw new Error('refreshToken is required');
    if (!expiresAt) throw new Error('expiresAt is required');

    const encrypted = encryptTokenBundle({ accessToken, refreshToken }, this.masterKey);
    await this.pool.query(
      `INSERT INTO tiktok_marketing_tokens
       (app_id, advertiser_id, token_blob, token_iv, token_tag,
        expires_at, last_refresh_at, refresh_error, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,now())
       ON CONFLICT (app_id, advertiser_id) DO UPDATE SET
        token_blob=EXCLUDED.token_blob,
        token_iv=EXCLUDED.token_iv,
        token_tag=EXCLUDED.token_tag,
        expires_at=EXCLUDED.expires_at,
        last_refresh_at=EXCLUDED.last_refresh_at,
        refresh_error=NULL,
        updated_at=now()`,
      [
        appId, advertiserId,
        encrypted.tokenBlob, encrypted.tokenIv, encrypted.tokenTag,
        expiresAt, lastRefreshAt,
      ],
    );
  }

  /**
   * 读取一个广告主的凭据。
   *
   * @param {object} options
   * @param {string} options.appId
   * @param {string} options.advertiserId
   * @returns {Promise<object|null>}
   */
  async load({ appId, advertiserId }) {
    if (!appId) throw new Error('appId is required');
    if (!advertiserId) throw new Error('advertiserId is required');
    const result = await this.pool.query(
      `SELECT app_id AS "appId",
              advertiser_id AS "advertiserId",
              token_blob AS "tokenBlob",
              token_iv AS "tokenIv",
              token_tag AS "tokenTag",
              expires_at AS "expiresAt",
              last_refresh_at AS "lastRefreshAt",
              refresh_error AS "refreshError"
         FROM tiktok_marketing_tokens
        WHERE app_id = $1 AND advertiser_id = $2`,
      [appId, advertiserId],
    );
    const row = result.rows[0];
    if (!row) return null;

    let bundle;
    try {
      bundle = decryptTokenBundle(
        { tokenBlob: row.tokenBlob, tokenIv: row.tokenIv, tokenTag: row.tokenTag },
        this.masterKey,
      );
    } catch (error) {
      // 解不开说明密文与主密钥不匹配（例如换了 master key）。
      // 这时不能当成"没凭据"糊弄过去 —— 要让调用方知道凭据需要重新授权。
      const failure = new Error(
        `TikTok marketing credential for advertiser ${advertiserId} cannot be decrypted; `
        + 'it must be authorized again',
      );
      failure.code = 'TIKTOK_MARKETING_CREDENTIAL_UNREADABLE';
      failure.cause = error;
      throw failure;
    }

    return {
      appId: row.appId,
      advertiserId: row.advertiserId,
      accessToken: bundle.accessToken,
      refreshToken: bundle.refreshToken,
      expiresAt: row.expiresAt,
      lastRefreshAt: row.lastRefreshAt,
      refreshError: row.refreshError,
    };
  }

  /**
   * 列出某个 app 下所有已授权的广告主。
   *
   * @param {object} options
   * @param {string} options.appId
   * @returns {Promise<Array<object>>}
   */
  async listAdvertisers({ appId }) {
    if (!appId) throw new Error('appId is required');
    const result = await this.pool.query(
      `SELECT app_id AS "appId",
              advertiser_id AS "advertiserId",
              expires_at AS "expiresAt",
              last_refresh_at AS "lastRefreshAt",
              refresh_error AS "refreshError",
              updated_at AS "updatedAt"
         FROM tiktok_marketing_tokens
        WHERE app_id = $1
        ORDER BY advertiser_id`,
      [appId],
    );
    return result.rows.map(row => ({
      appId: row.appId,
      advertiserId: row.advertiserId,
      expiresAt: row.expiresAt,
      lastRefreshAt: row.lastRefreshAt,
      refreshError: row.refreshError,
      updatedAt: row.updatedAt,
    }));
  }

  /**
   * 列出临近过期的凭据 —— 刷新调度用它。
   *
   * @param {object} options
   * @param {string} options.appId
   * @param {number} [options.marginSeconds]
   * @param {number} [options.now]
   * @returns {Promise<Array<object>>}
   */
  async listExpiring({ appId, marginSeconds = MARKETING_TOKEN_REFRESH_MARGIN_SECONDS, now = Date.now() }) {
    if (!appId) throw new Error('appId is required');
    const threshold = new Date(now + marginSeconds * 1000);
    const result = await this.pool.query(
      `SELECT app_id AS "appId",
              advertiser_id AS "advertiserId",
              expires_at AS "expiresAt",
              last_refresh_at AS "lastRefreshAt"
         FROM tiktok_marketing_tokens
        WHERE app_id = $1 AND expires_at <= $2
        ORDER BY expires_at`,
      [appId, threshold],
    );
    return result.rows.map(row => ({
      appId: row.appId,
      advertiserId: row.advertiserId,
      expiresAt: row.expiresAt,
      lastRefreshAt: row.lastRefreshAt,
    }));
  }

  /**
   * 记录一次刷新失败。
   *
   * 只记错误，不动凭据 —— 覆盖掉还能用的凭据是更糟的结果。
   *
   * @param {object} options
   * @returns {Promise<void>}
   */
  async markRefreshError({ appId, advertiserId, error }) {
    if (!appId) throw new Error('appId is required');
    if (!advertiserId) throw new Error('advertiserId is required');
    const message = error && error.message ? String(error.message).slice(0, 500) : String(error || 'unknown error');
    await this.pool.query(
      `UPDATE tiktok_marketing_tokens
          SET refresh_error = $3, updated_at = now()
        WHERE app_id = $1 AND advertiser_id = $2`,
      [appId, advertiserId, message],
    );
  }
}

/**
 * 判断凭据是否已过期。
 *
 * 留 60 秒余量：token 在「还没过期但即将过期」时调用也可能被平台拒，
 * 那会让一整批同步白跑。
 *
 * @param {Date|string} expiresAt
 * @param {number} [now]
 * @param {number} [marginSeconds]
 * @returns {boolean}
 */
function isExpired(expiresAt, now = Date.now(), marginSeconds = 60) {
  if (!expiresAt) return true;
  const expires = expiresAt instanceof Date ? expiresAt.getTime() : new Date(expiresAt).getTime();
  if (!Number.isFinite(expires)) return true;
  return expires - marginSeconds * 1000 <= now;
}

module.exports = {
  MARKETING_TOKEN_REFRESH_MARGIN_SECONDS,
  MARKETING_TOKEN_TTL_SECONDS,
  TikTokMarketingTokenRepository,
  isExpired,
};
