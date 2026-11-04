'use strict';

/**
 * TikTok 店铺健康服务。
 * ============================================================================================
 * 调平台官方的 SPS 端点，把结果整理成可展示的健康结论。
 *
 * ★ 与 Shopee 的健康评估路线不同
 * ---------------------------------
 * Shopee 那边是我们自己定度量、自己比达标线；
 * TikTok 这边平台直接给了：
 *   overview → 总分、层级、同层级百分位、各维度得分、待改进问题
 *   metrics  → 每个指标的 benchmarks（优秀线/较差线）、score、status、原因
 *
 * 所以本服务**不做任何自己的阈值判断**，只负责：
 *   1. 调两个端点；
 *   2. 整理成统一结构；
 *   3. 交给评估模块生成结论。
 *
 * ★ 平台没给的指标就是没有
 *   不拿别的指标顶替，不自己算一个 —— 那是编造。
 */

const {
  buildSignals,
  normalizeMetrics,
  normalizeOverview,
  overallStatus,
} = require('./tiktok-health-evaluation');

/** 达人的健康端点需要 shop_cipher。 */

/**
 * TikTok 店铺健康服务。
 */
class TikTokHealthService {
  /**
   * @param {object} options
   * @param {object} options.client Shop Open API 客户端（要签名的那种）
   * @param {object} options.tokenRepository
   * @param {object} [options.env]
   */
  constructor({ client, tokenRepository, env = process.env }) {
    if (!client) throw new Error('client is required');
    if (!tokenRepository) throw new Error('tokenRepository is required');
    this.client = client;
    this.tokenRepository = tokenRepository;
    this.env = env;
  }

  /**
   * 读一个店铺的健康状况。
   *
   * @param {object} options
   * @param {string} options.regionGroup
   * @param {string} options.shopId
   * @param {string} options.shopCipher
   * @returns {Promise<object>}
   */
  async getShopHealth({ regionGroup = 'ROW', shopId, shopCipher }) {
    if (!shopId) throw new Error('shopId is required');
    if (!shopCipher) throw new Error('shopCipher is required: cipher and shop id are a pair');

    const credential = await this.tokenRepository.load({ regionGroup, shopId });
    if (!credential) {
      const error = new Error(`No TikTok Shop credential for shop ${shopId}`);
      error.code = 'TIKTOK_CREDENTIAL_MISSING';
      throw error;
    }

    // 两个端点都要 —— overview 给总分与问题，metrics 给各项指标与达标线。
    // 只有一个拿到也不算失败：能显示的部分照常显示。
    const [overviewResult, metricsResult] = await Promise.allSettled([
      this._fetchOverview({ accessToken: credential.accessToken, shopCipher }),
      this._fetchMetrics({ accessToken: credential.accessToken, shopCipher }),
    ]);

    const overview = overviewResult.status === 'fulfilled' ? overviewResult.value : null;
    const rawMetrics = metricsResult.status === 'fulfilled' ? metricsResult.value : [];

    const errors = [];
    if (overviewResult.status === 'rejected') {
      errors.push({ endpoint: 'overview', message: overviewResult.reason?.message || String(overviewResult.reason) });
    }
    if (metricsResult.status === 'rejected') {
      errors.push({ endpoint: 'metrics', message: metricsResult.reason?.message || String(metricsResult.reason) });
    }

    const normalizedOverview = normalizeOverview(overview || {});
    const normalizedMetrics = normalizeMetrics(rawMetrics);
    const status = overallStatus(normalizedMetrics);

    return {
      shopId,
      regionGroup,
      overview: normalizedOverview,
      metrics: normalizedMetrics,
      status,
      signals: buildSignals({ overview: normalizedOverview, metrics: normalizedMetrics }),
      errors,
    };
  }

  /**
   * 读 SPS 总览。
   *
   * @param {object} options
   * @returns {Promise<object>}
   */
  async _fetchOverview({ accessToken, shopCipher }) {
    const data = await this.client.request({
      path: '/analytics/202606/shop_performances/overview',
      accessToken,
      method: 'GET',
      requiresShopCipher: true,
      shopCipher,
    });
    return data || {};
  }

  /**
   * 读 SPS 指标明细。
   *
   * @param {object} options
   * @returns {Promise<Array<object>>}
   */
  async _fetchMetrics({ accessToken, shopCipher }) {
    const data = await this.client.request({
      path: '/analytics/202606/shop_performances/metrics',
      accessToken,
      method: 'GET',
      requiresShopCipher: true,
      shopCipher,
    });
    const metrics = (data && data.metrics) || [];
    return Array.isArray(metrics) ? metrics : [];
  }
}

module.exports = { TikTokHealthService };
