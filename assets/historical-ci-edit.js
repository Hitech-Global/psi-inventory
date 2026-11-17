(function (global) {
  'use strict';
  if (!global || global.__historicalCIEditInstalled) return;
  global.__historicalCIEditInstalled = true;

  function tr(key, fallback) { return typeof global.t === 'function' ? global.t(key, fallback) : fallback; }
  function ui(zh, en, id) {
    var lang = typeof global.getLang === 'function' ? global.getLang() : 'zh';
    return lang === 'en' ? en : (lang === 'id' ? (id || en) : zh);
  }
  function esc(v) {
    if (typeof global.esc === 'function') return global.esc(v == null ? '' : String(v));
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function dateVal(v) { return String(v || '').slice(0, 10); }
  function money(v, c) { return typeof global.fmtMoney === 'function' ? global.fmtMoney(Number(v || 0), c) : Number(v || 0).toFixed(2); }
  function opt(v, label, selected) { return '<option value="' + esc(v) + '"' + (selected ? ' selected' : '') + '>' + esc(label) + '</option>'; }
  function fixedWarehouse(country) {
    var c = String(country || '').trim().toUpperCase();
    if (['ID', 'IND', 'INDONESIA', '印度尼西亚', '印尼'].indexOf(c) >= 0) return 'Bekasi Warehouse';
    if (['MY', 'MYS', 'MALAYSIA', '马来西亚', 'TH', 'THA', 'THAILAND', '泰国'].indexOf(c) >= 0) return '至速仓';
    return '';
  }
  function field(label, control, wide) {
    return '<div class="form-group"' + (wide ? ' style="grid-column:1/-1"' : '') + '><label>' + label + '</label>' + control + '</div>';
  }
  function selectCurrencies(id, rows, selected, extras, disabled) {
    var list = Array.isArray(rows) ? rows.slice() : [];
    (extras || []).forEach(function (code) {
      if (code && !list.some(function (r) { return String(r.code || '').toUpperCase() === String(code).toUpperCase(); })) list.push({ code: code });
    });
    return '<select id="' + id + '" class="form-control"' + (disabled ? ' disabled' : '') + '>' + list.map(function (r) {
      var code = String(r.code || '').toUpperCase();
      return opt(code, code + (r.symbol ? ' (' + r.symbol + ')' : ''), code === String(selected || '').toUpperCase());
    }).join('') + '</select>';
  }
  function supplierSelect(rows, selected, disabled) {
    var list = Array.isArray(rows) ? rows.slice() : [];
    if (selected && !list.some(function (s) { return String(s.id) === String(selected); })) {
      list.unshift({ id: selected, name: global._hciEditSupplierName || selected });
    }
    return '<select id="hci-edit-supplier-id" class="form-control" onchange="onHistoricalCIEditSupplierChange()"' + (disabled ? ' disabled' : '') + '>' +
      opt('', ui('手工供应商快照', 'Manual supplier snapshot', 'Snapshot pemasok manual'), !selected) +
      list.map(function (s) { return '<option value="' + esc(s.id) + '" data-name="' + esc(s.name || '') + '"' + (String(s.id) === String(selected || '') ? ' selected' : '') + '>' + esc(s.name || s.id) + '</option>'; }).join('') +
      '</select>';
  }
  function itemRow(it, currency, amountAllowed) {
    var linked = !!String(it.pi_id || '').trim();
    var qty = Number(it.shipped_qty || 0);
    var unit = Number(it.unit_price || 0);
    var discount = Number(it.discount || 0);
    var net = Number(it.net_unit_price || (unit * (1 - discount)));
    var line = Number(it.ci_amount || qty * net);
    var amounts = amountAllowed
      ? '<td><input data-hci-field="unit_price" type="number" min="0" step="0.01" value="' + esc(unit) + '"' + (linked ? ' readonly' : '') + ' oninput="recalcHistoricalCIEditLine(this)"></td>' +
        '<td><input data-hci-field="discount" type="number" min="0" max="100" step="0.1" value="' + esc((discount * 100).toFixed(1)) + '"' + (linked ? ' readonly' : '') + ' oninput="recalcHistoricalCIEditLine(this)"></td>' +
        '<td class="hci-edit-net">' + money(net, currency) + '</td><td class="hci-edit-amount">' + money(line, currency) + '</td>'
      : '';
    return '<tr class="hci-edit-item" data-item-id="' + esc(it.id) + '" data-linked="' + (linked ? '1' : '0') + '" data-net-unit="' + esc(net) + '">' +
      '<td><strong>' + esc(it.sku_code || '') + '</strong><div class="hci-edit-sub">' + (linked ? 'PI ' + esc(it.pi_no || '') : ui('手工明细', 'Manual item', 'Item manual')) + '</div></td>' +
      '<td><input data-hci-field="qty" type="number" min="0" step="1" value="' + esc(qty) + '" oninput="recalcHistoricalCIEditLine(this)"></td>' + amounts + '</tr>';
  }
  function injectStyle() {
    if (document.getElementById('hci-full-edit-style')) return;
    var style = document.createElement('style');
    style.id = 'hci-full-edit-style';
    style.textContent =
      '.modal-ci-create:has(.hci-edit-form){max-width:1080px!important;width:min(1080px,94vw)!important;background:#f5f5f7;border:1px solid rgba(0,0,0,.08);border-radius:18px;box-shadow:0 18px 48px rgba(0,0,0,.14)}' +
      '.modal-ci-create:has(.hci-edit-form) .modal-header{padding:14px 20px;background:rgba(255,255,255,.96);border-bottom:.5px solid #d2d2d7}' +
      '.modal-ci-create:has(.hci-edit-form) .modal-body{padding:18px 20px 22px;background:#f5f5f7;max-height:72vh;overflow:auto}' +
      '.hci-edit-form .hci-edit-note{padding:10px 12px;margin-bottom:14px;background:#fff;border:1px solid #e1e1e6;border-radius:10px;color:#6e6e73;font-size:12px;line-height:1.6}' +
      '.hci-edit-form .form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 16px;margin-bottom:12px}' +
      '.hci-edit-form .form-group{margin:0;min-width:0}.hci-edit-form .form-group>label{display:block;margin-bottom:6px;font-size:12px;font-weight:600;color:#6e6e73}' +
      '.hci-edit-form .form-group input,.hci-edit-form .form-group select{width:100%;min-height:38px;background:#fff;border:1px solid #d2d2d7;border-radius:9px;color:#1d1d1f;font-size:13px;padding:8px 10px}' +
      '.hci-edit-form .form-group input:focus,.hci-edit-form .form-group select:focus{outline:none;border-color:#007aff;box-shadow:0 0 0 3px rgba(0,122,255,.12)}' +
      '.hci-edit-form input[readonly],.hci-edit-form select:disabled{background:#ededf0!important;color:#6e6e73;opacity:1}' +
      '.hci-edit-form .hci-edit-title{font-size:14px;font-weight:650;color:#1d1d1f;margin:18px 0 9px}' +
      '.hci-edit-form .hci-edit-items{background:#fff;border:1px solid #e1e1e6;border-radius:12px;overflow:auto;max-height:330px}' +
      '.hci-edit-form .hci-edit-items table{width:100%;border-collapse:separate;border-spacing:0;font-size:12px;margin:0}' +
      '.hci-edit-form .hci-edit-items th{position:sticky;top:0;z-index:1;background:#f2f2f4;color:#6e6e73;padding:9px 10px;text-align:left;border-bottom:1px solid #dcdce1;white-space:nowrap}' +
      '.hci-edit-form .hci-edit-items td{padding:8px 10px;border-bottom:1px solid #ededf0;text-align:left;vertical-align:middle;white-space:nowrap}' +
      '.hci-edit-form .hci-edit-items input{width:104px;min-height:31px;padding:5px 7px;border:1px solid #d2d2d7;border-radius:7px;font-size:12px}' +
      '.hci-edit-form .hci-edit-sub,.hci-edit-form .hci-edit-footnote{font-size:10px;color:#8e8e93;margin-top:4px;line-height:1.55}' +
      '.modal-ci-create:has(.hci-edit-form) .modal-footer{padding:11px 20px;background:rgba(255,255,255,.97);border-top:.5px solid #d2d2d7;gap:8px}' +
      '.modal-ci-create:has(.hci-edit-form) .modal-footer .btn{min-height:36px;border-radius:9px;padding:7px 15px;font-size:13px;font-weight:600;box-shadow:none}' +
      '.modal-ci-create:has(.hci-edit-form) .modal-footer .btn-primary{background:#1d1d1f;border-color:#1d1d1f;color:#fff}' +
      '.modal-ci-create:has(.hci-edit-form) .modal-footer .btn-secondary{background:#fff;border-color:#d2d2d7;color:#1d1d1f}' +
      '.modal-ci-create .modal-header .hci-edit-entry{margin-left:auto;border-radius:8px;background:#fff;border-color:#d2d2d7;color:#1d1d1f}' +
      '@media(max-width:700px){.hci-edit-form .form-grid{grid-template-columns:1fr}.modal-ci-create:has(.hci-edit-form) .modal-body{max-height:68vh;padding:14px}}';
    document.head.appendChild(style);
  }

  global.onHistoricalCIEditSupplierChange = function () {
    var sel = document.getElementById('hci-edit-supplier-id');
    var name = document.getElementById('hci-edit-supplier-name');
    if (!sel || !name) return;
    var selected = sel.options[sel.selectedIndex];
    if (sel.value && selected) name.value = selected.getAttribute('data-name') || selected.textContent || '';
  };
  global.onHistoricalCIEditSupplierNameInput = function () {
    var sel = document.getElementById('hci-edit-supplier-id');
    if (sel) sel.value = '';
  };
  global.onHistoricalCIEditWarehouseChange = function () {
    var country = document.getElementById('hci-edit-country');
    var warehouse = document.getElementById('hci-edit-warehouse');
    if (!country || !warehouse) return;
    var fixed = fixedWarehouse(country.value);
    if (fixed) { warehouse.value = fixed; warehouse.readOnly = true; }
    else warehouse.readOnly = false;
  };
  global.recalcHistoricalCIEditLine = function (input) {
    var row = input && input.closest ? input.closest('.hci-edit-item') : null;
    if (!row) return;
    var qty = Number((row.querySelector('[data-hci-field="qty"]') || {}).value || 0);
    var unitEl = row.querySelector('[data-hci-field="unit_price"]');
    var discountEl = row.querySelector('[data-hci-field="discount"]');
    var unit = unitEl ? Number(unitEl.value || 0) : Number(row.getAttribute('data-net-unit') || 0);
    var discount = discountEl ? Number(discountEl.value || 0) / 100 : 0;
    var net = unitEl ? unit * (1 - discount) : Number(row.getAttribute('data-net-unit') || 0);
    var currency = (document.getElementById('hci-edit-currency') || {}).value || '';
    var netCell = row.querySelector('.hci-edit-net');
    var amountCell = row.querySelector('.hci-edit-amount');
    if (netCell) netCell.textContent = money(net, currency);
    if (amountCell) amountCell.textContent = money(qty * net, currency);
  };

  global.editHistoricalCI = async function (id, backPay, backMode) {
    try {
      var results = await Promise.all([
        global.api('/api/historical-commercial-invoices/' + encodeURIComponent(id)),
        global.api('/api/suppliers'),
        global.api('/api/countries'),
        global.api('/api/currencies')
      ]);
      var h = results[0] || {};
      var suppliers = (results[1] || []).filter(function (s) { return s.status === 'active' || String(s.id) === String(h.supplier_id || ''); });
      var countries = (results[2] || []).filter(function (c) { return c.status === 'active' || String(c.code) === String(h.country || ''); });
      var currencies = (results[3] || []).filter(function (c) { return c.status === 'active' || String(c.code).toUpperCase() === String(h.currency || '').toUpperCase(); });
      var items = Array.isArray(h.items) ? h.items : [];
      var hasLinked = items.some(function (it) { return !!String(it.pi_id || '').trim(); });
      var paymentStatus = String(h.payment_status || '');
      var hasSettlements = Number(h.historical_paid_amount || 0) > 0 || Number(h.subsequent_paid_amount || 0) > 0 || Number(h.deduction_amount || 0) > 0 || Number(h.rounding_amount || 0) > 0 || paymentStatus === 'paid' || paymentStatus.indexOf('partial') === 0;
      var amountAllowed = !!h.amount_view_allowed;
      global._hciEditAmountAllowed = amountAllowed;
      global._hciEditSupplierName = h.supplier_name || '';
      var identityLocked = hasLinked || hasSettlements;
      var supplierHtml = supplierSelect(suppliers, h.supplier_id || '', identityLocked);
      var countryHtml = '<select id="hci-edit-country" class="form-control" onchange="onHistoricalCIEditWarehouseChange()"' + (identityLocked ? ' disabled' : '') + '>' +
        countries.map(function (c) { return opt(c.code, (c.name || c.code) + (c.flag ? ' ' + c.flag : ''), String(c.code) === String(h.country || '')); }).join('') + '</select>';
      var currencyHtml = selectCurrencies('hci-edit-currency', currencies, h.currency, [h.currency], identityLocked);
      var freightCurrencyHtml = selectCurrencies('hci-edit-freight-currency', currencies, h.freight_currency || h.currency, [h.freight_currency, 'CNY'], false);
      var warehouse = h.target_warehouse || fixedWarehouse(h.country) || '';
      var warehouseLocked = !!fixedWarehouse(h.country) || identityLocked;
      var brandHtml = '<input id="hci-edit-brand" type="text" value="' + esc(h.brand_name || '') + '"' + (identityLocked ? ' readonly' : '') + '>';
      var itemTable = items.length
        ? '<div class="hci-edit-items"><table><thead><tr><th>SKU / PI</th><th>' + tr('ci.col.ci_qty', '数量') + '</th>' +
          (amountAllowed ? '<th>' + tr('field.original_unit_price', '原单价') + '</th><th>' + tr('field.discount', '折扣 %') + '</th><th>' + tr('field.net_unit_price', '折后单价') + '</th><th>' + tr('ci.col.amount', '金额') + '</th>' : '') +
          '</tr></thead><tbody>' + items.map(function (it) { return itemRow(it, h.currency, amountAllowed); }).join('') + '</tbody></table></div>'
        : '<div class="hci-edit-footnote">' + ui('该历史 CI 没有 SKU 明细，货款总金额按 CI 原始金额单独维护。', 'This historical CI has no SKU lines. Maintain the goods total from the original CI.', 'CI historis ini tidak memiliki rincian SKU. Total barang mengikuti CI asli.') + '</div>';

      var body = '<div class="hci-edit-form">' +
        '<div class="hci-edit-note">' + ui('整单编辑会同步更新历史 CI 主记录、对应应付信息及关联 PI 的出货数量。已发生的银行付款、抵扣和抹零流水不会被覆盖；PI 关联 SKU 的价格快照保持只读。SKU 明细金额不会自动覆盖 CI 货款总额，请按原始 CI 单据核对总金额。', 'Saving updates the historical CI, its payable details and linked PI shipped quantities. Recorded bank payments, deductions and rounding are preserved. Prices on PI-linked SKU snapshots remain read-only. SKU line totals do not overwrite the CI goods total; verify it against the original CI.', 'Penyimpanan memperbarui CI historis, rincian utang dan jumlah terkirim PI terkait. Pembayaran bank, potongan dan pembulatan yang sudah tercatat tetap dipertahankan. Harga SKU yang terkait PI hanya-baca. Total baris SKU tidak menimpa total barang CI; periksa berdasarkan CI asli.') + '</div>' +
        '<div class="hci-edit-title">' + ui('基本信息', 'Basic information', 'Informasi dasar') + '</div><div class="form-grid">' +
        field(tr('field.historical_ci_no', '历史 CI 编号'), '<input id="hci-edit-no" type="text" value="' + esc(h.historical_ci_no || '') + '">') +
        field(tr('field.supplier_name', '供应商'), supplierHtml + '<input id="hci-edit-supplier-name" type="text" style="margin-top:7px" value="' + esc(h.supplier_name || '') + '"' + (identityLocked ? ' readonly' : '') + ' oninput="onHistoricalCIEditSupplierNameInput()">') +
        field(tr('field.brand', '品牌'), brandHtml) +
        field(tr('field.country', '国家'), countryHtml) +
        field(tr('field.target_warehouse', '目标仓库'), '<input id="hci-edit-warehouse" type="text" value="' + esc(warehouse) + '"' + (warehouseLocked ? ' readonly' : '') + '>') +
        field(ui('清关方式', 'Clearance type', 'Jenis bea cukai'), '<select id="hci-edit-clearance">' + opt('', ui('未设置', 'Not set', 'Belum diatur'), !h.clearance_type) + opt('formal', ui('正清', 'Formal', 'Formal'), h.clearance_type === 'formal') + opt('non_formal', ui('非正清', 'Informal', 'Informal'), h.clearance_type === 'non_formal') + '</select>') +
        field(tr('field.ci_date', 'CI 日期'), '<input id="hci-edit-date" type="date" value="' + esc(dateVal(h.ci_date)) + '">') +
        field(tr('field.actual_ship_date', '实际出货日期'), '<input id="hci-edit-ship-date" type="date" value="' + esc(dateVal(h.actual_ship_date)) + '">') +
        field(tr('field.currency', '币种'), currencyHtml) + '</div>';

      if (amountAllowed) {
        body += '<div class="hci-edit-title">' + ui('金额与费用', 'Amounts and costs', 'Nominal dan biaya') + '</div><div class="form-grid">' +
          field(tr('field.gross_amount', 'CI 货款总金额'), '<input id="hci-edit-gross" type="number" min="0" step="0.01" value="' + esc(h.gross_goods_amount == null ? '' : h.gross_goods_amount) + '">') +
          field(tr('hci.freight_amount', '总运费'), '<input id="hci-edit-freight" type="number" min="0" step="0.01" value="' + esc(h.freight_amount == null ? '' : h.freight_amount) + '">') +
          field(ui('运费币种', 'Freight currency', 'Mata uang ongkir'), freightCurrencyHtml) +
          field(tr('hci.customs_duty_idr', '关税（IDR）'), '<input id="hci-edit-duty-idr" type="number" min="0" step="0.01" value="' + esc(h.customs_duty_idr == null ? '' : h.customs_duty_idr) + '">') +
          field(tr('hci.customs_duty_rmb', '关税（RMB）'), '<input id="hci-edit-duty-rmb" type="number" min="0" step="0.01" value="' + esc(h.customs_duty_rmb == null ? '' : h.customs_duty_rmb) + '">') +
          field(tr('field.historical_paid', '导入前历史已付款'), '<input id="hci-edit-paid" type="number" min="0" step="0.01" value="' + esc(h.historical_paid_amount == null ? '0' : h.historical_paid_amount) + '">') +
          field(ui('历史付款日期', 'Historical payment date', 'Tanggal pembayaran historis'), '<input id="hci-edit-paid-date" type="date" value="' + esc(dateVal(h.historical_paid_date)) + '">') + '</div>';
      }

      body += '<div class="hci-edit-title">' + ui('付款条件与备注', 'Payment terms and notes', 'Syarat pembayaran dan catatan') + '</div><div class="form-grid">' +
        field(tr('field.payment_terms', '付款条件 / 账期'), '<input id="hci-edit-terms" type="text" value="' + esc(h.payment_terms || '') + '">') +
        field(ui('Credit 天数', 'Credit days', 'Hari kredit'), '<input id="hci-edit-credit-days" type="number" min="0" step="1" value="' + esc(h.credit_days || 0) + '">') +
        field(tr('field.due_date', '尾款到期日'), '<input id="hci-edit-due" type="date" value="' + esc(dateVal(h.due_date)) + '">') +
        field(tr('field.source_note', '原始凭证或备注'), '<input id="hci-edit-note" type="text" value="' + esc(h.source_note || '') + '">', true) +
        '</div><div class="hci-edit-title">' + ui('SKU 明细', 'SKU details', 'Rincian SKU') + '</div>' + itemTable +
        '<div class="hci-edit-footnote">' + ui('PI 关联行可修改出货数量，价格来自 PI 快照且不可单独修改。无 PI 关联的历史明细，在具备金额查看权限时可修改单价和折扣。修改数量会同步 PI 的已出货 / 未出货数量。', 'For PI-linked rows, you can edit shipped quantity; prices come from the PI snapshot and cannot be changed here. For unlinked historical rows, unit price and discount can be edited when you have amount-view permission. Quantity changes sync PI shipped and unshipped quantities.', 'Untuk baris terkait PI, jumlah terkirim dapat diubah; harga berasal dari snapshot PI dan tidak dapat diubah di sini. Untuk baris historis tanpa PI, harga satuan dan diskon dapat diedit jika memiliki izin melihat nominal. Perubahan jumlah akan menyinkronkan jumlah terkirim dan belum terkirim PI.') + '</div></div>';

      var jsId = JSON.stringify(String(id));
      var jsPay = JSON.stringify(backPay || '');
      var jsMode = JSON.stringify(backMode || 'view');
      var footer = '<button class="btn btn-secondary" onclick="viewHistoricalCI(' + jsId + ',' + jsPay + ',' + jsMode + ')">' + ui('取消', 'Cancel', 'Batal') + '</button>' +
        '<button class="btn btn-primary" id="hci-edit-save" onclick="saveHistoricalCIEdit(' + jsId + ',' + jsPay + ',' + jsMode + ')">' + ui('保存修改', 'Save changes', 'Simpan perubahan') + '</button>';
      injectStyle();
      global.openModal(ui('编辑历史 CI', 'Edit historical CI', 'Edit CI historis') + ' - ' + esc(h.historical_ci_no || ''), body, footer, 'modal-ci-create');
      global.onHistoricalCIEditWarehouseChange();
    } catch (e) {
      global.showToast(e.message || String(e), 'danger');
    }
  };

  global.saveHistoricalCIEdit = async function (id, backPay, backMode) {
    var btn = document.getElementById('hci-edit-save');
    if (!btn || btn.disabled) return;
    function val(id) { var el = document.getElementById(id); return el ? el.value : ''; }
    var payload = {
      historical_ci_no: val('hci-edit-no').trim(),
      supplier_id: val('hci-edit-supplier-id'),
      supplier_name: val('hci-edit-supplier-name').trim(),
      brand_name: val('hci-edit-brand').trim(),
      country: val('hci-edit-country'),
      target_warehouse: val('hci-edit-warehouse').trim(),
      clearance_type: val('hci-edit-clearance'),
      ci_date: val('hci-edit-date'),
      actual_ship_date: val('hci-edit-ship-date'),
      currency: val('hci-edit-currency'),
      payment_terms: val('hci-edit-terms').trim(),
      credit_days: val('hci-edit-credit-days'),
      due_date: val('hci-edit-due'),
      source_note: val('hci-edit-note').trim()
    };
    if (global._hciEditAmountAllowed) {
      payload.gross_goods_amount = val('hci-edit-gross');
      payload.freight_amount = val('hci-edit-freight');
      payload.freight_currency = val('hci-edit-freight-currency');
      payload.customs_duty_idr = val('hci-edit-duty-idr');
      payload.customs_duty_rmb = val('hci-edit-duty-rmb');
      payload.historical_paid_amount = val('hci-edit-paid');
      payload.historical_paid_date = val('hci-edit-paid-date');
    }
    payload.items = Array.prototype.map.call(document.querySelectorAll('.hci-edit-item'), function (row) {
      var item = { id: row.getAttribute('data-item-id'), shipped_qty: (row.querySelector('[data-hci-field="qty"]') || {}).value || '0' };
      if (row.getAttribute('data-linked') !== '1' && global._hciEditAmountAllowed) {
        item.unit_price = (row.querySelector('[data-hci-field="unit_price"]') || {}).value || '0';
        item.discount = Number((row.querySelector('[data-hci-field="discount"]') || {}).value || 0) / 100;
      }
      return item;
    });
    if (!payload.historical_ci_no || !payload.supplier_name || !payload.brand_name || !payload.country || !payload.ci_date || !payload.currency) {
      global.showToast(ui('请填写历史 CI 编号、供应商、品牌、国家、CI 日期和币种', 'Complete CI number, supplier, brand, country, CI date and currency.', 'Lengkapi nomor CI, pemasok, merek, negara, tanggal CI dan mata uang.'), 'warning');
      return;
    }
    try {
      btn.disabled = true;
      btn.textContent = ui('保存中…', 'Saving…', 'Menyimpan…');
      await global.api('/api/historical-commercial-invoices/' + encodeURIComponent(id), 'PUT', payload);
      global.showToast(ui('历史 CI 已更新', 'Historical CI updated', 'CI historis diperbarui'), 'success');
      if (typeof global.loadCI === 'function') Promise.resolve(global.loadCI()).catch(function () {});
      await global.viewHistoricalCI(id, backPay || '', backMode || 'view');
    } catch (e) {
      global.showToast(e.message || String(e), 'danger');
      btn.disabled = false;
      btn.textContent = ui('保存修改', 'Save changes', 'Simpan perubahan');
    }
  };

  var originalView = global.viewHistoricalCI;
  if (typeof originalView === 'function' && !originalView.__hciFullEditWrapped) {
    async function wrappedViewHistoricalCI(id, backPay, backMode) {
      var result = await originalView.apply(this, arguments);
      try {
        if (typeof global.hasPermission !== 'function' || !global.hasPermission('ci_edit')) return result;
        var header = document.querySelector('#modal-content .modal-header');
        var close = header && header.querySelector('.modal-close');
        if (!header || !close || header.querySelector('.hci-edit-entry')) return result;
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn-secondary btn-sm hci-edit-entry';
        button.textContent = ui('编辑整张记录', 'Edit full record', 'Edit seluruh catatan');
        button.onclick = function () { global.editHistoricalCI(id, backPay || '', backMode || 'view'); };
        header.insertBefore(button, close);
      } catch (e) {}
      return result;
    }
    wrappedViewHistoricalCI.__hciFullEditWrapped = true;
    wrappedViewHistoricalCI.__original = originalView;
    global.viewHistoricalCI = wrappedViewHistoricalCI;
  }
})(typeof window !== 'undefined' ? window : this);
