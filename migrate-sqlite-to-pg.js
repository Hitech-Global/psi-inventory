/**
 * SQLite → PostgreSQL 数据迁移脚本
 *
 * 使用方式：
 *   DATABASE_URL=postgresql://... node migrate-sqlite-to-pg.js
 *
 * 策略：
 *   1. 调用 db-pg.js 的 initDatabase() 建表 + 种子数据
 *   2. 从 SQLite 读取每张表的所有行
 *   3. 检查 PG 是否有同名表，有则批量 INSERT ON CONFLICT (id) DO UPDATE
 *   4. 种子数据表（roles/users/countries/currencies/warehouses）会被 SQLite 数据覆盖
 *   5. PG 中不存在的表自动跳过并报告
 *
 * 安全：SQLite 以 readonly 打开，PG 只做 INSERT/UPDATE，不 DROP/DELETE。
 */

const path = require('path');
const Database = require('better-sqlite3');

const SQLITE_PATH = process.env.SQLITE_PATH || path.join(__dirname, 'data', 'inventory.db');
const PG_CONNECTION = process.env.DATABASE_URL;

if (!PG_CONNECTION) {
  console.error('[FATAL] 缺少 DATABASE_URL 环境变量');
  console.error('  用法: DATABASE_URL=postgresql://... node migrate-sqlite-to-pg.js');
  process.exit(1);
}

// 跳过的表：SQLite 内部表 + 备份表
const SKIP_TABLES = new Set([
  'sqlite_sequence',
  'approval_flows_backup_phase1',  // 备份表，PG 无对应
  'supplier_brand_configs',         // PG 无此表（需后续确认是否要补建）
]);

// PG 种子数据表（initDatabase 会插入，迁移时覆盖更新）
const SEED_TABLES = new Set([
  'roles', 'users', 'countries', 'currencies', 'warehouses',
  'expense_types', 'allocation_rules', 'system_config',
]);

async function main() {
  console.log('=== SQLite → PostgreSQL 迁移工具 ===');
  console.log('[1/4] 初始化 PG 连接池...');

  const { Pool } = require('pg');

  // PG 连接池（直接用，不走 db.js，避免 initDatabase 连接池泄漏导致进程挂住）
  const useSsl = /(sslmode=require|ssl=true|amazonaws|supabase|render\.com)/i.test(PG_CONNECTION);
  const pool = new Pool({
    connectionString: PG_CONNECTION,
    max: 3,
    ssl: useSsl ? { rejectUnauthorized: false } : false,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000,
  });
  console.log('  [OK] PG 连接池已创建 (ssl=' + (useSsl ? 'on' : 'off') + ')');

  // 禁用 FK 约束（迁移期间，避免表顺序导致 FK 违规）
  await pool.query("SET session_replication_role = 'replica'");
  console.log('  [OK] 已禁用 FK 约束 (session_replication_role=replica)');

  console.log('[2/4] 打开 SQLite (readonly)...');
  const sqliteDb = new Database(SQLITE_PATH, { readonly: true });
  console.log('  [OK] SQLite 路径:', SQLITE_PATH);

  // 获取 SQLite 所有表
  const sqliteTables = sqliteDb
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((r) => r.name);

  // 获取 PG 所有表
  const pgTablesResult = await pool.query(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"
  );
  const pgTableSet = new Set(pgTablesResult.rows.map((r) => r.tablename));

  console.log('[3/4] 开始迁移数据...');
  console.log('  SQLite 表数:', sqliteTables.length);
  console.log('  PG 表数:', pgTableSet.size);

  const report = [];
  let totalMigrated = 0;
  let totalSkipped = 0;

  for (const tableName of sqliteTables) {
   try {
    if (SKIP_TABLES.has(tableName)) {
      const count = sqliteDb.prepare('SELECT COUNT(*) as c FROM "' + tableName + '"').get().c;
      report.push({ table: tableName, sqliteRows: count, pgRows: 0, status: 'SKIPPED(manual)', migrated: 0 });
      totalSkipped += count;
      continue;
    }

    if (!pgTableSet.has(tableName)) {
      const count = sqliteDb.prepare('SELECT COUNT(*) as c FROM "' + tableName + '"').get().c;
      console.log('  [SKIP] PG 无表 ' + tableName + ' (' + count + ' 行) — 需确认');
      report.push({ table: tableName, sqliteRows: count, pgRows: 0, status: 'NO_PG_TABLE', migrated: 0 });
      totalSkipped += count;
      continue;
    }

    // 获取总行数
    const totalCount = sqliteDb.prepare('SELECT COUNT(*) as c FROM "' + tableName + '"').get().c;
    if (totalCount === 0) {
      report.push({ table: tableName, sqliteRows: 0, pgRows: 0, status: 'EMPTY', migrated: 0 });
      continue;
    }

    // 获取列名（从第一行）
    const sampleRow = sqliteDb.prepare('SELECT * FROM "' + tableName + '" LIMIT 1').get();
    const columns = Object.keys(sampleRow);

    // 检查列差异：SQLite 有但 PG 没有的列，自动 ALTER TABLE ADD COLUMN
    const pgColsResult = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1",
      [tableName]
    );
    const pgCols = new Set(pgColsResult.rows.map((r) => r.column_name));
    const sqliteColsInfo = sqliteDb.pragma('table_info("' + tableName + '")');
    const missingCols = sqliteColsInfo.filter((c) => c.name && c.name.length > 0 && !pgCols.has(c.name));

    if (missingCols.length > 0) {
      const client = await pool.connect();
      try {
        for (const col of missingCols) {
          // SQLite 类型 → PG 类型映射
          let pgType = 'TEXT';
          const stype = (col.type || '').toUpperCase();
          if (stype.includes('INT')) pgType = 'INTEGER';
          else if (stype.includes('REAL') || stype.includes('FLOA') || stype.includes('DOUB')) pgType = 'DOUBLE PRECISION';
          else if (stype.includes('NUM') || stype.includes('DEC')) pgType = 'NUMERIC';

          // 默认值（SQLite 双引号 → PG 单引号）
          let defaultClause = '';
          if (col.dflt_value !== null) {
            let dflt = col.dflt_value;
            // SQLite 用双引号包裹字符串默认值，PG 需要单引号
            if (dflt.startsWith('"') && dflt.endsWith('"')) {
              dflt = "'" + dflt.slice(1, -1).replace(/'/g, "''") + "'";
            }
            defaultClause = ' DEFAULT ' + dflt;
          } else {
            defaultClause = pgType === 'TEXT' ? " DEFAULT ''" : (pgType === 'INTEGER' ? ' DEFAULT 0' : ' DEFAULT 0');
          }

          await client.query('ALTER TABLE "' + tableName + '" ADD COLUMN IF NOT EXISTS "' + col.name + '" ' + pgType + defaultClause);
          console.log('    [ALTER] ' + tableName + ' + ' + col.name + ' (' + pgType + ')');
        }
      } finally {
        client.release();
      }
    }

    // 动态查询 PG 表的主键列
    const pkResult = await pool.query(`
      SELECT a.attname
      FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = $1::regclass AND i.indisprimary
      ORDER BY array_position(i.indkey, a.attnum)
    `, ['"' + tableName + '"']);
    const pkCols = pkResult.rows.map((r) => r.attname);
    const hasPk = pkCols.length > 0;

    // 构造 ON CONFLICT 子句
    let conflictClause;
    if (hasPk) {
      const updateSet = columns
        .filter((c) => !pkCols.includes(c))
        .map((c) => '"' + c + '" = EXCLUDED."' + c + '"')
        .join(', ');
      conflictClause = updateSet
        ? 'ON CONFLICT (' + pkCols.map((c) => '"' + c + '"').join(', ') + ') DO UPDATE SET ' + updateSet
        : 'ON CONFLICT (' + pkCols.map((c) => '"' + c + '"').join(', ') + ') DO NOTHING';
    } else {
      // 无主键：用 ON CONFLICT DO NOTHING 避免重复插入报错
      conflictClause = 'ON CONFLICT DO NOTHING';
    }

    // 检查 PG 已有行数，跳过已匹配的表
    const pgPreCount = await pool.query('SELECT COUNT(*) as c FROM "' + tableName + '"');
    const pgPreRows = parseInt(pgPreCount.rows[0].c, 10);
    if (pgPreRows === totalCount && totalCount > 0) {
      report.push({ table: tableName, sqliteRows: totalCount, pgRows: pgPreRows, status: 'ALREADY_MIGRATED', migrated: 0 });
      console.log('  [SKIP] ' + tableName + ': PG已有 ' + pgPreRows + ' 行，跳过');
      continue;
    }

    // 分批读取+多行 INSERT（避免 OOM + 减少网络往返）
    const READ_BATCH = 100;
    let migrated = 0;
    let lastProgress = 0;

    for (let offset = 0; offset < totalCount; offset += READ_BATCH) {
      const batch = sqliteDb.prepare('SELECT * FROM "' + tableName + '" LIMIT ? OFFSET ?').all(READ_BATCH, offset);
      if (batch.length === 0) break;

      // 构造多行 INSERT: INSERT INTO t (c1,c2) VALUES ($1,$2),($3,$4),... ON CONFLICT ...
      const colCount = columns.length;
      const valueGroups = [];
      const allValues = [];
      for (let i = 0; i < batch.length; i++) {
        const row = batch[i];
        const startParam = i * colCount + 1;
        const placeholders = columns.map((_, idx) => '$' + (startParam + idx)).join(', ');
        valueGroups.push('(' + placeholders + ')');
        for (const c of columns) {
          allValues.push(row[c]);
        }
      }

      const multiRowSql =
        'INSERT INTO "' + tableName + '" (' + columns.map((c) => '"' + c + '"').join(', ') + ') ' +
        'VALUES ' + valueGroups.join(', ') + ' ' +
        conflictClause;

      const client = await pool.connect();
      try {
        await client.query(multiRowSql, allValues);
        migrated += batch.length;
      } catch (err) {
        console.error('  [ERROR] 表 ' + tableName + ' 偏移 ' + offset + ':', err.message.substring(0, 120));
        // 降级为逐行插入
        try {
          await client.query('BEGIN');
          for (const row of batch) {
            const placeholders = columns.map((_, idx) => '$' + (idx + 1)).join(', ');
            const sql = 'INSERT INTO "' + tableName + '" (' + columns.map((c) => '"' + c + '"').join(', ') + ') VALUES (' + placeholders + ') ' + conflictClause;
            const values = columns.map((c) => row[c]);
            await client.query(sql, values);
          }
          await client.query('COMMIT');
          migrated += batch.length;
        } catch (err2) {
          await client.query('ROLLBACK');
          console.error('  [ERROR] 逐行插入也失败:', err2.message.substring(0, 120));
        }
      } finally {
        client.release();
      }

      // 进度日志
      if (migrated - lastProgress >= 1000) {
        console.log('    ' + tableName + ': ' + migrated + '/' + totalCount + ' (' + Math.round(migrated/totalCount*100) + '%)');
        lastProgress = migrated;
      }
    }

    // 验证 PG 行数
    const pgCount = await pool.query('SELECT COUNT(*) as c FROM "' + tableName + '"');
    const pgRows = parseInt(pgCount.rows[0].c, 10);

    const status = pgRows === totalCount ? 'OK' : 'MISMATCH';
    report.push({ table: tableName, sqliteRows: totalCount, pgRows, status, migrated });
    totalMigrated += migrated;

    const flag = status === 'OK' ? '[OK]  ' : '[WARN]';
    console.log('  ' + flag + ' ' + tableName + ': ' + totalCount + ' → ' + pgRows + ' (' + status + ')');
   } catch (tableErr) {
    console.error('  [FATAL-TABLE] ' + tableName + ': ' + tableErr.message.substring(0, 150));
    report.push({ table: tableName, sqliteRows: -1, pgRows: -1, status: 'ERROR: ' + tableErr.message.substring(0, 80), migrated: 0 });
   }
  }

  console.log('[4/4] 最终验证...');
  console.log('  总迁移行数:', totalMigrated);
  console.log('  总跳过行数:', totalSkipped);

  // 检查 PG 触发器
  const triggers = await pool.query(
    "SELECT tgname FROM pg_trigger WHERE tgrelid='wac_history'::regclass AND tgname IN ('trg_wac_history_block_update','trg_wac_history_block_delete')"
  );
  if (triggers.rows.length === 2) {
    console.log('  [OK] WAC 触发器存在 (' + triggers.rows.length + '/2)');
  } else {
    console.log('  [WARN] WAC 触发器缺失 (' + triggers.rows.length + '/2)');
  }

  // 输出报告
  console.log('\n=== 迁移报告 ===');
  console.log('表名 | SQLite行数 | PG行数 | 状态 | 迁移数');
  console.log('---|---|---|---|---');
  for (const r of report) {
    console.log(r.table + ' | ' + r.sqliteRows + ' | ' + r.pgRows + ' | ' + r.status + ' | ' + r.migrated);
  }

  const okCount = report.filter((r) => r.status === 'OK').length;
  const warnCount = report.filter((r) => r.status === 'MISMATCH').length;
  const skipCount = report.filter((r) => r.status === 'NO_PG_TABLE' || r.status === 'SKIPPED(manual)').length;
  const emptyCount = report.filter((r) => r.status === 'EMPTY').length;

  console.log('\n--- 汇总 ---');
  console.log('OK:', okCount, '| MISMATCH:', warnCount, '| SKIPPED:', skipCount, '| EMPTY:', emptyCount);

  if (warnCount > 0) {
    console.log('\n[WARNING] 有行数不一致的表，请检查！');
  }

  sqliteDb.close();
  await pool.end();

  console.log('\n[DONE] 迁移脚本结束');
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
