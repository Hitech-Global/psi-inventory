(function (global) {
  'use strict';

  if (!global || global.__wacBlockedImportControlsInstalled) return;
  global.__wacBlockedImportControlsInstalled = true;

  const doc = global.document;
  if (!doc) return;

  function language() {
    return typeof global.getLang === 'function'
      ? String(global.getLang() || 'zh').toLowerCase().slice(0, 2)
      : 'zh';
  }

  function tr(key, fallback) {
    return typeof global.t === 'function' ? global.t(key, fallback) : fallback;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char];
    });
  }

  function isBlockedPreview() {
    const preview = global._wacPreview;
    return !!(preview && preview.meta && !preview.meta.already_confirmed &&
      Array.isArray(preview.blockers) && preview.blockers.length > 0);
  }

  function keepConfirmLocked() {
    if (!isBlockedPreview()) return;
    const button = doc.getElementById('wac-confirm-btn');
    if (!button) return;
    const label = tr('wac.cannot_confirm', '当前批次不可确认WAC');
    if (!button.disabled) button.disabled = true;
    // Idempotent: rewriting the same text creates another childList mutation and
    // would recursively wake this observer forever on a blocked WAC preview.
    if (button.textContent !== label) button.textContent = label;
  }

  // The existing validator also manages the import state. Wrap it so an old-stock
  // import can never accidentally enable Confirm while server-side blockers remain.
  if (typeof global.wacValidateInputs === 'function' && !global.wacValidateInputs.__wacBlockerGuard) {
    const originalValidate = global.wacValidateInputs;
    const guardedValidate = function () {
      const result = originalValidate.apply(this, arguments);
      keepConfirmLocked();
      return result;
    };
    guardedValidate.__wacBlockerGuard = true;
    global.wacValidateInputs = guardedValidate;
  }

  function ensureBlockedImportControls() {
    if (!isBlockedPreview()) return;

    const preview = global._wacPreview;
    const button = doc.getElementById('wac-confirm-btn');
    const formCard = doc.querySelector('#modal-content .form-card');
    if (!button || !formCard || formCard.querySelector('.wac-blocked-import-section')) {
      keepConfirmLocked();
      return;
    }

    const lang = language();
    const english = lang === 'en';
    const indonesian = lang === 'id';
    const items = Array.isArray(preview.items) ? preview.items : [];
    const rows = items.map(function (item, index) {
      return '<tr>' +
        '<td>' + escapeHtml(item.sku_code) + '</td>' +
        '<td style="text-align:right">' + Number(item.batch_qty || 0).toLocaleString() + '</td>' +
        '<td><input id="wac-old-' + index + '" type="number" min="0" step="1" inputmode="numeric" ' +
          'style="width:150px;max-width:100%" placeholder="' +
          escapeHtml(english ? 'Enter original qty' : indonesian ? 'Isi stok awal' : '填写原库存数量') +
          '" oninput="recalcWacRow(' + index + ');wacValidateInputs()"></td>' +
        '<td hidden><span id="wac-old-value-' + index + '"></span>' +
          '<span id="wac-new-' + index + '"></span><span id="wac-change-' + index + '"></span></td>' +
      '</tr>';
    }).join('');

    const section = doc.createElement('div');
    section.className = 'wac-blocked-import-section';
    section.style.cssText = 'margin:10px 0 14px;padding:12px 14px;border:1px solid var(--border,#d9dde5);border-radius:8px;background:var(--surface-primary,#fff)';
    section.innerHTML =
      '<div class="wac-opbar" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">' +
        '<button type="button" class="btn btn-secondary btn-sm" onclick="exportWacOldInventoryTemplate()">📥 ' +
          escapeHtml(tr('wac.btn_export_old', english ? 'Export old inventory template' : indonesian ? 'Ekspor template stok awal' : '导出旧库存模板')) +
        '</button>' +
        '<button type="button" class="btn btn-secondary btn-sm" onclick="importWacOldInventory()">📤 ' +
          escapeHtml(tr('wac.btn_import_old', english ? 'Import old inventory' : indonesian ? 'Impor stok awal' : '导入旧库存')) +
        '</button>' +
        '<span class="wac-import-status" id="wac-import-status"><span class="warn">' +
          escapeHtml(tr('wac.import_not_imported', english ? 'Not imported' : indonesian ? 'Belum diimpor' : '未导入')) +
        '</span></span>' +
      '</div>' +
      '<div style="font-size:12px;color:var(--text-secondary,#666);margin-bottom:8px">' +
        escapeHtml(english
          ? 'Enter original stock quantities directly in the table below, or import a file. WAC confirmation stays disabled until all blockers above are resolved.'
          : indonesian
            ? 'Isi jumlah stok awal langsung pada tabel di bawah, atau impor file. Konfirmasi WAC tetap dinonaktifkan sampai semua masalah di atas diselesaikan.'
            : '可直接在下方手动填写原库存数量，也可导入文件；上方所有阻断问题解决后，才能确认 WAC。') +
      '</div>' +
      '<div style="overflow:auto;max-height:240px">' +
        '<table class="data-table" style="min-width:520px;width:100%"><thead><tr>' +
          '<th>SKU</th><th style="text-align:right">' + (english ? 'Inbound qty' : indonesian ? 'Qty masuk' : '本批到货数量') + '</th>' +
          '<th>' + (english ? 'Original stock qty' : indonesian ? 'Stok awal' : '原库存数量') + '</th>' +
          '<th hidden>WAC</th></tr></thead><tbody>' + rows + '</tbody></table></div>';

    // The combined CI/WAC modal may prepend logistics and PL detail sections.
    // Locate the blocker panel by its stable blocker codes, not by child index.
    const blockerCodes = (preview.blockers || []).map(function (item) {
      return String(item && item.code || '');
    }).filter(Boolean);
    const blockerPanel = Array.from(formCard.children || []).find(function (child) {
      const content = String(child && child.textContent || '');
      return blockerCodes.some(function (code) { return content.indexOf(code) >= 0; });
    });
    const anchor = blockerPanel || formCard.lastElementChild || formCard.firstElementChild;
    if (anchor && typeof anchor.insertAdjacentElement === 'function') {
      anchor.insertAdjacentElement('afterend', section);
    } else {
      formCard.appendChild(section);
    }

    if (typeof global.wacValidateInputs === 'function') global.wacValidateInputs();
    keepConfirmLocked();
  }

  // Only observe the stable modal content root. The controls are modal-scoped;
  // watching the whole document needlessly re-runs the blocker check for unrelated pages.
  const modalRoot = doc.getElementById('modal-content');
  if (typeof global.MutationObserver === 'function' && modalRoot) {
    const observer = new global.MutationObserver(ensureBlockedImportControls);
    observer.observe(modalRoot, { childList: true, subtree: true });
  }

  ensureBlockedImportControls();
})(window);
