'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const {
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

    const schema = fs.readFileSync(path.join(__dirname, '..', 'schema-import-jobs.sql'), 'utf8');
    assert(schema.includes("WHERE status='RUNNING'"), 'schema must enforce one RUNNING import globally');
    assert(schema.includes("WHERE status IN ('QUEUED','RUNNING')"), 'schema must dedupe active fingerprints');

    const compose = fs.readFileSync(path.join(__dirname, '..', 'deploy', 'desktop', 'docker-compose.yml'), 'utf8');
    assert(compose.includes('ad-group-import-worker:'), 'desktop compose must isolate imports in a dedicated service');
    assert(compose.includes('shopee_import_tmp:'), 'app and import worker must share only the import temp volume');

    console.log('ad-group import isolation tests passed');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
