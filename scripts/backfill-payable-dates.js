#!/usr/bin/env node
/**
 * 一次性存量回填：payable_items.payable_date 与 payment_requests.payable_date
 *
 * 背景：
 *   历史 CI / 运营 CI 的尾款在旧逻辑里因 credit_days=0（或变量引用错误）未写入应付日期，
 *   导致应付费用列表为空、应付驾驶舱误报「无到期日」。新建数据已在 server.js 通过
 *   resolvePayableDate 修复，但生产已存在的历史单据需要一次性补字段。
 *
 * 原则（与业务修复一致）：
 *   1. 仅补充 payable_date 字段，不修改任何付款状态 / 审批状态 / 金额 / 结算记录。
 *   2. Credit 条款判定：来源 CI 的 credit_days > 0 或 payment_terms 含 "credit"（不区分大小写）。
 *      - Credit：来源优先级 CI 已录入 due_date > 实际出货日 + credit_days > 空（真实异常，需人工补全）。
 *      - 非 Credit（如定金/预付）：本就无需应付日期，保持为空，不做填充、不计入异常。
 *   3. 只读计算；默认 dry-run，加 --apply 才写库。绝不为非 Credit 数据臆造日期。
 *
 * 用法：
 *   node scripts/backfill-payable-dates.js            # dry-run，仅打印影响行数
 *   node scripts/backfill-payable-dates.js --apply    # 真正写入
 *
 * 数据源：
 *   默认连接 ./data/inventory.db（sqlite）；若设置 DATABASE_URL 则连接 PostgreSQL。
 *   sqlite 路径可用 DB_PATH 覆盖。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const isPg = !!process.env.DATABASE_URL;

// ---------- 日期工具（与 server.js resolvePayableDate 保持一致） ----------
function isDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }
function addDays(s, n) {
  const d = new Date(s + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + Number(n));
  return d.toISOString().slice(0, 10);
}
function resolvePayableDate({ dueDate, creditDays, baseDate }) {
  const due = String(dueDate == null ? '' : dueDate).trim();
  if (isDate(due)) return due;
  if (Number(creditDays) > 0 && isDate(baseDate)) return addDays(baseDate, Number(creditDays));
  return '';
}

// ---------- DB 抽象（sqlite / pg 双驱动） ----------
let db = null;      // sqlite 句柄
let pgClient = null;

async function initDb() {
  if (isPg) {
    const { Client } = require('pg');
    pgClient = new Client({ connectionString: process.env.DATABASE_URL });
    await pgClient.connect();
  } else {
    const Database = require('better-sqlite3');
    const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'inventory.db');
    if (!fs.existsSync(dbPath)) throw new Error('sqlite 库不存在: ' + dbPath);
    db = new Database(dbPath, { readonly: !APPLY });
  }
}

async function q(sql, params = []) {
  if (isPg) { const r = await pgClient.query(sql, params); return r.rows; }
  return db.prepare(sql).all(...params);
}
async function q1(sql, params = []) {
  if (isPg) { const r = await pgClient.query(sql, params); return r.rows[0]; }
  return db.prepare(sql).get(...params);
}
async function run(sql, params = []) {
  if (isPg) { await pgClient.query(sql, params); }
  else { db.prepare(sql).run(...params); }
}
function ph(i) { return isPg ? '$' + i : '?'; }

async function closeDb() {
  if (isPg && pgClient) await pgClient.end();
  if (db) db.close();
}

// 仅 Credit 条款（credit_days>0 或 payment_terms 含 credit）才需要应付日期。
function isCreditTerms(creditDays, paymentTerms) {
  if (Number(creditDays) > 0) return true;
  return /credit/i.test(String(paymentTerms || ''));
}

// ---------- 核心：取 CI 的应付日期来源 ----------
// 优先按 related_ci_id / source_ci_id 关联；历史 CI 的 payment_request 生成时未写 related_ci_id，
// 退化为按 source_no（历史CI编号 / CI编号）反查，确保存量也能补上。
async function ciDueDate(sourceType, ciId, sourceNo) {
  if (ciId) {
    const tbl = sourceType === 'historical_ci' ? 'historical_commercial_invoices' : 'commercial_invoices';
    const row = await q1(`SELECT due_date, credit_days, actual_ship_date, payment_terms FROM ${tbl} WHERE id = ${ph(1)}`, [ciId]);
    if (row) return row;
  }
  if (sourceNo) {
    const h = await q1(`SELECT due_date, credit_days, actual_ship_date, payment_terms FROM historical_commercial_invoices WHERE historical_ci_no = ${ph(1)}`, [sourceNo]);
    if (h) return h;
    const c = await q1(`SELECT due_date, credit_days, actual_ship_date, payment_terms FROM commercial_invoices WHERE ci_no = ${ph(1)}`, [sourceNo]);
    if (c) return c;
  }
  return null;
}

// 统一计算单条记录的回填结论：
//   kind: 'fill'（可补）| 'non-credit'（非Credit，跳过不报异常）| 'anomaly'（Credit却无法计算，真实异常）| 'unknown'（无来源可判定，跳过）
//   date: 计算出的应付日期（'fill' 时有效）
//   src:  日期来源说明
async function evaluate(row) {
  const ci = await ciDueDate(row.source_type, row.source_ci_id || row.related_ci_id, row.source_no);
  if (!ci) return { kind: 'unknown', date: '', src: '无关联CI，无法判定' };
  if (!isCreditTerms(ci.credit_days, ci.payment_terms)) {
    return { kind: 'non-credit', date: '', src: '非Credit条款，无需应付日期（跳过）' };
  }
  const due = String(ci.due_date || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(due)) {
    return { kind: 'fill', srcKind: 'due_date', date: due, src: `CI已录入 due_date=${due}` };
  }
  if (Number(ci.credit_days) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(String(ci.actual_ship_date || '').trim())) {
    const d = addDays(String(ci.actual_ship_date).trim(), Number(ci.credit_days));
    return { kind: 'fill', srcKind: 'ship_credit', date: d, src: `出货日${ci.actual_ship_date}+账期${ci.credit_days}=${d}` };
  }
  return { kind: 'anomaly', date: '', src: 'Credit但缺 due_date 且无(出货日+账期)，无法计算' };
}

// ---------- 回填 payable_items ----------
async function backfillPayableItems(plan) {
  const rows = await q(`SELECT id, source_type, source_ci_id, source_no, payable_date FROM payable_items WHERE payable_date IS NULL OR payable_date = ''`);
  for (const r of rows) {
    const e = await evaluate(r);
    plan.push({ table: 'payable_items', id: r.id, source_type: r.source_type, date: e.date, kind: e.kind, srcKind: e.srcKind, src: e.src });
    if (APPLY && e.kind === 'fill') {
      const p1 = ph(1), p2 = ph(2);
      await run(`UPDATE payable_items SET payable_date = ${p1} WHERE id = ${p2}`, [e.date, r.id]);
    }
  }
}

// ---------- 回填 payment_requests ----------
async function backfillPaymentRequests(plan) {
  const rows = await q(`SELECT id, source_type, related_ci_id, source_no, payable_date FROM payment_requests WHERE payable_date IS NULL OR payable_date = ''`);
  for (const r of rows) {
    const e = await evaluate(r);
    plan.push({ table: 'payment_requests', id: r.id, source_type: r.source_type, date: e.date, kind: e.kind, srcKind: e.srcKind, src: e.src });
    if (APPLY && e.kind === 'fill') {
      const p1 = ph(1), p2 = ph(2);
      await run(`UPDATE payment_requests SET payable_date = ${p1} WHERE id = ${p2}`, [e.date, r.id]);
    }
  }
}

// ---------- 主流程 ----------
(async () => {
  try {
    await initDb();
    const mode = APPLY ? 'APPLY（真实写入）' : 'DRY-RUN（只读，不写库）';
    console.log('========================================');
    console.log(' 应付日期存量回填  |  ' + mode);
    console.log(' 数据源: ' + (isPg ? 'PostgreSQL (DATABASE_URL)' : 'SQLite (./data/inventory.db)'));
    console.log('========================================');

    const plan = [];
    await backfillPayableItems(plan);
    await backfillPaymentRequests(plan);

    const byTable = {};
    const stat = { fill: 0, 'non-credit': 0, anomaly: 0, unknown: 0 };
    const srcStat = { due_date: 0, ship_credit: 0 };
    for (const e of plan) {
      byTable[e.table] = byTable[e.table] || { total: 0, fill: 0, nonCredit: 0, anomaly: 0, unknown: 0 };
      byTable[e.table].total++;
      if (e.kind === 'fill') {
        byTable[e.table].fill++; stat.fill++;
        if (e.srcKind === 'due_date') srcStat.due_date++;
        else if (e.srcKind === 'ship_credit') srcStat.ship_credit++;
      }
      else if (e.kind === 'non-credit') { byTable[e.table].nonCredit++; stat['non-credit']++; }
      else if (e.kind === 'anomaly') { byTable[e.table].anomaly++; stat.anomaly++; }
      else { byTable[e.table].unknown++; stat.unknown++; }
    }

    console.log('\n扫描到空 payable_date 的记录（按 Credit 口径分类）：');
    for (const t of ['payable_items', 'payment_requests']) {
      const s = byTable[t] || { total: 0, fill: 0, nonCredit: 0, anomaly: 0, unknown: 0 };
      console.log(`  ${t}: 共 ${s.total} 条 ｜ 可补 ${s.fill} ｜ 非Credit跳过 ${s.nonCredit} ｜ 真实异常 ${s.anomaly} ｜ 无来源 ${s.unknown}`);
    }
    console.log(`\n【来源统计】可补 ${stat.fill} 条 ｜  其中 取CI已录入 due_date: ${srcStat.due_date} 条 ｜  由 出货日+账期 推算: ${srcStat.ship_credit} 条`);
    console.log(`【其他】非Credit跳过(不报异常) ${stat['non-credit']} 条 ｜ 真实异常(Credit但无法计算) ${stat.anomaly} 条 ｜ 无来源(无法判定) ${stat.unknown} 条`);

    if (!APPLY) {
      console.log('\n【可补】样例（前 20 条，含日期来源）：');
      plan.filter(e => e.kind === 'fill').slice(0, 20).forEach(e => {
        console.log(`  [${e.table}] ${e.id} (${e.source_type}) -> ${e.date} ｜ ${e.src}`);
      });
      const anomalies = plan.filter(e => e.kind === 'anomaly');
      if (anomalies.length) {
        console.log('\n【真实异常】Credit 但无法计算（前 20 条）：');
        anomalies.slice(0, 20).forEach(e => {
          console.log(`  [${e.table}] ${e.id} (${e.source_type}) ｜ ${e.src}`);
        });
      }
      const nc = plan.filter(e => e.kind === 'non-credit');
      if (nc.length) {
        console.log('\n【非Credit跳过】不补、不报异常（前 10 条）：');
        nc.slice(0, 10).forEach(e => {
          console.log(`  [${e.table}] ${e.id} (${e.source_type}) ｜ ${e.src}`);
        });
      }
      console.log('\n这是 dry-run，未做任何修改。确认无误后加 --apply 执行写入。');
    } else {
      console.log('\n已写入。请注意：本脚本仅更新 payable_date 字段，未触碰付款状态/审批/金额/结算。');
    }
  } catch (e) {
    console.error('回填失败:', e.message);
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
})();
