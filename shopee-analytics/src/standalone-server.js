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
const { createFeishuAuth } = require('./feishu-auth');
const { BrandPortalOAuthService } = require('./brand-portal-oauth-service');

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
  const backupStatusProvider = createBackupStatusProvider();
  const feishuAuth = createFeishuAuth({ pool });
  const brandPortalOAuthService = new BrandPortalOAuthService({ pool });

  // Docker/host health checks must remain available before auth middleware.
  // This endpoint exposes no shop, user, or business data.
  app.get('/api/shopee-analytics/health', (req, res) => {
    res.json({ ok: true, module: 'shopee-analytics', mode: 'read-only' });
  });
  app.use('/api/shopee-auth', feishuAuth.router);
  app.use('/api/shopee-analytics', feishuAuth.requireApiSession, feishuAuth.enforceShopAccess);

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
  }));

  const webDir = path.join(__dirname, '..', 'web');
  const indexPath = path.join(webDir, 'index.html');
  const loginPath = path.join(webDir, 'login.html');
  const assetVersion = Date.now().toString(36);
  let indexHtml = fs.readFileSync(indexPath, 'utf8');
  const loginHtml = fs.readFileSync(loginPath, 'utf8');
  for (const asset of ['/styles.css', '/shopee-metric-labels.js', '/app.js', '/ad-group-import-async.js']) {
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
