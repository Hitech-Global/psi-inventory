'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const { createAnalyticsPool } = require('./pg');
const { createShopeeAnalyticsRouter } = require('./http-router');
const { createAdGroupImportAsyncRouter } = require('./ad-group-import-async-router');
const { createProductAdsV2Router } = require('./product-ads-v2-router');
const { createProductAdSellerCentreRouter } = require('./product-ad-seller-centre-router');
const { createProductAdsOverviewEvidenceRouter } = require('./product-ads-overview-evidence-router');
const { createProductAdsSourceRouter } = require('./product-ads-source-router');
const { createManualDataSyncRouter } = require('./manual-data-sync-router');
const { createBackupStatusProvider } = require('./backup-status');
const { createConfiguredSkillProvider } = require('./skill-provider');
const { createSkillRuntime } = require('./skill-runtime');
const { ShopeeShopScopeRepository } = require('./shop-scope-repository');
const { ShopeeShopHealthRepository } = require('./shop-health-repository');
const { TikTokQueryRepository } = require('./tiktok-query-repository');
const { createFeishuAuth } = require('./feishu-auth');
const { BrandPortalOAuthService } = require('./brand-portal-oauth-service');
const { AppOAuthService } = require('./app-oauth-service');
const { ErpOAuthService } = require('./erp-oauth-service');
const { TikTokOAuthService } = require('./tiktok-oauth-service');
const { TikTokMarketingTokenRepository } = require('./tiktok-marketing-token-repository');
const { TikTokMarketingOAuthService } = require('./tiktok-marketing-oauth-service');
const { TikTokMarketingSyncRunner } = require('./tiktok-marketing-sync-runner');
const { createReviewerAuth, ROLE_REVIEWER } = require('./reviewer-auth');

function resolveBindAddress(env = process.env) {
  const requested = env.SHOPEE_ANALYTICS_HOST || '127.0.0.1';
  const isLoopback = requested === '127.0.0.1' || requested === 'localhost' || requested === '::1';
  if (!isLoopback && env.SHOPEE_ANALYTICS_ALLOW_REMOTE !== 'YES') {
    throw new Error('Refusing remote bind. Set SHOPEE_ANALYTICS_ALLOW_REMOTE=YES explicitly.');
  }
  return requested;
}

function resolvePort(env = process.env) {
  const value = Number(env.SHOPEE_ANALYTICS_PORT || 3090);
  if (!Number.isSafeInteger(value) || value < 1 || value > 65535) {
    throw new Error('SHOPEE_ANALYTICS_PORT must be 1..65535');
  }
  return value;
}

function createApp({ pool, skillProvider = null, importJobPool = null }) {
  const app = express();
  app.disable('x-powered-by');

  const {
    repository,
    strategyRepository,
    queryRepository,
    adPromotionRepository,
    skillReportRepository,
    runSkillAnalysis,
    runAdGroupSkillAnalysis,
  } = createSkillRuntime({ pool, skillProvider });
  const shopScopeRepository = new ShopeeShopScopeRepository({ pool });
  const shopHealthRepository = new ShopeeShopHealthRepository({ pool });
  // TikTok 数据查询：落库层只管写，查询要单独一个 repository。
  const tiktokQueryRepository = new TikTokQueryRepository({ pool });
  const backupStatusProvider = createBackupStatusProvider();
  const reviewerAuth = createReviewerAuth();
  const feishuAuth = createFeishuAuth({ pool, reviewerAuth });
  const brandPortalOAuthService = new BrandPortalOAuthService({ pool });
  // The applications that came after the shop side and the ERP: the
  // affiliate marketing, the videos, the online shops, the operations
  // brain and the order analysis. They are authorized the same way, so
  // one service does it for whichever one asked.
  const appOAuthService = new AppOAuthService({ pool });
  const erpOAuthService = new ErpOAuthService({ pool });
  const tiktokOAuthService = new TikTokOAuthService({ pool });

  // TikTok Marketing API（广告线）：与 Shop 侧完全独立的凭据域。
  // 独立的应用 ID/密钥、独立的授权流程、独立的 24 小时 token 与刷新调度。
  const tiktokMarketingTokenRepository = new TikTokMarketingTokenRepository({ pool });
  const tiktokMarketingOAuthService = new TikTokMarketingOAuthService({
    tokenRepository: tiktokMarketingTokenRepository,
  });
  const tiktokMarketingSyncRunner = new TikTokMarketingSyncRunner({
    pool,
    tokenRepository: tiktokMarketingTokenRepository,
  });

  // Docker/host health checks must remain available before auth middleware.
  // This endpoint exposes no shop, user, or business data.
  app.get('/api/shopee-analytics/health', (req, res) => {
    res.json({ ok: true, module: 'shopee-analytics', mode: 'read-only' });
  });
  app.get('/review', reviewerAuth.handleEntry);
  app.use('/api/shopee-review', reviewerAuth.router);
  app.use('/api/shopee-auth', feishuAuth.router);
  app.use('/api/shopee-analytics', feishuAuth.requireApiSession, feishuAuth.enforceShopAccess, (req, res, next) => {
    if (req.auth?.role === ROLE_REVIEWER && !['GET','HEAD','OPTIONS'].includes(req.method)) {
      res.status(403).json({ error:'REVIEW_READ_ONLY', message:'Shopee reviewer access is read-only.' });
      return;
    }
    next();
  });

  if (importJobPool) {
    app.use('/api/shopee-analytics', createAdGroupImportAsyncRouter({ pool: importJobPool }));
  }

  app.use('/api/shopee-analytics', createManualDataSyncRouter({ pool }));
  app.use('/api/shopee-analytics', createProductAdsV2Router({ pool }));
  app.use('/api/shopee-analytics', createProductAdSellerCentreRouter({ pool }));
  app.use('/api/shopee-analytics', createProductAdsOverviewEvidenceRouter({ pool }));
  // Mounted before the legacy analytics router so Product Ads campaign lists
  // preserve Shopee's source daily precision while retaining the existing URL.
  app.use('/api/shopee-analytics', createProductAdsSourceRouter({ pool }));

  app.use('/api/shopee-analytics', createShopeeAnalyticsRouter({
    repository,
    strategyRepository,
    queryRepository,
    adPromotionRepository,
    shopScopeRepository,
    backupStatusProvider,
    skillReportRepository,
    runSkillAnalysis,
    runAdGroupSkillAnalysis,
    brandPortalOAuthService,
    appOAuthService,
    erpOAuthService,
    tiktokOAuthService,
    shopHealthRepository,
    tiktokQueryRepository,
    tiktokMarketingOAuthService,
    tiktokMarketingTokenRepository,
    tiktokMarketingSyncRunner,
  }));

  const webDir = path.join(__dirname, '..', 'web');
  const indexPath = path.join(webDir, 'index.html');
  const loginPath = path.join(webDir, 'login.html');
  const connectionsPath = path.join(webDir, 'connections.html');
  const assetVersion = Date.now().toString(36);
  let indexHtml = fs.readFileSync(indexPath, 'utf8');
  const loginHtml = fs.readFileSync(loginPath, 'utf8');
  const connectionsHtml = fs.readFileSync(connectionsPath, 'utf8');
  // Every local script and stylesheet carries the version, so that a
  // change to one of them is picked up rather than served from a
  // browser's cache.
  //
  // The files the page leans on are named here, and the page is read as
  // well: a file named in one place but missing from the other is a file
  // the reader sees yesterday's version of, without knowing why.
  const LOCAL_ASSETS = [
    '/styles.css', '/i18n-v1.js', '/currency-format-v1.js',
    '/shopee-metric-labels.js', '/app.js', '/ad-group-import-async.js',
    '/funnel-ui-v1.js', '/shop-health-ui-v1.js', '/shop-connections-ui-v1.js',
    '/platform-connections-ui-v1.js', '/tiktok-ui-v1.js',
  ];
  const assets = new Set(LOCAL_ASSETS);
  for (const match of indexHtml.matchAll(/(?:src|href)="(\/[a-z0-9._\/-]+\.(?:js|css))"/gi)) {
    assets.add(match[1]);
  }
  for (const asset of assets) {
    indexHtml = indexHtml.replace(asset, `${asset}?v=${assetVersion}`);
  }
  const injectedScripts = [
    '/date-range-picker-v2.js',
    '/product-card-ui-v2.js', '/product-card-copy-v2.js', '/ad-channel-ui-v3.js',
    '/product-card-data-contract-v3.js', '/product-card-coverage-v4.js', '/table-sort-v1.js',
    '/auth-ui-v1.js',
  ].map(src => `  <script src="${src}?v=${assetVersion}" defer></script>`).join('\n');
  indexHtml = indexHtml.replace('</body>', `${injectedScripts}\n</body>`);

  app.get('/login', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.type('html').send(loginHtml);
  });
  app.get('/auth/feishu/login', feishuAuth.handleLogin);
  app.get('/auth/feishu/callback', feishuAuth.handleCallback);

  // 平台接入页：Shopee 与 TikTok 的开放平台授权入口。
  // 与首页一样要求已登录，否则无法知道谁在操作授权。
  app.get('/connections', feishuAuth.requireWebSession, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.type('html').send(connectionsHtml);
  });

  app.get(['/', '/index.html'], feishuAuth.requireWebSession, (req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.type('html').send(indexHtml);
  });

  app.use(express.static(webDir, {
    etag: true,
    maxAge: 0,
    index: 'index.html',
    setHeaders(res) {
      res.set('Cache-Control', 'no-cache');
    },
  }));

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = Number.isInteger(error.status)
      ? error.status
      : /must be|start_date|end_date|Invalid/.test(String(error.message)) ? 400 : 500;
    console.error('[Shopee Analytics]', error.stack || error);
    res.status(status).json({
      error: error.code || (status === 400 ? 'INVALID_REQUEST' : 'INTERNAL_ERROR'),
      message: error.message,
    });
  });

  return app;
}

async function main() {
  const host = resolveBindAddress();
  const port = resolvePort();
  const pool = createAnalyticsPool();
  const asyncImports = process.env.SHOPEE_AD_GROUP_IMPORT_ASYNC === 'YES';
  const importJobPool = asyncImports ? createAnalyticsPool({ max: 1 }) : null;
  const skillProvider = createConfiguredSkillProvider();
  const app = createApp({ pool, skillProvider, importJobPool });

  const server = app.listen(port, host, () => {
    console.log(`Shopee Analytics V1: http://${host}:${port}`);
    console.log(`Ad Group imports: ${asyncImports ? 'dedicated-worker' : 'legacy-inline'}`);
  });

  const close = async signal => {
    console.log(`\nReceived ${signal}, shutting down...`);
    server.close(async () => {
      await Promise.all([
        pool.end(),
        importJobPool ? importJobPool.end() : Promise.resolve(),
      ]);
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => close('SIGTERM'));
  process.on('SIGINT', () => close('SIGINT'));
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error);
    process.exitCode = 1;
  });
}

module.exports = { createApp, resolveBindAddress, resolvePort };
