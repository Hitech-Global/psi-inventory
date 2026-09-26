'use strict';

const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');
const express = require('express');
const { ShopeeAdGroupImportJobRepository, TERMINAL } = require('./ad-group-import-job-repository');

const DEFAULT_MAX_FILE_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_TMP_BYTES = 200 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(['.csv', '.xlsx']);
const ALLOWED_CONTENT_TYPES = new Set([
  'text/csv',
  'application/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
]);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function httpError(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function positiveShopId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw httpError('TARGET_SHOP_REQUIRED', 'target_shop_id must be a positive integer', 422);
  return id;
}

function safeOriginalFilename(value) {
  const name = path.basename(String(value || 'report.csv')).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 240);
  if (!name) throw httpError('INVALID_FILENAME', 'filename is required');
  const extension = path.extname(name).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) throw httpError('UNSUPPORTED_FILE_TYPE', 'only CSV and XLSX files are supported', 415);
  return { name, extension };
}

function validateContentType(value) {
  const type = String(value || '').split(';', 1)[0].trim().toLowerCase();
  if (type && !ALLOWED_CONTENT_TYPES.has(type)) {
    throw httpError('UNSUPPORTED_FILE_TYPE', `unsupported content-type: ${type}`, 415);
  }
}

async function tempUsageBytes(tmpDir) {
  let entries;
  try { entries = await fsp.readdir(tmpDir, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return 0; throw error; }
  let total = 0;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    try { total += (await fsp.stat(path.join(tmpDir, entry.name))).size; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return total;
}

async function stageUploadStream(readable, {
  tmpDir,
  filename,
  contentType = '',
  maxBytes = DEFAULT_MAX_FILE_BYTES,
} = {}) {
  const { name, extension } = safeOriginalFilename(filename);
  validateContentType(contentType);
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error('maxBytes must be a positive integer');
  await fsp.mkdir(tmpDir, { recursive: true });
  const filePath = path.join(path.resolve(tmpDir), `${crypto.randomUUID()}${extension}`);
  const hash = crypto.createHash('sha256');
  let size = 0;
  const limiter = new Transform({
    transform(chunk, encoding, callback) {
      size += chunk.length;
      if (size > maxBytes) {
        callback(httpError('FILE_TOO_LARGE', `file exceeds ${maxBytes} bytes`, 413));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  try {
    await pipeline(readable, limiter, fs.createWriteStream(filePath, { flags: 'wx' }));
    if (!size) throw httpError('EMPTY_FILE', 'uploaded file is empty', 400);
    return { filename: name, filePath, fileSize: size, sha256: hash.digest('hex') };
  } catch (error) {
    await fsp.unlink(filePath).catch(unlinkError => { if (unlinkError.code !== 'ENOENT') throw unlinkError; });
    throw error;
  }
}

function publicJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    batchId: job.batchId,
    operation: job.operation,
    status: job.status,
    filename: job.filename,
    fileSize: job.fileSize,
    targetShopId: job.targetShopId,
    sourceShopId: job.sourceShopId,
    periodStart: job.periodStart,
    periodEnd: job.periodEnd,
    granularity: job.granularity,
    result: job.result || null,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  };
}

async function waitForTerminal(jobRepository, id, { timeoutMs = 10 * 60 * 1000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let delay = 150;
  while (Date.now() < deadline) {
    const job = await jobRepository.get(id);
    if (!job) throw httpError('IMPORT_JOB_NOT_FOUND', `Import job ${id} was not found`, 500);
    if (TERMINAL.has(job.status)) return job;
    await sleep(delay);
    delay = Math.min(1000, Math.ceil(delay * 1.35));
  }
  throw httpError('IMPORT_JOB_TIMEOUT', 'Import job did not finish before the request timeout; it may still complete in the background', 504);
}

async function existingReusableFile(jobRepository, { sha256, targetShopId }) {
  const preview = await jobRepository.findReusablePreview({ sha256, targetShopId });
  if (!preview || !preview.filePath) return null;
  try {
    await fsp.access(preview.filePath, fs.constants.R_OK);
    return preview;
  } catch {
    return null;
  }
}

async function requireReusablePreview(jobRepository, id) {
  const preview = await jobRepository.get(id);
  if (!preview) throw httpError('IMPORT_JOB_NOT_FOUND', `Preview job ${id} was not found`, 404);
  if (preview.operation !== 'PREVIEW') throw httpError('PREVIEW_JOB_REQUIRED', 'confirm requires a PREVIEW job', 409);
  if (preview.status !== 'SUCCEEDED') throw httpError('PREVIEW_NOT_READY', 'preview must succeed before confirm', 409);
  if (!preview.result || preview.result.shopScope !== 'MATCH') {
    throw httpError('SHOP_SCOPE_MISMATCH', 'preview shop scope must be MATCH before confirm', 409);
  }
  if (!preview.filePath) throw httpError('PREVIEW_ARTIFACT_EXPIRED', 'preview artifact is unavailable; preview the file again', 410);
  try {
    await fsp.access(preview.filePath, fs.constants.R_OK);
  } catch {
    throw httpError('PREVIEW_ARTIFACT_EXPIRED', 'preview artifact expired; preview the file again', 410);
  }
  return preview;
}

function createAdGroupImportAsyncRouter({
  pool,
  tmpDir = process.env.SHOPEE_AD_GROUP_IMPORT_TMP_DIR || '/import-tmp',
  maxFileBytes = Number(process.env.SHOPEE_AD_GROUP_IMPORT_MAX_FILE_BYTES || DEFAULT_MAX_FILE_BYTES),
  maxTmpBytes = Number(process.env.SHOPEE_AD_GROUP_IMPORT_MAX_TMP_BYTES || DEFAULT_MAX_TMP_BYTES),
  waitTimeoutMs = Number(process.env.SHOPEE_AD_GROUP_IMPORT_WAIT_TIMEOUT_MS || 10 * 60 * 1000),
} = {}) {
  if (!pool || typeof pool.query !== 'function') throw new Error('import job pg pool is required');
  const router = express.Router();
  const jobs = new ShopeeAdGroupImportJobRepository({ pool });

  router.get('/ad-group-import-jobs/:id', async (req, res, next) => {
    try {
      const job = await jobs.get(req.params.id);
      if (!job) { res.status(404).json({ error: 'IMPORT_JOB_NOT_FOUND' }); return; }
      res.json({ ok: true, job: publicJob(job) });
    } catch (error) { next(error); }
  });

  router.post('/ad-group-import-jobs/:id/confirm', async (req, res, next) => {
    try {
      const preview = await requireReusablePreview(jobs, req.params.id);
      const queued = await jobs.enqueue({
        operation: 'IMPORT',
        filename: preview.filename,
        filePath: preview.filePath,
        fileSize: preview.fileSize,
        sha256: preview.sha256,
        targetShopId: preview.targetShopId,
        request: { sourcePreviewJobId: preview.id },
      });
      res.status(202).json({
        ok: true,
        accepted: true,
        reused: queued.reused,
        sourcePreviewJobId: preview.id,
        job: publicJob(queued.job),
      });
    } catch (error) { next(error); }
  });

  router.post('/ad-groups/import', async (req, res, next) => {
    let cleanupPath = null;
    try {
      const targetShopId = positiveShopId(req.query.target_shop_id);
      const filename = String(req.query.filename || req.headers['x-filename'] || 'report.csv');
      const operation = req.query.confirm === 'YES' ? 'IMPORT' : 'PREVIEW';
      const contentLength = Number(req.headers['content-length'] || 0);
      if (contentLength && contentLength > maxFileBytes) {
        throw httpError('FILE_TOO_LARGE', `file exceeds ${maxFileBytes} bytes`, 413);
      }

      const staged = await stageUploadStream(req, {
        tmpDir,
        filename,
        contentType: req.headers['content-type'],
        maxBytes: maxFileBytes,
      });
      cleanupPath = staged.filePath;
      const tmpBytes = await tempUsageBytes(tmpDir);
      if (tmpBytes > maxTmpBytes) {
        throw httpError('IMPORT_TEMP_LIMIT', `import temp storage exceeds ${maxTmpBytes} bytes`, 507);
      }
      let jobFilePath = staged.filePath;

      // Backward-compatible confirm uploads can reuse a retained preview
      // artifact.  The preferred UI path uses /:previewJobId/confirm and avoids
      // the second upload entirely.
      if (operation === 'IMPORT') {
        const reusable = await existingReusableFile(jobs, {
          sha256: staged.sha256,
          targetShopId,
        });
        if (reusable) {
          await fsp.unlink(staged.filePath).catch(error => { if (error.code !== 'ENOENT') throw error; });
          cleanupPath = null;
          jobFilePath = reusable.filePath;
        }
      }

      const queued = await jobs.enqueue({
        operation,
        filename: staged.filename,
        filePath: jobFilePath,
        fileSize: staged.fileSize,
        sha256: staged.sha256,
        targetShopId,
        request: { previewOnly: req.query.preview_only === 'YES' },
      });

      if (queued.reused) {
        if (cleanupPath) {
          await fsp.unlink(cleanupPath).catch(error => { if (error.code !== 'ENOENT') throw error; });
          cleanupPath = null;
        }
      } else if (jobFilePath === cleanupPath) {
        cleanupPath = null;
      }

      if (req.query.async === 'YES' || req.query.wait === 'NO') {
        res.status(202).json({
          ok: true,
          accepted: true,
          reused: queued.reused,
          job: publicJob(queued.job),
        });
        return;
      }

      const job = await waitForTerminal(jobs, queued.job.id, { timeoutMs: waitTimeoutMs });
      if (job.status === 'SUCCEEDED') {
        res.status(operation === 'IMPORT' ? 201 : 200).json(job.result || { ok: true });
        return;
      }
      const status = Number(job.result && job.result.httpStatus) || (job.status === 'BLOCKED' ? 422 : 500);
      res.status(status).json({
        error: job.errorCode || 'IMPORT_JOB_FAILED',
        message: job.errorMessage || 'Ad Group import job failed',
      });
    } catch (error) {
      if (cleanupPath) {
        await fsp.unlink(cleanupPath).catch(unlinkError => { if (unlinkError.code !== 'ENOENT') console.warn('[Ad Group Import] cleanup failed:', unlinkError.message); });
      }
      next(error);
    }
  });

  return router;
}

module.exports = {
  ALLOWED_CONTENT_TYPES,
  ALLOWED_EXTENSIONS,
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_MAX_TMP_BYTES,
  createAdGroupImportAsyncRouter,
  existingReusableFile,
  httpError,
  publicJob,
  requireReusablePreview,
  safeOriginalFilename,
  stageUploadStream,
  tempUsageBytes,
  validateContentType,
  waitForTerminal,
};
