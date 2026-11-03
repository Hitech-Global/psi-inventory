'use strict';

/**
 * TikTok Shop 凭据自动刷新器。
 * ============================================================================================
 * 为什么需要它
 * ------------
 * Shop Open API 的 access_token 会过期（官方口径 7 天）。
 * 过期之后所有店铺级接口都会失败 —— 401 会让整轮同步颗粒无收，
 * 而这类故障往往在半夜发生，第二天才发现就白白损失一天的数据。
 * 所以必须有一个主动的刷新调度：扫 expires_at，快到期就换掉。
 *
 * 与 Shopee 侧刷新器（src/token-manager.js）的差异
 * -----------------------------------------------
 *   1. **refresh_token 会轮换**。刷新响应里带的是**新的** refresh_token，
 *      旧值立刻失效。因此刷新成功后必须同时覆盖 access_token 与 refresh_token，
 *      只更新 access_token 的话，下一次刷新必然失败，然后整条数据线永久失效。
 *      这是本模块最关键的一行代码（见 updateAfterRefresh 的调用处）。
 *   2. 刷新**失败时绝不能把 token 标成有效**。失败的刷新只记录错误信息，
 *      expires_at 保持原样 —— 宁可让下一轮再试一次，
 *      也不能把一个已经失效的凭据写成一个"看起来还新鲜"的状态。
 *   3. 刷新必须走**退避重试**。刷新端点也是限流敏感的，
 *      多个店铺同时刷新、多个进程同时刷新都会撞上限流。
 *      这里复用 src/rate-limit-retry.js（TikTok 侧已在用），不另造一套退避。
 *
 * 只读约束：本模块只刷新与保存凭据，不调用任何业务端点。
 */

const { withRateLimitRetry } = require('./rate-limit-retry');
const { sanitizeTikTokError } = require('./tiktok-token-repository');
const { refreshAccessTokenWithEndpoint } = require('./tiktok-oauth-service');

/** 刷新失败后的默认重试次数（含首次）。 */
const DEFAULT_MAX_ATTEMPTS = 3;

/** 刷新失败后的默认退避基数（毫秒）。 */
const DEFAULT_BASE_DELAY_MS = 1000;

/**
 * 读取 TikTok 的限流退避参数。
 *
 * 全部可选，未设置时返回 undefined，由 rate-limit-retry 使用默认值。
 * 提供环境变量是为了让高 QPS 多店铺场景可以在不重新构建镜像的情况下收紧或放宽退避。
 *
 * @param {object} [env]
 * @returns {object}
 */
function loadTikTokRateLimitRetryOptions(env = process.env) {
  const readOptionalNumber = (name) => {
    const raw = String(env[name] || '').trim();
    if (!raw) return undefined;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${name} must be a non-negative number`);
    }
    return value;
  };

  const options = {};
  const maxAttempts = readOptionalNumber('TIKTOK_RATE_LIMIT_MAX_ATTEMPTS');
  const baseDelayMs = readOptionalNumber('TIKTOK_RATE_LIMIT_BASE_DELAY_MS');
  const maxDelayMs = readOptionalNumber('TIKTOK_RATE_LIMIT_MAX_DELAY_MS');
  if (maxAttempts !== undefined) options.maxAttempts = maxAttempts;
  if (baseDelayMs !== undefined) options.baseDelayMs = baseDelayMs;
  if (maxDelayMs !== undefined) options.maxDelayMs = maxDelayMs;
  return options;
}

/**
 * TikTok 凭据刷新器。
 */
class TikTokTokenManager {
  constructor({
    tokenRepository,
    env = process.env,
    now = () => new Date(),
    fetchImpl = global.fetch,
    refreshSkewSeconds = 300,
    retryOptions = {},
    sleep = null,
  }) {
    if (!tokenRepository) throw new Error('tokenRepository is required');
    this.tokenRepository = tokenRepository;
    this.env = env;
    this.now = now;
    this.fetchImpl = fetchImpl;
    this.refreshSkewSeconds = refreshSkewSeconds;
    this.retryOptions = { ...retryOptions };
    this.sleep = sleep;
    // 同一个店铺的并发刷新必须合并成一次。
    // 两个并发刷新会用同一个旧 refresh_token 各换一次，
    // 而轮换意味着第一次换出来的旧值立刻作废 —— 第二次必然失败，
    // 还会把已经换好的新值覆盖成一个错的。所以这里做并发去重。
    this.inflight = new Map();
  }

  appKey() {
    const value = String(this.env.TIKTOK_APP_KEY || '').trim();
    if (!value) throw new Error('TIKTOK_APP_KEY is required');
    return value;
  }

  appSecret() {
    const value = String(this.env.TIKTOK_APP_SECRET || '').trim();
    if (!value) throw new Error('TIKTOK_APP_SECRET is required');
    return value;
  }

  regionGroup() {
    const value = String(this.env.TIKTOK_REGION_GROUP || 'ROW').trim().toUpperCase();
    if (value !== 'ROW' && value !== 'US') {
      throw new Error('TIKTOK_REGION_GROUP must be ROW or US');
    }
    return value;
  }

  /**
   * 判断某个凭据是否需要刷新。
   *
   * @param {object|null} token
   * @returns {boolean}
   */
  shouldRefresh(token) {
    if (!token || !token.expiresAt) return true;
    const expiresAt = token.expiresAt instanceof Date
      ? token.expiresAt.getTime()
      : new Date(token.expiresAt).getTime();
    if (!Number.isFinite(expiresAt)) return true;
    return expiresAt - this.now().getTime() <= this.refreshSkewSeconds * 1000;
  }

  /**
   * 拿一个可用于调用的 access_token，必要时先刷新。
   *
   * @param {object} options
   * @param {string} options.appKey
   * @param {string} options.regionGroup
   * @param {string} options.shopId
   * @returns {Promise<{accessToken: string, shopCipher: string, expiresAt: Date|null}>}
   */
  async getAccessToken({ appKey, regionGroup, shopId }) {
    if (!shopId) throw new Error('shopId is required');
    const token = await this.tokenRepository.load({ appKey, regionGroup, shopId });
    if (!token) {
      const error = new Error(`No TikTok credential stored for shop ${shopId}`);
      error.code = 'TIKTOK_CREDENTIAL_MISSING';
      throw error;
    }
    if (!this.shouldRefresh(token)) {
      return {
        accessToken: token.accessToken,
        shopCipher: token.shopCipher,
        expiresAt: token.expiresAt,
      };
    }
    return this.refresh({ appKey, regionGroup, shopId, currentToken: token });
  }

  /**
   * 刷新某个店铺的凭据。
   *
   * @param {object} options
   * @param {string} options.appKey
   * @param {string} options.regionGroup
   * @param {string} options.shopId
   * @param {object} [options.currentToken] 已读出的凭据（省一次读库）
   * @returns {Promise<{accessToken: string, shopCipher: string, expiresAt: Date}>}
   */
  async refresh({ appKey, regionGroup, shopId, currentToken = null }) {
    if (!shopId) throw new Error('shopId is required');
    const key = `${regionGroup}:${shopId}`;
    if (this.inflight.has(key)) return this.inflight.get(key);
    const promise = this._refresh({ appKey, regionGroup, shopId, currentToken })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
  }

  /**
   * 实际刷新。
   *
   * @param {object} options
   * @returns {Promise<{accessToken: string, shopCipher: string, expiresAt: Date}>}
   */
  async _refresh({ appKey, regionGroup, shopId, currentToken = null }) {
    const token = currentToken || await this.tokenRepository.load({ appKey, regionGroup, shopId });
    if (!token) {
      const error = new Error(`No TikTok credential stored for shop ${shopId}`);
      error.code = 'TIKTOK_CREDENTIAL_MISSING';
      throw error;
    }

    const refreshedAt = this.now();
    try {
      const payload = await this._requestRefresh({
        appKey,
        refreshToken: token.refreshToken,
      });

      // 平台给的过期时间缺失时，退回到 7 天 —— 与授权流程的兜底一致。
      const expiresIn = payload.expiresIn && payload.expiresIn > 0 ? payload.expiresIn : 7 * 24 * 3600;
      const expiresAt = new Date(refreshedAt.getTime() + expiresIn * 1000);

      // **关键**：refresh_token 会轮换，必须用新值覆盖旧值。
      // 只更新 access_token 的话，下一次刷新会用已作废的旧 refresh_token，必然失败。
      // 这里把 access_token 与 refresh_token 一起写进同一行 —— 密文是成对加密的，
      // 少写一个都解不开。
      await this.tokenRepository.updateAfterRefresh({
        appKey,
        regionGroup,
        shopId,
        accessToken: payload.accessToken,
        refreshToken: payload.refreshToken,
        expiresAt,
        lastRefreshAt: refreshedAt,
      });

      return {
        accessToken: payload.accessToken,
        shopCipher: token.shopCipher,
        expiresAt,
      };
    } catch (error) {
      // 失败时**只**记录错误：expires_at 保持原样（仍然是过期状态），
      // refresh_error 落库。绝不能在这里写入"看起来有效"的状态 ——
      // 一个被标成有效但实际已失效的凭据，会让后续每一次调用都得到 401，
      // 而错误信息会指向"权限问题"，把排查方向带偏。
      await this.tokenRepository.markRefreshError({
        appKey,
        regionGroup,
        shopId,
        error: sanitizeTikTokError(error),
      });
      throw error;
    }
  }

  /**
   * 调用刷新端点，带退避重试。
   *
   * 退避交给共享的 rate-limit-retry：它只对限流与 5xx 重试，
   * 4xx 业务错误（如 refresh_token 已作废）立刻失败 ——
   * 那类错误重试多少次都不会变好。
   *
   * @param {object} options
   * @returns {Promise<object>}
   */
  async _requestRefresh({ appKey, refreshToken }) {
    const appSecret = this.appSecret();
    const options = { ...this.retryOptions };
    if (this.sleep) options.sleep = this.sleep;
    return withRateLimitRetry(
      () => refreshAccessTokenWithEndpoint({
        appKey,
        appSecret,
        refreshToken,
        fetchImpl: this.fetchImpl,
      }),
      options,
    );
  }

  /**
   * 扫描并刷新所有临近过期的店铺。
   *
   * 单个店铺刷新失败**不中断整批**：一个店铺的 refresh_token 作废
   * （例如卖家撤销了授权）不该让其他店铺的凭据也得不到刷新。
   *
   * @param {object} [options]
   * @returns {Promise<{refreshed: Array<object>, failed: Array<object>}>}
   */
  async refreshExpiring(options = {}) {
    const appKey = options.appKey || this.appKey();
    const regionGroup = options.regionGroup || this.regionGroup();
    const marginSeconds = options.marginSeconds ?? this.refreshSkewSeconds;

    const expiring = await this.tokenRepository.listExpiring({
      appKey,
      regionGroup,
      marginSeconds,
      now: this.now().getTime(),
    });

    const refreshed = [];
    const failed = [];
    for (const candidate of expiring) {
      try {
        const result = await this.refresh({
          appKey,
          regionGroup,
          shopId: candidate.shopId,
        });
        refreshed.push({ shopId: candidate.shopId, expiresAt: result.expiresAt });
      } catch (error) {
        failed.push({
          shopId: candidate.shopId,
          error: error && error.message ? error.message : String(error),
        });
      }
    }
    return { refreshed, failed };
  }
}

module.exports = {
  DEFAULT_BASE_DELAY_MS,
  DEFAULT_MAX_ATTEMPTS,
  TikTokTokenManager,
  loadTikTokRateLimitRetryOptions,
};
