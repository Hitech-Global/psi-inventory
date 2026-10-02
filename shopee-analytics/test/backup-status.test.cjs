'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createBackupStatusProvider } = require('../src/backup-status');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shopee-backup-status-'));
  const file = path.join(dir, 'backup-status.json');
  const provider = createBackupStatusProvider({ statusFile: file });

  assert.strictEqual(await provider(), null);

  fs.writeFileSync(file, JSON.stringify({
    ok: true,
    completedAt: '2026-09-18T03:02:00Z',
    fileName: 'shopee-analytics-20260918.dump',
    sizeBytes: 12345,
    sha256: 'abc',
    nasCopiedAt: '2026-09-18T03:03:00Z',
    restoreVerifiedAt: '2026-09-01T03:30:00Z',
  }));

  const status = await provider();
  assert.strictEqual(status.ok, true);
  assert.strictEqual(status.sizeBytes, 12345);
  assert.strictEqual(status.fileName, 'shopee-analytics-20260918.dump');

  fs.writeFileSync(file, '{bad json');
  const broken = await provider();
  assert.strictEqual(broken.ok, false);
  assert(broken.error);

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('shopee backup status tests: ok');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
