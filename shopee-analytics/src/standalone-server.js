'use strict';

const path = require('path');
const express = require('express');
const { createAnalyticsPool } = require('./pg');
const { ShopeeAnalyticsRepository } = require('./repository');
const { ShopeeStrategyRepository } = require('./strategy-repository');
const { ShopeeQueryRepository } = require('./query-repository');
const { createShopeeAnalyticsRouter } = require('./http-router');
const { createBackupStatusProvider } = require('./backup-status');
const { SkillReportRepository } = require('./skill-report-repository');
const { SkillRunner } = require('./skill-runner');
const { createSkillExecutor, disabledSkillProvider } = require('./skill-executor');
const { createConfiguredSkillProvider } = require('./openai-skill-provider');
const { buildCampaignSkillPackage } = require('./skill-analysis-service');

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

function createApp({ pool, skillProvider = null }) {
  const app = express();
  app.disable('x-powered-by');

  const repository = new ShopeeAnalyticsRepository({ pool });
  const strategyRepository = new ShopeeStrategyRepository({ pool });
  const queryRepository = new ShopeeQueryRepository({ pool });
  const backupStatusProvider = createBackupStatusProvider();
  const skillReportRepository = new SkillReportRepository(pool);
  const skillExecutor = createSkillExecutor({ provider: skillProvider || disabledSkillProvider() });
  const skillRunner = new SkillRunner({ executor: skillExecutor, reportRepository: skillReportRepository });
  const runSkillAnalysis = async ({
    shopId, campaignId, startDate, endDate, triggerType, triggerReason,
  }) => {
    const analysisPackage = await buildCampaignSkillPackage({
      repository, queryRepository, strategyRepository,
      shopId, campaignId, startDate, endDate,
      dataCutoff: new Date().toISOString(),
      triggerType, triggerReason,
    });
    return skillRunner.run(analysisPackage);
  };

  app.use('/api/shopee-analytics', createShopeeAnalyticsRouter({
    repository,
    strategyRepository,
    queryRepository,
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
    const status = /must be|start_date|end_date|Invalid/.test(String(error.message)) ? 400 : 500;
    console.error('[Shopee Analytics]', error.stack || error);
    res.status(status).json({
      error: status === 400 ? 'INVALID_REQUEST' : 'INTERNAL_ERROR',
      message: error.message,
    });
  });

  return app;
}

async function main() {
  const host = resolveBindAddress();
  const port = resolvePort();
  const pool = createAnalyticsPool();
  const skillProvider = createConfiguredSkillProvider();
  const app = createApp({ pool, skillProvider });

  const server = app.listen(port, host, () => {
    console.log(`Shopee Analytics V1: http://${host}:${port}`);
    console.log('Mode: read-only UI/API; analytics DB writes are not exposed through HTTP.');
  });

  const close = async signal => {
    console.log(`\nReceived ${signal}, shutting down...`);
    server.close(async () => {
      await pool.end();
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
