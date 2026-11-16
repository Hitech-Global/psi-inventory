(function (global) {
  'use strict';

  if (!global || typeof document === 'undefined') return;

  var LABELS = {
    'ci.cost.flags': ['Expense Flags', 'Penanda Biaya'],
    'ci.cost.has_duty': ['Customs Duty', 'Bea Masuk'],
    'ci.cost.has_inspection': ['Inspection Fee', 'Biaya Pemeriksaan'],
    'ci.cost.toggle_duty': ['Toggle Customs Duty', 'Ubah Penanda Bea Masuk'],
    'ci.cost.toggle_inspection': ['Toggle Inspection Fee', 'Ubah Penanda Biaya Pemeriksaan'],
    'ci.cost.allocation_snapshot': ['Allocation Inputs', 'Snapshot Alokasi'],
    'ci.cost.freight_basis': ['Actual Freight Billing Basis', 'Dasar Perhitungan Angkut Aktual'],
    'ci.cost.kg_pl_gross_weight': ['KG (PL total gross weight)', 'KG (Berat Kotor Total PL)'],
    'ci.cost.no_freight_basis': ['No freight-type fee / Not selected', 'Tidak ada biaya angkut / Belum dipilih'],
    'ci.cost.ci_duty_total': ['CI Import Duty Total', 'Total Bea Masuk CI'],
    'ci.cost.duty_rate': ['Actual Duty Rate (%)', 'Tarif Bea Masuk Aktual (%)'],
    'ci.cost.snapshot_note': ['The freight basis and actual duty rates are snapshots for this CI. They are not recalculated from the shipping method or SKU master data, and are locked after expense confirmation.', 'Basis angkut dan tarif bea aktual adalah snapshot CI ini. Nilainya tidak dihitung ulang dari metode pengiriman atau data master SKU, dan terkunci setelah konfirmasi biaya.'],
    'ci.cost.save_inputs': ['Save Allocation Inputs', 'Simpan Input Alokasi'],
    'ci.cost.summary': ['Expense Summary', 'Ringkasan Biaya'],
    'ci.cost.goods_amount': ['Goods Amount', 'Nilai Barang'],
    'ci.cost.warehouse_fee': ['Warehouse Arrival Costs', 'Biaya Tiba Gudang'],
    'ci.cost.customs_duty': ['Customs Duty', 'Bea Masuk'],
    'ci.cost.inspection_fee': ['Inspection Fee', 'Biaya Pemeriksaan'],
    'ci.cost.confirmation': ['Expense Confirmation', 'Konfirmasi Biaya'],
    'ci.cost.allocation': ['Expense Allocation', 'Alokasi Biaya'],
    'ci.cost.original_inventory': ['Original Inventory Import', 'Impor Stok Awal'],
    'ci.cost.details': ['Expense Details', 'Rincian Biaya'],
    'ci.cost.category': ['Category', 'Kategori'],
    'ci.cost.subcategory': ['Subcategory', 'Subkategori'],
    'ci.cost.payment_request': ['Payment Request No.', 'No. Pengajuan Pembayaran'],
    'ci.cost.payable_amount': ['Payable Amount', 'Jumlah Terutang'],
    'ci.cost.paid_amount': ['Paid Amount', 'Jumlah Dibayar'],
    'ci.cost.include_in_landing': ['Included in Landed Cost', 'Termasuk Biaya Mendarat'],
    'ci.cost.payee': ['Payee', 'Penerima'],
    'ci.cost.currency_note': ['Amounts are shown separately by currency. No cross-currency grand total is calculated.', 'Jumlah ditampilkan terpisah berdasarkan mata uang. Tidak ada total gabungan lintas mata uang.'],
    'ci.cost.freight_fx_note': ['Paid freight is displayed in RMB using the exchange-rate snapshot from the actual payment date. Unpaid freight remains in its original currency.', 'Ongkos angkut yang telah dibayar ditampilkan dalam RMB menggunakan snapshot kurs pada tanggal pembayaran aktual. Ongkos yang belum dibayar tetap dalam mata uang asal.'],
    'ci.cost.detail_fx_note': ['Expense details show each document in its original currency. The warehouse-cost summary converts paid freight to RMB using the actual payment-date rate.', 'Rincian biaya menampilkan mata uang asli setiap dokumen. Ringkasan biaya gudang mengonversi ongkos angkut yang telah dibayar ke RMB menggunakan kurs pada tanggal pembayaran aktual.'],
    'ci.cost.pending_fx': ['Paid freight: exchange-rate evidence is missing', 'Ongkos angkut dibayar: bukti kurs belum tersedia'],
    'ci.cost.freight_unavailable': ['Freight currency details are temporarily unavailable. Unverified amounts are not added to the summary.', 'Rincian mata uang ongkos angkut sementara tidak tersedia. Jumlah yang belum terverifikasi tidak ditambahkan ke ringkasan.'],
    'ci.cost.currency_unknown': ['Currency unconfirmed', 'Mata uang belum dikonfirmasi'],
    'ci.cost.empty': ['No expense records', 'Belum ada catatan biaya'],
    'ci.cost.yes': ['Yes', 'Ya'],
    'ci.cost.no': ['No', 'Tidak'],
    'ci.cost.confirm_complete': ['Confirm Expenses Complete', 'Konfirmasi Kelengkapan Biaya'],
    'ci.cost.allocate_action': ['Allocate Expenses', 'Alokasikan Biaya'],
    'ci.cost.create_duty_pay': ['Create Duty Payment', 'Buat Pembayaran Bea Masuk'],
    'ci.cost.create_inspection_pay': ['Create Inspection Payment', 'Buat Pembayaran Pemeriksaan'],
    'ci.cost.create_warehouse_pay': ['Create Warehouse Fee Payment', 'Buat Pembayaran Biaya Gudang'],
    'ci.cost.close': ['Close', 'Tutup']
  };

  if (global.I18N && global.I18N.dict) {
    Object.keys(LABELS).forEach(function (key) {
      if (global.I18N.dict.en && global.I18N.dict.en[key] == null) global.I18N.dict.en[key] = LABELS[key][0];
      if (global.I18N.dict.id && global.I18N.dict.id[key] == null) global.I18N.dict.id[key] = LABELS[key][1];
    });
  }

  function tr(key, fallback) {
    return typeof global.t === 'function' ? global.t(key, fallback) : fallback;
  }

  function esc(value) {
    return typeof global.esc === 'function'
      ? global.esc(value == null ? '' : value)
      : String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
          return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
        });
  }

  function jsArg(value) {
    return esc(JSON.stringify(String(value == null ? '' : value)));
  }

  function money(value, currency) {
    var code = String(currency || '').trim().toUpperCase();
    if (code && typeof global.fmtMoney === 'function') return global.fmtMoney(value, code);
    var number = Number(value || 0);
    var formatted = number.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (code || tr('ci.cost.currency_unknown', '币种待确认')) + ' ' + formatted;
  }

  function addTotal(target, currency, amount) {
    var code = String(currency || '').trim().toUpperCase();
    var value = Number(amount);
    if (!code || !Number.isFinite(value)) return;
    target[code] = Math.round(((Number(target[code]) || 0) + value) * 100) / 100;
  }

  function currencyLines(totals, pendingFx, unavailable) {
    var codes = Object.keys(totals || {}).sort();
    var lines = codes.map(function (code) {
      return '<div class="ci-cost-currency-line"><strong>' + esc(money(totals[code], code)) + '</strong></div>';
    }).join('');
    if (pendingFx) {
      lines += '<div class="ci-cost-inline-warning">' + esc(tr('ci.cost.pending_fx', '已付款运费待补充汇率证据')) + '</div>';
    }
    if (unavailable) {
      lines += '<div class="ci-cost-inline-warning">' + esc(tr('ci.cost.freight_unavailable', '运费币种明细暂不可用，未确认金额不会计入汇总')) + '</div>';
    }
    return lines || '<span class="ci-cost-empty-value">—</span>';
  }

  function stat(label, valueHtml, note) {
    return '<div class="ci-cost-stat"><div class="ci-cost-stat-label">' + esc(label) +
      '</div><div class="ci-cost-stat-value">' + valueHtml + '</div>' +
      (note ? '<div class="ci-cost-stat-note">' + note + '</div>' : '') + '</div>';
  }

  function statusPill(value, yesText, noText) {
    var yes = !!value;
    return '<span class="ci-cost-status ' + (yes ? 'is-complete' : 'is-incomplete') + '">' +
      (yes ? '✓ ' + esc(yesText) : '— ' + esc(noText)) + '</span>';
  }

  function ensureStyles() {
    if (document.getElementById('ci-cost-mac-style')) return;
    var style = document.createElement('style');
    style.id = 'ci-cost-mac-style';
    style.textContent = [
      '#modal-content.modal-ci-cost{width:min(980px,calc(100vw - 32px));max-width:980px;max-height:calc(100vh - 28px)}',
      '#modal-content.modal-ci-cost .modal-body{max-height:calc(100vh - 112px);overflow-y:auto;padding:18px 20px 22px}',
      '.ci-cost-mac{color:#20242b;font-size:13px;line-height:1.5}',
      '.ci-cost-mac .ci-cost-section{background:#fff;border:1px solid #e7e9ee;border-radius:13px;padding:15px 16px;margin:0 0 13px;box-shadow:0 1px 2px rgba(20,25,35,.025)}',
      '.ci-cost-mac .ci-cost-section-title{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 0 12px;font-size:14px;font-weight:650;color:#252a33}',
      '.ci-cost-mac .ci-cost-flags{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}',
      '.ci-cost-mac .ci-cost-flag{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border:1px solid #eceef2;border-radius:10px;background:#fafbfc}',
      '.ci-cost-mac .ci-cost-flag-label{color:#6b7280;font-size:12px}',
      '.ci-cost-mac .ci-cost-status{display:inline-flex;align-items:center;white-space:nowrap;border-radius:999px;padding:3px 8px;background:#f1f2f4;color:#616875;font-size:12px;font-weight:600}',
      '.ci-cost-mac .ci-cost-status.is-complete{background:#edf7f0;color:#267344}',
      '.ci-cost-mac .ci-cost-status.is-incomplete{background:#f3f4f6;color:#737b87}',
      '.ci-cost-mac .ci-cost-summary-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}',
      '.ci-cost-mac .ci-cost-stat{min-width:0;padding:12px 13px;border:1px solid #e9ebef;border-radius:10px;background:#f8f9fb}',
      '.ci-cost-mac .ci-cost-stat-label{margin-bottom:6px;color:#737b87;font-size:12px}',
      '.ci-cost-mac .ci-cost-stat-value{font-size:14px;font-weight:650;line-height:1.55;overflow-wrap:anywhere}',
      '.ci-cost-mac .ci-cost-stat-note{margin-top:5px;color:#8a919c;font-size:11px;font-weight:400}',
      '.ci-cost-mac .ci-cost-currency-lines{display:flex;flex-direction:column;gap:4px}',
      '.ci-cost-mac .ci-cost-currency-line{display:flex;align-items:baseline;justify-content:space-between;gap:10px}',
      '.ci-cost-mac .ci-cost-currency-code{color:#7a828e;font-size:11px;font-weight:600}',
      '.ci-cost-mac .ci-cost-inline-warning{margin-top:5px;color:#946200;font-size:11px;font-weight:500}',
      '.ci-cost-mac .ci-cost-note{margin-top:9px;color:#7b8491;font-size:11px;line-height:1.55}',
      '.ci-cost-mac .ci-cost-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}',
      '.ci-cost-mac .ci-cost-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}',
      '.ci-cost-mac .ci-cost-form-group{min-width:0}',
      '.ci-cost-mac .ci-cost-form-group label{display:block;margin-bottom:6px;color:#6e7682;font-size:12px;font-weight:600}',
      '.ci-cost-mac .ci-cost-form-group select,.ci-cost-mac .ci-cost-form-group input{width:100%;min-height:36px;border:1px solid #dfe3e9;border-radius:8px;padding:7px 10px;background:#fff;color:#252a33;text-align:left!important;box-shadow:none}',
      '.ci-cost-mac .ci-cost-money-input{display:flex;align-items:center;min-width:0;border:1px solid #dfe3e9;border-radius:8px;overflow:hidden;background:#fff}',
      '.ci-cost-mac .ci-cost-money-prefix{flex:0 0 auto;padding:8px 10px;background:#f3f5f7;border-right:1px solid #e5e8ed;color:#697280;font-size:12px;font-weight:650}',
      '.ci-cost-mac .ci-cost-money-input input{min-width:0;border:0;border-radius:0;box-shadow:none}',
      '.ci-cost-mac .ci-cost-table-wrap{width:100%;overflow:auto;border:1px solid #e8eaef;border-radius:10px}',
      '.ci-cost-mac table{width:100%;border-collapse:separate;border-spacing:0;font-size:12px}',
      '.ci-cost-mac th,.ci-cost-mac td{text-align:left!important;vertical-align:middle;padding:9px 10px;border-bottom:1px solid #eceef2;white-space:normal}',
      '.ci-cost-mac th{background:#f6f7f9;color:#66707d;font-size:11px;font-weight:650;white-space:nowrap}',
      '.ci-cost-mac tbody tr:last-child td{border-bottom:0}',
      '.ci-cost-mac .ci-cost-rate-input{width:120px;max-width:100%;text-align:left!important}',
      '.ci-cost-mac .ci-cost-empty-row{text-align:left!important;color:#8b929d}',
      '.ci-cost-mac .ci-cost-footer-note{padding:0 2px;color:#858d98;font-size:11px;line-height:1.55}',
      '@media(max-width:640px){#modal-content.modal-ci-cost .modal-body{padding:13px}.ci-cost-mac .ci-cost-flags,.ci-cost-mac .ci-cost-summary-grid,.ci-cost-mac .ci-cost-form-grid{grid-template-columns:1fr}.ci-cost-mac .ci-cost-section{padding:12px}.ci-cost-mac .ci-cost-flag{align-items:flex-start;flex-direction:column}}'
    ].join('');
    document.head.appendChild(style);
  }

  function renderExpenseRows(items, goodsCurrency) {
    if (!items.length) {
      return '<tr><td class="ci-cost-empty-row" colspan="7">' +
        esc(tr('ci.cost.empty', '暂无费用记录')) + '</td></tr>';
    }
    return items.map(function (item) {
      var category = item.cost_category;
      if (item.cost_category === 'warehouse_arrival') category = tr('cost.stat_warehouse_fee', '到仓费用');
      else if (item.cost_category === 'customs_duty') category = tr('cost.stat_duty', '关税');
      else if (item.cost_category === 'inspection_fee') category = tr('cost.stat_inspection_fee', '商检费用');
      else if (global.PAY_CATEGORIES && global.PAY_CATEGORIES[item.cost_category]) category = global.PAY_CATEGORIES[item.cost_category];
      var subcategory = item.cost_subcategory || '—';
      if (subcategory === 'freight') subcategory = tr('logistics.col.freight', '运费');
      else if (subcategory === 'duty') subcategory = tr('cost.stat_duty', '关税');
      else if (subcategory === 'inspection') subcategory = tr('cost.stat_inspection_fee', '商检费用');
      var currency = String(item.currency || '').trim().toUpperCase();
      return '<tr>' +
        '<td>' + esc(category || '—') + '</td>' +
        '<td>' + esc(subcategory) + '</td>' +
        '<td class="cell-id">' + esc(item.request_no || '—') + '</td>' +
        '<td>' + esc(money(item.payable_amount, currency)) + '</td>' +
        '<td>' + esc(money(item.paid_amount, currency)) + '</td>' +
        '<td>' + (item.include_in_landing_cost ? statusPill(true, tr('ci.cost.yes', '是'), tr('ci.cost.no', '否')) : statusPill(false, tr('ci.cost.yes', '是'), tr('ci.cost.no', '否'))) + '</td>' +
        '<td>' + esc(item.payee_name || '—') + '</td>' +
        '</tr>';
    }).join('');
  }

  async function viewCICost(id) {
    try {
      var result = await Promise.all([
        global.api('/api/commercial-invoices/' + encodeURIComponent(id) + '/cost-summary'),
        global.api('/api/commercial-invoices/' + encodeURIComponent(id)),
        global.api('/api/commercial-invoices/' + encodeURIComponent(id) + '/shared-logistics-fees').then(function (data) {
          return { data: data, failed: false };
        }).catch(function () {
          return { data: null, failed: true };
        })
      ]);
      var summary = result[0] || {};
      var ci = result[1] || {};
      var freightResult = result[2] || {};
      var freight = freightResult.data;
      var freightFailed = !!freightResult.failed;
      var goodsCurrency = String(summary.goods_currency || ci.currency || 'RMB').trim().toUpperCase();
      var dutyCurrency = String(summary.customs_duty_currency || '').trim().toUpperCase();
      var items = Array.isArray(summary.cost_items) ? summary.cost_items : [];
      var batchDisplay = freight && freight.batch_totals_display && typeof freight.batch_totals_display === 'object'
        ? freight.batch_totals_display : {};
      var batchIds = Object.keys(batchDisplay);
      var warehouseTotals = {};
      var inspectionTotals = {};
      var freightPendingFx = false;
      var hasBatchFreightItems = items.some(function (item) {
        return item.cost_category === 'warehouse_arrival' &&
          item.cost_subcategory === 'freight' &&
          !!String(item.logistics_batch_id || '').trim();
      });
      var freightUnavailable = freightFailed &&
        (hasBatchFreightItems || (Array.isArray(summary.shared_fees) && summary.shared_fees.length > 0));

      batchIds.forEach(function (batchId) {
        var batch = batchDisplay[batchId] || {};
        Object.keys(batch.display_totals || {}).forEach(function (currency) {
          addTotal(warehouseTotals, currency, batch.display_totals[currency]);
        });
        if (batch.pending_fx) freightPendingFx = true;
      });
      Object.keys(summary.manual_freight_display_totals || {}).forEach(function (currency) {
        addTotal(warehouseTotals, currency, summary.manual_freight_display_totals[currency]);
      });
      if (summary.manual_freight_pending_fx) freightPendingFx = true;

      items.forEach(function (item) {
        if (!item.include_in_landing_cost) return;
        var currency = String(item.currency || '').trim().toUpperCase();
        if (item.cost_category === 'warehouse_arrival') {
          if (item.cost_subcategory === 'freight') {
            var batchId = String(item.logistics_batch_id || '').trim();
            // Batch freight is already represented by the dedicated display endpoint.
            // Manual freight without a batch is represented by manual_freight_display_totals.
            if (batchId && !Object.prototype.hasOwnProperty.call(batchDisplay, batchId)) freightUnavailable = true;
            return;
          }
          addTotal(warehouseTotals, currency, item.payable_amount);
        } else if (item.cost_category === 'inspection_fee') {
          addTotal(inspectionTotals, currency, item.payable_amount);
        }
      });

      var flags = '<div class="ci-cost-flags">' +
        '<div class="ci-cost-flag"><div><div class="ci-cost-flag-label">' + esc(tr('ci.cost.has_duty', '有关税')) + '</div>' +
        statusPill(summary.has_customs_duty, tr('ci.cost.yes', '是'), tr('ci.cost.no', '否')) + '</div></div>' +
        '<div class="ci-cost-flag"><div><div class="ci-cost-flag-label">' + esc(tr('ci.cost.has_inspection', '有商检费用')) + '</div>' +
        statusPill(summary.has_inspection_fee, tr('ci.cost.yes', '是'), tr('ci.cost.no', '否')) + '</div></div></div>';

      var flagActions = '';
      if (typeof global.hasPermission === 'function' && global.hasPermission('ci_edit') && !summary.cost_confirmed) {
        flagActions = '<div class="ci-cost-actions">' +
          '<button class="btn btn-secondary btn-sm" onclick="toggleCiCostFlag(\'' + jsArg(id) + '\',' +
          (summary.has_customs_duty ? '0' : '1') + ',null)">' + esc(tr('ci.cost.toggle_duty', '切换关税标记')) + '</button>' +
          '<button class="btn btn-secondary btn-sm" onclick="toggleCiCostFlag(\'' + jsArg(id) + '\',null,' +
          (summary.has_inspection_fee ? '0' : '1') + ')">' + esc(tr('ci.cost.toggle_inspection', '切换商检标记')) + '</button>' +
          '</div>';
      }

      var basisDisabled = summary.cost_confirmed ? 'disabled' : '';
      var dutyDisabled = summary.cost_confirmed ? 'disabled' : '';
      var ciItems = Array.isArray(summary.ci_items) ? summary.ci_items : [];
      var skuRows = ciItems.length ? ciItems.map(function (item) {
        var rate = item.actual_customs_rate === null || item.actual_customs_rate === '' || item.actual_customs_rate === undefined
          ? '' : esc(item.actual_customs_rate);
        return '<tr><td class="cell-id">' + esc(item.sku_code) + '</td>' +
          '<td>' + esc(money(item.ci_amount, goodsCurrency)) + '</td>' +
          '<td><input type="number" min="0" step="0.01" class="ci-duty-rate ci-cost-rate-input" data-id="' +
          esc(item.id) + '" value="' + rate + '" ' + dutyDisabled + '></td></tr>';
      }).join('') : '<tr><td colspan="3" class="ci-cost-empty-row">' + esc(tr('ci.cost.empty', '暂无费用记录')) + '</td></tr>';

      var actions = '';
      var canEdit = typeof global.hasPermission === 'function' && global.hasPermission('ci_edit');
      var canPay = typeof global.hasPermission === 'function' && global.hasPermission('payment_create');
      if (canEdit && !summary.cost_confirmed) {
        actions += '<button class="btn btn-secondary btn-sm" onclick="confirmCiCosts(\'' + jsArg(id) + '\')">' +
          esc(tr('ci.cost.confirm_complete', '确认费用完整')) + '</button>';
      }
      if (canEdit) {
        actions += '<button class="btn btn-secondary btn-sm" onclick="allocateCosts(\'' + jsArg(id) + '\')">' +
          esc(tr('ci.cost.allocate_action', '费用分摊')) + '</button>';
      }
      if (canPay && summary.has_customs_duty && !summary.cost_confirmed) {
        actions += '<button class="btn btn-secondary btn-sm" onclick="createCustomsDutyPay(\'' + jsArg(id) + '\')">' +
          esc(tr('ci.cost.create_duty_pay', '关税付款')) + '</button>';
      }
      if (canPay && summary.has_inspection_fee && !summary.cost_confirmed) {
        actions += '<button class="btn btn-secondary btn-sm" onclick="createInspectionFeePay(\'' + jsArg(id) + '\')">' +
          esc(tr('ci.cost.create_inspection_pay', '商检付款')) + '</button>';
      }
      if (canPay && !summary.cost_confirmed) {
        actions += '<button class="btn btn-secondary btn-sm" onclick="createWarehousePay(\'' + jsArg(id) + '\')">' +
          esc(tr('ci.cost.create_warehouse_pay', '到仓费用付款')) + '</button>';
      }

      var dutyPrefix = dutyCurrency || tr('ci.cost.currency_unknown', '币种待确认');
      var body = '<div class="ci-cost-mac">' +
        '<section class="ci-cost-section"><h3 class="ci-cost-section-title">' + esc(tr('ci.cost.flags', '费用标记')) + '</h3>' +
        flags + flagActions + '</section>' +

        '<section class="ci-cost-section"><h3 class="ci-cost-section-title">' + esc(tr('ci.cost.allocation_snapshot', '分摊输入快照')) + '</h3>' +
        '<div class="ci-cost-form-grid">' +
        '<div class="ci-cost-form-group"><label for="ci-cost-basis">' + esc(tr('ci.cost.freight_basis', '本票实际运输计费基础')) + '</label>' +
        '<select id="ci-cost-basis" ' + basisDisabled + '><option value="">' + esc(tr('ci.cost.no_freight_basis', '无运输类费用 / 未选择')) + '</option>' +
        '<option value="cbm" ' + (summary.transport_basis === 'cbm' ? 'selected' : '') + '>CBM</option>' +
        '<option value="kg" ' + (summary.transport_basis === 'kg' ? 'selected' : '') + '>' + esc(tr('ci.cost.kg_pl_gross_weight', 'KG（PL总毛重）')) + '</option></select></div>' +
        '<div class="ci-cost-form-group"><label for="ci-duty-total">' + esc(tr('ci.cost.ci_duty_total', 'CI Import Duty总金额')) +
        '（' + esc(dutyPrefix) + '）</label><div class="ci-cost-money-input"><span class="ci-cost-money-prefix">' + esc(dutyPrefix) +
        '</span><input type="number" min="0" step="0.01" id="ci-duty-total" value="' +
        esc(Number(summary.import_duty_total || 0)) + '" ' + dutyDisabled + '></div></div></div>' +
        '<div class="ci-cost-note">' + esc(tr('ci.cost.snapshot_note', '运输依据和实际关税税率均为本票快照；费用确认后锁定。')) + '</div>' +
        '<div class="ci-cost-table-wrap" style="margin-top:12px"><table class="data-table"><thead><tr><th>SKU</th>' +
        '<th>' + esc(tr('ci.cost.goods_amount', 'CI实际金额')) + '（' + esc(goodsCurrency) + '）</th>' +
        '<th>' + esc(tr('ci.cost.duty_rate', '本票实际关税税率(%)')) + '</th></tr></thead><tbody>' + skuRows +
        '</tbody></table></div>' +
        '</section>' +

        '<section class="ci-cost-section"><h3 class="ci-cost-section-title">' + esc(tr('ci.cost.summary', '费用汇总')) + '</h3>' +
        '<div class="ci-cost-summary-grid">' +
        stat(tr('ci.cost.goods_amount', '商品金额'), '<span class="ci-cost-amount">' + esc(money(summary.goods_amount, goodsCurrency)) + '</span>') +
        stat(tr('ci.cost.warehouse_fee', '到仓费用'), '<div class="ci-cost-currency-lines">' +
          currencyLines(warehouseTotals, freightPendingFx, freightUnavailable) + '</div>') +
        stat(tr('ci.cost.customs_duty', '关税'), '<span class="ci-cost-amount">' +
          esc(money(summary.customs_duty_total, dutyCurrency)) + '</span>',
          dutyCurrency ? '' : esc(tr('ci.cost.currency_unknown', '币种待确认'))) +
        stat(tr('ci.cost.inspection_fee', '商检费用'), '<div class="ci-cost-currency-lines">' +
          currencyLines(inspectionTotals, false, false) + '</div>') +
        stat(tr('ci.cost.confirmation', '费用确认'), statusPill(summary.cost_confirmed, tr('ci.cost.yes', '是'), tr('ci.cost.no', '否'))) +
        stat(tr('ci.cost.allocation', '费用分摊'), statusPill(summary.cost_allocated, tr('ci.cost.yes', '是'), tr('ci.cost.no', '否'))) +
        stat(tr('ci.cost.original_inventory', '原库存导入'), statusPill(summary.original_inventory_imported, tr('ci.cost.yes', '是'), tr('ci.cost.no', '否'))) +
        '</div><div class="ci-cost-note">' + esc(tr('ci.cost.currency_note', '金额按币种分别显示，不进行跨币种直接相加。')) + '</div>' +
        '<div class="ci-cost-note">' + esc(tr('ci.cost.freight_fx_note', '已付款运费按实际付款日锁定汇率折算为RMB；未付款运费保留原币种。')) + '</div>' +
        '</section>' +

        '<section class="ci-cost-section"><h3 class="ci-cost-section-title">' + esc(tr('ci.cost.details', '费用明细')) + '</h3>' +
        '<div class="ci-cost-table-wrap"><table class="data-table"><thead><tr>' +
        '<th>' + esc(tr('ci.cost.category', '类别')) + '</th><th>' + esc(tr('ci.cost.subcategory', '小类')) + '</th>' +
        '<th>' + esc(tr('ci.cost.payment_request', '付款申请号')) + '</th><th>' + esc(tr('ci.cost.payable_amount', '应付金额')) + '</th>' +
        '<th>' + esc(tr('ci.cost.paid_amount', '已付金额')) + '</th><th>' + esc(tr('ci.cost.include_in_landing', '计入落地成本')) + '</th>' +
        '<th>' + esc(tr('ci.cost.payee', '付款对象')) + '</th></tr></thead><tbody>' + renderExpenseRows(items, goodsCurrency) +
        '</tbody></table></div><div class="ci-cost-note">' + esc(tr('ci.cost.detail_fx_note', '费用明细按单据原币显示；到仓费用汇总中的已付运费按实际付款日锁定汇率折算为RMB。')) + '</div>' +
        '</section>' +
        '<div class="ci-cost-footer-note">' + esc(tr('ci.cost.currency_note', '金额按币种分别显示，不进行跨币种直接相加。')) + '</div>' +
        '</div>';

      var footer = (canEdit && !summary.cost_confirmed
        ? '<button class="btn btn-secondary" onclick="saveCiCostInputs(' + jsArg(id) + ')">' +
          esc(tr('ci.cost.save_inputs', '保存分摊输入')) + '</button>'
        : '') +
        '<button class="btn btn-secondary" onclick="closeModal()">' +
        esc(tr('ci.cost.close', '关闭')) + '</button>';
      ensureStyles();
      global.openModal(
        tr('modal.title.viewCICost', 'CI费用管理 - {v1}', { v1: ci.ci_no }),
        body,
        footer,
        'modal-ci-cost'
      );
    } catch (error) {
      if (typeof global.showToast === 'function') global.showToast(error.message || String(error), 'danger');
    }
  }

  global.viewCICost = viewCICost;
})(typeof window !== 'undefined' ? window : globalThis);
