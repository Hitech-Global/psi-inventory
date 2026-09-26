'use strict';

const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { createAnalyticsPool } = require('./pg');
const { ShopeeAdPromotionRepository } = require('./ad-promotion-repository');
const { ShopeeShopScopeRepository } = require('./shop-scope-repository');
const { ShopeeAdGroupImportJobRepository } = require('./ad-group-import-job-repository');
const { parseShopeeAdGroupFile } = require('./shopee-ad-group-import');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function errorInfo(error) {
  const code = error && error.code ? String(error.code) : 'IMPORT_JOB_FAILED';
  let httpStatus = Number(error && error.status) || 500;
  if (!error || !error.status) {
    if (code === 'SHOP_SCOPE_MISMATCH') httpStatus = 409;
    else if (code === 'TARGET_SHOP_NOT_REGISTERED') httpStatus = 422;
    else if (/required|invalid|missing|must be|report|CSV|XLSX|Product ID|header/i.test(String(error && error.message || ''))) httpStatus = 400;
  }
  return { code, httpStatus, message: String(error && error.message || code) };
}

function scopeError(code, message, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function safeJobPath(filePath, tmpDir) {
  const base = path.resolve(tmpDir);
  const resolved = path.resolve(filePath);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw scopeError('INVALID_TEMP_PATH', 'Import job file is outside the controlled temp directory', 500);
  }
  return resolved;
}

async function processJob({ job, jobRepository, adPromotionRepository, shopScopeRepository, tmpDir }) {
  const filePath = safeJobPath(job.filePath, tmpDir);
  const buffer = await fsp.readFile(filePath);
  const { report, preview } = parseShopeeAdGroupFile({ buffer, filename: job.filename });
  const targetShopId = Number(job.targetShopId);
  const previewOnly = Boolean(job.request && job.request.previewOnly);

  if (!Number.isSafeInteger(targetShopId) || targetShopId <= 0) {
    throw scopeError('TARGET_SHOP_REQUIRED', 'target_shop_id is required for an Ad Group preview or import', 422);
  }

  if (report.metadata.shopId !== targetShopId) {
    if (job.operation === 'PREVIEW' && previewOnly) {
      const result = { ok: true, persisted: false, ...preview, targetShopId, shopScope: 'MISMATCH' };
      await jobRepository.succeed(job.id, {
        result,
        sourceShopId: report.metadata.shopId,
        periodStart: report.metadata.periodStart,
        periodEnd: report.metadata.periodEnd,
        granularity: report.metadata.granularity,
      });
      return result;
    }
    throw scopeError(
      'SHOP_SCOPE_MISMATCH',
      `Source shop ${report.metadata.shopId} does not match target shop ${targetShopId}`,
      409,
    );
  }

  const scopedPreview = { ...preview, targetShopId, shopScope: 'MATCH' };
  if (job.operation === 'PREVIEW') {
    const result = { ok: true, persisted: false, ...scopedPreview };
    await jobRepository.succeed(job.id, {
      result,
      sourceShopId: report.metadata.shopId,
      periodStart: report.metadata.periodStart,
      periodEnd: report.metadata.periodEnd,
      granularity: report.metadata.granularity,
    });
    return result;
  }

  const targetScope = await shopScopeRepository.find(targetShopId);
  if (!targetScope) {
    throw scopeError('TARGET_SHOP_NOT_REGISTERED', `Shop ${targetShopId} must be explicitly registered before import`, 422);
  }

  await adPromotionRepository.withTransaction(async queryable => {
    for (const entry of report.groups) {
      await adPromotionRepository.saveWithItems(entry.group, entry.items, { queryable });
    }
  });

  const result = { ok: true, persisted: true, ...scopedPreview };
  await jobRepository.succeed(job.id, {
    result,
    sourceShopId: report.metadata.shopId,
    periodStart: report.metadata.periodStart,
    periodEnd: report.metadata.periodEnd,
    granularity: report.metadata.granularity,
  });
  return result;
}

async function cleanupTemp({ jobRepository, tmpDir, ttlHours = 24 }) {
  const active = await jobRepository.activeFilePaths();
  let entries;
  try { entries = await fsp.readdir(tmpDir, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  const cutoff = Date.now() - ttlHours * 3600000;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const filePath = path.join(tmpDir, entry.name);
    if (active.has(filePath)) continue;
    try {
      const stat = await fsp.stat(filePath);
      if (stat.mtimeMs < cutoff) await fsp.unlink(filePath);
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn('[Ad Group Import Worker] temp cleanup:', error.message);
    }
  }
}

async function runWorker({ env = process.env } = {}) {
  const tmpDir = env.SHOPEE_AD_GROUP_IMPORT_TMP_DIR || '/import-tmp';
  const pollMs = Math.max(100, Number(env.SHOPEE_AD_GROUP_IMPORT_POLL_MS || 500));
  const leaseSeconds = Math.max(60, Number(env.SHOPEE_AD_GROUP_IMPORT_LEASE_SECONDS || 1800));
  const workerId = `${os.hostname()}:${process.pid}`;
  await fsp.mkdir(tmpDir, { recursive: true });

  // This pool is separate from the web app pool. The queue schema itself also
  // enforces at most one RUNNING heavy job globally.
  const pool = createAnalyticsPool({ max: 1, env });
  const jobRepository = new ShopeeAdGroupImportJobRepository({ pool });
  const adPromotionRepository = new ShopeeAdPromotionRepository({ pool });
  const shopScopeRepository = new ShopeeShopScopeRepository({ pool });
  let stopping = false;
  let lastCleanup = 0;

  const stop = signal => {
    console.log(`[Ad Group Import Worker] received ${signal}; stopping after current job`);
    stopping = true;
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));

  console.log(`[Ad Group Import Worker] ready pid=${process.pid} concurrency=1 tmp=${tmpDir}`);
  try {
    while (!stopping) {
      const now = Date.now();
      if (now - lastCleanup > 15 * 60 * 1000) {
        await cleanupTemp({ jobRepository, tmpDir }).catch(error => console.warn('[Ad Group Import Worker] cleanup failed:', error.message));
        lastCleanup = now;
      }

      const job = await jobRepository.claimNext({ workerId, leaseSeconds });
      if (!job) { await sleep(pollMs); continue; }

      const heartbeat = setInterval(() => {
        jobRepository.heartbeat({ id: job.id, workerId, leaseSeconds })
          .catch(error => console.warn('[Ad Group Import Worker] heartbeat failed:', error.message));
      }, Math.max(15000, Math.floor(leaseSeconds * 1000 / 3)));
      heartbeat.unref();

      let completed = false;
      try {
        await processJob({ job, jobRepository, adPromotionRepository, shopScopeRepository, tmpDir });
        completed = true;
      } catch (error) {
        const info = errorInfo(error);
        await jobRepository.fail(job.id, info).catch(failError => {
          console.error('[Ad Group Import Worker] failed to persist job failure:', failError.stack || failError);
        });
        console.error(`[Ad Group Import Worker] ${job.id} ${info.code}: ${info.message}`);
      } finally {
        clearInterval(heartbeat);
        // Preview artifacts are retained for confirm.  A failed IMPORT created
        // from a preview is also retained so the user can explicitly resume it
        // without re-uploading; TTL cleanup eventually removes abandoned files.
        const retainArtifact =
          (completed && job.operation === 'PREVIEW') ||
          (!completed && job.operation === 'IMPORT' && Boolean(job.request && job.request.sourcePreviewJobId));
        if (!retainArtifact) {
          try {
            await fsp.unlink(safeJobPath(job.filePath, tmpDir));
          } catch (error) {
            if (error.code !== 'ENOENT') console.warn('[Ad Group Import Worker] staged file cleanup failed:', error.message);
          }
        }
      }
    }
  } finally {
    await pool.end();
  }
}

module.exports = { cleanupTemp, errorInfo, processJob, runWorker, safeJobPath };
