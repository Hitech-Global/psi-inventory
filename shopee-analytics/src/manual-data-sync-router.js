'use strict';

const express = require('express');
const { randomUUID } = require('crypto');
const { createSyncRuntime } = require('./sync-runtime');
const { ShopeeShopProfileRepository } = require('./shop-profile-repository');
const { runBackfillShop } = require('./backfill-runner');
const { daysInclusive } = require('./backfill-utils');
const { assertOnlineOperationAllowed } = require('./deployment-mode');

const ALLOWED_SOURCES = new Set(['product-ads', 'gms']);
const JOB_TTL_MS = 15 * 60 * 1000;

const STEP_LABELS = Object.freeze({
  'campaign-settings-current': '广告活动基础信息',
  'ads-token-for-product-ads-history': 'Shopee 广告授权',
  'product-ads-overview-history': 'Product Card 店铺汇总',
  'product-ads-campaign-history': '单品广告历史数据',
  'discover-known-gms': '全店推 Campaign 识别',
  'ads-token-for-gms': '全店推授权',
  'gms-discovery-history-window': '全店推 Campaign 自动发现',
  'coverage-check': '数据完整度检查',
});

function stepLabel(name) {
  const match = /^gms-history-(\d+)$/.exec(String(name || ''));
  if (match) return `全店推历史数据（Campaign #${match[1]}）`;
  return STEP_LABELS[name] || name || '数据抓取';
}

function positiveInt(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error(`${name} must be a positive integer`);
  return number;
}

function isoDate(value, name) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`${name} must be YYYY-MM-DD`);
  return text;
}

function requestSources(value) {
  const raw = Array.isArray(value) && value.length ? value : ['product-ads', 'gms'];
  const sources = Array.from(new Set(raw.map(item => String(item).trim().toLowerCase()).filter(Boolean)));
  const invalid = sources.filter(source => !ALLOWED_SOURCES.has(source));
  if (invalid.length) throw new Error(`Unsupported manual sync source: ${invalid.join(', ')}`);
  return sources;
}

function createManualDataSyncRouter({ pool, runtimeFactory = () => createSyncRuntime({ pool }) } = {}) {
  if (!pool) throw new Error('pool is required');
  const router = express.Router();
  const profileRepository = new ShopeeShopProfileRepository({ pool });
  const jobs = new Map();

  const resolveRequest = async body => {
    assertOnlineOperationAllowed('Manual Shopee data sync');
    const shopId = positiveInt(body?.shop_id ?? body?.shopId, 'shop_id');
    const startDate = isoDate(body?.start_date ?? body?.startDate, 'start_date');
    const endDate = isoDate(body?.end_date ?? body?.endDate, 'end_date');
    if (startDate > endDate) throw new Error('start_date must be <= end_date');
    const days = daysInclusive(startDate, endDate);
    if (days > 366) throw new Error('Manual data sync range cannot exceed 366 days');
    const sources = requestSources(body?.sources);
    const shops = await profileRepository.list({ activeOnly: false });
    const shop = shops.find(row => row.shopId === shopId);
    if (!shop) {
      const error = new Error(`Shop ${shopId} is not configured`);
      error.code = 'SHOP_NOT_CONFIGURED'; error.status = 404; throw error;
    }
    if (!shop.oauthAuthorized || shop.dataSourceCapability === 'MANUAL_IMPORT_ONLY') {
      const error = new Error(`Shop ${shopId} does not have an authorized Shopee ADS API connection`);
      error.code = 'ADS_TOKEN_REQUIRED'; error.status = 422; throw error;
    }
    return { shopId, startDate, endDate, days, sources, shop };
  };

  const progressStepEnd = name => {
    if (name === 'campaign-settings-current') return 10;
    if (name === 'ads-token-for-product-ads-history') return 15;
    if (name === 'product-ads-overview-history') return 40;
    if (name === 'product-ads-campaign-history') return 60;
    if (name === 'discover-known-gms') return 65;
    if (name === 'ads-token-for-gms') return 70;
    if (name === 'gms-discovery-history-window') return 75;
    if (/^gms-history-\d+$/.test(String(name || ''))) return 95;
    if (name === 'coverage-check') return 99;
    return null;
  };

  const updateProgress = (job, event) => {
    let percent = job.progress.percent;
    let label = job.progress.label;
    let detail = job.progress.detail || '';
    const endpoint = String(event.endpointKey || '');
    const ranges = endpoint === 'BACKFILL_PRODUCT_ADS_OVERVIEW' ? [15, 40, 'Product Card 店铺汇总']
      : endpoint === 'BACKFILL_PRODUCT_ADS_CAMPAIGNS' ? [40, 60, '单品广告历史数据']
      : endpoint.startsWith('BACKFILL_GMS_') ? [75, 95, '全店推历史数据'] : null;
    if (ranges && (event.type === 'chunk-start' || event.type === 'chunk-complete')) {
      const total = Math.max(1, Number(event.totalChunks || 1));
      const completed = Math.max(0, Number(event.completedChunks || 0));
      percent = Math.max(percent, Math.floor(ranges[0] + ((ranges[1] - ranges[0]) * completed / total)));
      label = ranges[2];
      detail = `${completed}/${total} 个时间段`;
    } else if (event.type === 'step-start') {
      label = stepLabel(event.name);
      detail = '正在处理';
    } else if (event.type === 'step-complete') {
      const target = progressStepEnd(event.name);
      if (target != null) percent = Math.max(percent, target);
      label = stepLabel(event.name);
      detail = event.ok === false ? '该步骤失败，继续处理其他可用数据' : '已完成';
      if (event.ok === false) {
        job.failures.push({
          step: event.name,
          label,
          error: event.error || 'Shopee API 未返回具体错误',
          chunk: event.chunk || null,
        });
      }
    }
    job.progress = { percent: Math.min(99, percent), label, detail };
    job.updatedAt = new Date().toISOString();
  };

  const runSync = async ({ shopId, startDate, endDate, sources, shop }, onProgress = null) => {
    const runtime = runtimeFactory();
    const summary = await runBackfillShop({
      runtime,
      shop,
      startDate,
      endDate,
      sources,
      seededGmsCampaignIds: shop.gmsCampaignSeedIds || [],
      refreshCurrentMetadata: true,
      forceRefresh: true,
      onProgress,
    });
    return { ok: summary.ok, shopId, startDate, endDate, sources, summary };
  };

  router.post('/data/sync-range', express.json({ limit: '16kb' }), async (req, res, next) => {
    try {
      res.json(await runSync(await resolveRequest(req.body)));
    } catch (error) { next(error); }
  });

  router.post('/data/sync-jobs', express.json({ limit: '16kb' }), async (req, res, next) => {
    try {
      const input = await resolveRequest(req.body);
      const jobId = randomUUID();
      const job = {
        id: jobId, status: 'RUNNING', input: { shopId: input.shopId, startDate: input.startDate, endDate: input.endDate },
        progress: { percent: 2, label: '准备读取数据', detail: `${input.days} 天` }, failures: [],
        result: null, error: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      jobs.set(jobId, job);
      runSync(input, event => updateProgress(job, event)).then(result => {
        job.result = result;
        job.status = 'COMPLETED';
        job.progress = { percent: 100, label: '读取完成', detail: result.ok ? '全部数据步骤完成' : '部分数据步骤失败' };
        job.updatedAt = new Date().toISOString();
        setTimeout(() => jobs.delete(jobId), JOB_TTL_MS).unref?.();
      }).catch(error => {
        job.status = 'FAILED';
        job.error = error && error.message ? error.message : String(error);
        job.progress = { percent: job.progress.percent, label: '读取失败', detail: job.error };
        job.updatedAt = new Date().toISOString();
        setTimeout(() => jobs.delete(jobId), JOB_TTL_MS).unref?.();
      });
      res.status(202).json({ jobId, status: job.status, progress: job.progress });
    } catch (error) { next(error); }
  });

  router.get('/data/sync-jobs/:jobId', (req, res) => {
    const job = jobs.get(String(req.params.jobId || ''));
    if (!job) {
      res.status(404).json({ error: 'SYNC_JOB_NOT_FOUND', message: 'Data sync job was not found or has expired.' });
      return;
    }
    res.json(job);
  });

  return router;
}

module.exports = { createManualDataSyncRouter, requestSources, stepLabel };
