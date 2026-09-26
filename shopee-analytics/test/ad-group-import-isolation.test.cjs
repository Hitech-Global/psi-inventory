'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const {
  existingReusableFile,
  publicJob,
  safeOriginalFilename,
  stageUploadStream,
  validateContentType,
} = require('../src/ad-group-import-async-router');

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shopee-ad-group-import-'));
  try {
    assert.deepStrictEqual(safeOriginalFilename('../../report.csv'), { name: 'report.csv', extension: '.csv' });
    assert.throws(() => safeOriginalFilename('report.exe'), error => error.code === 'UNSUPPORTED_FILE_TYPE');
    assert.doesNotThrow(() => validateContentType('text/csv; charset=utf-8'));
    assert.throws(() => validateContentType('text/html'), error => error.code === 'UNSUPPORTED_FILE_TYPE');

    const staged = await stageUploadStream(Readable.from([Buffer.from('a,b\n1,2\n')]), {
      tmpDir: tmp,
      filename: 'report.csv',
      contentType: 'text/csv',
      maxBytes: 1024,
    });
    assert.strictEqual(staged.fileSize, 8);
    assert.strictEqual(staged.sha256.length, 64);
    assert(fs.existsSync(staged.filePath));

    await assert.rejects(
      stageUploadStream(Readable.from([Buffer.alloc(11)]), {
        tmpDir: tmp,
        filename: 'too-big.csv',
        contentType: 'text/csv',
        maxBytes: 10,
      }),
      error => error.code === 'FILE_TOO_LARGE' && error.status === 413,
    );

    const reusablePath = path.join(tmp, 'retained-preview.csv');
    fs.writeFileSync(reusablePath, 'preview');
    const reusable = await existingReusableFile({
      findReusablePreview: async () => ({ filePath: reusablePath, id: 'preview-job' }),
    }, { sha256: 'abc', targetShopId: 123 });
    assert.strictEqual(reusable.id, 'preview-job');
    const missing = await existingReusableFile({
      findReusablePreview: async () => ({ filePath: path.join(tmp, 'missing.csv') }),
    }, { sha256: 'abc', targetShopId: 123 });
    assert.strictEqual(missing, null);

    const exposed = publicJob({
      id: 'job-1', operation: 'PREVIEW', status: 'SUCCEEDED', filename: 'report.csv', fileSize: 8,
      targetShopId: 123, sourceShopId: 123, result: { ok: true, shopScope: 'MATCH' },
    });
    assert.deepStrictEqual(exposed.result, { ok: true, shopScope: 'MATCH' });

    const schema = fs.readFileSync(path.join(__dirname, '..', 'schema-import-jobs.sql'), 'utf8');
    assert(schema.includes("WHERE status='RUNNING'"), 'schema must enforce one RUNNING import globally');
    assert(schema.includes("WHERE status IN ('QUEUED','RUNNING')"), 'schema must dedupe active fingerprints');

    const compose = fs.readFileSync(path.join(__dirname, '..', 'deploy', 'desktop', 'docker-compose.yml'), 'utf8');
    assert(compose.includes('ad-group-import-worker:'), 'desktop compose must isolate imports in a dedicated service');
    assert(compose.includes('shopee_import_tmp:'), 'app and import worker must share only the import temp volume');

    const repositorySource = fs.readFileSync(path.join(__dirname, '..', 'src', 'ad-promotion-repository.js'), 'utf8');
    assert(repositorySource.includes('jsonb_to_recordset'), 'item persistence must use a set-based bulk insert');
    assert(!repositorySource.includes('for (const item of items)'), 'item persistence must not issue one SQL round-trip per item');

    const workerSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'ad-group-import-worker.js'), 'utf8');
    assert(workerSource.includes("retainPreviewArtifact = completed && job.operation === 'PREVIEW'"), 'successful preview artifacts must be retained for confirm reuse');

    console.log('ad-group import isolation tests passed');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
