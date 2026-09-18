'use strict';

const { fetchCampaignIds, fetchCampaignSettings } = require('./sync-campaigns');
const { fetchItemList, fetchModelList } = require('./sync-product');
const { fetchRecommendedRoi } = require('./sync-roi');
const { fetchAllVoucherDetails } = require('./sync-voucher');
const { fetchAllDiscountDetails } = require('./sync-discount');
const { fetchOrderList, fetchOrderDetails } = require('./sync-orders');
const { fetchAllReturnDetails } = require('./sync-returns');
const { fetchShopBiDay } = require('./sync-shop-bi');
const { recordPages, recordSnapshot } = require('./raw-snapshot');

function requireRole(roleClients, role) {
  const entry = roleClients && roleClients[role];
  if (!entry || !entry.client || !entry.accessToken) throw new Error(`Missing configured Shopee role client: ${role}`);
  return entry;
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
  }

  async syncCampaignSettings({ eventDate = new Date().toISOString().slice(0, 10), adType = 'all' } = {}) {
    const { client, accessToken } = requireRole(this.roleClients, 'ADS');
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

    const campaignIds = list.rows.map(row => row.campaignId);
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

  async syncProducts({
    itemStatus = ['NORMAL'],
    updateTimeFrom,
    updateTimeTo,
    includeModels = true,
  } = {}) {
    const { client, accessToken } = requireRole(this.roleClients, 'ADS');
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

    for (const item of list.rows) {
      if (this.productRepository) await this.productRepository.upsertItem({ shopId: this.shopId, item });
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
    return { itemCount: list.rows.length };
  }

  async syncRecommendedRoi({ itemIds, observedAt = new Date() }) {
    const { client, accessToken } = requireRole(this.roleClients, 'ADS');
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
    const { client, accessToken } = requireRole(this.roleClients, 'STORE_OPS');

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
    const { client, accessToken } = requireRole(this.roleClients, 'ADS');
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

  async syncShopBiDay({ date, timezone, currency = 'LOCAL' }) {
    const { client, accessToken } = requireRole(this.roleClients, 'BRAND_PORTAL');
    const result = await fetchShopBiDay({
      client,
      shopId: this.shopId,
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

  async syncReturns({ createTimeFrom, createTimeTo, updateTimeFrom, updateTimeTo, status }) {
    const { client, accessToken } = requireRole(this.roleClients, 'ERP');
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

module.exports = { ShopeeSyncService, requireRole };
