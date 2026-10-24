'use strict';

const express = require('express');
const { parseProductAdSellerCentreFile } = require('./product-ad-seller-centre-import');
const { ShopeeAdPromotionRepository } = require('./ad-promotion-repository');
const { ShopeeShopScopeRepository } = require('./shop-scope-repository');

function positiveInt(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error(`${name} must be a positive integer`);
  return number;
}

function scopedError(code, message, status = 422) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function createProductAdSellerCentreRouter({ pool }) {
  const router = express.Router();
  const promotionRepository = new ShopeeAdPromotionRepository({ pool });
  const shopScopeRepository = new ShopeeShopScopeRepository({ pool });

  router.post(
    '/product-ads/seller-centre/import',
    express.raw({
      type: [
        'text/csv',
        'application/csv',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ],
      limit: '16mb',
    }),
    async (req, res, next) => {
      try {
        if (!req.body || !Buffer.isBuffer(req.body) || !req.body.length) {
          throw new Error('a Product Ads Seller Centre CSV or XLSX request body is required');
        }
        if (req.query.target_shop_id === undefined || req.query.target_shop_id === '') {
          throw scopedError('TARGET_SHOP_REQUIRED', 'target_shop_id is required');
        }
        if (req.query.target_campaign_id === undefined || req.query.target_campaign_id === '') {
          throw scopedError('TARGET_CAMPAIGN_REQUIRED', 'target_campaign_id is required');
        }

        const targetShopId = positiveInt(req.query.target_shop_id, 'target_shop_id');
        const targetCampaignId = positiveInt(req.query.target_campaign_id, 'target_campaign_id');
        const filename = String(req.query.filename || req.headers['x-filename'] || 'product-ad-report.csv');
        const parsed = parseProductAdSellerCentreFile({ buffer: req.body, filename });
        const preview = {
          ...parsed.preview,
          targetShopId,
          targetCampaignId,
          shopScope: parsed.preview.shopId === targetShopId ? 'MATCH' : 'MISMATCH',
          campaignScope: parsed.preview.campaignId === targetCampaignId ? 'MATCH' : 'MISMATCH',
        };
        const persist = req.query.confirm === 'YES';

        if (parsed.preview.shopId !== targetShopId) {
          if (!persist && req.query.preview_only === 'YES') {
            res.json({ ok: true, persisted: false, ...preview });
            return;
          }
          throw scopedError(
            'SHOP_SCOPE_MISMATCH',
            `Source shop ${parsed.preview.shopId} does not match target shop ${targetShopId}`,
            409,
          );
        }
        if (parsed.preview.campaignId !== targetCampaignId) {
          if (!persist && req.query.preview_only === 'YES') {
            res.json({ ok: true, persisted: false, ...preview });
            return;
          }
          throw scopedError(
            'CAMPAIGN_SCOPE_MISMATCH',
            `Source campaign ${parsed.preview.campaignId} does not match target campaign ${targetCampaignId}`,
            409,
          );
        }

        if (!persist) {
          res.json({ ok: true, persisted: false, ...preview });
          return;
        }

        const scope = await shopScopeRepository.find(targetShopId);
        if (!scope) {
          throw scopedError(
            'TARGET_SHOP_NOT_REGISTERED',
            `Shop ${targetShopId} must be registered before Product Ads evidence import`,
          );
        }

        const saved = await promotionRepository.saveWithItems(parsed.promotion, [parsed.item]);
        res.status(201).json({
          ok: true,
          persisted: true,
          ...preview,
          promotionKey: saved.promotionKey,
          evidencePolicy: 'SELLER_CENTRE_ATC_FALLBACK_ONLY_WHEN_SHOPEE_API_ATC_IS_UNAVAILABLE',
        });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}

module.exports = { createProductAdSellerCentreRouter };
