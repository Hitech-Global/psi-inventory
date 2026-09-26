'use strict';

const path = require('path');
const express = require('express');
const { createAnalyticsPool } = require('./pg');
const { createShopeeAnalyticsRouter } = require('./http-router');
const { createAdGroupImportAsyncRouter } = require('./ad-group-import-async-router');
const { createBackupStatusProvider } = require('./backup-status');
const { createConfiguredSkillProvider } = require('./openai-skill-provider');
const { createSkillRuntime } = require('./skill-runtime');
const { ShopeeShopScopeRepository } = require('./shop-scope-repository');

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
  } = createSkillRuntime({ pool, skillProvider });
  const shopScopeRepository = new ShopeeShopScopeRepository({ pool });
  const backupStatusProvider = createBackupStatusProvider();

  // Production can move CPU-heavy CSV/XLSX parsing and Ad Group persistence to
  // the dedicated import worker while preserving the existing HTTP contract.
  // Mount this before the legacy router so the legacy synchronous route remains
  // available for tests/dev only when the async gate is disabled.
  if (importJobPool) {
    app.use('/api/shopee-analytics', createAdGroupImportAsyncRouter({ pool: importJobPool }));
  }

  app.use('/api/shopee-analytics', createShopeeAnalyticsRouter({
    repository,
    strategyRepository,
    queryRepository,
    adPromotionRepository,
    shopScopeRepository,
    backupStatusProvider,
    skillReportRepository,
    runSkillAnalysis,
  }));

  const webDir = path.join(__dirname, '..', 'web');
  app.use(express.static(webDir, {
    etag: true,
    maxAge: '5m',
    index: 'index.html',
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
  // Queue/status polling is deliberately isolated from the normal read pool so
  // a long import cannot exhaust connections required by interactive pages.
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
