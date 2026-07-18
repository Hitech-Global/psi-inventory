#!/usr/bin/env node
/**
 * SQLite 恢复脚本（B2 · SYSTEM-READY-AUDIT-01）
 *
 * 用法:
 *   node scripts/restore.js <备份文件路径>
 *   例: node scripts/restore.js backups/inventory-20260718-160000.db
 *
 * 流程（安全优先）:
 *   1. 对备份文件做 PRAGMA integrity_check，失败即中止
 *   2. 交互确认（须手动输入 yes；请先停服）
 *   3. 对当前库做一次 pre-restore 安全备份
 *   4. 用备份覆盖 DB_PATH，并删除旧 -wal/-shm（避免旧 WAL 覆盖恢复内容）
 *   5. 提示重启服务
 *
 * 环境变量:
 *   DB_PATH   目标库路径（默认 ./data/inventory.db）
 *   FORCE=1   跳过交互确认（用于自动化，谨慎）
 */
'use strict';
const path = require('path');
const fs = require('fs');
const readline = require('readline');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..');
const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'data', 'inventory.db');
const src = process.argv[2];

if (!src) {
  console.error('用法: node scripts/restore.js <备份文件路径>');
  process.exit(1);
}
if (!fs.existsSync(src)) {
  console.error('[restore] 备份文件不存在:', src);
  process.exit(1);
}

// 1. 备份完整性校验
const chk = new Database(src, { readonly: true });
const result = chk.pragma('integrity_check', { simple: true });
chk.close();
if (result !== 'ok') {
  console.error('[restore] 备份完整性校验失败，已中止:', result);
  process.exit(2);
}
console.log('[restore] 备份完整性校验通过 (integrity_check=ok)');

function doRestore() {
  // 3. 当前库安全备份
  if (fs.existsSync(DB_PATH)) {
    const bak = DB_PATH + '.pre-restore-' + Date.now();
    fs.copyFileSync(DB_PATH, bak);
    console.log('[restore] 已对当前库做安全备份:', bak);
  }
  // 4. 覆盖 + 清理旧 WAL/SHM
  fs.copyFileSync(src, DB_PATH);
  for (const ext of ['-wal', '-shm']) {
    const p = DB_PATH + ext;
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
      console.log('[restore] 已删除旧', ext);
    }
  }
  console.log('[restore] 恢复完成，请重启服务。目标库:', DB_PATH);
}

if (process.env.FORCE === '1') {
  doRestore();
} else {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question(
    `\n将用备份覆盖当前库:\n  源:   ${src}\n  目标: ${DB_PATH}\n请确认服务已停止。输入 yes 继续: `,
    (ans) => {
      rl.close();
      if (String(ans).trim().toLowerCase() !== 'yes') {
        console.log('[restore] 已取消，未做任何修改。');
        process.exit(0);
      }
      doRestore();
    }
  );
}
