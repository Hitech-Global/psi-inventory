'use strict';

const { fetchCampaignIds, fetchCampaignSettings } = require('./sync-campaigns');
const { fetchProductCampaignDailyPerformance, campaignFamilyForAdType } = require('./sync-product-ads');
const { fetchItemList, fetchItemBaseInfo, fetchModelList } = require('./sync-product');
const { fetchRecommendedRoi } = require('./sync-roi');
const { fetchAllVoucherDetails } = require('./sync-voucher');
const { fetchAllDiscountDetails } = require('./sync-discount');
const { fetchOrderList, fetchOrderDetails } = require('./sync-orders');
const { fetchAllReturnDetails } = require('./sync-returns');
const { fetchShopBiDay } = require('./sync-shop-bi');
const { fetchShopHealth } = require('./sync-account-health');
const { fetchShopTraffic, fetchProductTraffic } = require('./sync-business-insights');
const { fetchVideoOverview, fetchVideoList } = require('./sync-video');
const { fetchLiveSessions } = require('./sync-livestream');
const { fetchHealthEvents } = require('./sync-account-health-events');
const { fetchShopLivestreamDay } = require('./sync-shop-livestream');
const { fetchShopInfo } = require('./sync-shop');
const { recordPages, recordSnapshot } = require('./raw-snapshot');

function requireRole(roleClients, role) {
  const entry = roleClients && roleClients[role];
  if (!entry || !entry.client) throw new Error(`Missing configured Shopee role client: ${role}`);
  return entry;
}

async function resolveRole(roleClients, role, shopId) {
  const entry = requireRole(roleClients, role);
  const accessToken = typeof entry.getAccessToken === 'function'
    ? await entry.getAccessToken(shopId)
    : entry.accessToken;
  if (!accessToken) throw new Error(`Missing access token for Shopee role: ${role}`);
  return { client: entry.client, accessToken };
}

class ShopeeSyncService {
  constructor({
    shopId,
    roleClients,
    rawRepository,
    campaignRepository,
    productRepository,
    promotionRepository,
    orderRepository,
    returnRepository,
    shopBiRepository,
    shopLivestreamRepository,
    shopHealthRepository,
    videoRepository,
    livestreamRepository,
    shopRepository,
  }) {
    this.shopId = shopId;
    this.roleClients = roleClients;
    this.rawRepository = rawRepository;
    this.campaignRepository = campaignRepository;
    this.productRepository = productRepository;
    this.promotionRepository = promotionRepository;
    this.orderRepository = orderRepository;
    this.returnRepository = returnRepository;
    this.shopBiRepository = shopBiRepository;
    this.shopLivestreamRepository = shopLivestreamRepository;
    this.shopHealthRepository = shopHealthRepository;
    this.videoRepository = videoRepository;
    this.livestreamRepository = livestreamRepository;
    this.shopRepository = shopRepository;
  }

  async syncShopInfo() {
    const { client, accessToken } = await resolveRole(this.roleClients, 'ADS', this.shopId);
    const result = await fetchShopInfo({
      client,
      shopId: this.shopId,
      accessToken,
    });
    await recordSnapshot({
      repository: this.rawRepository,
      appRole: 'ADS',
      endpointKey: 'shopInfo',
      shopId: this.shopId,
      requestJson: {},
      responseJson: result.payload,
    });
    if (this.shopRepository) {
      await this.shopRepository.upsert({
        requestedShopId: this.shopId,
        shop: result.shop,
      });
    }
    return {
      shopId: result.shop.shopId || this.shopId,
      shopName: result.shop.shopName,
      region: result.shop.region,
      status: result.shop.status,
    };
  }

  async syncCampaignSettings({ eventDate = new Date().toISOString().slice(0, 10), adType = 'all', campaignIds: requestedCampaignIds = null } = {}) {
    const { client, accessToken } = await resolveRole(this.roleClients, 'ADS', this.shopId);
    const suppliedIds = Array.isArray(requestedCampaignIds)
      ? Array.from(new Set(requestedCampaignIds.map(Number).filter(Number.isSafeInteger)))
      : null;
    let campaignIds = suppliedIds;
    if (!campaignIds) {
      const list = await fetchCampaignIds({
        client, shopId: this.shopId, accessToken, adType,
      });
      await recordPages({
        repository: this.rawRepository,
        appRole: 'ADS',
        endpointKey: 'adsCampaignIds',
        shopId: this.shopId,
        pages: list.rawPages,
      });
      campaignIds = list.rows.map(row => row.campaignId);
    }
    const settings = await fetchCampaignSettings({
      client, shopId: this.shopId, accessToken, campaignIds,
    });
    await recordPages({
      repository: this.rawRepository,
      appRole: 'ADS',
      endpointKey: 'adsCampaignSettings',
      shopId: this.shopId,
      pages: settings.rawPages,
    });

    if (this.campaignRepository) {
      await this.campaignRepository.saveCampaignSettingsSnapshot({
        shopId: this.shopId,
        eventDate,
        settings: settings.rows,
      });
    }
    return { campaignCount: campaignIds.length, settingsCount: settings.rows.length };
  }

  async syncProductAdsDaily({
    startDate,
    endDate,
    adTypes = ['manual', 'auto'],
    includeSettings = true,
  } = {}) {
    if (!startDate || !endDate) throw new Error('startDate and endDate are required');
    const requestedTypes = Array.from(new Set((adTypes || []).map(value => String(value || '').toLowerCase())));
    if (!requestedTypes.length || requestedTypes.some(value => !['manual', 'auto'].includes(value))) {
      throw new Error('adTypes must contain manual and/or auto');
    }

    const { client, accessToken } = await resolveRole(this.roleClients, 'ADS', this.shopId);
    const summary = { campaignCount: 0, dailyRowCount: 0, byType: {} };

    for (const adType of requestedTypes) {
      const list = await fetchCampaignIds({ client, shopId: this.shopId, accessToken, adType });
      await recordPages({
        repository: this.rawRepository,
        appRole: 'ADS',
        endpointKey: `adsCampaignIds:${adType}`,
        shopId: this.shopId,
        pages: list.rawPages,
      });

      const campaignIds = list.rows
        .filter(row => String(row.adType || '').toLowerCase() === adType)
        .map(row => Number(row.campaignId))
        .filter(Number.isSafeInteger);

      if (this.rawRepository && typeof this.rawRepository.upsertCampaign === 'function') {
        for (const campaignId of campaignIds) {
          await this.rawRepository.upsertCampaign({
            shopId: this.shopId,
            campaignId,
            adType,
            campaignTypeRaw: 'PRODUCT_AD',
            campaignTypeNormalized: campaignFamilyForAdType(adType),
          });
        }
      }

      let settings = { rows: [], rawPages: [] };
      if (includeSettings) {
        settings = await fetchCampaignSettings({
          client, shopId: this.shopId, accessToken, campaignIds,
        });
        await recordPages({
          repository: this.rawRepository,
          appRole: 'ADS',
          endpointKey: `adsCampaignSettings:${adType}`,
          shopId: this.shopId,
          pages: settings.rawPages,
        });
        if (this.campaignRepository) {
          await this.campaignRepository.saveCampaignSettingsSnapshot({
            shopId: this.shopId,
            eventDate: endDate,
            settings: settings.rows,
          });
        }
      }

      const daily = await fetchProductCampaignDailyPerformance({
        client,
        shopId: this.shopId,
        accessToken,
        campaignIds,
        startDate,
        endDate,
      });
      await recordPages({
        repository: this.rawRepository,
        appRole: 'ADS',
        endpointKey: `adsDailyPerformance:${adType}`,
        shopId: this.shopId,
        pages: daily.rawPages,
      });

      for (const row of daily.rows) {
        if (!this.rawRepository) continue;
        await this.rawRepository.upsertCampaign({
          shopId: this.shopId,
          campaignId: row.campaignId,
          adType: row.adType,
          campaignTypeRaw: 'PRODUCT_AD',
          campaignTypeNormalized: campaignFamilyForAdType(row.adType),
        });
        await this.rawRepository.upsertCampaignDaily({
          shopId: this.shopId,
          campaignId: row.campaignId,
          eventDate: row.eventDate,
          performance: row.performance,
          rawJson: row.raw,
        });
      }

      summary.campaignCount += campaignIds.length;
      summary.dailyRowCount += daily.rows.length;
      summary.byType[adType] = {
        campaignCount: campaignIds.length,
        settingCount: settings.rows.length,
        dailyRowCount: daily.rows.length,
      };
    }
    return summary;
  }

  async syncProducts({
    itemStatus = ['NORMAL'],
    updateTimeFrom,
    updateTimeTo,
    includeModels = true,
  } = {}) {
    const { client, accessToken } = await resolveRole(this.roleClients, 'ADS', this.shopId);
    const list = await fetchItemList({
      client, shopId: this.shopId, accessToken,
      itemStatus, updateTimeFrom, updateTimeTo,
    });
    await recordPages({
      repository: this.rawRepository,
      appRole: 'ADS',
      endpointKey: 'products',
      shopId: this.shopId,
      pages: list.rawPages,
    });

    const itemIds = list.rows.map(item => item.itemId).filter(Boolean);
    const baseInfo = await fetchItemBaseInfo({
      client, shopId: this.shopId, accessToken, itemIds,
    });
    await recordPages({
      repository: this.rawRepository,
      appRole: 'ADS',
      endpointKey: 'productBaseInfo',
      shopId: this.shopId,
      pages: baseInfo.rawPages,
    });

    const baseById = new Map(baseInfo.rows.map(item => [String(item.itemId), item]));
    for (const item of list.rows) {
      const base = baseById.get(String(item.itemId));
      const merged = {
        ...item,
        ...(base || {}),
        itemStatus: item.itemStatus,
        updateTime: (base && base.updateTime) || item.updateTime,
        raw: { item_list: item.raw, base_info: base && base.raw },
      };
      if (this.productRepository) await this.productRepository.upsertItem({ shopId: this.shopId, item: merged });
      if (!includeModels || !item.itemId) continue;
      const models = await fetchModelList({
        client, shopId: this.shopId, accessToken, itemId: item.itemId,
      });
      await recordSnapshot({
        repository: this.rawRepository,
        appRole: 'ADS',
        endpointKey: 'productModels',
        shopId: this.shopId,
        requestJson: models.query,
        responseJson: models.payload,
      });
      if (this.productRepository) {
        await this.productRepository.replaceModels({
          shopId: this.shopId,
          itemId: item.itemId,
          models: models.rows,
        });
      }
    }
    return { itemCount: list.rows.length, baseInfoCount: baseInfo.rows.length };
  }

  async syncRecommendedRoi({ itemIds, observedAt = new Date() }) {
    const { client, accessToken } = await resolveRole(this.roleClients, 'ADS', this.shopId);
    let count = 0;
    for (const itemId of itemIds || []) {
      const result = await fetchRecommendedRoi({
        client, shopId: this.shopId, accessToken, itemId,
      });
      await recordSnapshot({
        repository: this.rawRepository,
        appRole: 'ADS',
        endpointKey: 'adsRecommendedRoi',
        shopId: this.shopId,
        requestJson: result.query,
        responseJson: result.payload,
      });
      if (this.productRepository) {
        await this.productRepository.insertRecommendedRoi({
          shopId: this.shopId,
          itemId,
          observedAt,
          recommendation: result.recommendation,
        });
      }
      count += 1;
    }
    return { itemCount: count };
  }

  async syncPromotions({ discountStatus = 'all' } = {}) {
    const { client, accessToken } = await resolveRole(this.roleClients, 'STORE_OPS', this.shopId);

    const vouchers = await fetchAllVoucherDetails({
      client, shopId: this.shopId, accessToken,
    });
    await recordPages({
      repository: this.rawRepository,
      appRole: 'STORE_OPS',
      endpointKey: 'vouchers',
      shopId: this.shopId,
      pages: vouchers.list.rawPages,
    });
    for (const detail of vouchers.details) {
      await recordSnapshot({
        repository: this.rawRepository,
        appRole: 'STORE_OPS',
        endpointKey: 'voucherDetail',
        shopId: this.shopId,
        requestJson: detail.query,
        responseJson: detail.payload,
      });
      if (this.promotionRepository) {
        await this.promotionRepository.upsertVoucher({ shopId: this.shopId, voucher: detail.voucher });
      }
    }

    const discounts = await fetchAllDiscountDetails({
      client, shopId: this.shopId, accessToken, discountStatus,
    });
    await recordPages({
      repository: this.rawRepository,
      appRole: 'STORE_OPS',
      endpointKey: 'discounts',
      shopId: this.shopId,
      pages: discounts.list.rawPages,
    });
    for (const detail of discounts.details) {
      await recordPages({
        repository: this.rawRepository,
        appRole: 'STORE_OPS',
        endpointKey: 'discountDetail',
        shopId: this.shopId,
        pages: detail.rawPages,
      });
      if (this.promotionRepository) {
        await this.promotionRepository.upsertDiscount({ shopId: this.shopId, discount: detail.discount });
      }
    }

    return {
      voucherCount: vouchers.details.length,
      discountCount: discounts.details.length,
    };
  }

  async syncOrders({ timeFrom, timeTo, timeRangeField = 'update_time', orderStatus }) {
    const { client, accessToken } = await resolveRole(this.roleClients, 'ADS', this.shopId);
    const list = await fetchOrderList({
      client, shopId: this.shopId, accessToken,
      timeFrom, timeTo, timeRangeField, orderStatus,
    });
    await recordPages({
      repository: this.rawRepository,
      appRole: 'ADS',
      endpointKey: 'orders',
      shopId: this.shopId,
      pages: list.rawPages,
    });

    const details = await fetchOrderDetails({
      client,
      shopId: this.shopId,
      accessToken,
      orderSns: list.rows.map(row => row.order_sn),
    });
    await recordPages({
      repository: this.rawRepository,
      appRole: 'ADS',
      endpointKey: 'orderDetail',
      shopId: this.shopId,
      pages: details.rawPages,
    });
    if (this.orderRepository) {
      for (const order of details.orders) {
        await this.orderRepository.upsertOrder({ shopId: this.shopId, order });
      }
    }
    return { orderCount: details.orders.length };
  }

  /**
   * The traffic the shop brought in on its own, day by day.
   *
   * This is the natural side of the shop's figures: the visitors who came,
   * what they looked at, what they clicked, what they bought. It comes
   * from the business insights endpoints, which belong to the permission
   * pool of an ERP System application — the advertising application
   * cannot see it, and its figures are a different thing altogether.
   *
   * Each day is kept as it was reported, so that a series of days becomes
   * a trend rather than a single number.
   */
  async syncShopTraffic({ startDate, endDate }) {
    const { client, accessToken } = await resolveRole(this.roleClients, 'ERP', this.shopId);
    const result = await fetchShopTraffic({
      client,
      shopId: this.shopId,
      accessToken,
      startDate,
      endDate,
    });
    await recordSnapshot({
      repository: this.rawRepository,
      appRole: 'ERP',
      endpointKey: 'shopTraffic',
      shopId: this.shopId,
      eventDateFrom: startDate,
      eventDateTo: endDate,
      requestJson: { start_date: startDate, end_date: endDate },
      responseJson: result.payload,
    });
    if (this.shopBiRepository) {
      for (const row of result.rows) {
        await this.shopBiRepository.upsertDaily({ eventDate: row.eventDate, detail: row.detail });
      }
    }
    return { dayCount: result.rows.length };
  }

  /**
   * The videos of the shop, and what came of them.
   *
   * The videos belong to the person behind the shop rather than to the
   * shop itself, so the request is made in that person's name: the token
   * is theirs and the request is signed with their number.
   */
  async syncVideos({ userId, startDate, endDate, pageNo = 1, pageSize = 50 }) {
    const person = Number(userId);
    if (!Number.isSafeInteger(person) || person <= 0) {
      throw new Error('A user number is required to read the videos');
    }
    const { client, accessToken } = await resolveRole(this.roleClients, 'VIDEO', person);
    const overview = await fetchVideoOverview({ client, userId: person, accessToken, startDate, endDate });
    await recordSnapshot({
      repository: this.rawRepository,
      appRole: 'VIDEO',
      endpointKey: 'videoOverviewPerformance',
      shopId: this.shopId,
      eventDateFrom: startDate,
      eventDateTo: endDate,
      requestJson: { start_date: startDate, end_date: endDate },
      responseJson: overview.payload,
    });
    if (this.videoRepository) {
      for (const row of overview.rows) {
        await this.videoRepository.upsertDaily({
          shopId: this.shopId,
          eventDate: row.eventDate,
          detail: { ...row.detail, raw: overview.raw },
        });
      }
    }
    // The videos themselves, so that a reader can see which one is worth
    // making more of.
    const list = await fetchVideoList({
      client, userId: person, accessToken, startDate, endDate, pageNo, pageSize,
    });
    await recordSnapshot({
      repository: this.rawRepository,
      appRole: 'VIDEO',
      endpointKey: 'videoPerformanceList',
      shopId: this.shopId,
      eventDateFrom: startDate,
      eventDateTo: endDate,
      requestJson: { start_date: startDate, end_date: endDate, page_no: pageNo, page_size: pageSize },
      responseJson: list.payload,
    });
    if (this.videoRepository) {
      for (const item of list.items) {
        await this.videoRepository.upsertItem({
          shopId: this.shopId,
          videoId: item.videoId,
          eventDate: item.eventDate,
          title: item.title,
          status: item.status,
          publishedAt: item.publishedAt,
          detail: { ...item.detail, raw: list.raw },
        });
      }
    }
    return { dayCount: overview.rows.length, videoCount: list.items.length };
  }

  /**
   * The livestreams of the shop, one session at a time.
   *
   * A livestream belongs to the person behind the shop, so the request
   * is made in that person's name. The day's total is worked out from
   * the sessions that make it up, so that the shop's live hours add up
   * without being counted twice.
   */
  async syncLivestreams({ userId, startDate, endDate, pageNo = 1, pageSize = 50 }) {
    const person = Number(userId);
    if (!Number.isSafeInteger(person) || person <= 0) {
      throw new Error('A user number is required to read the livestreams');
    }
    const { client, accessToken } = await resolveRole(this.roleClients, 'ONLINE', person);
    const result = await fetchLiveSessions({
      client, userId: person, accessToken, startDate, endDate, pageNo, pageSize,
    });
    await recordSnapshot({
      repository: this.rawRepository,
      appRole: 'ONLINE',
      endpointKey: 'liveSessionList',
      shopId: this.shopId,
      eventDateFrom: startDate,
      eventDateTo: endDate,
      requestJson: { start_date: startDate, end_date: endDate, page_no: pageNo, page_size: pageSize },
      responseJson: result.payload,
    });
    if (!this.livestreamRepository) return { sessionCount: result.sessions.length };

    // The day's total is written from the sessions, so that a day with
    // two sessions is counted as two and not as one row per session.
    const byDay = new Map();
    for (const session of result.sessions) {
      await this.livestreamRepository.upsertSession({
        shopId: this.shopId,
        sessionId: session.sessionId,
        eventDate: session.eventDate,
        title: session.title,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        detail: { ...session.detail, raw: result.raw },
      });
      const day = byDay.get(session.eventDate) || {
        sessions: 0, seconds: 0, views: 0, viewers: 0, orders: 0, sales: 0,
      };
      day.sessions += 1;
      day.seconds += Number(session.detail.watchDurationSeconds || 0);
      day.views += Number(session.detail.views || 0);
      day.viewers += Number(session.detail.viewers || 0);
      day.orders += Number(session.detail.orders || 0);
      day.sales += Number(session.detail.sales || 0);
      byDay.set(session.eventDate, day);
    }
    for (const [eventDate, day] of byDay) {
      await this.livestreamRepository.upsertDaily({
        shopId: this.shopId,
        eventDate,
        detail: {
          liveSessions: day.sessions,
          liveHours: Math.round((day.seconds / 3600) * 1e4) / 1e4,
          liveViews: day.views,
          liveViewers: day.viewers,
          confirmedOrders: day.orders,
          confirmedSales: Math.round(day.sales * 1e6) / 1e6,
          raw: result.raw,
        },
      });
    }
    return { sessionCount: result.sessions.length, dayCount: byDay.size };
  }

  async syncShopBiDay({ date, timezone, principalId, currency = 'LOCAL' }) {
    const entry = requireRole(this.roleClients, 'BRAND_PORTAL');
    const normalizedPrincipalId = Number(principalId);
    if (!Number.isSafeInteger(normalizedPrincipalId) || normalizedPrincipalId <= 0) throw new Error('Brand Portal principalId is required');
    const accessToken = typeof entry.getAccessToken === 'function'
      ? await entry.getAccessToken(normalizedPrincipalId)
      : entry.accessToken;
    if (!accessToken) throw new Error('Missing access token for Shopee role: BRAND_PORTAL');
    const result = await fetchShopBiDay({
      client: entry.client,
      shopId: this.shopId,
      principalId: normalizedPrincipalId,
      accessToken,
      date,
      timezone,
      currency,
    });
    await recordSnapshot({
      repository: this.rawRepository,
      appRole: 'BRAND_PORTAL',
      endpointKey: 'shopSalesPerformance',
      shopId: this.shopId,
      eventDateFrom: date,
      eventDateTo: date,
      requestJson: result.body,
      responseJson: result.payload,
    });
    if (this.shopBiRepository) {
      for (const detail of result.details) {
        await this.shopBiRepository.upsertDaily({ eventDate: date, detail });
      }
    }
    return { detailCount: result.details.length };
  }

  async syncShopLivestreamDay({ date, timezone, principalId, currency = 'LOCAL' }) {
    const entry = requireRole(this.roleClients, 'BRAND_PORTAL');
    const normalizedPrincipalId = Number(principalId);
    if (!Number.isSafeInteger(normalizedPrincipalId) || normalizedPrincipalId <= 0) {
      throw new Error('Brand Portal principalId is required');
    }
    const accessToken = typeof entry.getAccessToken === 'function'
      ? await entry.getAccessToken(normalizedPrincipalId)
      : entry.accessToken;
    if (!accessToken) throw new Error('Missing access token for Shopee role: BRAND_PORTAL');
    const result = await fetchShopLivestreamDay({
      client: entry.client,
      shopId: this.shopId,
      principalId: normalizedPrincipalId,
      accessToken,
      date,
      timezone,
      currency,
    });
    await recordSnapshot({
      repository: this.rawRepository,
      appRole: 'BRAND_PORTAL',
      endpointKey: 'shopLivestreamPerformance',
      shopId: this.shopId,
      eventDateFrom: date,
      eventDateTo: date,
      requestJson: result.body,
      responseJson: result.payload,
    });
    if (this.shopLivestreamRepository) {
      for (const detail of result.details) {
        await this.shopLivestreamRepository.upsertDaily({ eventDate: date, detail });
      }
    }
    return { detailCount: result.details.length };
  }

  /**
   * The shop's score and how well it is being run.
   *
   * The endpoint answers with a current period and a previous one rather
   * than a day by day series, so the reading is kept against the day it
   * was taken. Over days that becomes a trend.
   */
  async syncShopHealth({ eventDate }) {
    const { client, accessToken } = await resolveRole(this.roleClients, 'ERP', this.shopId);
    const result = await fetchShopHealth({ client, shopId: this.shopId, accessToken });
    await recordSnapshot({
      repository: this.rawRepository,
      appRole: 'ERP',
      endpointKey: 'accountHealth',
      shopId: this.shopId,
      requestJson: {},
      responseJson: result.payload,
    });
    if (this.shopHealthRepository) {
      await this.shopHealthRepository.upsertDaily({
        eventDate,
        health: { ...result.health, shopId: this.shopId },
      });
      // The figures say a shop's cancellation rate is this; the detail says
      // which order was cancelled and why. Both are kept.
      const metricIds = result.health.metricIds || {};
      const wanted = Object.values(metricIds);
      const events = await fetchHealthEvents({
        client,
        shopId: this.shopId,
        accessToken,
        metricKeys: wanted,
      });
      if (events.events.length) {
        await this.shopHealthRepository.upsertEvents({
          eventDate,
          events: events.events.map(event => ({ ...event, shopId: this.shopId })),
        });
      }
    }
    return { shopRating: result.health.shopRating };
  }

  async syncReturns({ createTimeFrom, createTimeTo, updateTimeFrom, updateTimeTo, status }) {
    const { client, accessToken } = await resolveRole(this.roleClients, 'ERP', this.shopId);
    const result = await fetchAllReturnDetails({
      client,
      shopId: this.shopId,
      accessToken,
      createTimeFrom,
      createTimeTo,
      updateTimeFrom,
      updateTimeTo,
      status,
    });
    await recordPages({
      repository: this.rawRepository,
      appRole: 'ERP',
      endpointKey: 'returns',
      shopId: this.shopId,
      pages: result.list.rawPages,
    });
    for (const detail of result.details) {
      await recordSnapshot({
        repository: this.rawRepository,
        appRole: 'ERP',
        endpointKey: 'returnDetail',
        shopId: this.shopId,
        requestJson: detail.query,
        responseJson: detail.payload,
      });
      if (this.returnRepository) {
        await this.returnRepository.upsertReturn({
          shopId: this.shopId,
          returnRecord: detail.returnRecord,
        });
      }
    }
    return { returnCount: result.details.length };
  }
}

module.exports = { ShopeeSyncService, requireRole, resolveRole };
