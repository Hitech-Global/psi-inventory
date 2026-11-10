'use strict';

const fs = require('node:fs');
const path = require('node:path');

const serverPath = path.join(__dirname, '..', 'server.js');
let source = fs.readFileSync(serverPath, 'utf8');

function replaceOnce(oldText, newText, label) {
  const count = source.split(oldText).length - 1;
  if (count !== 1) {
    throw new Error('[CI-WAC-SUMMARY] ' + label + ': expected exactly one source match, found ' + count);
  }
  source = source.replace(oldText, newText);
}

const statusMarker = '/* CI-WAC-STATUS-IN-CI-LOGISTICS-20261110 */';
if (!source.includes(statusMarker)) {
  replaceOnce(
    "  rows.forEach(r => { r.pls = plsByBatch[r.id] || []; });\n  if (!ciCanViewAmounts(req)) rows.forEach(ciRedactLogistics);",
    "  rows.forEach(r => { r.pls = plsByBatch[r.id] || []; });\n" +
    "  " + statusMarker + "\n" +
    "  const wacStatusRows = query([\n" +
    "    'SELECT lb.id,',\n" +
    "    'CASE',\n" +
    "    \"WHEN EXISTS (SELECT 1 FROM wac_history wh WHERE wh.logistics_batch_id = lb.id) THEN 'confirmed'\",\n" +
    "    \"WHEN EXISTS (SELECT 1 FROM wac_batch_exclusions e WHERE e.logistics_batch_id = lb.id AND e.status = 'excluded') THEN 'excluded'\",\n" +
    "    \"WHEN lb.logistics_status = ? AND EXISTS (SELECT 1 FROM packing_lists pl WHERE pl.logistics_batch_id = lb.id AND EXISTS (SELECT 1 FROM packing_list_items pli WHERE pli.pl_id = pl.id AND COALESCE(pli.total_qty, 0) > 0)) THEN 'pending'\",\n" +
    "    \"ELSE 'not_ready' END AS wac_status,\",\n" +
    "    '(SELECT MAX(wh.confirmed_at) FROM wac_history wh WHERE wh.logistics_batch_id = lb.id) AS wac_confirmed_at,',\n" +
    "    \"(SELECT e.reason FROM wac_batch_exclusions e WHERE e.logistics_batch_id = lb.id AND e.status = 'excluded' LIMIT 1) AS wac_exclusion_reason,\",\n" +
    "    \"(SELECT e.excluded_at FROM wac_batch_exclusions e WHERE e.logistics_batch_id = lb.id AND e.status = 'excluded' LIMIT 1) AS wac_excluded_at\",\n" +
    "    'FROM logistics_batches lb WHERE lb.related_ci_id = ?'\n" +
    "  ].join(' '), [LOGISTICS_STATUS_ARRIVED, ciId]).rows;\n" +
    "  const wacStatusByBatch = new Map(wacStatusRows.map(row => [String(row.id), row]));\n" +
    "  rows.forEach(r => {\n" +
    "    const wac = wacStatusByBatch.get(String(r.id)) || {};\n" +
    "    r.wac_status = wac.wac_status || 'not_ready';\n" +
    "    r.wac_confirmed_at = wac.wac_confirmed_at || '';\n" +
    "    r.wac_exclusion_reason = wac.wac_exclusion_reason || '';\n" +
    "    r.wac_excluded_at = wac.wac_excluded_at || '';\n" +
    "  });\n" +
    "  if (!ciCanViewAmounts(req)) rows.forEach(ciRedactLogistics);",
    'CI logistics batch WAC status projection'
  );
}

const summaryMarker = '/* CI-WAC-SUMMARY-PROJECTION-20261110 */';
if (!source.includes(summaryMarker)) {
  replaceOnce(
    "const LOGISTICS_STATUS_ARRIVED = 'completed'; // 已到仓\n",
    "const LOGISTICS_STATUS_ARRIVED = 'completed'; // 已到仓\n\n" +
    summaryMarker + "\n" +
    "// CI-level WAC completion is a projection of every WAC-relevant logistics batch.\n" +
    "// A CI is complete only when each batch with positive PL quantity is either confirmed or explicitly excluded.\n" +
    "// If the CI has no WAC-relevant logistics batch, preserve its legacy flag for backward compatibility.\n" +
    "function refreshCIWacSummary(ciId) {\n" +
    "  const id = String(ciId || '').trim();\n" +
    "  if (!id) return null;\n" +
    "  const counts = query([\n" +
    "    'SELECT COUNT(DISTINCT lb.id) AS total_batches,',\n" +
    "    'COUNT(DISTINCT CASE WHEN',\n" +
    "    'NOT EXISTS (SELECT 1 FROM wac_history wh WHERE wh.logistics_batch_id = lb.id)',\n" +
    "    \"AND NOT EXISTS (SELECT 1 FROM wac_batch_exclusions e WHERE e.logistics_batch_id = lb.id AND e.status = 'excluded')\",\n" +
    "    'THEN lb.id END) AS unresolved_batches',\n" +
    "    'FROM logistics_batches lb',\n" +
    "    'WHERE lb.related_ci_id = ?',\n" +
    "    'AND EXISTS (SELECT 1 FROM packing_lists pl WHERE pl.logistics_batch_id = lb.id',\n" +
    "    'AND EXISTS (SELECT 1 FROM packing_list_items pli WHERE pli.pl_id = pl.id AND COALESCE(pli.total_qty, 0) > 0))'\n" +
    "  ].join(' '), [id]).rows[0] || {};\n" +
    "  const total = Number(counts.total_batches || 0);\n" +
    "  if (total === 0) return null;\n" +
    "  const unresolved = Number(counts.unresolved_batches || 0);\n" +
    "  const complete = unresolved === 0;\n" +
    "  const latest = query([\n" +
    "    'SELECT actor_id, event_at FROM (',\n" +
    "    'SELECT wh.confirmed_by AS actor_id, wh.confirmed_at AS event_at FROM wac_history wh',\n" +
    "    'JOIN logistics_batches lb ON lb.id = wh.logistics_batch_id WHERE lb.related_ci_id = ?',\n" +
    "    'UNION ALL',\n" +
    "    'SELECT e.excluded_by AS actor_id, e.excluded_at AS event_at FROM wac_batch_exclusions e',\n" +
    "    \"JOIN logistics_batches lb ON lb.id = e.logistics_batch_id WHERE lb.related_ci_id = ? AND e.status = 'excluded'\",\n" +
    "    \") ci_wac_events WHERE COALESCE(event_at, '') <> '' ORDER BY event_at DESC LIMIT 1\"\n" +
    "  ].join(' '), [id, id]).rows[0] || {};\n" +
    "  run('UPDATE commercial_invoices SET wac_confirmed = ?, wac_confirmed_at = ?, wac_confirmed_by = ? WHERE id = ?',\n" +
    "    [complete ? 1 : 0, complete ? (latest.event_at || '') : '', complete ? (latest.actor_id || '') : '', id]);\n" +
    "  return { total_batches: total, unresolved_batches: unresolved, wac_confirmed: complete };\n" +
    "}\n",
    'CI WAC summary projection helper'
  );
}

const oldConfirmProjection =
  "      // WAC history remains the source of truth; keep the CI summary flag synchronized as a projection.\n" +
  "      run(\"UPDATE commercial_invoices SET wac_confirmed=1, wac_confirmed_at=datetime('now'), wac_confirmed_by=? WHERE id=?\",\n" +
  "        [req.currentUserId || userName, ci.id]);";
if (source.includes(oldConfirmProjection)) {
  replaceOnce(oldConfirmProjection,
    "      // WAC history remains the source of truth; project completion across all relevant CI batches.\n" +
    "      refreshCIWacSummary(meta.ci_id || ci.id);",
    'batch WAC confirmation CI summary update'
  );
}

const excludeResponse = "  res.json({success:true,excluded_count:batchIds.length});";
if (source.includes(excludeResponse) && !source.includes('CI-WAC-EXCLUSION-SUMMARY-20261110')) {
  replaceOnce(excludeResponse,
    "  // CI-WAC-EXCLUSION-SUMMARY-20261110: recalculate each affected CI after the atomic exclusion commit.\n" +
    "  const affectedCiRows = query('SELECT DISTINCT related_ci_id FROM logistics_batches WHERE id IN (' + batchIds.map(() => '?').join(',') + ')', batchIds).rows;\n" +
    "  affectedCiRows.forEach(row => { if (row.related_ci_id) refreshCIWacSummary(row.related_ci_id); });\n" +
    excludeResponse,
    'WAC exclusion CI summary update'
  );
}

const restoreResponse = "  if(failure)return res.status(failure.status).json({error:failure.message});\n  res.json({success:true,restored:true,logistics_batch_id:batchId});";
if (source.includes(restoreResponse) && !source.includes('CI-WAC-RESTORE-SUMMARY-20261110')) {
  replaceOnce(restoreResponse,
    "  if(failure)return res.status(failure.status).json({error:failure.message});\n" +
    "  // CI-WAC-RESTORE-SUMMARY-20261110: a restored batch is unresolved again until confirmed.\n" +
    "  const restoredBatch = queryOne('SELECT related_ci_id FROM logistics_batches WHERE id = ?', [batchId]);\n" +
    "  if (restoredBatch && restoredBatch.related_ci_id) refreshCIWacSummary(restoredBatch.related_ci_id);\n" +
    "  res.json({success:true,restored:true,logistics_batch_id:batchId});",
    'WAC restore CI summary update'
  );
}

const opsGetStart =
  "app.get('/api/commercial-invoices/:id/ops-prep', requireApiPermission('ci_view'), asyncHandler((req, res) => {\n" +
  "  try {\n" +
  "    const ci = queryOne('SELECT * FROM commercial_invoices WHERE id = ?', [req.params.id]);\n" +
  "    if (!ci) return res.status(404).json({ error: 'CI 不存在' });";
if (source.includes(opsGetStart) && !source.includes('CI-WAC-OPS-GET-SUMMARY-20261110')) {
  replaceOnce(opsGetStart,
    opsGetStart + "\n" +
    "    // CI-WAC-OPS-GET-SUMMARY-20261110: refresh the projection before exposing the ops gate.\n" +
    "    refreshCIWacSummary(ci.id);\n" +
    "    const wacState = queryOne('SELECT wac_confirmed FROM commercial_invoices WHERE id = ?', [ci.id]) || ci;",
    'ops-prep read-side WAC summary refresh'
  );
  replaceOnce(
    "      wac_confirmed: ci.wac_confirmed === 1,",
    "      wac_confirmed: wacState.wac_confirmed === 1,",
    'ops-prep read-side WAC flag'
  );
}

const opsPostGuard =
  "    if (ci.wac_confirmed !== 1) return res.status(400).json({ error: 'CI 尚未确认（wac_confirmed=1），无法安排上架准备' });";
if (source.includes(opsPostGuard) && !source.includes('CI-WAC-OPS-POST-SUMMARY-20261110')) {
  replaceOnce(opsPostGuard,
    "    // CI-WAC-OPS-POST-SUMMARY-20261110: enforce the latest batch-level WAC completion state.\n" +
    "    const wacSummary = refreshCIWacSummary(ci.id);\n" +
    "    if (wacSummary) ci.wac_confirmed = wacSummary.wac_confirmed ? 1 : 0;\n" +
    opsPostGuard,
    'ops-prep write-side WAC gate'
  );
}

const opsReadyGuard =
  "    if (ci.wac_confirmed !== 1) return res.status(400).json({ error: 'CI 尚未确认，无法标记上架准备' });";
if (source.includes(opsReadyGuard) && !source.includes('CI-WAC-OPS-READY-SUMMARY-20261110')) {
  replaceOnce(opsReadyGuard,
    "    // CI-WAC-OPS-READY-SUMMARY-20261110: recheck all logistics batches before marking Ready.\n" +
    "    const wacSummary = refreshCIWacSummary(ci.id);\n" +
    "    if (wacSummary) ci.wac_confirmed = wacSummary.wac_confirmed ? 1 : 0;\n" +
    opsReadyGuard,
    'ops-ready WAC gate'
  );
}

fs.writeFileSync(serverPath, source, 'utf8');
console.log('[CI-WAC-SUMMARY] server.js patched successfully');
