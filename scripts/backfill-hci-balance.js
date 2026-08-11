#!/usr/bin/env node
/**
 * 历史 CI 尾款回补脚本（默认 dry-run，不写库）
 * ============================================================
 * 业务规则（与 createHistoricalCI 修正后逻辑一致）：
 *   historical_ci balance payable_item 新金额
 *     = CI货值(gross_goods_amount)
 *     - 关联PI当前可抵扣定金余额(available_deduct_deposit)
 *
 * 不修改（红线）：
 *   - PI 的 payable_item
 *   - PI 的 available_deduct_deposit（只读）
 *   - payment_settlement_logs
 *   - payment_allocations
 *   - payment_requests
 *
 * 分类（仅 A 类进入自动回补）：
 *   A: 无付款申请 / 无付款分配 / 无结算日志           → 可直接调整 payable_amount_minor
 *   B: 有付款申请、但无实际付款/结算                   → 仅列出，需评估同步 PR 金额
 *   C: 已有付款/结算事实                               → 仅列出，不修改
 *
 * 用法：
 *   node scripts/backfill-hci-balance.js                      # dry-run（默认）
 *   node scripts/backfill-hci-balance.js --db ./data/inventory.db
 *   node scripts/backfill-hci-balance.js --apply              # 真正写库（仅 A 类）
 *   node scripts/backfill-hci-balance.js --apply --only "NHT260318B&NHT260417A"
 *
 * 说明：
 *   - 本地为 SQLite（better-sqlite3）。生产 PG 请运行本脚本 dry-run 后，
 *     将打印出的 UPDATE 语句在 PG 端执行，或直接移植脚本中的 SQL。
 *   - 关联 PI 来源：historical_commercial_invoice_items.pi_no ∪ 解析 historical_ci_no（按 & + , / 等拆分）。
 */

const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const hasFlag = (name) => args.includes(name);

const APPLY = hasFlag('--apply');
const DB_PATH = arg('--db') || path.join(__dirname, '..', 'data', 'inventory.db');
const ONLY = arg('--only');

if (!fs.existsSync(DB_PATH)) {
  console.error(`[ERR] 数据库文件不存在: ${DB_PATH}`);
  process.exit(1);
}

let db;
try {
  const Database = require('better-sqlite3');
  db = new Database(DB_PATH, { readonly: !APPLY });
} catch (e) {
  console.error('[ERR] 无法打开 SQLite 数据库:', e.message);
  process.exit(1);
}

function q(sql, params = []) {
  return db.prepare(sql).all(...params);
}

// 解析 historical_ci_no 中的 PI 号（按常见分隔符拆分）
function parsePiNosFromCiNo(ciNo) {
  if (!ciNo) return [];
  return String(ciNo)
    .split(/[&+,/，、\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// 取某历史 CI 关联的 PI 可用抵扣余额（minor 单位合计）
function getLinkedDeductMinor(hciId, ciNo) {
  const fromItems = q(
    'SELECT DISTINCT pi_no FROM historical_commercial_invoice_items WHERE hci_id = ?',
    [hciId]
  ).map((r) => r.pi_no);
  const fromNo = parsePiNosFromCiNo(ciNo);
  const piNos = [...new Set([...fromItems, ...fromNo].filter(Boolean))];
  if (!piNos.length) return { piNos: [], deductMinor: 0 };

  const placeholders = piNos.map(() => '?').join(',');
  const rows = q(
    `SELECT pi_no, available_deduct_deposit FROM proforma_invoices WHERE pi_no IN (${placeholders})`,
    piNos
  );
  const deductMinor = rows.reduce(
    (s, r) => s + Math.round((r.available_deduct_deposit || 0) * 100),
    0
  );
  return { piNos, deductMinor };
}

// 分类：A / B / C
function classify(payableItemId) {
  const prCnt = q(
    `SELECT COUNT(*) AS c FROM payment_request_items pri
       JOIN payment_requests pr ON pr.id = pri.payment_request_id
       WHERE pri.payable_item_id = ? AND pr.payment_status NOT IN ('cancelled','rejected')
         AND pr.approval_status NOT IN ('cancelled','rejected')`,
    [payableItemId]
  )[0].c;
  const allocCnt = q(
    `SELECT COUNT(*) AS c FROM payment_allocations pa
       JOIN payment_request_items pri ON pri.id = pa.payment_request_item_id
       WHERE pri.payable_item_id = ?`,
    [payableItemId]
  )[0].c;
  const settleCnt = q(
    `SELECT COUNT(*) AS c FROM payment_settlement_logs l
       JOIN payment_request_items pri ON pri.payment_request_id = l.payment_request_id
       WHERE pri.payable_item_id = ?`,
    [payableItemId]
  )[0].c;
  const paid = q(
    `SELECT 1 FROM payment_request_items pri
       JOIN payment_requests pr ON pr.id = pri.payment_request_id
       WHERE pri.payable_item_id = ? AND pr.payment_status = 'paid' LIMIT 1`,
    [payableItemId]
  ).length;

  let category = 'A';
  if (allocCnt > 0 || settleCnt > 0 || paid > 0) category = 'C';
  else if (prCnt > 0) category = 'B';
  return { category, prCnt, allocCnt, settleCnt };
}

console.log('========================================================');
console.log(' 历史 CI 尾款回补 — ' + (APPLY ? 'APPLY（写库，仅 A 类）' : 'DRY-RUN（不写库）'));
console.log(' DB: ' + DB_PATH);
console.log('========================================================\n');

const rows = q(`
  SELECT pi.id            AS payable_item_id,
         pi.source_id     AS hci_id,
         pi.source_no     AS ci_no,
         pi.payable_amount_minor AS old_minor,
         h.gross_goods_amount AS gross,
         h.historical_paid_amount AS historical_paid
  FROM payable_items pi
  JOIN historical_commercial_invoices h ON h.id = pi.source_id
  WHERE pi.source_type = 'historical_ci' AND pi.fee_type = 'balance'
`);

if (ONLY) {
  rows = rows.filter((r) => r.ci_no === ONLY);
}

const summary = { A: 0, B: 0, C: 0, totalOld: 0, totalNew: 0, applyList: [] };
const lines = [];

for (const r of rows) {
  const grossMinor = Math.round((r.gross || 0) * 100);
  const { piNos, deductMinor } = getLinkedDeductMinor(r.hci_id, r.ci_no);
  const newMinor = Math.max(0, grossMinor - deductMinor);
  const { category } = classify(r.payable_item_id);

  summary[category]++;
  summary.totalOld += r.old_minor || 0;
  if (category === 'A') {
    summary.totalNew += newMinor;
    summary.applyList.push({ id: r.payable_item_id, newMinor });
  }

  lines.push({
    ci_no: r.ci_no,
    category,
    gross: (grossMinor / 100).toFixed(2),
    deduct: (deductMinor / 100).toFixed(2),
    piNos: piNos.join(','),
    old: ((r.old_minor || 0) / 100).toFixed(2),
    new: (newMinor / 100).toFixed(2),
    delta: (((r.old_minor || 0) - newMinor) / 100).toFixed(2),
    id: r.payable_item_id,
  });
}

// 表格输出
const pad = (s, n) => String(s).padEnd(n);
console.log(
  pad('CI_NO', 34) + pad('CAT', 4) + pad('GROSS', 12) + pad('DEDUCT', 11) +
  pad('OLD', 12) + pad('NEW', 12) + pad('DELTA', 10) + 'PI_NOS'
);
console.log('-'.repeat(120));
for (const l of lines) {
  console.log(
    pad(l.ci_no, 34) + pad(l.category, 4) + pad(l.gross, 12) + pad(l.deduct, 11) +
    pad(l.old, 12) + pad(l.new, 12) + pad(l.delta, 10) + l.piNos
  );
}
console.log('-'.repeat(120));
console.log(
  `分类统计: A=${summary.A}  B=${summary.B}  C=${summary.C}   ` +
  `A类总额 OLD=${(summary.totalOld / 100).toFixed(2)}  NEW=${((summary.totalNew || 0) / 100).toFixed(2)}`
);

if (APPLY) {
  const stmt = db.prepare('UPDATE payable_items SET payable_amount_minor = ? WHERE id = ?');
  const tx = db.transaction(() => {
    for (const a of summary.applyList) stmt.run(a.newMinor, a.id);
  });
  tx();
  console.log(`\n[APPLY] 已更新 ${summary.applyList.length} 条 A 类 payable_items（仅 payable_amount_minor）。`);
} else {
  console.log('\n[DRY-RUN] 未写库。A 类将执行以下 UPDATE（复制至生产 PG 执行）：');
  for (const a of summary.applyList) {
    console.log(`UPDATE payable_items SET payable_amount_minor = ${a.newMinor} WHERE id = '${a.id}';`);
  }
  if (summary.B + summary.C > 0) {
    console.log(`\n⚠ B 类(${summary.B}) / C 类(${summary.C}) 未处理，需单独评估。`);
  }
}

db.close();
