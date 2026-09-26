'use strict';

(() => {
  const MAX_FILES = 20;
  const MAX_FILE_BYTES = 10 * 1024 * 1024;
  const MAX_BATCH_BYTES = 50 * 1024 * 1024;
  const STORAGE_KEY = 'shopee.adGroupImportBatch.v1';
  const terminal = new Set(['SUCCEEDED', 'FAILED', 'BLOCKED']);
  const batch = { files: [], entries: [], scopes: [], running: false };

  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const num = value => new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Number(value || 0));

  function setMessage(message, bad = false) {
    const box = $('#adGroupImportResult');
    if (!box) return;
    box.textContent = message || '';
    box.classList.toggle('negative', Boolean(bad));
  }

  async function api(url, options = {}) {
    const response = await fetch(url, options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.message || payload.error || `HTTP ${response.status}`);
      error.code = payload.error || 'REQUEST_FAILED';
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function contentType(file) {
    return file.type || (/\.xlsx$/i.test(file.name)
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'text/csv');
  }

  function validateFiles(files) {
    if (!files.length) throw new Error('请选择一个或多个 CSV / XLSX 文件');
    if (files.length > MAX_FILES) throw new Error(`单次最多 ${MAX_FILES} 个文件`);
    let total = 0;
    for (const file of files) {
      if (!/\.(csv|xlsx)$/i.test(file.name)) throw new Error(`不支持的文件：${file.name}`);
      if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} 超过 10 MB`);
      total += file.size;
    }
    if (total > MAX_BATCH_BYTES) throw new Error('单批文件总大小不能超过 50 MB');
    return total;
  }

  function persistBatch() {
    try {
      if (batch.entries.length && batch.entries.every(entry => entry.done)) {
        sessionStorage.removeItem(STORAGE_KEY);
        return;
      }
      const serializable = batch.entries
        .filter(entry => entry.previewJobId && entry.preview && entry.preview.shopScope === 'MATCH')
        .map(entry => ({
          fileName: entry.fileName,
          shopId: entry.shopId,
          registered: entry.registered,
          existing: entry.existing,
          previewJobId: entry.previewJobId,
          importJobId: entry.importJobId || null,
          preview: entry.preview,
          done: Boolean(entry.done),
          error: entry.error || null,
          status: entry.status || null,
        }));
      if (serializable.length) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
      else sessionStorage.removeItem(STORAGE_KEY);
    } catch {}
  }

  function restoreBatch() {
    try {
      const rows = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]');
      if (!Array.isArray(rows) || !rows.length) return;
      batch.entries = rows.map(row => ({ ...row, file: null, overlap: false }));
      render();
      recoverJobs().catch(error => setMessage(error.message, true));
    } catch {}
  }

  async function loadScopes() {
    const payload = await api('/api/shopee-analytics/shop-scopes');
    batch.scopes = payload.shopScopes || [];
  }

  async function pollJob(id, { timeoutMs = 10 * 60 * 1000 } = {}) {
    const started = Date.now();
    let delay = 1000;
    while (Date.now() - started < timeoutMs) {
      const payload = await api(`/api/shopee-analytics/ad-group-import-jobs/${encodeURIComponent(id)}`);
      const job = payload.job;
      if (job && terminal.has(job.status)) return job;
      await sleep(delay);
      delay = Math.min(3000, delay + 1000);
    }
    throw new Error('导入任务等待超时；任务可能仍在后台执行');
  }

  async function queuePreview(file, targetShopId) {
    const params = new URLSearchParams({
      filename: file.name,
      target_shop_id: String(targetShopId),
      preview_only: 'YES',
      async: 'YES',
    });
    const payload = await api(`/api/shopee-analytics/ad-groups/import?${params}`, {
      method: 'POST',
      headers: { 'content-type': contentType(file) },
      body: file,
    });
    const job = await pollJob(payload.job.id);
    if (job.status !== 'SUCCEEDED') {
      const error = new Error(job.errorMessage || 'Preview failed');
      error.code = job.errorCode || 'PREVIEW_FAILED';
      throw error;
    }
    return job;
  }

  async function detectExisting(entry) {
    if (!entry.registered || !entry.preview || entry.preview.granularity !== 'DAY') return false;
    const params = new URLSearchParams({
      shop_id: String(entry.shopId),
      start_date: entry.preview.periodStart,
      end_date: entry.preview.periodEnd,
      promotion_type: 'AD_GROUP',
      data_source: 'MANUAL_IMPORT',
    });
    const payload = await api(`/api/shopee-analytics/ad-promotions?${params}`);
    return Boolean((payload.promotions || []).length);
  }

  function applyOverlapGuard() {
    for (const entry of batch.entries) entry.overlap = false;
    const ranges = batch.entries.filter(entry => entry.preview && entry.preview.granularity === 'RANGE');
    const days = batch.entries.filter(entry => entry.preview && entry.preview.granularity === 'DAY');
    for (const range of ranges) {
      for (const day of days) {
        if (range.shopId !== day.shopId) continue;
        if (day.preview.periodStart >= range.preview.periodStart && day.preview.periodStart <= range.preview.periodEnd) {
          range.overlap = true;
          day.overlap = true;
        }
      }
    }
  }

  function statusText(entry) {
    if (entry.error) return entry.error;
    if (entry.done) return '✓ 已导入';
    if (entry.status === 'IMPORTING') return '导入中…';
    if (entry.status === 'PREVIEWING') return 'Preview 中…';
    if (entry.overlap) return 'OVERLAPPING_DAY_RANGE';
    if (entry.preview && !entry.registered) return '需要注册店铺';
    if (entry.preview && entry.registered) return entry.existing ? '已存在 · 将更新' : '✓ Ready';
    return '等待 Preview';
  }

  function render() {
    applyOverlapGuard();
    const rows = $('#adGroupBatchRows');
    if (rows) {
      rows.innerHTML = batch.entries.length
        ? batch.entries.map(entry => {
            const p = entry.preview || {};
            return `<div class="ad-group-batch-row">
              <strong>${esc(entry.fileName || (entry.file && entry.file.name) || '—')}</strong>
              <span>${esc(String(p.sourceShopId || entry.shopId || '—'))} · ${esc(p.sourceShopName || '—')}</span>
              <span>${esc(p.periodStart || '—')} · ${esc(p.granularity || '—')}</span>
              <span>${num(p.adGroupCount)} groups · ${num(p.itemRowCount)} products</span>
              <span>${(p.warnings || []).length ? `⚠ ${(p.warnings || []).length} warnings` : '正常'}</span>
              <b>${esc(statusText(entry))}</b>
            </div>`;
          }).join('')
        : '尚未选择文件。Preview 不会写入数据。';
    }

    const ready = batch.entries.length > 0 && batch.entries.every(entry =>
      entry.preview && entry.preview.shopScope === 'MATCH' && entry.registered && !entry.overlap && !entry.error && !entry.done && entry.previewJobId
    );
    const importBtn = $('#adGroupImportBtn');
    const previewBtn = $('#adGroupPreviewBtn');
    if (importBtn) importBtn.disabled = batch.running || !ready;
    if (previewBtn) previewBtn.disabled = batch.running;

    const failed = batch.entries.some(entry => entry.error && entry.previewJobId && !entry.done);
    const resume = $('#adGroupResumeBtn');
    if (resume) {
      resume.classList.toggle('hidden', !failed);
      resume.disabled = batch.running;
    }

    const unknown = batch.entries.find(entry => entry.preview && !entry.registered);
    const onboarding = $('#adGroupOnboarding');
    if (onboarding) onboarding.classList.toggle('hidden', !unknown);
    if (unknown && $('#adGroupScopeNotice')) {
      $('#adGroupScopeNotice').textContent = `${unknown.preview.sourceShopName || 'Shopee Shop'} · ${unknown.shopId}，未授权 · Manual Import Only`;
    }
    persistBatch();
  }

  async function previewBatch() {
    if (batch.running) return;
    const files = batch.files.length ? batch.files : Array.from($('#adGroupFile')?.files || []);
    const total = validateFiles(files);
    batch.running = true;
    batch.entries = files.map(file => ({ file, fileName: file.name, status: 'WAITING', error: null, done: false }));
    setMessage(`已选择 ${files.length} 个文件，共 ${(total / 1024 / 1024).toFixed(1)} MB；开始串行 Preview。`);
    render();
    try {
      await loadScopes();
      for (let index = 0; index < batch.entries.length; index += 1) {
        const entry = batch.entries[index];
        entry.status = 'PREVIEWING';
        render();
        try {
          const selected = Number($('#shopSelect')?.value || 0);
          const firstTarget = selected > 0 ? selected : 1;
          let job = await queuePreview(entry.file, firstTarget);
          let preview = job.result || {};
          const sourceShopId = Number(preview.sourceShopId ?? preview.shopId);
          const scope = batch.scopes.find(row => Number(row.shopId) === sourceShopId);
          entry.shopId = sourceShopId;
          entry.registered = Boolean(scope);

          if (scope && sourceShopId !== firstTarget) {
            job = await queuePreview(entry.file, sourceShopId);
            preview = job.result || {};
          }

          entry.preview = preview;
          entry.previewJobId = job.id;
          entry.status = 'READY';
          entry.error = preview.shopScope === 'MATCH' || !entry.registered
            ? null
            : 'SHOP_SCOPE_MISMATCH';
          entry.existing = await detectExisting(entry);
        } catch (error) {
          entry.error = `${error.code || 'PREVIEW_FAILED'}: ${error.message}`;
          entry.status = 'FAILED';
        }
        setMessage(`Preview ${index + 1} / ${batch.entries.length}`);
        render();
      }
      setMessage('Preview 完成。确认无阻断后再执行批量导入。');
    } finally {
      batch.running = false;
      render();
    }
  }

  async function registerUnknown() {
    if (batch.running) return;
    const entry = batch.entries.find(row => row.preview && !row.registered);
    if (!entry) return;
    const countryCode = $('#adGroupCountry')?.value.trim();
    const brandCode = $('#adGroupBrand')?.value.trim();
    if (!countryCode || !brandCode) throw new Error('国家和品牌为必填项');
    if (!entry.file) throw new Error('注册后需要重新 Preview；请重新选择原文件');

    batch.running = true;
    render();
    try {
      await api('/api/shopee-analytics/shop-scopes/import-only', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          shopId: entry.shopId,
          importSourceShopName: entry.preview.sourceShopName,
          countryCode,
          brandCode,
          operatorLabel: $('#adGroupOperatorLabel')?.value.trim() || null,
        }),
      });
      await loadScopes();
      entry.registered = true;
      entry.status = 'PREVIEWING';
      entry.error = null;
      render();
      const job = await queuePreview(entry.file, entry.shopId);
      entry.previewJobId = job.id;
      entry.preview = job.result || {};
      entry.existing = await detectExisting(entry);
      entry.status = 'READY';
      if (typeof window.loadShopDirectory === 'function') await window.loadShopDirectory();
      setMessage('店铺已注册并重新通过正式 Scope Preview。');
    } finally {
      batch.running = false;
      render();
    }
  }

  async function confirmEntry(entry) {
    const payload = await api(`/api/shopee-analytics/ad-group-import-jobs/${encodeURIComponent(entry.previewJobId)}/confirm`, {
      method: 'POST',
      headers: { accept: 'application/json' },
    });
    entry.importJobId = payload.job.id;
    persistBatch();
    const job = await pollJob(entry.importJobId);
    if (job.status !== 'SUCCEEDED') {
      const error = new Error(job.errorMessage || 'Import failed');
      error.code = job.errorCode || 'IMPORT_FAILED';
      throw error;
    }
    return job;
  }

  async function confirmBatch({ resume = false } = {}) {
    if (batch.running) return;
    batch.running = true;
    render();
    let success = 0;
    try {
      for (const entry of batch.entries) {
        if (entry.done) continue;
        if (entry.overlap || !entry.registered || !entry.previewJobId || entry.preview?.shopScope !== 'MATCH') break;
        if (entry.error && !resume) break;
        entry.error = null;
        entry.status = 'IMPORTING';
        render();
        try {
          const job = await confirmEntry(entry);
          entry.done = true;
          entry.status = 'DONE';
          entry.importResult = job.result || {};
          success += 1;
          setMessage(`已导入 ${success} 个文件；后台重型任务始终单文件串行。`);
        } catch (error) {
          entry.error = `${error.code || 'IMPORT_FAILED'}: ${error.message}`;
          entry.status = 'FAILED';
          render();
          break;
        }
        render();
      }

      if (batch.entries.length && batch.entries.every(entry => entry.done)) {
        setMessage(`批量导入完成：${batch.entries.length} / ${batch.entries.length}。`);
        const load = $('#loadBtn');
        if (load) load.click();
      }
    } finally {
      batch.running = false;
      render();
    }
  }

  async function recoverJobs() {
    for (const entry of batch.entries) {
      if (!entry.importJobId || entry.done) continue;
      let payload = await api(`/api/shopee-analytics/ad-group-import-jobs/${encodeURIComponent(entry.importJobId)}`);
      let job = payload.job;
      if (job && !terminal.has(job.status)) job = await pollJob(entry.importJobId);
      if (!job) continue;
      if (job.status === 'SUCCEEDED') {
        entry.done = true;
        entry.error = null;
        entry.status = 'DONE';
      } else if (terminal.has(job.status)) {
        entry.error = `${job.errorCode || 'IMPORT_FAILED'}: ${job.errorMessage || '导入失败'}`;
        entry.status = 'FAILED';
      }
    }
    render();
  }

  function selectFiles(files) {
    try {
      validateFiles(files);
      batch.files = files;
      batch.entries = [];
      sessionStorage.removeItem(STORAGE_KEY);
      const total = files.reduce((sum, file) => sum + file.size, 0);
      setMessage(`已选择 ${files.length} 个文件，共 ${(total / 1024 / 1024).toFixed(1)} MB。点击 Preview 全部文件。`);
      if ($('#adGroupBatchRows')) $('#adGroupBatchRows').textContent = `已选择 ${files.length} 个文件，尚未 Preview。`;
    } catch (error) {
      batch.files = [];
      batch.entries = [];
      setMessage(error.message, true);
      render();
    }
  }

  function toLocalIso(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function presetRange(name) {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const start = new Date(today);
    const end = new Date(today);
    if (name === 'today') return [toLocalIso(start), toLocalIso(end)];
    if (name === 'yesterday') {
      start.setDate(start.getDate() - 1);
      end.setDate(end.getDate() - 1);
    } else if (name === 'month') {
      start.setDate(1);
    } else if (name === 'last-month') {
      start.setMonth(start.getMonth() - 1, 1);
      end.setDate(0);
    } else if (name === '7d') {
      start.setDate(start.getDate() - 6);
    } else if (name === '30d') {
      start.setDate(start.getDate() - 29);
    } else if (name === '6m') {
      start.setMonth(start.getMonth() - 6);
    }
    return [toLocalIso(start), toLocalIso(end)];
  }

  function formatRangeDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    return match ? `${match[1]}/${match[2]}/${match[3]}` : '选择日期';
  }

  function enhanceDateRangeFilter() {
    const start = $('#startDate');
    const end = $('#endDate');
    if (!start || !end || $('#dateRangeField')) return;

    const startLabel = start.closest('label');
    const endLabel = end.closest('label');
    if (!startLabel || !endLabel || !startLabel.parentNode) return;

    const style = document.createElement('style');
    style.id = 'dateRangeFilterStyles';
    style.textContent = `
      .date-source-hidden{display:none!important}
      .multi-filter{grid-template-columns:minmax(130px,.75fr) minmax(130px,.75fr) minmax(220px,1.15fr) minmax(590px,2.5fr) auto!important}
      .date-range-field{display:flex;flex-direction:column;gap:7px;min-width:0;position:relative}
      .date-range-label{font-size:12px;font-weight:600;color:#6e6e73}
      .date-range-tools{display:flex;align-items:center;gap:6px;min-width:0;white-space:nowrap}
      .date-range-button{height:40px;min-width:178px;border:1px solid #d8d8dc;border-radius:10px;background:#fff;color:#1d1d1f;padding:0 12px;display:inline-flex;align-items:center;justify-content:space-between;gap:10px;font:inherit;font-weight:600;cursor:pointer}
      .date-range-button:hover{background:#f8f8fa}.date-range-button:focus{outline:2px solid rgba(0,113,227,.18);border-color:#0071e3}
      .date-range-icon{font-size:15px;color:#6e6e73}
      .date-preset{height:34px;padding:0 9px;border:1px solid #dedee2;border-radius:9px;background:#fff;color:#515154;font-size:11px;font-weight:650;cursor:pointer}
      .date-preset:hover{background:#f5f5f7}.date-preset.active{border-color:#0071e3;background:#eef6ff;color:#0567c5}
      .date-range-popover{position:absolute;z-index:40;top:calc(100% + 8px);left:0;width:330px;padding:14px;background:#fff;border:1px solid #dedee2;border-radius:14px;box-shadow:0 14px 42px rgba(0,0,0,.14)}
      .date-range-popover.hidden{display:none!important}
      .date-range-popover-title{font-size:12px;font-weight:750;margin-bottom:10px;color:#1d1d1f}
      .date-range-popover-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
      .date-range-popover label{font-size:11px;font-weight:600;color:#6e6e73;display:flex;flex-direction:column;gap:6px}
      .date-range-popover input{height:38px;border:1px solid #d8d8dc;border-radius:9px;padding:0 9px;font:inherit;color:#1d1d1f;background:#fff}
      .date-range-popover-actions{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:12px}
      .date-range-error{font-size:10px;color:#b9361d;min-height:14px}
      .date-range-apply{height:34px;border:0;border-radius:9px;padding:0 14px;background:#0071e3;color:#fff;font-size:11px;font-weight:700;cursor:pointer}
      @media(max-width:1250px){.multi-filter{grid-template-columns:1fr 1fr 1.4fr!important}.date-range-field{grid-column:1/-1}.multi-filter .primary{grid-column:1/-1}.date-range-tools{flex-wrap:wrap}}
      @media(max-width:800px){.multi-filter{grid-template-columns:1fr 1fr!important}.date-range-field{grid-column:1/-1}.date-range-tools{white-space:normal;flex-wrap:wrap}.date-range-button{min-width:100%;width:100%}.date-range-popover{width:min(330px,calc(100vw - 56px))}}
      @media(max-width:560px){.multi-filter{grid-template-columns:1fr!important}.date-range-popover-grid{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);

    startLabel.classList.add('date-source-hidden');
    endLabel.classList.add('date-source-hidden');

    const field = document.createElement('div');
    field.id = 'dateRangeField';
    field.className = 'date-range-field';
    field.innerHTML = `
      <span class="date-range-label">日期</span>
      <div class="date-range-tools">
        <button id="dateRangeButton" class="date-range-button" type="button" aria-haspopup="dialog" aria-expanded="false">
          <span id="dateRangeText"></span><span class="date-range-icon">▣</span>
        </button>
        <button class="date-preset" type="button" data-date-preset="month">本月</button>
        <button class="date-preset" type="button" data-date-preset="last-month">上月</button>
        <button class="date-preset" type="button" data-date-preset="today">今天</button>
        <button class="date-preset" type="button" data-date-preset="yesterday">昨天</button>
        <button class="date-preset" type="button" data-date-preset="7d">近7天</button>
        <button class="date-preset" type="button" data-date-preset="30d">近30天</button>
        <button class="date-preset" type="button" data-date-preset="6m">近半年</button>
      </div>
      <div id="dateRangePopover" class="date-range-popover hidden" role="dialog" aria-label="日期范围">
        <div class="date-range-popover-title">自定义日期范围</div>
        <div class="date-range-popover-grid">
          <label>开始日期<input id="dateRangeStart" type="date"></label>
          <label>结束日期<input id="dateRangeEnd" type="date"></label>
        </div>
        <div class="date-range-popover-actions">
          <span id="dateRangeError" class="date-range-error"></span>
          <button id="dateRangeApply" class="date-range-apply" type="button">应用</button>
        </div>
      </div>`;
    startLabel.parentNode.insertBefore(field, startLabel);

    const rangeButton = $('#dateRangeButton');
    const popover = $('#dateRangePopover');
    const pickerStart = $('#dateRangeStart');
    const pickerEnd = $('#dateRangeEnd');
    const error = $('#dateRangeError');

    function refresh() {
      $('#dateRangeText').textContent = `${formatRangeDate(start.value)} – ${formatRangeDate(end.value)}`;
      pickerStart.value = start.value;
      pickerEnd.value = end.value;
      document.querySelectorAll('[data-date-preset]').forEach(button => {
        const [presetStart, presetEnd] = presetRange(button.dataset.datePreset);
        button.classList.toggle('active', start.value === presetStart && end.value === presetEnd);
      });
    }

    function setRange(nextStart, nextEnd) {
      if (!nextStart || !nextEnd || nextStart > nextEnd) return false;
      start.value = nextStart;
      end.value = nextEnd;
      error.textContent = '';
      refresh();
      return true;
    }

    function closePopover() {
      popover.classList.add('hidden');
      rangeButton.setAttribute('aria-expanded', 'false');
    }

    rangeButton.addEventListener('click', event => {
      event.preventDefault();
      const willOpen = popover.classList.contains('hidden');
      popover.classList.toggle('hidden', !willOpen);
      rangeButton.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
      if (willOpen) {
        pickerStart.value = start.value;
        pickerEnd.value = end.value;
        error.textContent = '';
      }
    });

    document.querySelectorAll('[data-date-preset]').forEach(button => {
      button.addEventListener('click', event => {
        event.preventDefault();
        const [nextStart, nextEnd] = presetRange(button.dataset.datePreset);
        setRange(nextStart, nextEnd);
        closePopover();
      });
    });

    $('#dateRangeApply').addEventListener('click', event => {
      event.preventDefault();
      if (!pickerStart.value || !pickerEnd.value) {
        error.textContent = '请选择完整的日期范围';
        return;
      }
      if (pickerStart.value > pickerEnd.value) {
        error.textContent = '开始日期不能晚于结束日期';
        return;
      }
      setRange(pickerStart.value, pickerEnd.value);
      closePopover();
    });

    document.addEventListener('click', event => {
      if (!field.contains(event.target)) closePopover();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') closePopover();
    });

    refresh();
  }

  document.addEventListener('change', event => {
    if (event.target && event.target.id === 'adGroupFile') {
      selectFiles(Array.from(event.target.files || []));
    }
  }, true);

  document.addEventListener('drop', event => {
    if (!event.target.closest || !event.target.closest('#adGroupDropzone')) return;
    const files = Array.from(event.dataTransfer?.files || []).filter(file => /\.(csv|xlsx)$/i.test(file.name));
    selectFiles(files);
  }, true);

  document.addEventListener('click', event => {
    const button = event.target.closest && event.target.closest('button');
    if (!button) return;
    const handlers = {
      adGroupPreviewBtn: () => previewBatch(),
      adGroupImportBtn: () => confirmBatch(),
      adGroupResumeBtn: () => confirmBatch({ resume: true }),
      adGroupRegisterImportOnlyBtn: () => registerUnknown(),
    };
    const handler = handlers[button.id];
    if (!handler) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    Promise.resolve(handler()).catch(error => {
      batch.running = false;
      setMessage(error.message, true);
      render();
    });
  }, true);

  enhanceDateRangeFilter();
  restoreBatch();
})();
