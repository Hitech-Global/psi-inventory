'use strict';

const express = require('express');
const { analyzeCampaignWindow } = require('./analysis-service');
const { buildShopeeSeaEventCalendar, toEventDateSet } = require('./event-calendar');
const { evaluateItemCoverage, buildSystemWarnings } = require('./data-quality');
const { previousPeriod, diagnosePortfolio, diagnoseRow } = require('./portfolio-diagnosis');
const { diagnoseStoreSkus } = require('./store-sku-diagnosis');
const { localIsoDate, addDays } = require('./sync-cycle-utils');
const { daysInclusive } = require('./backfill-utils');
const { sumPerformance } = require('./metrics');
const { productAdDiagnosis } = require('./product-ads-diagnosis');
const { normalizeManualPromotion, normalizeManualItem } = require('./manual-ad-group');
const { parseShopeeAdGroupFile } = require('./shopee-ad-group-import');
const { ShopeeOperationHistoryRepository } = require('./operation-history-repository');
const { ROLE_SUPER_ADMIN, authorizedShopIds, assertShopAccess } = require('./feishu-auth');
const { BRAND_PORTAL_COOKIE, stateCookie, clearStateCookie, parseCookie } = require('./brand-portal-oauth-service');
const { ERP_COOKIE, stateCookie: erpStateCookie, clearStateCookie: clearErpStateCookie, parseCookie: parseErpCookie } = require('./erp-oauth-service');
const { TIKTOK_COOKIE, stateCookie: tiktokStateCookie, clearStateCookie: clearTikTokStateCookie, parseCookie: parseTikTokCookie } = require('./tiktok-oauth-service');
const { resolveDateRange, regionTimeZone } = require('./tiktok-query-repository');
const { diagnoseTikTokShop } = require('./platforms/tiktok-diagnosis');
const { SkillJobManager, normalizeReportLanguage } = require('./skill-job-manager');
const { buildFunnelRows, missingSources } = require('./shop-funnel');
const {
  evaluateMeasures, overallStatus, violationTotal, MEASURES,
  findAddToCartDropoffs, ADD_TO_CART_RULES,
} = require('./shop-health-evaluation');

function positiveInt(value, name) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer`);
  return n;
}

function isoDate(value, name) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) throw new Error(`${name} must be YYYY-MM-DD`);
  return String(value);
}

function sourceEvidenceMetric(row, key) {
  const value = row?.raw_json?.sourceMetrics?.[key];
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function aggregateGmsSellerEvidence(rows = [], startDate, endDate) {
  const expectedDays = daysInclusive(startDate, endDate);
  const grouped = new Map();
  for (const row of rows) {
    if (row?.raw_json?.sourceFormat !== 'SHOPEE_GMS_SELLER_CENTRE_EXPORT' || !row.campaign_id) continue;
    const key = Number(row.campaign_id);
    if (!grouped.has(key)) grouped.set(key, { exact: null, days: new Map() });
    const entry = grouped.get(key);
    const periodStart = String(row.period_start).slice(0, 10);
    const periodEnd = String(row.period_end).slice(0, 10);
    if (periodStart === startDate && periodEnd === endDate) entry.exact = row;
    if (periodStart === periodEnd && periodStart >= startDate && periodStart <= endDate && !entry.days.has(periodStart)) entry.days.set(periodStart, row);
  }
  const result = new Map();
  for (const [campaignId, entry] of grouped.entries()) {
    const sourceRows = entry.exact ? [entry.exact] : (entry.days.size === expectedDays ? Array.from(entry.days.values()) : []);
    if (!sourceRows.length) continue;
    const itemMap = new Map();
    for (const row of sourceRows) {
      for (const item of row.items || []) {
        const itemId = Number(item.itemId);
        if (!Number.isSafeInteger(itemId) || itemId <= 0) continue;
        if (!itemMap.has(itemId)) itemMap.set(itemId, { voucherAmount: 0, voucheredSales: 0, evidenceDays: 0 });
        const target = itemMap.get(itemId);
        target.voucherAmount += Number(item.voucherAmount || 0);
        target.voucheredSales += Number(item.voucheredSales || 0);
        target.evidenceDays += 1;
      }
    }
    result.set(campaignId, {
      voucherAmount: sourceRows.reduce((sum, row) => sum + Number(sourceEvidenceMetric(row, 'voucherAmount') || 0), 0),
      voucheredSales: sourceRows.reduce((sum, row) => sum + Number(sourceEvidenceMetric(row, 'voucheredSales') || 0), 0),
      coverage: entry.exact ? 'EXACT_RANGE' : 'DAILY_COMPLETE',
      evidenceRows: sourceRows.length,
      items: Object.fromEntries(Array.from(itemMap.entries()).map(([itemId, metrics]) => [String(itemId), metrics])),
    });
  }
  return result;
}

function optionalCode(value, name) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value).trim().toUpperCase();
  if (!/^[A-Z0-9_-]{1,32}$/.test(normalized)) throw new Error(`${name} contains invalid characters`);
  return normalized;
}

function parseShopIds(value) {
  if (value === undefined || value === null || value === '') return [];
  const ids = String(value)
    .split(',')
    .map(part => Number(part.trim()))
    .filter(Number.isSafeInteger);
  return Array.from(new Set(ids));
}

function eventMixForRange(startDate, endDate) {
  const startYear = Number(startDate.slice(0, 4));
  const endYear = Number(endDate.slice(0, 4));
  const events = [];
  for (let year = startYear; year <= endYear; year += 1) {
    for (const row of buildShopeeSeaEventCalendar(year)) {
      if (row.eventDate >= startDate && row.eventDate <= endDate) events.push(row);
    }
  }
  return {
    totalEventDays: events.length,
    doubleDayCount: events.filter(row => row.eventType === 'DOUBLE_DAY').length,
    payday25Count: events.filter(row => row.eventType === 'PAYDAY_25').length,
    dates: events.map(row => row.eventDate),
  };
}

function comparisonContext(startDate, endDate, previousStartDate, previousEndDate) {
  const currentEventMix = eventMixForRange(startDate, endDate);
  const previousEventMix = eventMixForRange(previousStartDate, previousEndDate);
  const eventMixMismatch =
    currentEventMix.doubleDayCount !== previousEventMix.doubleDayCount ||
    currentEventMix.payday25Count !== previousEventMix.payday25Count;
  return {
    currentEventMix,
    previousEventMix,
    eventMixMismatch,
    warning: eventMixMismatch
      ? '当前周期与上一周期的大促日构成不同，环比只作为经营信号；请结合普通日与活动日明细验证。'
      : null,
  };
}

function eventSetForRange(startDate, endDate) {
  const startYear = Number(startDate.slice(0, 4));
  const endYear = Number(endDate.slice(0, 4));
  const rows = [];
  for (let year = startYear; year <= endYear; year += 1) rows.push(...buildShopeeSeaEventCalendar(year));
  return toEventDateSet(rows.filter(row => row.eventDate >= startDate && row.eventDate <= endDate));
}

function storeDetailMetrics(row) {
  if (!row) return null;
  const shopBiAvailable = Boolean(row.shopBiAvailable);
  const sales = shopBiAvailable ? Number(row.sales || 0) : null;
  const orders = shopBiAvailable ? Number(row.orders || 0) : null;
  const productClicks = shopBiAvailable ? Number(row.productClicks || 0) : null;
  const productViews = shopBiAvailable ? Number(row.productViews || 0) : null;
  const attributionMismatch = shopBiAvailable ? Number(row.broadGmv || 0) > sales : null;
  const estimatedNaturalSales = shopBiAvailable && !attributionMismatch
    ? sales - Number(row.broadGmv || 0)
    : null;
  return {
    ...row,
    sales,
    orders,
    unitsSold: shopBiAvailable ? Number(row.unitsSold || 0) : null,
    productClicks,
    productViews,
    visitorDays: shopBiAvailable ? Number(row.visitorDays || 0) : null,
    avgItemConversionRate: shopBiAvailable ? row.avgItemConversionRate : null,
    avgOrderConversionRate: shopBiAvailable ? row.avgOrderConversionRate : null,
    voucherSales: shopBiAvailable ? Number(row.voucherSales || 0) : null,
    voucherBuyers: shopBiAvailable ? Number(row.voucherBuyers || 0) : null,
    voucherCost: shopBiAvailable ? Number(row.voucherCost || 0) : null,
    adSpendRatioToBiSales: shopBiAvailable && sales > 0 ? Number(row.adExpense || 0) / sales : null,
    adGmvShareOfBiSales: shopBiAvailable && sales > 0 ? Number(row.broadGmv || 0) / sales : null,
    estimatedNaturalSales,
    adAttributionExceedsBiSales: attributionMismatch,
    orderPerProductClick: shopBiAvailable && productClicks > 0 ? orders / productClicks : null,
  };
}

function addSkuPeriodComparison(currentRows, previousRows) {
  const previousMap = new Map((previousRows || []).map(row => [String(row.itemId), row]));
  return (currentRows || []).map(row => {
    const previous = previousMap.get(String(row.itemId)) || null;
    const currentSales = row.totalSales;
    const previousSales = previous ? previous.totalSales : null;
    const comparable = currentSales !== null && currentSales !== undefined && previousSales !== null && previousSales !== undefined;
    const salesDelta = comparable ? Number(currentSales) - Number(previousSales) : null;
    const salesChange = comparable && Number(previousSales) !== 0
      ? salesDelta / Math.abs(Number(previousSales))
      : (comparable && Number(currentSales) === 0 ? 0 : null);
    return {
      ...row,
      previousTotalSales: comparable ? Number(previousSales) : null,
      salesDelta,
      salesChange,
    };
  });
}

function skuContributionSummary(rows) {
  const comparable = (rows || []).filter(row => row.salesDelta !== null && Number.isFinite(Number(row.salesDelta)));
  const growth = comparable.filter(row => Number(row.salesDelta) > 0).sort((a,b) => Number(b.salesDelta) - Number(a.salesDelta)).slice(0,5);
  const drag = comparable.filter(row => Number(row.salesDelta) < 0).sort((a,b) => Number(a.salesDelta) - Number(b.salesDelta)).slice(0,5);
  return {
    available: comparable.length > 0,
    comparableCount: comparable.length,
    growth,
    drag,
  };
}

function escapeHtmlText(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function createShopeeAnalyticsRouter({
  repository,
  strategyRepository,
  queryRepository,
  adPromotionRepository = null,
  operationHistoryRepository = null,
  shopScopeRepository = null,
  backupStatusProvider = async () => null,
  skillReportRepository = null,
  runSkillAnalysis = null,
  runAdGroupSkillAnalysis = null,
  brandPortalOAuthService = null,
  erpOAuthService = null,
  tiktokOAuthService = null,
  shopHealthRepository = null,
  tiktokQueryRepository = null,
}) {
  const router = express.Router();
  const skillJobManager = new SkillJobManager();
  const operationRepo = operationHistoryRepository ||
    (adPromotionRepository && adPromotionRepository.pool ? new ShopeeOperationHistoryRepository({ pool: adPromotionRepository.pool }) : null);

  function scopeError(code, message, status = 422) {
    const error = new Error(message);
    error.code = code;
    error.status = status;
    return error;
  }

  /**
   * 把查询参数里的日期区间规整成 [startDate, endDate]。
   *
   * TikTok 的报表端点有 30 天跨度上限，所以这里给的默认区间（30 天）
   * 与那个限制对齐 —— 调度脚本与页面看到的口径一致。
   *
   * ★ 时区：TikTok 的店铺档案里没有独立的 timezone 字段（不像 Shopee 的
   *   店铺档案），只有 region_group。所以按区域取时区。
   *   区域缺省是 ROW（东南亚），UTC+8。
   *
   * @param {object} query Express 的 req.query
   * @returns {{startDate: string, endDate: string}}
   */
  function resolveTikTokDateRange(query = {}) {
    const regionGroup = String(query.region_group || 'ROW').trim().toUpperCase();
    const today = localIsoDate(new Date(), regionTimeZone(regionGroup));
    const end = isoDate(query.end_date || today, 'end_date');
    const start = query.start_date ? isoDate(query.start_date, 'start_date') : null;
    if (!start) return resolveDateRange({ startDate: null, endDate: end, today: new Date() });
    if (start > end) throw scopeError('TIKTOK_DATE_RANGE_INVALID', 'start_date must be <= end_date', 400);
    return { startDate: start, endDate: end };
  }

  router.get('/shop-scopes', async (req, res, next) => {
    try {
      if (!shopScopeRepository) throw new Error('Shop scope registry is unavailable');
      let shopScopes = await shopScopeRepository.list();
      if (req.auth?.enabled && req.auth.role !== ROLE_SUPER_ADMIN) {
        const allowed = new Set(req.auth.shopIds || []);
        shopScopes = shopScopes.filter(scope => allowed.has(scope.shopId));
      }
      res.json({ shopScopes });
    } catch (error) { next(error); }
  });

  router.post('/shop-scopes/import-only', express.json({ limit: '32kb' }), async (req, res, next) => {
    try {
      if (req.auth?.enabled && req.auth.role !== ROLE_SUPER_ADMIN) {
        throw scopeError('SUPER_ADMIN_REQUIRED', '只有超级管理员可以注册新店铺。', 403);
      }
      if (!shopScopeRepository) throw new Error('Shop scope registry is unavailable');
      const shopId = positiveInt(req.body && req.body.shopId, 'shopId');
      const scope = await shopScopeRepository.registerImportOnly({
        shopId,
        operatorLabel: req.body && req.body.operatorLabel,
        importSourceShopName: req.body && req.body.importSourceShopName,
        countryCode: optionalCode(req.body && req.body.countryCode, 'countryCode'),
        brandCode: optionalCode(req.body && req.body.brandCode, 'brandCode'),
      });
      res.status(201).json({ ok: true, shopScope: scope });
    } catch (error) { next(error); }
  });

  router.get('/shops', async (req, res, next) => {
    try {
      let shops = await queryRepository.listShops({ activeOnly: req.query.include_inactive !== '1' });
      if (req.auth?.enabled && req.auth.role !== ROLE_SUPER_ADMIN) {
        const allowed = new Set(req.auth.shopIds || []);
        shops = shops.filter(shop => allowed.has(shop.shopId));
      }
      const countries = Array.from(new Map(shops.map(shop => [
        shop.countryCode,
        { code: shop.countryCode, name: shop.countryName || shop.countryCode },
      ])).values()).sort((a, b) => String(a.code || '').localeCompare(String(b.code || '')));
      const brands = Array.from(new Map(shops.map(shop => [
        shop.brandCode,
        { code: shop.brandCode, name: shop.brandName || shop.brandCode },
      ])).values()).sort((a, b) => String(a.code || '').localeCompare(String(b.code || '')));
      res.json({ shops, countries, brands });
    } catch (error) {
      next(error);
    }
  });

  /**
   * The state of every shop's connections, for the settings panel.
   *
   * A reader wants one place that says which shop is missing which
   * connection, rather than having to open each shop's page to find out.
   * The counts come from the repository in one pass; the credential and
   * callback state comes from the two services, which hold the settings
   * that live outside the database.
   */
  router.get('/shop-connections', async (req, res, next) => {
    try {
      let shops = await queryRepository.listShops({ activeOnly: false });
      if (req.auth?.enabled && req.auth.role !== ROLE_SUPER_ADMIN) {
        const allowed = new Set(req.auth.shopIds || []);
        shops = shops.filter(shop => allowed.has(shop.shopId));
      }
      const coverage = await queryRepository.getShopConnectionCoverage();
      const coverageByShop = new Map(coverage.map(row => [row.shopId, row]));

      const rows = [];
      for (const shop of shops) {
        const [erp, brandPortal] = await Promise.all([
          erpOAuthService
            ? erpOAuthService.status({ shopId: shop.shopId }).catch(() => null)
            : Promise.resolve(null),
          brandPortalOAuthService
            ? brandPortalOAuthService.status({ shopId: shop.shopId }).catch(() => null)
            : Promise.resolve(null),
        ]);
        const cover = coverageByShop.get(shop.shopId) || {};
        rows.push({
          shopId: shop.shopId,
          displayName: shop.displayName,
          countryName: shop.countryName,
          brandName: shop.brandName,
          // Two shops can be registered from the same store under different
          // names, and the name they were registered under is often the only
          // thing that tells them apart.
          importSourceShopName: shop.importSourceShopName || null,
          dataSourceCapability: shop.dataSourceCapability || null,
          marketplaceRegion: shop.marketplaceRegion || null,
          currency: shop.currency || null,
          shopBi: {
            days: cover.biDays || 0,
            latestDate: cover.biLatest || null,
          },
          livestream: {
            days: cover.livestreamDays || 0,
            latestDate: cover.livestreamLatest || null,
          },
          returns: {
            rows: cover.returnRows || 0,
            latestDate: cover.returnLatest || null,
          },
          erp: erp
            ? {
              credentialConfigured: Boolean(erp.credentialConfigured),
              tokenPresent: Boolean(erp.tokenPresent),
              tokenExpiresAt: erp.tokenExpiresAt || null,
              tokenRefreshError: erp.tokenRefreshError || null,
              redirectUrl: erp.redirectUrl || null,
            }
            : null,
          brandPortal: brandPortal
            ? {
              credentialConfigured: Boolean(brandPortal.credentialConfigured),
              tokenPresent: Boolean(brandPortal.tokenPresent),
              principalId: brandPortal.principalId || null,
              timezoneConfigured: Boolean(brandPortal.timezoneConfigured),
              tokenRefreshError: brandPortal.tokenRefreshError || null,
              redirectUrl: brandPortal.redirectUrl || null,
            }
            : null,
        });
      }
      // Which App the reader should open in the console. Knowing the number
      // saves searching for it among the partner's own applications.
      res.json({
        shops: rows,
        apps: {
          ads: String(process.env.SHOPEE_ADS_PARTNER_ID || '').trim() || null,
          erp: String(process.env.SHOPEE_ERP_PARTNER_ID || '').trim() || null,
          brandPortal: String(process.env.SHOPEE_BRAND_PORTAL_PARTNER_ID || '').trim() || null,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * Add a shop that is not known here yet.
   *
   * The reader says where it trades, which brand it belongs to and what to
   * call it; the shop's own number is not known until the code is
   * exchanged, so it is learned on the way back. The answer is the address
   * to send the reader to.
   */
  router.post('/shop-connections/register', express.json({ limit: '16kb' }), async (req, res, next) => {
    try {
      if (!req.auth || req.auth.role !== ROLE_SUPER_ADMIN) {
        res.status(403).json({ error: 'SUPER_ADMIN_REQUIRED', message: 'Only super admins can add a shop.' });
        return;
      }
      if (!erpOAuthService) throw Object.assign(new Error('ERP OAuth service is unavailable'), { status: 503 });
      const result = await erpOAuthService.beginAuthorization({
        shopId: 0,
        register: {
          countryCode: req.body && req.body.country_code,
          brandCode: req.body && req.body.brand_code,
          displayName: req.body && req.body.display_name,
        },
      });
      res.setHeader('Set-Cookie', erpStateCookie(result.state, result.ttlSeconds));
      res.json({ authorizationUrl: result.authorizationUrl });
    } catch (error) { next(error); }
  });

  router.get('/erp/status', async (req, res, next) => {
    try {
      if (!erpOAuthService) throw Object.assign(new Error('ERP OAuth service is unavailable'), { status: 503 });
      const shopId = positiveInt(req.query.shop_id, 'shop_id');
      assertShopAccess(req, shopId);
      res.json(await erpOAuthService.status({ shopId }));
    } catch (error) { next(error); }
  });

  router.get('/erp/oauth/start', async (req, res, next) => {
    try {
      if (!req.auth || req.auth.role !== ROLE_SUPER_ADMIN) {
        res.status(403).json({ error: 'SUPER_ADMIN_REQUIRED', message: 'Only super admins can connect ERP.' });
        return;
      }
      if (!erpOAuthService) throw Object.assign(new Error('ERP OAuth service is unavailable'), { status: 503 });
      const shopId = positiveInt(req.query.shop_id, 'shop_id');
      const result = await erpOAuthService.beginAuthorization({ shopId });
      res.setHeader('Set-Cookie', erpStateCookie(result.state, result.ttlSeconds));
      res.redirect(302, result.authorizationUrl);
    } catch (error) { next(error); }
  });

  router.get('/brand-portal/status', async (req, res, next) => {
    try {
      if (!brandPortalOAuthService) throw Object.assign(new Error('Brand Portal OAuth service is unavailable'), { status: 503 });
      const shopId = positiveInt(req.query.shop_id, 'shop_id');
      assertShopAccess(req, shopId);
      res.json(await brandPortalOAuthService.status({ shopId }));
    } catch (error) { next(error); }
  });

  router.get('/brand-portal/oauth/start', async (req, res, next) => {
    try {
      if (!req.auth || req.auth.role !== ROLE_SUPER_ADMIN) {
        res.status(403).json({ error: 'SUPER_ADMIN_REQUIRED', message: 'Only super admins can connect Brand Portal.' });
        return;
      }
      if (!brandPortalOAuthService) throw Object.assign(new Error('Brand Portal OAuth service is unavailable'), { status: 503 });
      const shopId = positiveInt(req.query.shop_id, 'shop_id');
      const result = await brandPortalOAuthService.beginAuthorization({ shopId });
      res.setHeader('Set-Cookie', stateCookie(result.state, result.ttlSeconds));
      res.redirect(302, result.authorizationUrl);
    } catch (error) { next(error); }
  });

  /**
   * Tell the reader what happened when an authorization did not finish.
   *
   * The reader arrives here from Shopee's own page, having just typed a
   * password. Answering with a code and a stack means nothing to them, and
   * they have no way back to the page they came from. So: a page that says
   * what went wrong, what to do about it, and a way back.
   */
  function respondWithOAuthOutcome(res, error, label) {
    const code = error && error.code ? String(error.code) : 'OAUTH_FAILED';
    const detail = error && error.safe && error.message ? error.message : '';
    const known = {
      ERP_OAUTH_SHOP_NOT_ALLOWED: '授权的店铺与本系统已配置的店铺不一致',
      ERP_OAUTH_INVALID_TOKEN_RESPONSE: 'Shopee 返回的授权结果无法识别',
      ERP_OAUTH_MISSING_CODE: '授权回调缺少 code',
      ERP_OAUTH_INVALID_OR_REPLAYED_STATE: '授权请求已过期或已被使用，请重新发起',
      ERP_OAUTH_PROVIDER_ERROR: 'Shopee 拒绝了这次授权',
      ERP_OAUTH_TOKEN_EXCHANGE_FAILED: '用 code 换取令牌时失败',
      BRAND_PORTAL_OAUTH_MULTIPLE_PRINCIPALS: '这个账号关联了多个品牌主体，无法确定用哪一个',
      BRAND_PORTAL_OAUTH_INVALID_PRINCIPAL_RESPONSE: 'Shopee 没有返回可用的品牌主体',
      BRAND_PORTAL_OAUTH_INVALID_TOKEN_RESPONSE: 'Shopee 返回的授权结果无法识别',
      BRAND_PORTAL_OAUTH_MISSING_CODE: '授权回调缺少 code',
      BRAND_PORTAL_OAUTH_INVALID_OR_REPLAYED_STATE: '授权请求已过期或已被使用，请重新发起',
      BRAND_PORTAL_OAUTH_PROVIDER_ERROR: 'Shopee 拒绝了这次授权',
      BRAND_PORTAL_OAUTH_TOKEN_EXCHANGE_FAILED: '用 code 换取令牌时失败',
    };
    const title = known[code] || `${label} 授权未完成`;
    const steps = {
      ERP_OAUTH_SHOP_NOT_ALLOWED: '请回到「店铺接口」页面重新发起连接，在授权页勾选本系统已配置的店铺后确认。',
      BRAND_PORTAL_OAUTH_MULTIPLE_PRINCIPALS: '请在开放平台确认该 App 只关联一个品牌主体后重试。',
      BRAND_PORTAL_OAUTH_INVALID_PRINCIPAL_RESPONSE: 'Brand Portal 仅对官方店 / Mall 卖家开放；普通店铺请改用卖家中心导出的数据。',
    };
    const action = steps[code] || '请回到「店铺接口」页面重新发起连接。';
    res.status(error && error.status ? error.status : 400).send(
      `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtmlText(title)}</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;
       background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;color:#172033}
  .card{width:min(520px,100%);background:#fff;border:1px solid rgba(15,23,42,.08);border-radius:18px;padding:28px;
        box-shadow:0 12px 40px rgba(15,23,42,.08)}
  h1{font-size:19px;margin:0 0 10px}
  p{margin:0 0 12px;font-size:13px;line-height:1.7;color:#475467}
  code{display:block;margin:0 0 14px;padding:9px 11px;border-radius:9px;background:#f5f5f7;
       font-size:11px;color:#6b7280;word-break:break-word}
  a{display:inline-block;margin-top:8px;background:#175cd3;color:#fff;text-decoration:none;
    padding:9px 16px;border-radius:10px;font-size:13px;font-weight:600}
</style></head><body>
<div class="card">
  <h1>${escapeHtmlText(title)}</h1>
  ${detail ? `<p>${escapeHtmlText(detail)}</p>` : ''}
  <code>${escapeHtmlText(code)}</code>
  <p>${escapeHtmlText(action)}</p>
  <a href="/">返回电商运营系统</a>
</div></body></html>`,
    );
  }

  router.get('/erp/oauth/callback', async (req, res, next) => {
    try {
      if (!req.auth || req.auth.role !== ROLE_SUPER_ADMIN) {
        res.status(403).json({ error: 'SUPER_ADMIN_REQUIRED', message: 'Only super admins can connect ERP.' });
        return;
      }
      if (!erpOAuthService) throw Object.assign(new Error('ERP OAuth service is unavailable'), { status: 503 });
      const state = parseErpCookie(req.headers.cookie, ERP_COOKIE);
      const result = await erpOAuthService.completeAuthorization({
        state,
        code: typeof req.query.code === 'string' ? req.query.code : '',
        providerError: req.query.error || null,
      });
      res.setHeader('Set-Cookie', clearErpStateCookie());
      const connected = (result.connectedShopIds || [result.shopId]).length;
      const params = new URLSearchParams({
        erp: 'connected',
        shop_id: String(result.shopId),
        shops: String(connected),
      });
      // The reader asked for one shop and the authorization covered
      // another. Say which, or they will read "connected" as "the shop I
      // was looking at is connected".
      if (result.expectedShopConnected === false) {
        params.set('expected', String(result.expectedShopId));
        params.set('reason', `授权的店铺里没有 ${result.expectedShopId}，需要用能访问该店铺的账号重新授权`);
      }
      res.redirect(302, '/?' + params.toString());
    } catch (error) {
      res.setHeader('Set-Cookie', clearErpStateCookie());
      respondWithOAuthOutcome(res, error, 'ERP');
    }
  });

  router.get('/brand-portal/oauth/callback', async (req, res, next) => {
    try {
      if (!req.auth || req.auth.role !== ROLE_SUPER_ADMIN) {
        res.status(403).json({ error: 'SUPER_ADMIN_REQUIRED', message: 'Only super admins can connect Brand Portal.' });
        return;
      }
      if (!brandPortalOAuthService) throw Object.assign(new Error('Brand Portal OAuth service is unavailable'), { status: 503 });
      const state = parseCookie(req.headers.cookie, BRAND_PORTAL_COOKIE);
      const result = await brandPortalOAuthService.completeAuthorization({
        state,
        code: typeof req.query.code === 'string' ? req.query.code : '',
        providerError: req.query.error || null,
      });
      res.setHeader('Set-Cookie', clearStateCookie());
      res.redirect(302, '/?brand_portal=connected&shop_id=' + encodeURIComponent(result.shopId));
    } catch (error) {
      res.setHeader('Set-Cookie', clearStateCookie());
      respondWithOAuthOutcome(res, error, 'Brand Portal');
    }
  });

  // ---- TikTok Shop 授权 ----
  // 登录页与「平台接入」页共用这两个端点：状态查询给界面展示，
  // start 发起授权并跳转，callback 接收平台回跳。

  router.get('/tiktok/status', async (req, res, next) => {
    try {
      if (!tiktokOAuthService) throw Object.assign(new Error('TikTok OAuth service is unavailable'), { status: 503 });
      res.json(await tiktokOAuthService.status());
    } catch (error) { next(error); }
  });

  router.get('/tiktok/oauth/start', async (req, res, next) => {
    try {
      if (!req.auth || req.auth.role !== ROLE_SUPER_ADMIN) {
        res.status(403).json({ error: 'SUPER_ADMIN_REQUIRED', message: 'Only super admins can connect TikTok Shop.' });
        return;
      }
      if (!tiktokOAuthService) throw Object.assign(new Error('TikTok OAuth service is unavailable'), { status: 503 });
      const result = await tiktokOAuthService.beginAuthorization();
      res.setHeader('Set-Cookie', tiktokStateCookie(result.state, result.ttlSeconds));
      res.redirect(302, result.authorizationUrl);
    } catch (error) { next(error); }
  });

  router.get('/tiktok/oauth/callback', async (req, res, next) => {
    try {
      if (!req.auth || req.auth.role !== ROLE_SUPER_ADMIN) {
        res.status(403).json({ error: 'SUPER_ADMIN_REQUIRED', message: 'Only super admins can connect TikTok Shop.' });
        return;
      }
      if (!tiktokOAuthService) throw Object.assign(new Error('TikTok OAuth service is unavailable'), { status: 503 });
      const state = parseTikTokCookie(req.headers.cookie, TIKTOK_COOKIE);
      const result = await tiktokOAuthService.completeAuthorization({
        state,
        code: typeof req.query.code === 'string' ? req.query.code : '',
        providerError: req.query.error || null,
      });
      res.setHeader('Set-Cookie', clearTikTokStateCookie());
      // 跳到平台接入页而不是首页：只有该页会读 tiktok 参数并展示连接结果。
      res.redirect(302, '/connections?tiktok=connected&shops=' + encodeURIComponent(result.shopCount));
    } catch (error) { next(error); }
  });

  // ---- TikTok Shop 数据查询 ----
  //
  // 授权只是拿到了凭据，能不能看到数据是另一回事 —— 这一组接口把已落库的
  // TikTok 数据读出来，供「TikTok」页签展示。
  //
  // ★ 权限隔离：TikTok 的 shop_id 是**字符串**，与 Shopee 的数字 shop_id
  //   不是一回事，所以不能用 assertShopAccess（它按数字比），
  //   否则会把不相干的店铺 ID 悄悄当成同一家。这里改用字符串比较，
  //   并且照旧只放行 operator 被分配到的店铺。

  /**
   * 判断当前请求者能否看这家 TikTok 店铺。
   *
   * @param {object} req Express 请求
   * @param {string} shopId TikTok 店铺 ID（字符串）
   * @returns {boolean}
   */
  function canSeeTikTokShop(req, shopId) {
    if (!req.auth || !req.auth.enabled) return true;
    if (req.auth.role === ROLE_SUPER_ADMIN) return true;
    const allowed = Array.isArray(req.auth.shopIds) ? req.auth.shopIds : [];
    // 两侧都转成字符串再比 —— Shopee 的授权名单里存的是数字，
    // 直接 === 会永远不相等。
    const target = String(shopId);
    return allowed.some(id => String(id) === target);
  }

  /**
   * 读一个阈值参数。
   *
   * 阈值是给运营调的数字，传进来的可能是 "0.2"，也可能是空或乱写。
   * 解析不出来就用默认值 —— 一个填错的阈值不该让整个诊断失败。
   *
   * @param {*} value
   * @param {number} fallback
   * @returns {number}
   */
  function readThreshold(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return fallback;
    return parsed;
  }

  router.get('/tiktok/shops', async (req, res, next) => {
    try {
      if (!tiktokQueryRepository) throw scopeError('TIKTOK_DATA_UNAVAILABLE', 'TikTok data registry is unavailable', 503);
      const shops = await tiktokQueryRepository.listShops();
      // 只列可见的店铺 —— 未授权的店铺不列，页面会单独说明"尚未接入"。
      const visible = shops.filter(shop => canSeeTikTokShop(req, shop.shopId));
      res.json({ shops: visible });
    } catch (error) { next(error); }
  });

  router.get('/tiktok/shops/:shopId/overview', async (req, res, next) => {
    try {
      if (!tiktokQueryRepository) throw scopeError('TIKTOK_DATA_UNAVAILABLE', 'TikTok data registry is unavailable', 503);
      const shopId = String(req.params.shopId || '').trim();
      if (!shopId) throw scopeError('TIKTOK_SHOP_ID_REQUIRED', 'shopId is required', 400);
      if (!canSeeTikTokShop(req, shopId)) {
        throw scopeError('TIKTOK_SHOP_FORBIDDEN', 'This TikTok shop is not assigned to you', 403);
      }
      const regionGroup = String(req.query.region_group || 'ROW').trim().toUpperCase();
      const { startDate, endDate } = resolveTikTokDateRange(req.query);
      const [overview, daily, coverage] = await Promise.all([
        tiktokQueryRepository.getShopOverview({ regionGroup, shopId, startDate, endDate }),
        tiktokQueryRepository.listDailySummary({ regionGroup, shopId, startDate, endDate }),
        tiktokQueryRepository.getDataCoverage({ regionGroup, shopId, startDate, endDate }),
      ]);
      res.json({ ...overview, daily, coverage });
    } catch (error) { next(error); }
  });

  router.get('/tiktok/shops/:shopId/products', async (req, res, next) => {
    try {
      if (!tiktokQueryRepository) throw scopeError('TIKTOK_DATA_UNAVAILABLE', 'TikTok data registry is unavailable', 503);
      const shopId = String(req.params.shopId || '').trim();
      if (!shopId) throw scopeError('TIKTOK_SHOP_ID_REQUIRED', 'shopId is required', 400);
      if (!canSeeTikTokShop(req, shopId)) {
        throw scopeError('TIKTOK_SHOP_FORBIDDEN', 'This TikTok shop is not assigned to you', 403);
      }
      const regionGroup = String(req.query.region_group || 'ROW').trim().toUpperCase();
      const { startDate, endDate } = resolveTikTokDateRange(req.query);
      const products = await tiktokQueryRepository.listProductSummary({
        regionGroup, shopId, startDate, endDate, limit: 100,
      });
      res.json({ products, startDate, endDate });
    } catch (error) { next(error); }
  });

  router.get('/tiktok/shops/:shopId/orders', async (req, res, next) => {
    try {
      if (!tiktokQueryRepository) throw scopeError('TIKTOK_DATA_UNAVAILABLE', 'TikTok data registry is unavailable', 503);
      const shopId = String(req.params.shopId || '').trim();
      if (!shopId) throw scopeError('TIKTOK_SHOP_ID_REQUIRED', 'shopId is required', 400);
      if (!canSeeTikTokShop(req, shopId)) {
        throw scopeError('TIKTOK_SHOP_FORBIDDEN', 'This TikTok shop is not assigned to you', 403);
      }
      const regionGroup = String(req.query.region_group || 'ROW').trim().toUpperCase();
      const { startDate, endDate } = resolveTikTokDateRange(req.query);
      const orders = await tiktokQueryRepository.listRecentOrders({
        regionGroup, shopId, startDate, endDate, limit: 50,
      });
      res.json({ orders, startDate, endDate });
    } catch (error) { next(error); }
  });

  router.get('/tiktok/shops/:shopId/diagnosis', async (req, res, next) => {
    try {
      if (!tiktokQueryRepository) throw scopeError('TIKTOK_DATA_UNAVAILABLE', 'TikTok data registry is unavailable', 503);
      const shopId = String(req.params.shopId || '').trim();
      if (!shopId) throw scopeError('TIKTOK_SHOP_ID_REQUIRED', 'shopId is required', 400);
      if (!canSeeTikTokShop(req, shopId)) {
        throw scopeError('TIKTOK_SHOP_FORBIDDEN', 'This TikTok shop is not assigned to you', 403);
      }
      const regionGroup = String(req.query.region_group || 'ROW').trim().toUpperCase();
      const { startDate, endDate } = resolveTikTokDateRange(req.query);

      // 阈值允许调用方覆盖 —— 项目要求阈值可配置。
      // 解析失败就用默认值，不能因为一个非法阈值让整个诊断挂掉。
      const thresholds = {
        adSpendRatioLimit: readThreshold(req.query.ad_spend_ratio_limit, 0.15),
        settledNetRoasLimit: readThreshold(req.query.settled_net_roas_limit, 1),
      };

      const rows = await tiktokQueryRepository.listDailySummary({
        regionGroup, shopId, startDate, endDate,
      });
      const diagnosis = diagnoseTikTokShop({
        rows, thresholds, shopId,
        shopName: req.query.shop_name ? String(req.query.shop_name) : null,
      });
      res.json({ ...diagnosis, startDate, endDate, thresholds });
    } catch (error) { next(error); }
  });

  router.get('/shops/:shopId/detail', async (req, res, next) => {
    try {
      const shopId = positiveInt(req.params.shopId, 'shopId');
      const startDate = isoDate(req.query.start_date, 'start_date');
      const endDate = isoDate(req.query.end_date, 'end_date');
      if (startDate > endDate) throw new Error('start_date must be <= end_date');

      const shops = await queryRepository.listShops({ activeOnly: false });
      const shop = shops.find(row => row.shopId === shopId);
      if (!shop) {
        res.status(404).json({ error: 'SHOP_NOT_CONFIGURED', message: `Shop ${shopId} is not configured` });
        return;
      }

      const previous = previousPeriod(startDate, endDate);
      const [currentOverview, previousOverview, daily, skus, previousSkus] = await Promise.all([
        queryRepository.getPortfolioOverview({
          startDate,
          endDate,
          shopIds: [shopId],
        }),
        queryRepository.getPortfolioOverview({
          startDate: previous.startDate,
          endDate: previous.endDate,
          shopIds: [shopId],
        }),
        queryRepository.getShopDailyTrend({ shopId, startDate, endDate }),
        queryRepository.getShopSkuOverview({ shopId, startDate, endDate, limit: 200 }),
        queryRepository.getShopSkuOverview({ shopId, startDate: previous.startDate, endDate: previous.endDate, limit: 200 }),
      ]);

      const current = storeDetailMetrics(currentOverview.shops[0] || null);
      const prior = storeDetailMetrics(previousOverview.shops[0] || null);

      // What the products say — the visits, the basket, what was saved for
      // later. The open platform gives none of it, so it is only here when
      // the seller centre's export has been read.
      let products = [];
      if (shopHealthRepository) {
        try {
          products = await shopHealthRepository.listProductTraffic({ shopIds: [shopId], limit: 300 });
        } catch (error) {
          products = [];
        }
      }
      const diagnosis = current ? diagnoseRow(current, prior, { products }) : null;
      const comparedSkus = addSkuPeriodComparison(skus, previousSkus);
      const skuDiagnosis = diagnoseStoreSkus(comparedSkus, {
        adSpendRatioLimit: current && current.adSpendRatioLimit != null
          ? current.adSpendRatioLimit
          : 0.15,
      });

      const startYear = Number(startDate.slice(0, 4));
      const endYear = Number(endDate.slice(0, 4));
      const eventMap = new Map();
      for (let year = startYear; year <= endYear; year += 1) {
        for (const row of buildShopeeSeaEventCalendar(year)) {
          if (row.eventDate >= startDate && row.eventDate <= endDate) {
            eventMap.set(row.eventDate, {
              eventType: row.eventType,
              intensity: row.intensity,
              note: row.note,
            });
          }
        }
      }

      res.json({
        shop,
        startDate,
        endDate,
        previousStartDate: previous.startDate,
        previousEndDate: previous.endDate,
        comparisonContext: comparisonContext(
          startDate,
          endDate,
          previous.startDate,
          previous.endDate,
        ),
        current,
        previous: prior,
        diagnosis,
        daily: daily.map(row => ({
          ...row,
          event: eventMap.get(row.eventDate) || null,
        })),
        skus: skuDiagnosis.items,
        skuContribution: skuContributionSummary(skuDiagnosis.items),
        skuDiagnosis: {
          cvrMedian: skuDiagnosis.cvrMedian,
          attentionCount: skuDiagnosis.attentionCount,
        },
        productCardExactPeriod: skus.some(row => row.hasProductCard),
        previousProductCardExactPeriod: previousSkus.some(row => row.hasProductCard),
        dataAvailability: {
          shopBi: Boolean(current && current.shopBiAvailable),
          shopBiDays: Number(current && current.shopBiDays || 0),
          ads: Boolean(current && current.adDataAvailable),
          adDays: Number(current && current.adDays || 0),
          productCard: skus.some(row => row.hasProductCard),
          previousProductCard: previousSkus.some(row => row.hasProductCard),
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/overview', async (req, res, next) => {
    try {
      const startDate = isoDate(req.query.start_date, 'start_date');
      const endDate = isoDate(req.query.end_date, 'end_date');
      if (startDate > endDate) throw new Error('start_date must be <= end_date');
      const countryCode = optionalCode(req.query.country, 'country');
      const brandCode = optionalCode(req.query.brand, 'brand');
      const shopIds = authorizedShopIds(req, parseShopIds(req.query.shop_ids));

      const previous = previousPeriod(startDate, endDate);
      const [overview, previousOverview] = await Promise.all([
        queryRepository.getPortfolioOverview({
          startDate,
          endDate,
          countryCode,
          brandCode,
          shopIds,
        }),
        queryRepository.getPortfolioOverview({
          startDate: previous.startDate,
          endDate: previous.endDate,
          countryCode,
          brandCode,
          shopIds,
        }),
      ]);
      const comparison = diagnosePortfolio(overview, previousOverview);

      res.json({
        startDate,
        endDate,
        previousStartDate: previous.startDate,
        previousEndDate: previous.endDate,
        comparisonContext: comparisonContext(
          startDate,
          endDate,
          previous.startDate,
          previous.endDate,
        ),
        filters: { countryCode, brandCode, shopIds },
        ...overview,
        comparison,
        currencyPolicy: overview.dimensions.multiCurrency
          ? 'MONETARY_TOTALS_SPLIT_BY_CURRENCY'
          : 'SINGLE_CURRENCY',
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/health', (req, res) => {
    res.json({ ok: true, module: 'shopee-analytics', mode: 'read-only' });
  });

  router.get('/status/portfolio', async (req, res, next) => {
    try {
      const countryCode = optionalCode(req.query.country, 'country');
      const brandCode = optionalCode(req.query.brand, 'brand');
      const shopIds = new Set(authorizedShopIds(req, parseShopIds(req.query.shop_ids)));

      let shops = await queryRepository.listShops({ activeOnly: true });
      if (countryCode) shops = shops.filter(shop => shop.countryCode === countryCode);
      if (brandCode) shops = shops.filter(shop => shop.brandCode === brandCode);
      if (shopIds.size) shops = shops.filter(shop => shopIds.has(shop.shopId));

      const [statuses, backupStatus] = await Promise.all([
        Promise.all(shops.map(async shop => {
        const status = await queryRepository.getSystemStatus({ shopId: shop.shopId });
        const warnings = buildSystemWarnings(status);
        const errorCount = warnings.filter(warning => warning.severity === 'error').length;
        const warningCount = warnings.filter(warning => warning.severity !== 'error').length;
        const sourceDates = status.sources
          .map(source => source.lastSyncedAt)
          .filter(Boolean)
          .map(value => new Date(value))
          .filter(value => !Number.isNaN(value.getTime()));
        const lastAnySyncAt = sourceDates.length
          ? new Date(Math.max(...sourceDates.map(value => value.getTime()))).toISOString()
          : null;
        return {
          shop,
          ok: errorCount === 0,
          errorCount,
          warningCount,
          lastAnySyncAt,
          sources: status.sources,
          tokens: status.tokens,
          warnings,
        };
        })),
        backupStatusProvider(),
      ]);

      res.json({
        filters: { countryCode, brandCode, shopIds: Array.from(shopIds) },
        backup: backupStatus,
        shopCount: statuses.length,
        okShopCount: statuses.filter(status => status.ok).length,
        errorShopCount: statuses.filter(status => !status.ok).length,
        statuses,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/status', async (req, res, next) => {
    try {
      const shopId = positiveInt(req.query.shop_id, 'shop_id');
      const [status, shops, backupStatus] = await Promise.all([
        queryRepository.getSystemStatus({ shopId }),
        queryRepository.listShops({ activeOnly: false }),
        backupStatusProvider(),
      ]);
      const shop = shops.find(row => row.shopId === shopId) || null;

      status.warnings = buildSystemWarnings(status);
      status.ok = !status.warnings.some(warning => warning.severity === 'error');

      let historyCoverage = null;
      if (shop && shop.analyticsStartDate) {
        const requestedEndDate = req.query.history_end_date
          ? isoDate(req.query.history_end_date, 'history_end_date')
          : addDays(localIsoDate(new Date(), shop.timezone), -1);

        if (shop.analyticsStartDate <= requestedEndDate) {
          const coverage = await queryRepository.getBackfillCoverage({
            shopId,
            startDate: shop.analyticsStartDate,
            endDate: requestedEndDate,
            timezone: shop.timezone,
          });
          const expectedDays = daysInclusive(shop.analyticsStartDate, requestedEndDate);
          const expectedGmsRows = coverage.campaignCount * expectedDays;
          const backfillStates = (status.syncStates || []).filter(row =>
            String(row.endpointKey || '').startsWith('BACKFILL_')
          );

          historyCoverage = {
            startDate: shop.analyticsStartDate,
            endDate: requestedEndDate,
            expectedDays,
            ...coverage,
            expectedGmsCampaignDayRows: expectedGmsRows,
            gmsCampaignDayCoverage: expectedGmsRows > 0
              ? Math.min(1, coverage.campaignDayRows / expectedGmsRows)
              : null,
            shopBiDayCoverage: Math.min(1, coverage.shopBiDays / expectedDays),
            backfillStateCount: backfillStates.length,
            backfillErrorCount: backfillStates.filter(row => row.lastError).length,
            backfillStates,
            limitations: [
              'Historical campaign membership is only trusted where a real membership snapshot exists.',
              'Orders/returns are event records, so record counts do not have an expected daily coverage percentage.',
              'Product Card exact-period coverage is separate from API backfill.',
            ],
          };
        }
      }

      res.json({
        shopId,
        shop,
        historyCoverage,
        backup: backupStatus,
        ...status,
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * How each shop is being run.
   *
   * The judgement is the platform's own: it sets a standard for each of
   * these figures and reports the figure beside it, so a shop is said to
   * have met a standard only where the platform's line says it did.
   */
  router.get('/shop-health', async (req, res, next) => {
    try {
      const shops = await queryRepository.listShops({ activeOnly: false });
      const filtered = shops.filter(row => {
        if (req.query.country && row.countryCode !== req.query.country) return false;
        if (req.query.brand && row.brandCode !== req.query.brand) return false;
        if (req.query.shop_id && Number(row.shopId) !== Number(req.query.shop_id)) return false;
        return true;
      });
      // An operator only sees the shops assigned to them. The check that
      // refuses a shop throws, so it cannot be used to narrow a list —
      // the visible set is worked out instead.
      const visible = !req.auth || !req.auth.enabled || req.auth.role === ROLE_SUPER_ADMIN
        ? new Set(filtered.map(row => row.shopId))
        : new Set(req.auth.shopIds);
      const allowed = filtered
        .filter(row => visible.has(row.shopId))
        .map(row => row.shopId);
      if (!shopHealthRepository) throw scopeError('SHOP_HEALTH_UNAVAILABLE', 'Shop health registry is unavailable', 503);
      const readings = await shopHealthRepository.listWithShops({ shopIds: allowed });

      const rows = readings.map(reading => {
        const measures = evaluateMeasures(reading, reading.targets);
        const standing = overallStatus(measures);
        return {
          shopId: reading.shopId,
          displayName: reading.displayName,
          countryCode: reading.countryCode,
          brandCode: reading.brandCode,
          brandName: reading.brandName,
          currency: reading.currency,
          eventDate: reading.eventDate,
          status: standing.status,
          breachCount: standing.breachCount,
          measureCount: standing.measureCount,
          violationTotal: violationTotal(reading),
          fulfillmentFailed: reading.fulfillmentFailed,
          listingFailed: reading.listingFailed,
          customServiceFailed: reading.customServiceFailed,
          measures,
        };
      });
      rows.sort((a, b) => {
        const order = { poor: 0, watch: 1, unknown: 2, good: 3 };
        const byStatus = order[a.status] - order[b.status];
        if (byStatus) return byStatus;
        return (a.shopRating ?? 99) - (b.shopRating ?? 99);
      });

      // The shops that have no reading yet: they are not healthy, they are
      // unconnected, and the page has to be able to say which is which.
      //
      // They are kept out of the table itself — a row of nothing but gaps
      // reads as a shop that was measured and found wanting, which is the
      // opposite of what happened.
      const missing = filtered
        .filter(row => visible.has(row.shopId))
        .filter(row => !rows.some(reading => reading.shopId === row.shopId))
        .map(row => ({
          shopId: row.shopId,
          displayName: row.displayName || row.operatorLabel || `Shop ${row.shopId}`,
          countryCode: row.countryCode,
          brandCode: row.brandCode,
          status: 'unconnected',
        }));

      // Every shop the reader may see, in one list, whether or not it has
      // been read yet. The page is about the shops; a shop that has not been
      // read yet is part of the answer, not an omission from it.
      const allShops = [
        ...rows.map(row => ({ ...row, connected: true })),
        ...missing.map(row => ({
          shopId: row.shopId,
          displayName: row.displayName,
          countryCode: row.countryCode,
          brandCode: row.brandCode,
          eventDate: null,
          status: 'unconnected',
          breachCount: 0,
          measureCount: 0,
          violationTotal: null,
          measures: [],
          connected: false,
        })),
      ];

      const events = await shopHealthRepository.listEvents({ shopIds: allowed, limit: 300 });

      res.json({
        rows: allShops,
        missing,
        events,
        measures: MEASURES.map(spec => ({
          key: spec.key, label: spec.label, labelEn: spec.labelEn, kind: spec.kind, better: spec.better,
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * What the shop's products drew: the visits, the pages, what went into
   * the basket and what was saved for later.
   *
   * The open platform gives none of this — it is the seller centre's
   * export that carries it — so it is kept where the exports are read
   * into, and asked for here.
   */
  router.get('/product-traffic', async (req, res, next) => {
    try {
      const shopId = req.query.shop_id ? positiveInt(req.query.shop_id, 'shop_id') : null;
      // Several shops may be asked for at once: the funnel reads them
      // together when no shop has been chosen.
      const wanted = String(req.query.shop_ids || '').trim();
      const wantedIds = wanted
        ? wanted.split(',').map(value => Number(value.trim())).filter(Boolean)
        : null;
      const rowKind = req.query.row_kind ? String(req.query.row_kind) : 'PRODUCT';
      const shops = await queryRepository.listShops({ activeOnly: false });
      const visible = !req.auth || !req.auth.enabled || req.auth.role === ROLE_SUPER_ADMIN
        ? new Set(shops.map(row => row.shopId))
        : new Set(req.auth.shopIds || []);
      const allowed = shops
        .filter(row => visible.has(row.shopId)
          && (!shopId || row.shopId === shopId)
          && (!wantedIds || wantedIds.includes(row.shopId)))
        .map(row => row.shopId);
      if (!allowed.length) {
        res.json({ rows: [], totals: null });
        return;
      }
      // The products gathered under the parent they share, when asked for:
      // the same figures, read as families rather than one at a time.
      const byParent = String(req.query.by_parent || '') === '1';
      const rows = byParent
        ? await shopHealthRepository.listProductTrafficByParentSku({
          shopIds: allowed, limit: positiveInt(req.query.limit || 300, 'limit'),
        })
        : await shopHealthRepository.listProductTraffic({
          shopIds: allowed, rowKind, limit: positiveInt(req.query.limit || 300, 'limit'),
        });
      // The totals are the shop's own figures for the period, which is
      // what the figures below are parts of.
      const totals = rows.reduce((sum, row) => ({
        productImpression: sum.productImpression + (row.productImpression || 0),
        productClicks: sum.productClicks + (row.productClicks || 0),
        productVisitors: sum.productVisitors + (row.productVisitors || 0),
        productPageViews: sum.productPageViews + (row.productPageViews || 0),
        bounceVisitors: sum.bounceVisitors + (row.bounceVisitors || 0),
        searchClicks: sum.searchClicks + (row.searchClicks || 0),
        likes: sum.likes + (row.likes || 0),
        addToCartVisitors: sum.addToCartVisitors + (row.addToCartVisitors || 0),
        addToCartUnits: sum.addToCartUnits + (row.addToCartUnits || 0),
      }), {
        productImpression: 0, productClicks: 0, productVisitors: 0, productPageViews: 0,
        bounceVisitors: 0, searchClicks: 0, likes: 0, addToCartVisitors: 0, addToCartUnits: 0,
      });
      const rate = (part, whole) => (whole ? part / whole : null);
      // The products that were put in baskets and not bought: a customer
      // who did that was close to buying, and something stood in the way.
      const dropoffs = findAddToCartDropoffs(rows, {
        minAddToCartVisitors: req.query.min_add_to_cart_visitors
          ? Number(req.query.min_add_to_cart_visitors) : undefined,
        maxBuyerRate: req.query.max_buyer_rate
          ? Number(req.query.max_buyer_rate) : undefined,
      });
      res.json({
        rows,
        totals: {
          ...totals,
          bounceRate: rate(totals.bounceVisitors, totals.productVisitors),
          addToCartRate: rate(totals.addToCartVisitors, totals.productVisitors),
        },
        dropoffs,
        rules: ADD_TO_CART_RULES,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/funnel', async (req, res, next) => {
    try {
      const startDate = isoDate(req.query.start_date, 'start_date');
      const endDate = isoDate(req.query.end_date, 'end_date');
      if (startDate > endDate) throw new Error('start_date must be <= end_date');

      const shops = await queryRepository.listShops({ activeOnly: false });
      // One shop, or the shops a filter picks out. The funnel reads a
      // single shop the same way it reads several, so the figures for all
      // of them are the ones already gathered.
      const wanted = String(req.query.shop_ids || '').trim();
      let targets;
      if (wanted) {
        const ids = wanted.split(',').map(value => Number(value.trim())).filter(Boolean);
        targets = shops.filter(row => ids.includes(row.shopId));
        if (targets.length !== ids.length) {
          res.status(404).json({ error: 'SHOP_NOT_CONFIGURED', message: '有店铺未配置' });
          return;
        }
      } else if (req.query.shop_id) {
        const shopId = positiveInt(req.query.shop_id, 'shop_id');
        targets = shops.filter(row => row.shopId === shopId);
        if (!targets.length) {
          res.status(404).json({ error: 'SHOP_NOT_CONFIGURED', message: `Shop ${shopId} is not configured` });
          return;
        }
      } else {
        const country = String(req.query.country || '');
        const brand = String(req.query.brand || '');
        targets = shops.filter(row =>
          (!country || row.countryCode === country)
          && (!brand || row.brandCode === brand));
      }
      if (!targets.length) {
        res.status(404).json({ error: 'NO_SHOP_MATCHES', message: '没有符合筛选条件的店铺' });
        return;
      }
      for (const target of targets) assertShopAccess(req, target.shopId);

      const { days, sources } = await queryRepository.getShopFunnelDaily({
        shopIds: targets.map(row => row.shopId),
        startDate,
        endDate,
        // The shops may sit in different time zones; the days are drawn
        // with the first shop's, and the reader is told which.
        timezone: targets[0].timezone || 'UTC',
      });
      const { dates, rows } = buildFunnelRows(days, sources);

      // Money cannot be added across currencies: rupiah and ringgit are
      // not the same number twice over. When the shops do not share one
      // currency the money is left out rather than totalled wrongly, and
      // the reader is told why.
      const currencies = [...new Set(targets.map(row => row.currency).filter(Boolean))];
      const mixedCurrency = currencies.length > 1;
      if (mixedCurrency) {
        for (const row of rows) {
          if (row.format !== 'money') continue;
          row.values = row.values.map(() => null);
          row.currencyNote = '多币种未合计';
        }
      }

      const one = targets.length === 1;
      res.json({
        shop: one ? {
          shopId: targets[0].shopId,
          displayName: targets[0].displayName,
          countryName: targets[0].countryName,
          brandName: targets[0].brandName,
          currency: targets[0].currency,
          timezone: targets[0].timezone,
        } : null,
        shops: targets.map(row => ({
          shopId: row.shopId,
          displayName: row.displayName,
          countryName: row.countryName,
          brandName: row.brandName,
          currency: row.currency,
        })),
        shopCount: targets.length,
        currency: one ? targets[0].currency : null,
        currencies,
        mixedCurrency,
        startDate,
        endDate,
        dates,
        rows,
        missingSources: missingSources(rows),
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/campaigns', async (req, res, next) => {
    try {
      const shopId = positiveInt(req.query.shop_id, 'shop_id');
      const startDate = isoDate(req.query.start_date, 'start_date');
      const endDate = isoDate(req.query.end_date, 'end_date');
      if (startDate > endDate) throw new Error('start_date must be <= end_date');
      const [campaigns, searchItemsByCampaign, sellerEvidenceRows] = await Promise.all([
        queryRepository.listCampaignOverview({ shopId, startDate, endDate, campaignTypeNormalized: 'GMS' }),
        queryRepository.listCampaignSearchItems({ shopId, endDate, campaignTypeNormalized: 'GMS' }),
        adPromotionRepository
          ? adPromotionRepository.list({ shopId, startDate, endDate, promotionType: 'SHOP_GMV_MAX', dataSource: 'MANUAL_IMPORT' })
          : [],
      ]);
      const sellerEvidence = aggregateGmsSellerEvidence(sellerEvidenceRows, startDate, endDate);
      const enrichedCampaigns = campaigns.map(campaign => {
        const evidence = sellerEvidence.get(Number(campaign.campaignId));
        const searchItems = searchItemsByCampaign.get(Number(campaign.campaignId)) || [];
        if (!evidence) return { ...campaign, searchItems };
        return {
          ...campaign,
          searchItems,
          performance: {
            ...campaign.performance,
            voucherAmount: evidence.voucherAmount,
            voucheredSales: evidence.voucheredSales,
          },
          sellerCentreEvidence: evidence,
        };
      });
      res.json({ shopId, startDate, endDate, campaigns: enrichedCampaigns });
    } catch (error) {
      next(error);
    }
  });

  router.get('/ad-promotions', async (req, res, next) => {
    try {
      if (!adPromotionRepository) throw new Error('Unified ad promotions are unavailable');
      const shopId = positiveInt(req.query.shop_id, 'shop_id');
      const startDate = isoDate(req.query.start_date, 'start_date');
      const endDate = isoDate(req.query.end_date, 'end_date');
      const promotionType = req.query.promotion_type || null;
      const dataSource = req.query.data_source || null;
      const campaignStatus = req.query.campaign_status || null;
      const productId = req.query.product_id === undefined ? null : positiveInt(req.query.product_id, 'product_id');
      res.json({ shopId, startDate, endDate, promotions: await adPromotionRepository.list({ shopId, startDate, endDate, promotionType, dataSource, campaignStatus, productId }) });
    } catch (error) { next(error); }
  });

  router.post('/ad-groups/manual', express.json({ limit: '256kb' }), async (req, res, next) => {
    try {
      if (!adPromotionRepository) throw new Error('Unified ad promotions are unavailable');
      const row = normalizeManualPromotion(req.body, { source: 'MANUAL' });
      assertShopAccess(req, row.shopId);
      if (row.promotionType !== 'AD_GROUP') throw new Error('manual endpoint accepts AD_GROUP only');
      if (!shopScopeRepository) throw new Error('Shop scope registry is unavailable');
      if (!await shopScopeRepository.find(row.shopId)) {
        throw scopeError('TARGET_SHOP_NOT_REGISTERED', `Shop ${row.shopId} must be registered before manual import`);
      }
      const items = Array.isArray(req.body && req.body.items) ? req.body.items.map(normalizeManualItem) : [];
      row.itemCount = items.length;
      const saved = await adPromotionRepository.saveWithItems(row, items);
      res.status(201).json({ ok: true, ...saved, itemCount: items.length, dataQualityStatus: row.dataQualityStatus, qualityFlags: row.qualityFlags });
    } catch (error) { next(error); }
  });

  router.post('/ad-groups/import', express.raw({ type: ['text/csv', 'application/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], limit: '16mb' }), async (req, res, next) => {
    try {
      if (!adPromotionRepository) throw new Error('Unified ad promotions are unavailable');
      if (!req.body || !Buffer.isBuffer(req.body) || !req.body.length) throw new Error('a CSV or XLSX request body is required');
      if (req.query.target_shop_id === undefined || req.query.target_shop_id === '') {
        throw scopeError('TARGET_SHOP_REQUIRED', 'target_shop_id is required for an Ad Group preview or import');
      }
      const targetShopId = positiveInt(req.query.target_shop_id, 'target_shop_id');
      const filename = String(req.query.filename || req.headers['x-filename'] || 'report.csv');
      const { report, preview } = parseShopeeAdGroupFile({ buffer: req.body, filename });
      const persist = req.query.confirm === 'YES';
      if (report.metadata.shopId !== targetShopId) {
        if (!persist && req.query.preview_only === 'YES') {
          res.json({ ok: true, persisted: false, ...preview, targetShopId, shopScope: 'MISMATCH' });
          return;
        }
        throw scopeError(
          'SHOP_SCOPE_MISMATCH',
          `Source shop ${report.metadata.shopId} does not match target shop ${targetShopId}`,
          409,
        );
      }
      const scopedPreview = { ...preview, targetShopId, shopScope: 'MATCH' };
      if (!persist) { res.json({ ok: true, persisted: false, ...scopedPreview }); return; }
      if (!shopScopeRepository) throw new Error('Shop scope registry is unavailable');
      const targetScope = await shopScopeRepository.find(targetShopId);
      if (!targetScope) {
        throw scopeError('TARGET_SHOP_NOT_REGISTERED', `Shop ${targetShopId} must be explicitly registered before import`);
      }
      let persistenceResult = null;
      if (report.reportType === 'OPERATION_LOG') {
        if (!operationRepo) throw new Error('Operation history repository is unavailable');
        persistenceResult = await adPromotionRepository.withTransaction(async queryable =>
          operationRepo.saveImportedOperations({
            shopId: report.metadata.shopId,
            campaignId: report.metadata.campaignId,
            operations: report.operations,
            queryable,
          }));
      } else {
        await adPromotionRepository.withTransaction(async queryable => {
          for (const entry of report.groups) {
            await adPromotionRepository.saveWithItems(entry.group, entry.items, { queryable });
          }
        });
      }
      res.status(201).json({ ok: true, persisted: true, ...scopedPreview, ...(persistenceResult || {}) });
    } catch (error) { next(error); }
  });

  router.get('/product-ads', async (req, res, next) => {
    try {
      const shopId = positiveInt(req.query.shop_id, 'shop_id');
      const startDate = isoDate(req.query.start_date, 'start_date');
      const endDate = isoDate(req.query.end_date, 'end_date');
      if (startDate > endDate) throw new Error('start_date must be <= end_date');
      const adType = String(req.query.ad_type || '').toLowerCase();
      if (!['manual', 'auto'].includes(adType)) throw new Error('ad_type must be manual or auto');
      const campaignTypeNormalized = adType === 'manual' ? 'MANUAL_PRODUCT_AD' : 'AUTO_PRODUCT_AD';
      const [campaigns, searchItemsByCampaign] = await Promise.all([
        queryRepository.listProductAdsOverview({ shopId, startDate, endDate, adType }),
        queryRepository.listCampaignSearchItems({ shopId, endDate, campaignTypeNormalized }),
      ]);
      res.json({
        shopId, startDate, endDate, adType,
        campaigns: campaigns.map(campaign => ({
          ...campaign,
          searchItems: searchItemsByCampaign.get(Number(campaign.campaignId)) || [],
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/product-ads/:campaignId/items', async (req, res, next) => {
    try {
      const shopId = positiveInt(req.query.shop_id, 'shop_id');
      const campaignId = positiveInt(req.params.campaignId, 'campaignId');
      const endDate = isoDate(req.query.end_date, 'end_date');
      const items = await queryRepository.listProductAdItems({ shopId, campaignId, endDate });
      res.json({ shopId, campaignId, endDate, items });
    } catch (error) {
      next(error);
    }
  });

  router.get('/product-ads/:campaignId/detail', async (req, res, next) => {
    try {
      const shopId = positiveInt(req.query.shop_id, 'shop_id');
      const campaignId = positiveInt(req.params.campaignId, 'campaignId');
      const startDate = isoDate(req.query.start_date, 'start_date');
      const endDate = isoDate(req.query.end_date, 'end_date');
      if (startDate > endDate) throw new Error('start_date must be <= end_date');
      const adType = String(req.query.ad_type || '').toLowerCase();
      if (!['manual', 'auto'].includes(adType)) throw new Error('ad_type must be manual or auto');

      const campaigns = await queryRepository.listProductAdsOverview({ shopId, startDate, endDate, adType });
      const campaign = campaigns.find(row => row.campaignId === campaignId);
      if (!campaign) {
        res.status(404).json({ error: 'PRODUCT_AD_NOT_FOUND', message: `Campaign ${campaignId} is not a ${adType} Product Ad` });
        return;
      }

      const [latestSetting, items, daily, shopStrategy] = await Promise.all([
        queryRepository.getLatestCampaignSetting({ shopId, campaignId }),
        queryRepository.listProductAdItems({ shopId, campaignId, endDate }),
        repository.loadCampaignDaily({ shopId, campaignId, startDate, endDate }),
        strategyRepository && typeof strategyRepository.getShopStrategy === 'function'
          ? strategyRepository.getShopStrategy(shopId)
          : Promise.resolve({ weeklyOrderReference: 25 }),
      ]);

      let breakEvenRoas = 0;
      let breakEvenByItem = {};
      if (strategyRepository && typeof strategyRepository.getItemBreakEvenMap === 'function' && items.length) {
        const map = await strategyRepository.getItemBreakEvenMap({
          shopId,
          itemIds: items.map(item => item.itemId),
        });
        breakEvenByItem = Object.fromEntries(
          items.map(item => [String(item.itemId), Number(map.get(String(item.itemId)) || 0)]),
        );
        if (adType === 'manual' && items.length === 1) {
          breakEvenRoas = breakEvenByItem[String(items[0].itemId)] || 0;
        }
      }

      const raw = latestSetting && latestSetting.raw || {};
      const autoInfo = Array.isArray(raw.auto_product_ads_info) ? raw.auto_product_ads_info : [];
      const autoStatusMap = new Map(autoInfo.map(row => [String(row.item_id), row.status || null]));
      const detailedItems = items.map(item => ({
        ...item,
        autoProductStatus: autoStatusMap.get(String(item.itemId)) || null,
        breakEvenRoas: breakEvenByItem[String(item.itemId)] || 0,
      }));

      const performance = sumPerformance(daily);
      const diagnosis = productAdDiagnosis({
        performance,
        days: daysInclusive(startDate, endDate),
        targetRoas: latestSetting && latestSetting.targetRoas || campaign.targetRoas || 0,
        breakEvenRoas,
        weeklyOrderReference: Number(shopStrategy.weeklyOrderReference || 25),
        adType,
        itemCount: detailedItems.length,
      });

      res.json({
        shopId,
        campaignId,
        adType,
        startDate,
        endDate,
        campaign,
        latestSetting: latestSetting ? {
          status: latestSetting.status,
          biddingMethod: latestSetting.biddingMethod,
          campaignBudget: latestSetting.campaignBudget,
          targetRoas: latestSetting.targetRoas,
          observedAt: latestSetting.observedAt,
          adName: raw.common_info && raw.common_info.ad_name || campaign.adName || null,
          campaignPlacement: raw.common_info && raw.common_info.campaign_placement || campaign.campaignPlacement || null,
          enhancedCpc: raw.manual_bidding_info && raw.manual_bidding_info.enhanced_cpc,
          selectedKeywordCount: Array.isArray(raw.manual_bidding_info && raw.manual_bidding_info.selected_keywords)
            ? raw.manual_bidding_info.selected_keywords.length
            : 0,
        } : null,
        diagnosis,
        items: detailedItems,
        daily: daily.map(row => ({
          eventDate: String(row.event_date).slice(0, 10),
          performance: sumPerformance([row]),
        })),
        itemPerformanceAvailable: false,
        itemPerformanceNote: adType === 'auto'
          ? '当前接入的 Product Ads 日表现接口提供 Campaign 级数据；自动选品只展示真实 Membership/状态，不伪造 SKU 贡献。'
          : null,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/campaigns/:campaignId/analysis', async (req, res, next) => {
    try {
      const shopId = positiveInt(req.query.shop_id, 'shop_id');
      const campaignId = positiveInt(req.params.campaignId, 'campaignId');
      const startDate = isoDate(req.query.start_date, 'start_date');
      const endDate = isoDate(req.query.end_date, 'end_date');
      if (startDate > endDate) throw new Error('start_date must be <= end_date');

      const latest = await queryRepository.getLatestCampaignSetting({ shopId, campaignId });
      const targetRoas = req.query.target_roas === undefined
        ? (latest && Number(latest.targetRoas) > 0 ? Number(latest.targetRoas) : null)
        : (Number(req.query.target_roas) > 0 ? Number(req.query.target_roas) : null);
      const breakEvenRoas = Number(req.query.break_even_roas || 0);

      const analysis = await analyzeCampaignWindow({
        repository,
        strategyRepository,
        shopId,
        campaignId,
        startDate,
        endDate,
        targetRoas,
        breakEvenRoas,
        campaignBudget: latest && latest.campaignBudget,
        eventDateSet: eventSetForRange(startDate, endDate),
      });

      const ids = analysis.diagnosis.items.map(item => item.itemId).filter(Boolean);
      const [names, recommended, productCard, coverageContext, sellerEvidenceRows] = await Promise.all([
        queryRepository.getCampaignItemNames({ shopId, itemIds: ids }),
        queryRepository.getLatestRecommendedRoiMap({ shopId, itemIds: ids }),
        queryRepository.getProductCardPeriodMap({ shopId, startDate, endDate, itemIds: ids }),
        queryRepository.getCampaignCoverageContext({ shopId, campaignId, startDate, endDate }),
        adPromotionRepository
          ? adPromotionRepository.list({ shopId, startDate, endDate, promotionType: 'SHOP_GMV_MAX', dataSource: 'MANUAL_IMPORT' })
          : [],
      ]);
      const campaignSellerEvidence = aggregateGmsSellerEvidence(sellerEvidenceRows, startDate, endDate).get(campaignId) || null;
      const evidenceItems = campaignSellerEvidence?.items || {};
      analysis.diagnosis.items = analysis.diagnosis.items.map(item => ({
        ...item,
        ...(names.get(String(item.itemId)) || {}),
        recommendedRoi: recommended.get(String(item.itemId)) || null,
        productCard: productCard.get(String(item.itemId)) || null,
        voucherAmount: evidenceItems[String(item.itemId)]?.voucherAmount ?? null,
        voucheredSales: evidenceItems[String(item.itemId)]?.voucheredSales ?? null,
      }));
      if (campaignSellerEvidence) {
        analysis.diagnosis.campaign = {
          ...analysis.diagnosis.campaign,
          voucherAmount: campaignSellerEvidence.voucherAmount,
          voucheredSales: campaignSellerEvidence.voucheredSales,
        };
        analysis.sellerCentreEvidence = campaignSellerEvidence;
      }
      analysis.latestSetting = latest;
      analysis.dataQuality = evaluateItemCoverage({
        campaignExpense: analysis.diagnosis.campaign.expense,
        itemExpense: coverageContext.itemExpense,
        membershipCount: coverageContext.membershipCount,
        performanceItemCount: coverageContext.performanceItemCount,
      });
      analysis.dataQuality.storedItemCount = coverageContext.storedItemCount;
      res.json(analysis);
    } catch (error) {
      next(error);
    }
  });

  router.post('/skill-jobs/campaigns/:campaignId', express.json({ limit: '32kb' }), async (req, res, next) => {
    try {
      if (typeof runSkillAnalysis !== 'function') throw new Error('Skill execution is not configured');
      const shopId = positiveInt(req.query.shop_id, 'shop_id');
      assertShopAccess(req, shopId);
      const campaignId = positiveInt(req.params.campaignId, 'campaignId');
      const startDate = isoDate(req.body && req.body.start_date, 'start_date');
      const endDate = isoDate(req.body && req.body.end_date, 'end_date');
      if (startDate > endDate) throw new Error('start_date must be <= end_date');
      const language = normalizeReportLanguage(req.body && req.body.language);
      const job = skillJobManager.create({
        shopId, language,
        task: onProgress => runSkillAnalysis({
          shopId, campaignId, startDate, endDate, triggerType: 'MANUAL',
          triggerReason: req.body && req.body.reason ? String(req.body.reason).slice(0, 500) : null,
          outputLanguage: language, onProgress,
        }),
      });
      res.status(202).json({ job });
    } catch (error) { next(error); }
  });

  router.post('/skill-jobs/ad-groups', express.json({ limit: '32kb' }), async (req, res, next) => {
    try {
      if (typeof runAdGroupSkillAnalysis !== 'function') throw new Error('Ad Group Skill execution is not configured');
      const shopId = positiveInt(req.query.shop_id, 'shop_id');
      assertShopAccess(req, shopId);
      const promotionKey = String(req.body && req.body.promotion_key || '').trim();
      if (!promotionKey || promotionKey.length > 512) throw new Error('promotion_key is required');
      const startDate = isoDate(req.body && req.body.start_date, 'start_date');
      const endDate = isoDate(req.body && req.body.end_date, 'end_date');
      if (startDate > endDate) throw new Error('start_date must be <= end_date');
      const language = normalizeReportLanguage(req.body && req.body.language);
      const job = skillJobManager.create({
        shopId, language,
        task: onProgress => runAdGroupSkillAnalysis({
          shopId, promotionKey, startDate, endDate, triggerType: 'MANUAL',
          triggerReason: req.body && req.body.reason ? String(req.body.reason).slice(0, 500) : null,
          outputLanguage: language, onProgress,
        }),
      });
      res.status(202).json({ job });
    } catch (error) { next(error); }
  });

  router.get('/skill-jobs/:jobId', (req, res, next) => {
    try {
      const shopId = positiveInt(req.query.shop_id, 'shop_id');
      assertShopAccess(req, shopId);
      const job = skillJobManager.get(req.params.jobId, { shopId });
      if (!job) return res.status(404).json({ error: 'SKILL_JOB_NOT_FOUND' });
      res.json({ job });
    } catch (error) { next(error); }
  });

  router.post('/ad-groups/skill-report', express.json({ limit: '32kb' }), async (req, res, next) => {
    try {
      if (typeof runAdGroupSkillAnalysis !== 'function') throw new Error('Ad Group Skill execution is not configured');
      const shopId = positiveInt(req.query.shop_id, 'shop_id');
      const promotionKey = String(req.body && req.body.promotion_key || '').trim();
      if (!promotionKey || promotionKey.length > 512) throw new Error('promotion_key is required');
      const startDate = isoDate(req.body && req.body.start_date, 'start_date');
      const endDate = isoDate(req.body && req.body.end_date, 'end_date');
      if (startDate > endDate) throw new Error('start_date must be <= end_date');
      const result = await runAdGroupSkillAnalysis({
        shopId,
        promotionKey,
        startDate,
        endDate,
        triggerType: 'MANUAL',
        triggerReason: req.body && req.body.reason ? String(req.body.reason).slice(0, 500) : null,
      });
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get('/ad-groups/skill-report', async (req, res, next) => {
    try {
      if (!skillReportRepository) throw new Error('Skill report repository is not configured');
      const shopId = positiveInt(req.query.shop_id, 'shop_id');
      assertShopAccess(req, shopId);
      const promotionKey = String(req.query.promotion_key || '').trim();
      if (!promotionKey || promotionKey.length > 512) throw new Error('promotion_key is required');
      const startDate = req.query.start_date ? isoDate(req.query.start_date, 'start_date') : null;
      const endDate = req.query.end_date ? isoDate(req.query.end_date, 'end_date') : null;
      if ((startDate && !endDate) || (!startDate && endDate)) throw new Error('start_date and end_date must be supplied together');
      if (startDate && startDate > endDate) throw new Error('start_date must be <= end_date');
      const row = await skillReportRepository.latest({
        shopId,
        promotionKey,
        completedOnly: true,
        periodStart: startDate,
        periodEnd: endDate,
      });
      if (!row) return res.status(404).json({ error: 'SKILL_REPORT_NOT_FOUND' });
      res.json({
        id: row.id,
        shopId: Number(row.shop_id),
        campaignId: row.campaign_id,
        period: { startDate: String(row.period_start).slice(0,10), endDate: String(row.period_end).slice(0,10) },
        generatedAt: row.generated_at,
        report: row.report_json,
        context: {
          maturity: row.maturity_json || null,
          timeContext: row.time_context_json || null,
          itemCurrentWindow: row.item_current_window_json || null,
          campaignMetrics: row.campaign_metrics_json || null,
          dataQuality: row.data_quality_json || null,
          campaign: row.campaign_context_json || null,
        },
      });
    } catch (error) { next(error); }
  });

  router.get('/ad-groups/operations', async (req, res, next) => {
    try {
      const shopId = positiveInt(req.query.shop_id, 'shop_id');
      assertShopAccess(req, shopId);
      const groupStartDate = isoDate(req.query.group_start_date, 'group_start_date');
      const startDate = isoDate(req.query.start_date, 'start_date');
      const endDate = isoDate(req.query.end_date, 'end_date');
      if (startDate > endDate) throw new Error('start_date must be <= end_date');
      const itemCountRaw = req.query.item_count;
      const itemCount = itemCountRaw === undefined || itemCountRaw === '' ? null : Number(itemCountRaw);
      if (itemCount !== null && (!Number.isSafeInteger(itemCount) || itemCount < 0)) throw new Error('item_count must be a non-negative integer');
      if (!queryRepository || typeof queryRepository.resolveAdGroupOperationCampaign !== 'function') {
        throw new Error('Ad Group operation history is unavailable');
      }
      const link = await queryRepository.resolveAdGroupOperationCampaign({ shopId, groupStartDate, itemCount });
      const operations = link.campaignId && typeof queryRepository.loadCampaignOperations === 'function'
        ? await queryRepository.loadCampaignOperations({ shopId, campaignId: link.campaignId, startDate, endDate })
        : [];
      res.json({
        shopId,
        groupStartDate,
        startDate,
        endDate,
        operationCampaignId: link.campaignId || null,
        match: link.match,
        candidates: link.candidates || [],
        operations,
      });
    } catch (error) { next(error); }
  });

  router.get('/campaigns/:campaignId/skill-report', async (req, res, next) => {
    try {
      if (!skillReportRepository) throw new Error('Skill report repository is not configured');
      const shopId = positiveInt(req.query.shop_id, 'shop_id');
      const campaignId = positiveInt(req.params.campaignId, 'campaignId');
      const report = await skillReportRepository.latest({ shopId, campaignId });
      if (!report) {
        res.status(404).json({ error: 'SKILL_REPORT_NOT_FOUND' });
        return;
      }
      res.json(report);
    } catch (error) {
      next(error);
    }
  });

  router.post('/campaigns/:campaignId/skill-report', express.json({ limit: '32kb' }), async (req, res, next) => {
    try {
      if (typeof runSkillAnalysis !== 'function') throw new Error('Skill execution is not configured');
      const shopId = positiveInt(req.query.shop_id, 'shop_id');
      const campaignId = positiveInt(req.params.campaignId, 'campaignId');
      const startDate = isoDate(req.body && req.body.start_date, 'start_date');
      const endDate = isoDate(req.body && req.body.end_date, 'end_date');
      if (startDate > endDate) throw new Error('start_date must be <= end_date');
      const result = await runSkillAnalysis({
        shopId,
        campaignId,
        startDate,
        endDate,
        triggerType: 'MANUAL',
        triggerReason: req.body && req.body.reason ? String(req.body.reason).slice(0, 500) : null,
      });
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get('/items/:itemId/timeline', async (req, res, next) => {
    try {
      const shopId = positiveInt(req.query.shop_id, 'shop_id');
      const itemId = positiveInt(req.params.itemId, 'itemId');
      const startDate = isoDate(req.query.start_date, 'start_date');
      const endDate = isoDate(req.query.end_date, 'end_date');
      if (startDate > endDate) throw new Error('start_date must be <= end_date');
      const events = await queryRepository.getItemTimeline({
        shopId, itemId, startDate, endDate,
      });
      res.json({ shopId, itemId, startDate, endDate, events });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = {
  positiveInt,
  isoDate,
  optionalCode,
  sourceEvidenceMetric,
  aggregateGmsSellerEvidence,
  parseShopIds,
  eventMixForRange,
  comparisonContext,
  eventSetForRange,
  storeDetailMetrics,
  addSkuPeriodComparison,
  skuContributionSummary,
  createShopeeAnalyticsRouter,
};
