#!/usr/bin/env node
'use strict';
/**
 * BULK-1 — 生产在线创建 inventory_imports latest-per-key 索引。
 * 默认 dry-run；真正执行必须显式 --apply，远程数据库还必须显式 --allow-remote。
 *
 * CREATE INDEX CONCURRENTLY 不能在 transaction block 内执行；若执行中断，PostgreSQL
 * 可能留下同名 INVALID / NOT READY 索引。脚本对此状态 fail-closed：不会依赖
 * IF NOT EXISTS 静默跳过，而是直接报错，要求先处理坏索引后再重试。
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
const INDEX_STATUS_SQL = `
  SELECT idx.relname, i.indisvalid, i.indisready,
         pg_size_pretty(pg_relation_size(idx.oid)) AS size
  FROM pg_class idx
  JOIN pg_namespace ns ON ns.oid = idx.relnamespace
  JOIN pg_index i ON i.indexrelid = idx.oid
  JOIN pg_class tbl ON tbl.oid = i.indrelid
  WHERE ns.nspname = 'public'
    AND tbl.relname = 'inventory_imports'
    AND idx.relname = $1
    AND idx.relkind = 'i'`;

function unhealthyIndexError(row) {
  const valid = row ? row.indisvalid : null;
  const ready = row ? row.indisready : null;
  return new Error(
    '索引 ' + M.INDEX_NAME + ' 已存在但不可用 (indisvalid=' + valid + ', indisready=' + ready + ')。' +
    '请先确认没有并发建索引任务，然后执行：DROP INDEX CONCURRENTLY IF EXISTS public.' + M.INDEX_NAME + '; 再重跑本脚本。'
  );
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log('用法: node scripts/create-inventory-imports-index-concurrently.cjs --dsn <DSN> [--apply] [--allow-remote] [--statement-timeout 0]');
    return;
  }

  const dsn = args.dsn || process.env.DATABASE_URL;
  if (!dsn) throw new Error('缺少 DSN：请用 --dsn 或环境变量 DATABASE_URL 提供连接串。');

  const url = new URL(dsn.replace(/^postgres(ql)?:\/\//, 'postgresql://'));
  if (!LOCAL_HOSTS.has(url.hostname) && !args.allowRemote) {
    throw new Error('拒绝执行：主机 ' + url.hostname + ' 不在本地白名单；确认目标远程库后追加 --allow-remote。');
  }

  const client = new Client({
    connectionString: dsn,
    ssl: /sslmode=require|ssl=true|supabase|amazonaws|render\.com/.test(dsn)
      ? { rejectUnauthorized: false }
      : undefined
  });

  await client.connect();
  try {
    const table = await client.query("SELECT to_regclass('public.inventory_imports') AS reg");
    if (!table.rows[0] || !table.rows[0].reg) {
      throw new Error('public.inventory_imports 不存在，拒绝建索引。');
    }

    const exists = await client.query(INDEX_STATUS_SQL, [M.INDEX_NAME]);
    const state = M.classifyPgIndexRows(exists.rows);

    const cnt = await client.query(
      "SELECT count(*)::bigint AS n, " +
      "(SELECT c.reltuples FROM pg_class c WHERE c.oid = 'public.inventory_imports'::regclass) AS est " +
      'FROM public.inventory_imports'
    );
    const rows = cnt.rows[0];

    console.log('--- 现状 ---');
    console.log('inventory_imports 行数（精确）: ' + rows.n + '   planner 估计: ' + rows.est);
    if (state === 'missing') {
      console.log('索引 ' + M.INDEX_NAME + ': 不存在');
    } else {
      const r = exists.rows[0];
      console.log('索引 ' + r.relname + ': 已存在  valid=' + r.indisvalid + ' ready=' + r.indisready + ' size=' + r.size);
    }

    if (state === 'unhealthy') {
      throw unhealthyIndexError(exists.rows[0]);
    }
    if (state === 'ready') {
      console.log('\n索引已存在且 valid+ready → 无需执行。');
      return;
    }

    console.log('\n--- 将执行的 SQL ---');
    console.log(M.PG_CONCURRENTLY_SQL + ';');
    console.log('\n（CONCURRENTLY 不阻塞普通业务写入，但会等待部分并发事务；若中途失败可能留下 INVALID 索引。）');

    if (!args.apply) {
      console.log('\n[dry-run] 未做任何修改。确认后追加 --apply 执行。');
      return;
    }

    if (args.statementTimeout !== undefined) {
      if (!/^\d+$/.test(String(args.statementTimeout))) {
        throw new Error('--statement-timeout 必须是非负整数毫秒。');
      }
      await client.query('SET statement_timeout = ' + String(args.statementTimeout));
    } else {
      // CONCURRENTLY 可能需要等待旧事务结束；默认不因 statement_timeout 半途留下 INVALID 索引。
      await client.query('SET statement_timeout = 0');
      await client.query('SET lock_timeout = 0');
    }

    const t0 = Date.now();
    console.log('\n[apply] 开始 CREATE INDEX CONCURRENTLY ...');
    await client.query(M.PG_CONCURRENTLY_SQL);
    console.log('[apply] SQL 返回，耗时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');

    const after = await client.query(INDEX_STATUS_SQL, [M.INDEX_NAME]);
    const afterState = M.classifyPgIndexRows(after.rows);
    if (afterState !== 'ready') {
      if (afterState === 'unhealthy') throw unhealthyIndexError(after.rows[0]);
      throw new Error('CREATE INDEX CONCURRENTLY 返回后未找到 ' + M.INDEX_NAME + '，校验失败。');
    }
    console.log('[apply] 校验通过：indisvalid=true, indisready=true');
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
}

module.exports = { parseArgs, unhealthyIndexError, INDEX_STATUS_SQL, main };
