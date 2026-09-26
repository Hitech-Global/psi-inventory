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

function createAdGroupImportAsyncRouter({
  pool,
  tmpDir = process.env.SHOPEE_AD_GROUP_IMPORT_TMP_DIR || '/import-tmp',
  maxFileBytes = Number(process.env.SHOPEE_AD_GROUP_IMPORT_MAX_FILE_BYTES || DEFAULT_MAX_FILE_BYTES),
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

  router.post('/ad-groups/import', async (req, res, next) => {
    let staged = null;
    try {
      const targetShopId = positiveShopId(req.query.target_shop_id);
      const filename = String(req.query.filename || req.headers['x-filename'] || 'report.csv');
      const contentLength = Number(req.headers['content-length'] || 0);
      if (contentLength && contentLength > maxFileBytes) {
        throw httpError('FILE_TOO_LARGE', `file exceeds ${maxFileBytes} bytes`, 413);
      }
      staged = await stageUploadStream(req, {
        tmpDir,
        filename,
        contentType: req.headers['content-type'],
        maxBytes: maxFileBytes,
      });
      const operation = req.query.confirm === 'YES' ? 'IMPORT' : 'PREVIEW';
      const queued = await jobs.enqueue({
        operation,
        filename: staged.filename,
        filePath: staged.filePath,
        fileSize: staged.fileSize,
        sha256: staged.sha256,
        targetShopId,
        request: { previewOnly: req.query.preview_only === 'YES' },
      });
      if (queued.reused) {
        await fsp.unlink(staged.filePath).catch(error => { if (error.code !== 'ENOENT') throw error; });
      }
      // Ownership of a newly queued file transfers to the worker. Never delete
      // it from the web request if the client disconnects or the wait times out.
      staged = null;
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
      if (staged && staged.filePath) {
        await fsp.unlink(staged.filePath).catch(unlinkError => { if (unlinkError.code !== 'ENOENT') console.warn('[Ad Group Import] cleanup failed:', unlinkError.message); });
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
  createAdGroupImportAsyncRouter,
  httpError,
  publicJob,
  safeOriginalFilename,
  stageUploadStream,
  validateContentType,
  waitForTerminal,
};
