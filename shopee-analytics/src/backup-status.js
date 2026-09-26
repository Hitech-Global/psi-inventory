'use strict';

const fs = require('fs');

function createBackupStatusProvider({
  statusFile = process.env.SHOPEE_BACKUP_STATUS_FILE,
} = {}) {
  return async function readBackupStatus() {
    if (!statusFile) return null;
    try {
      const raw = await fs.promises.readFile(statusFile, 'utf8');
      const parsed = JSON.parse(raw);
      return {
        ok: parsed.ok === true,
        lastAttemptAt: parsed.lastAttemptAt || null,
        completedAt: parsed.completedAt || null,
        fileName: parsed.fileName || null,
        sizeBytes: Number(parsed.sizeBytes || 0),
        sha256: parsed.sha256 || null,
        nasCopiedAt: parsed.nasCopiedAt || null,
        restoreVerifiedAt: parsed.restoreVerifiedAt || null,
        error: parsed.error || null,
      };
    } catch (error) {
      if (error && error.code === 'ENOENT') return null;
      return {
        ok: false,
        lastAttemptAt: null,
        completedAt: null,
        fileName: null,
        sizeBytes: 0,
        sha256: null,
        nasCopiedAt: null,
        restoreVerifiedAt: null,
        error: error && error.message ? error.message : String(error),
      };
    }
  };
}

module.exports = { createBackupStatusProvider };
