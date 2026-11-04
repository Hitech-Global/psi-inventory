'use strict';

/**
 * TikTok 达人（创作者）数据。
 * ============================================================================================
 * 达人概览页的数据层。
 *
 * ★ 数据来源是 Shop Open API 的 Affiliate 端点，**不是** Marketing API：
 *   POST /affiliate_seller/202608/marketplace_creators/search  搜索达人
 *   GET  /affiliate_seller/202608/marketplace_creators/{id}     达人表现
 *   POST /affiliate_seller/202410/orders/search                 达人带来的订单
 *
 * 所以它走 x-tts-access-token 头、请求要签名 —— 与订单/商品那些端点一样。
 *
 * ★ 达人表现是平台给的快照，不是我们自己算的
 *   达人的 GMV 是「这个达人带来的成交」，GPM 是「每千次曝光的成交额」，
 *   两者都由平台计算并给出。我们只做展示与排序，不自己推算。
 *
 * ★ 达人规模差异极大
 *   粉丝数从几百到几百万都有，GMV 差距更大。所以**不能只看绝对值** ——
 *   页面同时给出 GPM（效率指标），让人能横向比较不同量级的达人。
 */

const { ATTRIBUTION_BASES, CHANNELS, PLATFORMS, SOURCES, createFact } = require('./platform-model');

/**
 * 判断一个数字是否有值。
 *
 * @param {*} value
 * @returns {boolean}
 */
function hasValue(value) {
  if (value === null || value === undefined || value === '') return false;
  const parsed = Number(value);
  return Number.isFinite(parsed);
}

/**
 * 取一个对象里的第一个有值的字段。
 *
 * @param {object} source
 * @param {Array<string>} names
 * @returns {number|null}
 */
function pickNumber(source = {}, names = []) {
  for (const name of names) {
    const value = source[name];
    if (hasValue(value)) return Number(value);
  }
  return null;
}

/**
 * 取一个字符串字段。
 *
 * @param {object} source
 * @param {Array<string>} names
 * @returns {string|null}
 */
function pickString(source = {}, names = []) {
  for (const name of names) {
    const value = source[name];
    if (value !== null && value !== undefined && value !== '') return String(value);
  }
  return null;
}

/**
 * 平台返回的金额对象形如 { currency, amount }。
 *
 * @param {object} source
 * @returns {{amount: number|null, currency: string|null}}
 */
function readMoney(source = {}) {
  if (!source || typeof source !== 'object') return { amount: null, currency: null };
  return {
    amount: hasValue(source.amount) ? Number(source.amount) : null,
    currency: pickString(source, ['currency']),
  };
}

/**
 * 把平台返回的达人对象整理成中性事实。
 *
 * @param {object} creator 平台的 creator 对象
 * @returns {object}
 */
function toCreatorFact(creator = {}) {
  const gmv = readMoney(creator.gmv);
  const videoGmv = readMoney(creator.video_gmv);
  const liveGmv = readMoney(creator.live_gmv);
  const gpm = readMoney(creator.gpm);

  return createFact({
    platform: PLATFORMS.TIKTOK,
    // ★ 达人带来的是**自然流量**成交（平台归因），不是广告付费。
    //   所以口径是 platform_attributed，来源是达人侧的 API。
    attributionBasis: ATTRIBUTION_BASES.PLATFORM_ATTRIBUTED,
    channel: CHANNELS.AFFILIATE,
    source: SOURCES.AFFILIATE_CREATOR,
    impressions: null,
    clicks: null,
    spend: null,
    orders: creator.units_sold ?? null,
    units: creator.units_sold ?? null,
    gmvOrderTotal: gmv.amount,
    gmvSubtotal: null,
    gmvSettled: null,
    refunds: null,
    cancellations: null,
    commission: null,
    shipping: null,
    currency: gmv.currency,
  });
}

/**
 * 把平台返回的达人列表整理成可展示的行。
 *
 * @param {object} creator
 * @returns {object}
 */
function toCreatorRow(creator = {}) {
  const gmv = readMoney(creator.gmv);
  const videoGmv = readMoney(creator.video_gmv);
  const liveGmv = readMoney(creator.live_gmv);
  const gpm = readMoney(creator.gpm);
  const liveGpm = readMoney(creator.live_gpm);
  const videoGpm = readMoney(creator.video_gpm);

  return {
    creatorUserId: pickString(creator, ['creator_user_id', 'creatorUserId', 'user_id']),
    username: pickString(creator, ['username']),
    nickname: pickString(creator, ['nickname']),
    avatarUrl: pickString(creator, ['avatar']) || (creator.avatar && creator.avatar.url) || null,
    selectionRegion: pickString(creator, ['selection_region']),
    bioDescription: pickString(creator, ['bio_description']),
    followerCount: pickNumber(creator, ['follower_count']),
    brandCollaborationCount: pickNumber(creator, ['brand_collaboration_count']),
    unitsSold: pickNumber(creator, ['units_sold']),
    currency: gmv.currency,
    gmv: gmv.amount,
    videoGmv: videoGmv.amount,
    liveGmv: liveGmv.amount,
    gpm: gpm.amount,
    liveGpm: liveGpm.amount,
    videoGpm: videoGpm.amount,
    ecLiveEngagementRate: pickNumber(creator, ['ec_live_engagement_rate']),
    // 达人的类目分布与内容分布 —— 用来回答「这个达人擅长卖什么」
    categoryGmvDistribution: creator.category_gmv_distribution || [],
    contentGmvDistribution: creator.content_gmv_distribution || [],
    topCollaboratedBrandIds: creator.top_collaborated_brand_ids || [],
  };
}

/**
 * 达人的事实与行的混合仓储。
 */
class TikTokCreatorRepository {
  /**
   * @param {object} options
   * @param {object} options.pool
   */
  constructor({ pool }) {
    if (!pool || typeof pool.query !== 'function') throw new Error('pool is required');
    this.pool = pool;
  }

  /**
   * 落库一批达人快照。
   *
   * @param {object} options
   * @returns {Promise<number>} 写入行数
   */
  async upsertCreatorDaily({ rows = [] }) {
    if (!rows.length) return 0;
    for (const row of rows) {
      if (!row.region_group) throw new Error('region_group is required');
      if (!row.shop_id) throw new Error('shop_id is required');
      if (!row.shop_cipher) throw new Error('shop_cipher is required');
      if (!row.creator_user_id) throw new Error('creator_user_id is required');
      if (!row.event_date) throw new Error('event_date is required');
    }

    for (const row of rows) {
      await this.pool.query(
        `INSERT INTO tiktok_creator_daily
         (region_group, shop_id, shop_cipher, creator_user_id, event_date,
          username, nickname, avatar_url, selection_region,
          follower_count, brand_collaboration_count, units_sold,
          currency, gmv, video_gmv, live_gmv, gpm, live_gpm, video_gpm,
          ec_live_engagement_rate, content_type, raw_json, synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,now())
         ON CONFLICT (region_group, shop_id, creator_user_id, event_date, currency) DO UPDATE SET
          username=EXCLUDED.username,
          nickname=EXCLUDED.nickname,
          avatar_url=EXCLUDED.avatar_url,
          selection_region=EXCLUDED.selection_region,
          follower_count=EXCLUDED.follower_count,
          brand_collaboration_count=EXCLUDED.brand_collaboration_count,
          units_sold=EXCLUDED.units_sold,
          gmv=EXCLUDED.gmv,
          video_gmv=EXCLUDED.video_gmv,
          live_gmv=EXCLUDED.live_gmv,
          gpm=EXCLUDED.gpm,
          live_gpm=EXCLUDED.live_gpm,
          video_gpm=EXCLUDED.video_gpm,
          ec_live_engagement_rate=EXCLUDED.ec_live_engagement_rate,
          content_type=EXCLUDED.content_type,
          raw_json=EXCLUDED.raw_json,
          synced_at=now()`,
        [
          row.region_group, row.shop_id, row.shop_cipher, row.creator_user_id, row.event_date,
          row.username, row.nickname, row.avatar_url, row.selection_region,
          row.follower_count, row.brand_collaboration_count, row.units_sold,
          row.currency, row.gmv, row.video_gmv, row.live_gmv, row.gpm, row.live_gpm, row.video_gpm,
          row.ec_live_engagement_rate, row.content_type, JSON.stringify(row.raw_json || {}),
        ],
      );
    }
    return rows.length;
  }

  /**
   * 读达人列表。
   *
   * ★ 取区间内**每个达人的最新一条** —— 达人表现是快照，
   *   一个区间内有多天的记录时，取最新那条才是"这个达人现在什么水平"。
   *
   * @param {object} options
   * @returns {Promise<Array<object>>}
   */
  async listCreators({ regionGroup, shopId, startDate, endDate, limit = 100 } = {}) {
    if (!regionGroup) throw new Error('regionGroup is required');
    if (!shopId) throw new Error('shopId is required');
    const result = await this.pool.query(
      `SELECT DISTINCT ON (creator_user_id)
              creator_user_id AS "creatorUserId",
              event_date AS "eventDate",
              username,
              nickname,
              avatar_url AS "avatarUrl",
              selection_region AS "selectionRegion",
              follower_count AS "followerCount",
              brand_collaboration_count AS "brandCollaborationCount",
              units_sold AS "unitsSold",
              currency,
              gmv,
              video_gmv AS "videoGmv",
              live_gmv AS "liveGmv",
              gpm,
              live_gpm AS "liveGpm",
              video_gpm AS "videoGpm",
              ec_live_engagement_rate AS "ecLiveEngagementRate",
              raw_json AS "rawJson"
         FROM tiktok_creator_daily
        WHERE region_group = $1
          AND shop_id = $2
          AND event_date BETWEEN $3 AND $4
        ORDER BY creator_user_id, event_date DESC
        LIMIT $5`,
      [regionGroup, String(shopId), startDate, endDate, limit],
    );
    return result.rows;
  }

  /**
   * 读达人的区间汇总。
   *
   * 用于概览卡片：区间内这个店总共通过达人带来了多少 GMV、多少销量。
   *
   * @param {object} options
   * @returns {Promise<object>}
   */
  async getCreatorSummary({ regionGroup, shopId, startDate, endDate } = {}) {
    if (!regionGroup) throw new Error('regionGroup is required');
    if (!shopId) throw new Error('shopId is required');
    const result = await this.pool.query(
      `SELECT COUNT(DISTINCT creator_user_id) AS "creatorCount",
              SUM(gmv) AS gmv,
              SUM(units_sold) AS "unitsSold",
              SUM(follower_count) AS "followerCount"
         FROM tiktok_creator_daily
        WHERE region_group = $1
          AND shop_id = $2
          AND event_date BETWEEN $3 AND $4
          AND event_date = (
            SELECT MAX(d2.event_date) FROM tiktok_creator_daily d2
             WHERE d2.region_group = tiktok_creator_daily.region_group
               AND d2.shop_id = tiktok_creator_daily.shop_id
               AND d2.creator_user_id = tiktok_creator_daily.creator_user_id
               AND d2.event_date BETWEEN $3 AND $4
          )`,
      [regionGroup, String(shopId), startDate, endDate],
    );
    const row = result.rows[0] || {};
    return {
      creatorCount: row.creatorCount ?? 0,
      gmv: row.gmv ?? null,
      unitsSold: row.unitsSold ?? null,
      followerCount: row.followerCount ?? null,
    };
  }
}

/**
 * 达人同步器。
 *
 * 流程：先搜出达人列表，再逐个取表现。
 * 逐个取是因为 performance 端点是按 creator_user_id 查的，没有批量接口。
 */
class TikTokCreatorSyncRunner {
  /**
   * @param {object} options
   * @param {object} options.pool
   * @param {object} options.creatorRepository
   * @param {object} options.client Shop Open API 客户端（要签名的那种）
   * @param {object} options.tokenRepository
   * @param {Function} [options.now]
   */
  constructor({
    pool,
    creatorRepository,
    client,
    tokenRepository,
    now = () => new Date(),
  }) {
    if (!pool) throw new Error('pool is required');
    if (!creatorRepository) throw new Error('creatorRepository is required');
    if (!client) throw new Error('client is required');
    if (!tokenRepository) throw new Error('tokenRepository is required');
    this.pool = pool;
    this.creatorRepository = creatorRepository;
    this.client = client;
    this.tokenRepository = tokenRepository;
    this.now = now;
  }

  /**
   * 同步一个店铺的达人数据。
   *
   * @param {object} options
   * @returns {Promise<object>} 同步摘要
   */
  async syncShop({ regionGroup = 'ROW', shopId, shopCipher, startDate, endDate, creatorLimit = 50 }) {
    if (!shopId) throw new Error('shopId is required');
    if (!shopCipher) throw new Error('shopCipher is required: cipher and shop id are a pair');

    const credential = await this.tokenRepository.load({ regionGroup, shopId });
    if (!credential) {
      const error = new Error(`No TikTok Shop credential for shop ${shopId}`);
      error.code = 'TIKTOK_CREDENTIAL_MISSING';
      throw error;
    }

    const summary = { shopId, searched: 0, fetched: 0, written: 0, errors: [] };

    // 1) 搜达人
    let creators = [];
    try {
      creators = await this._searchCreators({
        accessToken: credential.accessToken,
        shopCipher,
        limit: creatorLimit,
      });
      summary.searched = creators.length;
    } catch (error) {
      summary.errors.push({ stage: 'search', message: error.message });
      return summary;
    }

    // 2) 逐个取表现
    const eventDate = this.now().toISOString().slice(0, 10);
    const rows = [];
    for (const creator of creators) {
      const creatorUserId = creator.creatorUserId || creator.creator_user_id;
      if (!creatorUserId) continue;
      try {
        const detail = await this._fetchCreatorPerformance({
          accessToken: credential.accessToken,
          shopCipher,
          creatorUserId,
        });
        summary.fetched += 1;
        const row = toCreatorRow(detail || {});
        rows.push({
          region_group: regionGroup,
          shop_id: String(shopId),
          shop_cipher: shopCipher,
          creator_user_id: String(creatorUserId),
          event_date: eventDate,
          username: row.username,
          nickname: row.nickname,
          avatar_url: row.avatarUrl,
          selection_region: row.selectionRegion,
          follower_count: row.followerCount,
          brand_collaboration_count: row.brandCollaborationCount,
          units_sold: row.unitsSold,
          currency: row.currency || 'UNKNOWN',
          gmv: row.gmv,
          video_gmv: row.videoGmv,
          live_gmv: row.liveGmv,
          gpm: row.gpm,
          live_gpm: row.liveGpm,
          video_gpm: row.videoGpm,
          ec_live_engagement_rate: row.ecLiveEngagementRate,
          content_type: null,
          raw_json: detail || {},
        });
      } catch (error) {
        // 单个达人失败不影响其它达人 —— 一个达人被封/被删是常事。
        summary.errors.push({ stage: 'performance', creatorUserId, message: error.message });
      }
    }

    summary.written = await this.creatorRepository.upsertCreatorDaily({ rows });
    return summary;
  }

  /**
   * 搜索达人。
   *
   * @param {object} options
   * @returns {Promise<Array<object>>}
   */
  async _searchCreators({ accessToken, shopCipher, limit }) {
    const rows = [];
    let pageToken = null;
    for (let guard = 0; guard < 20; guard += 1) {
      const data = await this.client.request({
        path: '/affiliate_seller/202608/marketplace_creators/search',
        accessToken,
        method: 'POST',
        query: { page_size: Math.min(limit, 100) },
        body: {
          ...(pageToken ? { page_token: pageToken } : {}),
          data_groups: ['BASIC_CREATOR_INFORMATION'],
        },
        requiresShopCipher: true,
        shopCipher,
      });
      const list = (data && (data.creators || data.list)) || [];
      rows.push(...list);
      pageToken = data && data.page_token ? data.page_token : (data.next_page_token || null);
      if (!pageToken || !list.length || rows.length >= limit) break;
    }
    return rows.slice(0, limit);
  }

  /**
   * 取单个达人的表现。
   *
   * @param {object} options
   * @returns {Promise<object>}
   */
  async _fetchCreatorPerformance({ accessToken, shopCipher, creatorUserId }) {
    const data = await this.client.request({
      path: `/affiliate_seller/202608/marketplace_creators/${encodeURIComponent(creatorUserId)}`,
      accessToken,
      method: 'GET',
      query: {
        data_groups: [
          'BASIC_CREATOR_INFORMATION',
          'CONTENT_PERFORMANCE',
          'COLLABORATION',
          'SALES_AND_GMV',
        ],
      },
      requiresShopCipher: true,
      shopCipher,
    });
    return (data && data.creator) ? data.creator : (data || {});
  }
}

module.exports = {
  TikTokCreatorRepository,
  TikTokCreatorSyncRunner,
  hasValue,
  pickNumber,
  pickString,
  readMoney,
  toCreatorFact,
  toCreatorRow,
};
