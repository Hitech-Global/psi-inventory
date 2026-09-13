#!/usr/bin/env node
'use strict';
/**
 * BULK-1 — 生产在线创建 inventory_imports latest-per-key 索引（CREATE INDEX CONCURRENTLY）
 *
 * 为什么必须独立脚本、不能放进启动流程：
 *   * CREATE INDEX CONCURRENTLY 不能在 transaction block 内执行；
 *   * 它需要在多个事务里多次扫描表并等待所有并发写事务结束，耗时不可预测，
 *     放在启动路径上会拖长发布窗口甚至触发健康检查失败。
 *
 * 用法（只读预检，默认行为）：
 *   node scripts/create-inventory-imports-index-concurrently.cjs --dsn "$DATABASE_URL"
 *
 * 真正执行（需显式加 --apply）：
 *   node scripts/create-inventory-imports-index-concurrently.cjs --dsn "$DATABASE_URL" --apply
 *
 * 安全护栏：
 *   * 主机白名单：仅允许 localhost / 127.0.0.1 / ::1，或显式 --allow-remote 才放行
 *     （生产 Supabase 是远程主机，运维需显式确认）
 *   * 默认 dry-run：只打印将执行的 SQL 与当前行数/索引状态，不落任何 DDL
 *   * 若已存在同名 INVALID 索引，先提示 DROP INDEX 后再重建（INVALID 索引不会被使用）
 */

const { Client } = require('pg');
const M = require('../migrations/inventory-imports-latest-index');

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') out.apply = true;
    else if (a === '--allow-remote') out.allowRemote = true;
    else if (a === '--dsn') out.dsn = argv[++i];
    else if (a && a.startsWith('--dsn=')) out.dsn = a.slice(6);
    else if (a === '--statement-timeout') out.statementTimeout = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log('用法: node scripts/create-inventory-imports-index-concurrently.cjs --dsn <DSN> [--apply] [--allow-remote] [--statement-timeout 0]');
    return;
  }
  const dsn = args.dsn || process.env.DATABASE_URL;
  if (!dsn) {
    console.error('缺少 DSN：请用 --dsn 或环境变量 DATABASE_URL 提供连接串。');
    process.exit(2);
  }
  const url = new URL(dsn.replace(/^postgres(ql)?:\/\//, 'postgresql://'));
  if (!LOCAL_HOSTS.has(url.hostname) && !args.allowRemote) {
    console.error('拒绝执行：主机 ' + url.hostname + ' 不在本地白名单。');
    console.error('若确认这是目标生产库且已评估影响，请追加 --allow-remote。');
    process.exit(2);
  }

  const client = new Client({ connectionString: dsn, ssl: /sslmode=require|ssl=true|supabase|amazonaws|render\.com/.test(dsn) ? { rejectUnauthorized: false } : undefined });
  await client.connect();
  try {
    const exists = await client.query(
      "SELECT c.relname, i.indisvalid, i.indisready, pg_size_pretty(pg_relation_size(c.oid)) AS size " +
      "FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid " +
      "WHERE c.relname = $1", [M.INDEX_NAME]);

    const cnt = await client.query('SELECT count(*)::bigint AS n, (SELECT c.reltuples FROM pg_class c WHERE c.oid = \'public.inventory_imports\'::regclass) AS est FROM public.inventory_imports');
    const rows = cnt.rows[0];

    console.log('--- 现状 ---');
    console.log('inventory_imports 行数（精确）: ' + rows.n + '   planner 估计: ' + rows.est);
    if (exists.rows.length === 0) {
      console.log('索引 ' + M.INDEX_NAME + ': 不存在');
    } else {
      for (const r of exists.rows) {
        console.log('索引 ' + r.relname + ': 已存在  valid=' + r.indisvalid + ' ready=' + r.indisready + ' size=' + r.size);
        if (!r.indisvalid) {
          console.log('  ⚠ INVALID：该索引不会被 planner 使用，建议先 DROP INDEX ' + M.INDEX_NAME + '; 再重建。');
        }
      }
    }

    console.log('\n--- 将执行的 SQL ---');
    console.log(M.PG_CONCURRENTLY_SQL + ';');
    console.log('\n（CONCURRENTLY 不阻塞读写；若中途失败会留下 INVALID 索引，需 DROP 后重跑。）');

    if (!args.apply) {
      console.log('\n[dry-run] 未做任何修改。确认后追加 --apply 执行。');
      return;
    }
    if (exists.rows.length > 0 && exists.rows[0].indisvalid) {
      console.log('\n索引已存在且 valid → 无需执行，退出。');
      return;
    }

    if (args.statementTimeout) {
      await client.query('SET statement_timeout = ' + String(args.statementTimeout));
    } else {
      // CONCURRENTLY 需要等待并发事务，禁止被 statement_timeout 打断
      await client.query('SET statement_timeout = 0');
      await client.query('SET lock_timeout = 0');
    }
    const t0 = Date.now();
    console.log('\n[apply] 开始创建（不阻塞业务写入）...');
    await client.query(M.PG_CONCURRENTLY_SQL);
    console.log('[apply] 完成，耗时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
    const after = await client.query("SELECT c.relname, i.indisvalid FROM pg_class c JOIN pg_index i ON i.indexrelid=c.oid WHERE c.relname=$1", [M.INDEX_NAME]);
    console.log('[apply] 校验: ' + JSON.stringify(after.rows));
  } finally {
    await client.end();
  }
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
