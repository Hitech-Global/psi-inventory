'use strict';
const fs = require('fs');

function replaceRange(path, startMarker, endMarker, replacement) {
  const src = fs.readFileSync(path, 'utf8');
  const start = src.indexOf(startMarker);
  if (start < 0) throw new Error(`${path}: start marker not found`);
  const end = src.indexOf(endMarker, start);
  if (end < 0) throw new Error(`${path}: end marker not found`);
  fs.writeFileSync(path, src.slice(0, start) + replacement + '\n\n' + src.slice(end));
}

const serverBlock = String.raw`// 库存导入实时进度：只记录执行状态，不改变库存事实表/事务边界；1 小时 TTL 防止内存累积。
const inventoryImportRuns = new Map();
const INVENTORY_IMPORT_RUN_TTL_MS = 60 * 60 * 1000;
function inventoryImportProgressBody(run) {
  if (!run) return null;
  return {
    import_id: run.import_id,
    status: run.status,
    phase: run.phase,
    percent: run.percent,
    processed_count: run.processed_count,
    total_count: run.total_count,
    message: run.message || '',
    created: run.created || 0,
    failed: run.failed || 0,
    started_at: run.started_at,
    updated_at: run.updated_at,
    finished_at: run.finished_at || null
  };
}
function cleanupInventoryImportRuns(nowMs) {
  const now = Number(nowMs || Date.now());
  for (const [id, run] of inventoryImportRuns.entries()) {
    const t = Date.parse(run.updated_at || run.started_at || 0);
    if (Number.isFinite(t) && now - t > INVENTORY_IMPORT_RUN_TTL_MS) inventoryImportRuns.delete(id);
  }
}
function setInventoryImportProgress(importId, patch) {
  cleanupInventoryImportRuns();
  const now = new Date().toISOString();
  const prev = inventoryImportRuns.get(importId) || {
    import_id: importId,
    status: 'running', phase: 'validating', percent: 0,
    processed_count: 0, total_count: 0, created: 0, failed: 0,
    started_at: now
  };
  const next = Object.assign({}, prev, patch || {}, { updated_at: now });
  next.percent = Math.max(0, Math.min(100, Number(next.percent) || 0));
  next.processed_count = Math.max(0, Number(next.processed_count) || 0);
  next.total_count = Math.max(0, Number(next.total_count) || 0);
  inventoryImportRuns.set(importId, next);
  return next;
}
function finishInventoryImportProgress(importId, status, patch) {
  return setInventoryImportProgress(importId, Object.assign({}, patch || {}, {
    status,
    percent: status === 'completed' ? 100 : ((patch && patch.percent) || 0),
    finished_at: new Date().toISOString()
  }));
}
function yieldInventoryImportProgress() { return new Promise(resolve => setImmediate(resolve)); }

app.get('/api/inventory-imports/bulk-import/:importId/status', requireApiPermission('inventory_import'), asyncHandler(async (req, res) => {
  const run = inventoryImportRuns.get(String(req.params.importId || ''));
  if (!run) return res.status(404).json({ error: '导入任务不存在', import_id: req.params.importId });
  res.json(inventoryImportProgressBody(run));
}));

app.post('/api/inventory-imports/bulk-import', requireApiPermission('inventory_import'), asyncHandler(async (req, res) => {
  const items = req.body.items || [];
  const snapshotCutoffDate = req.body.snapshot_cutoff_date || '';
  const importId = String(req.body.import_id || genId('invjob')).trim();
  const totalCount = items.length;
  setInventoryImportProgress(importId, { status: 'running', phase: 'validating', percent: 2, processed_count: 0, total_count: totalCount, message: '正在校验导入数据' });
  await yieldInventoryImportProgress();
  try {
    const precheck = validateInventoryImportRows(items);
    if (!precheck.ok) {
      finishInventoryImportProgress(importId, 'blocked', { phase: 'blocked', percent: 5, failed: precheck.blocking_count, message: '预检查未通过，数据库零写入' });
      return res.status(422).json({
        error: '库存导入预检查未通过，本次导入已整批阻断，数据库未发生任何写入',
        blocked: true, import_id: importId, created: 0, updated: 0, failed: precheck.blocking_count,
        precheck, blocking: precheck.blocking, summary: precheck.summary
      });
    }
    setInventoryImportProgress(importId, { phase: 'preparing', percent: 12, processed_count: totalCount, message: '预检查通过，正在准备写入' });
    await yieldInventoryImportProgress();

    const result = { created: 0, updated: 0, failed: 0, tombstones_lifted: 0, errors: [] };
    if (items.length > MAX_INVENTORY_IMPORT_ROWS) {
      finishInventoryImportProgress(importId, 'blocked', { phase: 'blocked', percent: 12, failed: items.length, message: `超过单次导入上限 ${MAX_INVENTORY_IMPORT_ROWS} 条` });
      return res.status(400).json({ error: `单次库存导入最多 ${MAX_INVENTORY_IMPORT_ROWS} 条，当前 ${items.length} 条（已拒绝，零写入）`, blocked: true, import_id: importId, created: 0, updated: 0, failed: items.length });
    }

    if (isPgDriver()) {
      const validated = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item.sku_code || !item.import_date) { result.failed++; result.errors.push({ row: i + 2, reason: 'SKU或导入日期为空' }); continue; }
        const rawAvailQty = item.available_qty;
        if (rawAvailQty === null || rawAvailQty === undefined || String(rawAvailQty).trim() === '') { result.failed++; result.errors.push({ row: i + 2, reason: '可用数量必须为非负整数' }); continue; }
        const availQty = Number(rawAvailQty);
        if (!Number.isFinite(availQty) || !Number.isInteger(availQty) || availQty < 0) { result.failed++; result.errors.push({ row: i + 2, reason: '可用数量必须为非负整数' }); continue; }
        validated.push({
          id: genId('inv_imp'), import_date: normalizeImportDate(item.import_date), country: item.country || '', warehouse: item.warehouse || '', channel: item.channel || '',
          sku_code: item.sku_code, available_qty: availQty, remark: item.remark || '', snapshot_cutoff_date: snapshotCutoffDate, brand: item.brand || '',
          weighted_avg_cost: parseFloat(item.weighted_avg_cost) || 0, last_inbound_date: item.last_inbound_date || '', first_inbound_date: item.first_inbound_date || ''
        });
        if ((i + 1) % 50 === 0 || i === items.length - 1) {
          const validationPercent = 12 + Math.round(((i + 1) / Math.max(1, totalCount)) * 13);
          setInventoryImportProgress(importId, { phase: 'validating_rows', percent: validationPercent, processed_count: i + 1, message: `正在校验 ${i + 1} / ${totalCount} 条` });
          await yieldInventoryImportProgress();
        }
      }
      if (result.failed > 0) {
        finishInventoryImportProgress(importId, 'blocked', { phase: 'blocked', percent: 25, failed: result.failed, message: '数据校验未通过，整批零写入' });
        return res.status(422).json({ error: '库存导入校验未通过，PG 要求整批原子写入，已拒绝本次导入（零写入）', import_id: importId, created: 0, updated: 0, failed: result.failed, errors: result.errors });
      }
      const keyMap = new Map();
      for (const r of validated) {
        const k = r.sku_code + '\\0' + r.country + '\\0' + r.warehouse;
        if (!keyMap.has(k)) keyMap.set(k, { sku_code: r.sku_code, country: r.country, warehouse: r.warehouse });
      }
      const keys = Array.from(keyMap.values());
      const liftTuples = keys.map(k => ({ sku_code: k.sku_code, country: k.country, warehouse: k.warehouse }));
      setInventoryImportProgress(importId, { phase: 'writing', percent: 32, processed_count: 0, message: '正在写入库存数据' });
      await yieldInventoryImportProgress();
      try {
        transaction(() => {
          run(pgBatchImportInsertSql(), [JSON.stringify(validated)]);
          const lifted = run(pgBatchTombstoneLiftSql(), [JSON.stringify(liftTuples)]);
          result.tombstones_lifted = Number((lifted && (lifted.changes != null ? lifted.changes : lifted.rowCount)) || 0);
        });
        result.created = validated.length;
      } catch (e) {
        finishInventoryImportProgress(importId, 'failed', { phase: 'failed', percent: 32, failed: validated.length, message: '库存写入失败，整批已回滚' });
        return res.status(500).json({ error: 'PG 批量导入失败，整批已回滚: ' + e.message, import_id: importId, created: 0, updated: 0, failed: validated.length });
      }
      setInventoryImportProgress(importId, { phase: 'written', percent: 68, processed_count: totalCount, created: result.created, message: `库存数据已写入 ${totalCount} / ${totalCount} 条` });
      await yieldInventoryImportProgress();
      setInventoryImportProgress(importId, { phase: 'refreshing_inventory', percent: 76, processed_count: totalCount, message: '正在更新库存总表' });
      await yieldInventoryImportProgress();
      const refreshResult = await refreshInventoryTotalsForKeys(keys, snapshotCutoffDate);
      setInventoryImportProgress(importId, { phase: 'finalizing', percent: 96, processed_count: totalCount, created: result.created, message: '正在完成导入校验' });
      await yieldInventoryImportProgress();
      const body = { ...result, import_id: importId, snapshot_cutoff_date: snapshotCutoffDate, wac_warnings: refreshResult.warnings || [] };
      finishInventoryImportProgress(importId, 'completed', { phase: 'completed', processed_count: totalCount, created: result.created, failed: result.failed, message: '导入完成' });
      return res.json(body);
    }

    setInventoryImportProgress(importId, { phase: 'writing', percent: 30, processed_count: 0, message: '正在写入库存数据' });
    await yieldInventoryImportProgress();
    transaction(() => {
      items.forEach((item, i) => {
        let imported = false;
        try {
          if (!item.sku_code || !item.import_date) { result.failed++; result.errors.push({ row: i + 2, reason: 'SKU或导入日期为空' }); return; }
          const rawAvailQty = item.available_qty;
          if (rawAvailQty === null || rawAvailQty === undefined || String(rawAvailQty).trim() === '') { result.failed++; result.errors.push({ row: i + 2, reason: '可用数量必须为非负整数' }); return; }
          const availQty = Number(rawAvailQty);
          if (!Number.isFinite(availQty) || !Number.isInteger(availQty) || availQty < 0) { result.failed++; result.errors.push({ row: i + 2, reason: '可用数量必须为非负整数' }); return; }
          const id = genId('inv_imp');
          const importDate = normalizeImportDate(item.import_date);
          run(`INSERT INTO inventory_imports (id, import_date, country, warehouse, channel, sku_code, available_qty, remark, snapshot_cutoff_date, brand, weighted_avg_cost, last_inbound_date, first_inbound_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, importDate, item.country || '', item.warehouse || '', item.channel || '', item.sku_code, availQty, item.remark || '', snapshotCutoffDate, item.brand || '', parseFloat(item.weighted_avg_cost) || 0, item.last_inbound_date || '', item.first_inbound_date || '']);
          imported = true;
          const lifted = run('DELETE FROM inventory_delete_tombstones WHERE sku_code=? AND country=? AND warehouse=?', [item.sku_code || '', item.country || '', item.warehouse || '']);
          if (!lifted) throw new Error('tombstone 解除执行失败');
          if (Number(lifted.changes || 0) > 0) result.tombstones_lifted++;
          result.created++;
        } catch (e) {
          if (imported) throw new Error(`第 ${i + 2} 行：库存导入已写入但 tombstone 解除失败，整批回滚 — ${e.message}`);
          result.failed++; result.errors.push({ row: i + 2, reason: e.message });
        }
      });
    });
    setInventoryImportProgress(importId, { phase: 'written', percent: 68, processed_count: totalCount, created: result.created, failed: result.failed, message: `库存数据已处理 ${totalCount} / ${totalCount} 条` });
    await yieldInventoryImportProgress();
    setInventoryImportProgress(importId, { phase: 'refreshing_inventory', percent: 76, processed_count: totalCount, message: '正在更新库存总表' });
    await yieldInventoryImportProgress();
    const refreshResult = await refreshInventoryTotals(snapshotCutoffDate);
    setInventoryImportProgress(importId, { phase: 'finalizing', percent: 96, processed_count: totalCount, created: result.created, failed: result.failed, message: '正在完成导入校验' });
    await yieldInventoryImportProgress();
    const body = { ...result, import_id: importId, snapshot_cutoff_date: snapshotCutoffDate, wac_warnings: refreshResult.warnings || [] };
    finishInventoryImportProgress(importId, 'completed', { phase: 'completed', processed_count: totalCount, created: result.created, failed: result.failed, message: '导入完成' });
    res.json(body);
  } catch (e) {
    finishInventoryImportProgress(importId, 'failed', { phase: 'failed', message: e.message || '导入失败' });
    res.status(500).json({ error: e.message, import_id: importId });
  }
}));`;

replaceRange('server.js', "app.post('/api/inventory-imports/bulk-import'", '// ==================== 库存总表 ====================', serverBlock);

const appBlock = String.raw`var invImportPollTimer=null;
function stopInvImportPolling(){if(invImportPollTimer){clearTimeout(invImportPollTimer);invImportPollTimer=null;}}
function invImportPhaseLabel(phase){var m={validating:'正在校验导入数据',preparing:'预检查通过，正在准备写入',validating_rows:'正在校验数据行',writing:'正在写入库存数据',written:'库存数据写入完成',refreshing_inventory:'正在更新库存总表',finalizing:'正在完成导入校验',completed:'导入完成',blocked:'导入已阻断',failed:'导入失败'};return m[phase]||'正在导入库存';}
function renderInvImportProgress(run){
  if(!run)return;
  var p=Math.max(0,Math.min(100,Number(run.percent)||0));
  var total=Math.max(0,Number(run.total_count)||0),done=Math.max(0,Number(run.processed_count)||0);
  var terminal=run.status==='completed'||run.status==='failed'||run.status==='blocked';
  var ok=run.status==='completed',bad=run.status==='failed'||run.status==='blocked';
  var title=run.message||invImportPhaseLabel(run.phase);
  var accent=ok?'#30a85a':(bad?'#ff3b30':'#2e7d32');
  var box=document.getElementById('inv-result');
  if(box){box.innerHTML='<div style="margin-top:12px;padding:18px 18px 16px;border-radius:16px;background:rgba(248,248,250,.96);border:1px solid rgba(0,0,0,.06);box-shadow:0 8px 24px rgba(0,0,0,.06)">'+
    '<div style="display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:12px"><div><div style="font-size:14px;font-weight:600;color:#1d1d1f">'+esc(title)+'</div><div style="font-size:12px;color:#86868b;margin-top:3px">'+(total?(done+' / '+total+' 条'):'正在准备…')+'</div></div><div style="font-size:28px;line-height:1;font-weight:650;letter-spacing:-.03em;color:'+accent+'">'+Math.round(p)+'%</div></div>'+ 
    '<div style="height:7px;border-radius:999px;background:#e8e8ed;overflow:hidden"><div style="height:100%;width:'+p+'%;border-radius:999px;background:'+accent+';transition:width .35s ease"></div></div>'+ 
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:9px;font-size:11px;color:#86868b"><span>'+esc(invImportPhaseLabel(run.phase))+'</span><span>'+(terminal?(ok?'✓ 已完成':'已停止'):'请保持窗口打开，无需重复操作')+'</span></div></div>';}
  var btn=document.getElementById('inv-import-btn');if(btn&&!terminal){btn.disabled=true;btn.textContent='正在导入 '+Math.round(p)+'%';}
}
async function pollInvImportStatus(importId){
  if(!importId)return;
  try{var run=await api('/api/inventory-imports/bulk-import/'+encodeURIComponent(importId)+'/status');renderInvImportProgress(run);if(run.status==='completed'||run.status==='failed'||run.status==='blocked'){stopInvImportPolling();return;}}catch(e){if(!(e&&e.status===404)){/* best-effort */}}
  stopInvImportPolling();invImportPollTimer=setTimeout(function(){pollInvImportStatus(importId)},400);
}
function startInvImportPolling(importId){stopInvImportPolling();invImportPollTimer=setTimeout(function(){pollInvImportStatus(importId)},120);}

async function submitInvBatchImport(){
  var records=window._invImportData||[];
  if(records.length===0){showToast(t("toast.no_valid_data", "没有可导入的有效数据"),'danger');return}
  var hasLocalError=records.some(function(r){return r._errors&&r._errors.length>0});if(hasLocalError){showToast(t('inv.toast_blocked','存在阻断型错误，本次库存导入已整批拒绝'),'danger');return}
  var snapshotDate=window._invSnapshotDate||'';if(!snapshotDate){showToast(t("toast.fill_snapshot_date", "请填写库存快照截止日期"),'danger');return}
  if(!invImportRulesReady()){showToast(t('inv.rules_missing_toast','库存导入规则模块未能加载，已取消本次导入。请刷新页面后重试。'),'danger');return;}
  var fp=InvImportRules.computeInvImportFingerprint(records,snapshotDate);var pc=window._invPrecheck;var pcOk=!!(pc&&pc.ok===true&&pc.blocking&&pc.blocking.length===0);
  if(!pcOk||fp!==window._invPassedFingerprint){if(pc&&!pcOk){renderInvPrecheck(pc);}else{runInvPrecheck();}showToast(t('inv.toast_recheck_before_submit','当前数据尚未通过预检查，正在重新校验……'),'warning');return;}
  var btn=document.getElementById('inv-import-btn');btn.disabled=true;btn.textContent='正在导入 0%';
  var importId='';try{importId=(window.crypto&&crypto.randomUUID)?crypto.randomUUID():'inv-import-'+Date.now()+'-'+Math.random().toString(36).slice(2)}catch(_){importId='inv-import-'+Date.now()}
  renderInvImportProgress({status:'running',phase:'validating',percent:0,processed_count:0,total_count:records.length,message:'正在启动库存导入'});startInvImportPolling(importId);
  try{
    var items=records.map(buildInvImportItem);
    var res=await api('/api/inventory-imports/bulk-import','POST',{items:items,snapshot_cutoff_date:snapshotDate,import_id:importId});
    stopInvImportPolling();renderInvImportProgress({status:'completed',phase:'completed',percent:100,processed_count:records.length,total_count:records.length,message:'导入完成'});
    window._lastInvImportErrors=res.errors||[];
    var html='<div style="background:'+(res.failed>0?'#fffbe6':'#f6ffed')+';border:1px solid '+(res.failed>0?'#ffe58f':'#b7eb8f')+';border-radius:12px;padding:14px 16px;font-size:13px;margin-top:12px"><div style="font-weight:600;margin-bottom:8px">'+t("toast.import_done", "导入完成")+'</div><div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">'+t("html.import.added_open", "<span>已新增：")+(res.created||0)+t("html.unit.tiao_close", " 条</span>")+t("html.import.fail_open", "<span>失败：")+(res.failed||0)+t("html.unit.tiao_close", " 条</span>")+'<span style="color:#1890ff">快照截止日期：'+esc(res.snapshot_cutoff_date||snapshotDate)+'</span></div>';
    if(res.wac_warnings&&res.wac_warnings.length>0){var highWarnings=res.wac_warnings.filter(function(w){return w.priority==='high'}),normalWarnings=res.wac_warnings.filter(function(w){return w.priority!=='high'});html+='<div style="margin-top:10px;padding:10px 12px;border-radius:8px;background:'+(highWarnings.length>0?'#fff1f0':'#fffbe6')+';border:1px solid '+(highWarnings.length>0?'#ffa39e':'#ffe58f')+'"><div style="font-weight:600;color:'+(highWarnings.length>0?'#ff3b30':'#faad14')+';margin-bottom:6px">加权平均成本匹配结果</div>';if(highWarnings.length>0){html+='<div style="color:#ff3b30;margin-bottom:4px;font-weight:600">⚠️ 高优先级（成本为 0，请尽快完成成本确认）</div>';highWarnings.forEach(function(w){html+='<div style="color:#666;margin-left:12px">'+esc(w.sku_code)+' / '+esc(w.country||'')+' / '+esc(w.warehouse||'')+'：'+esc(w.message)+'</div>';});}if(normalWarnings.length>0){html+='<div style="color:#faad14;margin-bottom:4px;margin-top:'+(highWarnings.length>0?'6px':'0')+'">ℹ️ 已保留原成本（请完成成本确认以更新）</div>';normalWarnings.forEach(function(w){html+='<div style="color:#666;margin-left:12px">'+esc(w.sku_code)+' / '+esc(w.country||'')+' / '+esc(w.warehouse||'')+'：'+esc(w.message)+'</div>';});}html+='</div>';}
    if(window._lastInvImportErrors.length>0){html+='<div style="margin-top:10px"><div style="font-weight:600;color:#ff3b30;margin-bottom:6px">'+t("html.inv.fail_detail", "失败明细")+'</div>';html+=window._lastInvImportErrors.slice(0,20).map(function(e){return '<div style="color:#666">第 '+e.row+' 行：'+esc(e.reason)+'</div>'}).join('');if(window._lastInvImportErrors.length>20)html+='<div style="color:#999">还有 '+(window._lastInvImportErrors.length-20)+' 条失败...</div>';html+='<button type="button" class="btn btn-secondary" style="margin-top:10px" onclick="downloadInvImportErrors()">'+t("html.inv.download_fail", "下载失败明细")+'</button></div>';}
    html+='</div>';var resultBox=document.getElementById('inv-result');if(resultBox)resultBox.insertAdjacentHTML('beforeend',html);
    var createdN=res.created||0,failedN=res.failed||0,toastMsg,toastType;if(createdN>0&&failedN===0){toastMsg=t('toast.importDone2','导入完成：新增{c}，失败{f}',{c:createdN,f:failedN});toastType='success';}else if(createdN>0&&failedN>0){toastMsg=t('toast.import_partial','导入部分完成：新增{c}，失败{f}',{c:createdN,f:failedN});toastType='warning';}else if(createdN===0&&failedN>0){toastMsg=t('toast.import_failed2','导入失败：新增{c}，失败{f}',{c:createdN,f:failedN});toastType='danger';}else{toastMsg=t('toast.import_no_data','无有效数据：新增{c}，失败{f}',{c:createdN,f:failedN});toastType='danger';}showToast(toastMsg,toastType);loadInv();
  }catch(e){
    stopInvImportPolling();var pl=e&&e.payload;
    if(pl&&pl.blocked===true){window._invPrecheck=pl.precheck||{ok:false,blocking:pl.blocking||[],summary:pl.summary||[],blocking_count:(pl.blocking||[]).length,total_rows:records.length};window._invPassedFingerprint=null;renderInvPrecheck(window._invPrecheck);renderInvStatus();var rbox=document.getElementById('inv-result');if(rbox)rbox.innerHTML='<div style="background:#fff1f0;border:1px solid #ffa39e;border-radius:12px;padding:12px 14px;font-size:13px;color:#a8071a">'+esc(t('inv.blocked_zero_write','本次库存导入已整批阻断，数据库未发生任何写入。请按下方问题明细修复后重新导入。'))+'</div>';var pbox=document.getElementById('inv-precheck');if(pbox&&pbox.scrollIntoView)pbox.scrollIntoView({behavior:'auto',block:'center'});showToast(t('inv.toast_blocked','存在阻断型错误，本次库存导入已整批拒绝'),'danger');}
    else{renderInvImportProgress({status:'failed',phase:'failed',percent:(pl&&pl.percent)||0,processed_count:0,total_count:records.length,message:(e&&e.message)||'导入失败'});showToast(e.message||t("toast.import_failed", "导入失败"),'danger');}
  }finally{stopInvImportPolling();btn.disabled=false;btn.textContent=t("app.067", "开始导入");updateInvImportBtnState();}
}`;

replaceRange('app.js', 'async function submitInvBatchImport(){', 'function downloadInvImportErrors(){', appBlock);
console.log('inventory import progress patch applied');
