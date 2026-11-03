'use strict';

const express = require('express');
const { randomUUID } = require('crypto');
const { createSyncRuntime } = require('./sync-runtime');
const { ShopeeShopProfileRepository } = require('./shop-profile-repository');
const { runBackfillShop } = require('./backfill-runner');
const { daysInclusive } = require('./backfill-utils');
const { assertOnlineOperationAllowed } = require('./deployment-mode');
const { assertShopAccess, ROLE_SUPER_ADMIN } = require('./feishu-auth');
const { TikTokSyncRunner, DEFAULT_ENDPOINTS } = require('./tiktok-sync-runner');

const ALLOWED_SOURCES = new Set(['product-ads', 'gms']);

/**
 * TikTok 手动同步允许的数据源。
 *
 * 刻意**不含**广告相关的数据源：广告线（GMV Max / 整合报表）走的是
 * Marketing API —— 独立的 app 凭据、`Access-Token` 头、不签名，
 * 与本项目的 Shop Open API 客户端完全不兼容（见 src/tiktok-client.js 的
 * assertShopOpenApiPath）。在这里放行只会让请求必然失败并给出误导性的报错。
 */
const TIKTOK_ALLOWED_SOURCES = new Set(DEFAULT_ENDPOINTS);

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

/**
 * TikTok 的店铺 ID 是**字符串**（Shop Open API 的 shop_id 不是数字），
 * 所以不能复用 Shopee 那边的 positiveInt 校验。
 */
function tiktokShopId(value, name) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${name} is required`);
  if (text.length > 64) throw new Error(`${name} is too long`);
  return text;
}

function requestTikTokSources(value) {
  const raw = Array.isArray(value) && value.length ? value : [...DEFAULT_ENDPOINTS];
  const sources = Array.from(new Set(raw.map(item => String(item).trim().toLowerCase()).filter(Boolean)));
  const invalid = sources.filter(source => !TIKTOK_ALLOWED_SOURCES.has(source));
  if (invalid.length) throw new Error(`Unsupported TikTok sync source: ${invalid.join(', ')}`);
  return sources;
}

function createManualDataSyncRouter({
  pool,
  runtimeFactory = () => createSyncRuntime({ pool }),
  tiktokRunnerFactory = null,
  env = process.env,
} = {}) {
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
      const input = await resolveRequest(req.body);
      assertShopAccess(req, input.shopId);
      res.json(await runSync(input));
    } catch (error) { next(error); }
  });

  router.post('/data/sync-jobs', express.json({ limit: '16kb' }), async (req, res, next) => {
    try {
      const input = await resolveRequest(req.body);
      assertShopAccess(req, input.shopId);
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

  router.get('/data/sync-jobs/:jobId', (req, res, next) => {
    try {
      const job = jobs.get(String(req.params.jobId || ''));
      if (!job) {
        res.status(404).json({ error: 'SYNC_JOB_NOT_FOUND', message: 'Data sync job was not found or has expired.' });
        return;
      }
      assertShopAccess(req, job.input.shopId);
      res.json(job);
    } catch (error) { next(error); }
  });

  // ---- TikTok Shop ----
  //
  // TikTok 的店铺标识是 (shop_id, shop_cipher) 二元组，而 shop_id 是**字符串**。
  // 它与 Shopee 的 BIGINT shop_id 是两套不同的编号空间，
  // 因此这里走独立的一组路由，不复用上面的 /data/... 路径 ——
  // 否则两套编号会混进同一个 jobs 表，一个店的作业可能被另一个店的人查到。
  //
  // 鉴权沿用平台接入页的规则：TikTok 侧的连接与数据读取只对超级管理员开放。
  // 原因：TikTok 的一次授权覆盖卖家名下**全部**店铺，
  // 目前没有"哪个操作员可以看哪个 TikTok 店铺"的映射，
  // 贸然放开会让任意登录用户读到别人品牌的数据。

  const tiktokJobs = new Map();

  const resolveTikTokRequest = async body => {
    assertOnlineOperationAllowed('Manual TikTok data sync');
    const shopId = tiktokShopId(body?.shop_id ?? body?.shopId, 'shop_id');
    const startDate = isoDate(body?.start_date ?? body?.startDate, 'start_date');
    const endDate = isoDate(body?.end_date ?? body?.endDate, 'end_date');
    if (startDate > endDate) throw new Error('start_date must be <= end_date');
    const days = daysInclusive(startDate, endDate);
    // 上限与 Shopee 侧一致（366 天）。runner 会按 30 天拆窗，
    // 所以超长区间是安全的，只是会跑得久。
    if (days > 366) throw new Error('Manual data sync range cannot exceed 366 days');
    const sources = requestTikTokSources(body?.sources);
    return { shopId, startDate, endDate, days, sources };
  };

  const createTikTokRunner = () => {
    if (tiktokRunnerFactory) return tiktokRunnerFactory();
    return new TikTokSyncRunner({ pool, env });
  };

  const runTikTokSync = async ({ shopId, startDate, endDate, sources }) => {
    const runner = createTikTokRunner();
    const summary = await runner.runShop({
      shopId,
      startDate,
      endDate,
      endpoints: sources,
    });
    return { ok: summary.ok, platform: 'tiktok', shopId, startDate, endDate, sources, summary };
  };

  router.post('/tiktok/data/sync-range', express.json({ limit: '16kb' }), async (req, res, next) => {
    try {
      if (!req.auth || req.auth.role !== ROLE_SUPER_ADMIN) {
        res.status(403).json({ error: 'SUPER_ADMIN_REQUIRED', message: 'Only super admins can sync TikTok Shop data.' });
        return;
      }
      const input = await resolveTikTokRequest(req.body);
      res.json(await runTikTokSync(input));
    } catch (error) { next(error); }
  });

  router.post('/tiktok/data/sync-jobs', express.json({ limit: '16kb' }), async (req, res, next) => {
    try {
      if (!req.auth || req.auth.role !== ROLE_SUPER_ADMIN) {
        res.status(403).json({ error: 'SUPER_ADMIN_REQUIRED', message: 'Only super admins can sync TikTok Shop data.' });
        return;
      }
      const input = await resolveTikTokRequest(req.body);
      const jobId = randomUUID();
      const job = {
        id: jobId, status: 'RUNNING', input: { shopId: input.shopId, startDate: input.startDate, endDate: input.endDate },
        progress: { percent: 2, label: '准备读取 TikTok 数据', detail: `${input.days} 天` }, failures: [],
        result: null, error: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      tiktokJobs.set(jobId, job);
      runTikTokSync(input).then(result => {
        job.result = result;
        job.status = 'COMPLETED';
        job.progress = { percent: 100, label: '读取完成', detail: result.ok ? '全部数据步骤完成' : '部分数据步骤失败' };
        job.updatedAt = new Date().toISOString();
        setTimeout(() => tiktokJobs.delete(jobId), JOB_TTL_MS).unref?.();
      }).catch(error => {
        job.status = 'FAILED';
        job.error = error && error.message ? error.message : String(error);
        job.progress = { percent: job.progress.percent, label: '读取失败', detail: job.error };
        job.updatedAt = new Date().toISOString();
        setTimeout(() => tiktokJobs.delete(jobId), JOB_TTL_MS).unref?.();
      });
      res.status(202).json({ jobId, status: job.status, progress: job.progress });
    } catch (error) { next(error); }
  });

  router.get('/tiktok/data/sync-jobs/:jobId', (req, res, next) => {
    try {
      if (!req.auth || req.auth.role !== ROLE_SUPER_ADMIN) {
        res.status(403).json({ error: 'SUPER_ADMIN_REQUIRED', message: 'Only super admins can sync TikTok Shop data.' });
        return;
      }
      const job = tiktokJobs.get(String(req.params.jobId || ''));
      if (!job) {
        res.status(404).json({ error: 'SYNC_JOB_NOT_FOUND', message: 'Data sync job was not found or has expired.' });
        return;
      }
      res.json(job);
    } catch (error) { next(error); }
  });

  return router;
}

module.exports = {
  createManualDataSyncRouter,
  requestSources,
  requestTikTokSources,
  stepLabel,
  tiktokShopId,
};
