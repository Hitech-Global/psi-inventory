#!/usr/bin/env node
/**
 * SQLite 在线备份脚本（B2 · SYSTEM-READY-AUDIT-01）
 *
 * 用法:
 *   node scripts/backup.js
 *
 * 特性:
 *   - 使用 better-sqlite3 在线 .backup()，WAL 安全，产出单文件（已 checkpoint，不含 -wal/-shm）
 *   - 备份后执行 PRAGMA integrity_check 校验
 *   - 保留最近 N 份（默认 14），仅清理 backups/ 目录内旧备份，绝不触碰 data/
 *
 * 环境变量:
 *   DB_PATH            源库路径（默认 ./data/inventory.db）
 *   BACKUP_DIR         备份输出目录（默认 ./backups）
 *   BACKUP_RETENTION   保留份数（默认 14）
 */
'use strict';
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..');
const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'data', 'inventory.db');
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(ROOT, 'backups');
const RETENTION = parseInt(process.env.BACKUP_RETENTION || '14', 10);

function ts() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

(async () => {
  if (!fs.existsSync(DB_PATH)) {
    console.error('[backup] 源库不存在:', DB_PATH);
    process.exit(1);
  }
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const dest = path.join(BACKUP_DIR, `inventory-${ts()}.db`);

  const db = new Database(DB_PATH, { readonly: true });
  try {
    await db.backup(dest);
  } finally {
    db.close();
  }

  // 完整性校验（对备份产物）
  const chk = new Database(dest, { readonly: true });
  const result = chk.pragma('integrity_check', { simple: true });
  chk.close();
  // 校验读连接在 WAL 模式下会生成 -wal/-shm 附属文件；备份主文件已自包含，清理附属文件保持单文件
  for (const ext of ['-wal', '-shm']) {
    const p = dest + ext;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  if (result !== 'ok') {
    console.error('[backup] 完整性校验失败:', result, '=> 已保留问题备份供排查:', dest);
    process.exit(2);
  }
  const sizeMB = (fs.statSync(dest).size / 1048576).toFixed(1);
  console.log(`[backup] 备份成功: ${dest} (${sizeMB}MB, integrity_check=ok)`);

  // 保留策略：仅清理 backups/ 目录内、匹配命名规则的旧备份
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => /^inventory-\d{8}-\d{6}\.db$/.test(f))
    .sort();
  const excess = files.length - RETENTION;
  if (excess > 0) {
    for (const f of files.slice(0, excess)) {
      fs.unlinkSync(path.join(BACKUP_DIR, f));
      console.log('[backup] 清理旧备份:', f);
    }
  }
  console.log(`[backup] 当前保留 ${Math.min(files.length, RETENTION)} 份（策略上限 ${RETENTION}）`);
})().catch((e) => {
  console.error('[backup] 异常:', e && e.stack || e);
  process.exit(3);
});
