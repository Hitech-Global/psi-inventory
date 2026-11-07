'use strict';
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'app.js');
const I18N = path.join(ROOT, 'i18n.js');
const APP_MARKER = '// CI-PL-COMPLETE-I18N-V1';
const I18N_MARKER = '// CI-PL-COMPLETE-I18N-DICT-V1';

function once(src, from, to, label) {
  const count = src.split(from).length - 1;
  if (count === 0 && src.includes(to)) return src;
  if (count !== 1) throw new Error('[CI-PL-I18N] ' + label + ' anchor mismatch: ' + count);
  return src.replace(from, to);
}

function patchAppSource(src) {
  if (src.includes(APP_MARKER)) return src;

  src = once(
    src,
    "function ciClearanceLabel(v){return v==='formal'?'正清':v==='non_formal'?'非正清':'未设置';}",
    "function ciClearanceLabel(v){return v==='formal'?t('ci.clearance.formal','正清'):v==='non_formal'?t('ci.clearance.non_formal','非正清'):t('ci.clearance.unset','未设置');}\n"
      + "function ciPaymentStatusLabel(status){var keys={unpaid:'status.unpaid',paid:'status.paid',partial_paid:'status.partial_paid',pending_approval:'status.pending_approval',approved:'status.approved',rejected:'status.rejected',partial_deduction:'status.partial_deduction',partial_rounding:'status.partial_rounding',deduction_settled:'status.deduction_settled',partial_payment_partial_deduction:'status.partial_payment_partial_deduction',reversed:'status.reversed',cancelled:'status.cancelled'};var key=keys[String(status||'')];return key?t(key,String(status||'—')):(status||'—');}",
    'clearance and payment status label helpers'
  );

  src = once(
    src,
    "const ciFilterControls = '<div class=\"filter-group\"><label>'+t('logistics.detail.logistics_status','物流状态')+'</label><select id=\"ci-logistics-fs\"><option value=\"\">'+t('common.all','全部')+'</option>'+logisticsFilterOptions('')+'</select></div><div class=\"filter-group\"><label>清关方式</label><select id=\"ci-clearance-filter\" onchange=\"onCIFilterChange()\"><option value=\"\">全部</option><option value=\"formal\">正清</option><option value=\"non_formal\">非正清</option><option value=\"unset\">未设置</option></select></div>",
    "const ciFilterControls = '<div class=\"filter-group\"><label>'+t('logistics.detail.logistics_status','物流状态')+'</label><select id=\"ci-logistics-fs\"><option value=\"\">'+t('common.all','全部')+'</option>'+logisticsFilterOptions('')+'</select></div><div class=\"filter-group\"><label>'+t('ci.clearance.filter','清关方式')+'</label><select id=\"ci-clearance-filter\" onchange=\"onCIFilterChange()\"><option value=\"\">'+t('common.all','全部')+'</option><option value=\"formal\">'+t('ci.clearance.formal','正清')+'</option><option value=\"non_formal\">'+t('ci.clearance.non_formal','非正清')+'</option><option value=\"unset\">'+t('ci.clearance.unset','未设置')+'</option></select></div>",
    'clearance filter labels'
  );

  const oldColumns = "  var columns=[\n    ['CI号','ci.no'],['CI类型','ci.col.type'],['品牌','field.brand'],['国家','field.country'],\n    ['仓库','field.target_warehouse'],['清关方式','ci.clearance_type'],['CI日期','field.ci_date'],\n    ['CI金额','ci.amount'],['总运费','ci.col.total_freight'],\n    ['运费占比','ci.col.freight_ratio'],['已付金额','ci.paid_amount'],['未结金额','ci.unpaid_amount'],\n    ['付款状态','ci.payment_status'],['物流状态','ci.col.logistics_status'],\n    ['入库状态','ci.col.inbound_status'],['到期日','field.due_date'],['操作','common.actions']\n  ];";
  const newColumns = "  var columns=[\n    ['CI号','ci.no'],['CI类型','ci.col.type'],['品牌','field.brand'],['国家','field.country'],\n    ['仓库','field.target_warehouse'],['清关方式','ci.clearance_type'],['CI日期','field.ci_date'],\n    ['CI金额','ci.amount'],['总运费','ci.col.total_freight'],\n    ['运费占比','ci.col.freight_ratio'],['已付金额','ci.paid_amount'],['未结金额','ci.unpaid_amount'],\n    ['付款状态','ci.payment_status'],['物流状态','ci.col.logistics_status'],\n    ['入库状态','ci.col.inbound_status'],['尾款到期日','ci.final_balance_due_date'],['操作','common.actions']\n  ];";
  src = once(src, oldColumns, newColumns, 'unified CI table column labels');

  src = once(
    src,
    "    tr.appendChild(cell(srcTable,sourceRow,['尾款状态','付款状态','Balance Payment Status','Payment Status']));",
    "    var paymentStatusCell=cell(srcTable,sourceRow,['尾款状态','付款状态','Balance Payment Status','Payment Status']);paymentStatusCell.textContent=ciPaymentStatusLabel(c.balance_payment_status);tr.appendChild(paymentStatusCell);",
    'operational payment status cell'
  );
  src = once(
    src,
    "    tr.appendChild(cell(srcTable,sourceRow,['付款状态','Payment Status']));",
    "    var historicalPaymentStatusCell=cell(srcTable,sourceRow,['付款状态','Payment Status']);historicalPaymentStatusCell.textContent=ciPaymentStatusLabel(h.payment_status);tr.appendChild(historicalPaymentStatusCell);",
    'historical payment status cell'
  );

  src = once(
    src,
    "      ['导入历史已付',h.historical_paid_amount],['后续已付',h.subsequent_paid_amount],\n      ['抵扣',h.deduction_amount],['抹零',h.rounding_amount]",
    "      [t('ci.historical_paid','导入历史已付'),h.historical_paid_amount],[t('ci.subsequent_paid','后续已付'),h.subsequent_paid_amount],\n      [t('ci.deduction','抵扣'),h.deduction_amount],[t('ci.rounding','抹零'),h.rounding_amount]",
    'historical payment detail labels'
  );

  return src.replace('function renderCI(){', APP_MARKER + '\nfunction renderCI(){');
}

function patchI18nSource(src) {
  if (src.includes(I18N_MARKER)) return src;
  const anchor = '})();';
  const additions = `
  ${I18N_MARKER}
  // The legacy English/Indonesian hidden source-table templates had fewer columns than the current renderer.
  // Keep their header order identical to renderOperationalCITable so unified-row extraction never shifts data.
  var ciSourceHeader = "<div class=\\"table-container\\" style=\\"box-shadow:none;border-radius:0\\"><table class=\\"data-table\\"><thead><tr><th>CI No</th><th>CI Type</th><th>Related PI</th><th>Brand</th><th>Country</th><th>Warehouse</th><th>Clearance Type</th><th>Ship Date</th><th>Currency</th><th>CI Amount</th><th>Paid Deposit</th><th>Payable Balance</th><th>Paid Balance</th><th>Balance Payment Status</th><th>Related Logistics Batch</th><th>Logistics Status</th><th>Inbound Status</th><th>Status</th><th>Actions</th></tr></thead><tbody>";
  I18N.dict.en["gen.L5761.2"] = ciSourceHeader;
  I18N.dict.id["gen.L5761.2"] = ciSourceHeader;
  I18N.dict.zh["ci.type.operational"]="运营CI"; I18N.dict.en["ci.type.operational"]="Operations CI"; I18N.dict.id["ci.type.operational"]="CI Operasional";
  I18N.dict.zh["ci.type.historical"]="历史CI"; I18N.dict.en["ci.type.historical"]="Historical CI"; I18N.dict.id["ci.type.historical"]="CI Historis";
  I18N.dict.zh["ci.clearance.filter"]="清关方式"; I18N.dict.en["ci.clearance.filter"]="Clearance Method"; I18N.dict.id["ci.clearance.filter"]="Metode Kepabeanan";
  I18N.dict.zh["ci.clearance.formal"]="正清"; I18N.dict.en["ci.clearance.formal"]="Formal Customs Clearance"; I18N.dict.id["ci.clearance.formal"]="Jalur Bea Cukai Resmi";
  I18N.dict.zh["ci.clearance.non_formal"]="非正清"; I18N.dict.en["ci.clearance.non_formal"]="Informal Customs Clearance"; I18N.dict.id["ci.clearance.non_formal"]="Jalur Bea Cukai Nonresmi";
  I18N.dict.zh["ci.clearance.unset"]="未设置"; I18N.dict.en["ci.clearance.unset"]="Not Set"; I18N.dict.id["ci.clearance.unset"]="Belum Diatur";
  I18N.dict.zh["ci.no"]="CI号"; I18N.dict.en["ci.no"]="CI No."; I18N.dict.id["ci.no"]="No. CI";
  I18N.dict.zh["ci.col.type"]="CI类型"; I18N.dict.en["ci.col.type"]="CI Type"; I18N.dict.id["ci.col.type"]="Tipe CI";
  I18N.dict.zh["ci.clearance_type"]="清关方式"; I18N.dict.en["ci.clearance_type"]="Clearance Method"; I18N.dict.id["ci.clearance_type"]="Metode Kepabeanan";
  I18N.dict.zh["ci.col.logistics_status"]="物流状态"; I18N.dict.en["ci.col.logistics_status"]="Logistics Status"; I18N.dict.id["ci.col.logistics_status"]="Status Logistik";
  I18N.dict.zh["ci.amount"]="CI金额"; I18N.dict.en["ci.amount"]="CI Amount"; I18N.dict.id["ci.amount"]="Jumlah CI";
  I18N.dict.zh["ci.paid_amount"]="已付金额"; I18N.dict.en["ci.paid_amount"]="Paid Amount"; I18N.dict.id["ci.paid_amount"]="Jumlah Dibayar";
  I18N.dict.zh["ci.unpaid_amount"]="未结金额"; I18N.dict.en["ci.unpaid_amount"]="Outstanding Amount"; I18N.dict.id["ci.unpaid_amount"]="Jumlah Belum Dibayar";
  I18N.dict.zh["ci.payment_status"]="付款状态"; I18N.dict.en["ci.payment_status"]="Payment Status"; I18N.dict.id["ci.payment_status"]="Status Pembayaran";
  I18N.dict.zh["ci.final_balance_due_date"]="尾款到期日"; I18N.dict.en["ci.final_balance_due_date"]="Final Balance Due Date"; I18N.dict.id["ci.final_balance_due_date"]="Tanggal Jatuh Tempo Pelunasan";
  I18N.dict.zh["ci.historical_paid"]="导入历史已付"; I18N.dict.en["ci.historical_paid"]="Previously Paid (Imported)"; I18N.dict.id["ci.historical_paid"]="Pembayaran Historis (Impor)";
  I18N.dict.zh["ci.subsequent_paid"]="后续已付"; I18N.dict.en["ci.subsequent_paid"]="Subsequent Payments"; I18N.dict.id["ci.subsequent_paid"]="Pembayaran Berikutnya";
  I18N.dict.zh["ci.deduction"]="抵扣"; I18N.dict.en["ci.deduction"]="Deduction"; I18N.dict.id["ci.deduction"]="Pengurangan";
  I18N.dict.zh["ci.rounding"]="抹零"; I18N.dict.en["ci.rounding"]="Rounding Adjustment"; I18N.dict.id["ci.rounding"]="Penyesuaian Pembulatan";
  I18N.dict.en["status.pending_approval"]="Pending Approval"; I18N.dict.id["status.pending_approval"]="Menunggu Persetujuan";
  I18N.dict.en["status.approved"]="Approved"; I18N.dict.id["status.approved"]="Disetujui";
  I18N.dict.en["status.rejected"]="Rejected"; I18N.dict.id["status.rejected"]="Ditolak";
  I18N.dict.en["status.partial_deduction"]="Partially Deducted"; I18N.dict.id["status.partial_deduction"]="Sebagian Dikurangi";
  I18N.dict.en["status.partial_rounding"]="Partially Rounded"; I18N.dict.id["status.partial_rounding"]="Sebagian Dibulatkan";
  I18N.dict.en["status.deduction_settled"]="Fully Settled by Deduction"; I18N.dict.id["status.deduction_settled"]="Lunas melalui Pengurangan";
  I18N.dict.en["status.partial_payment_partial_deduction"]="Partially Paid and Deducted"; I18N.dict.id["status.partial_payment_partial_deduction"]="Sebagian Dibayar dan Dikurangi";
  I18N.dict.en["status.reversed"]="Reversed"; I18N.dict.id["status.reversed"]="Dibatalkan";
  I18N.dict.en["status.cancelled"]="Cancelled"; I18N.dict.id["status.cancelled"]="Dibatalkan";
`;
  if (src.split(anchor).length !== 2) throw new Error('[CI-PL-I18N] i18n closing anchor mismatch');
  return src.replace(anchor, additions + '\n' + anchor);
}

function apply() {
  const app = fs.readFileSync(APP, 'utf8');
  const i18n = fs.readFileSync(I18N, 'utf8');
  const nextApp = patchAppSource(app);
  const nextI18n = patchI18nSource(i18n);
  if (nextApp !== app) fs.writeFileSync(APP, nextApp, 'utf8');
  if (nextI18n !== i18n) fs.writeFileSync(I18N, nextI18n, 'utf8');
  console.log('[CI-PL-I18N] complete CI/PL translations applied');
}

if (require.main === module) apply();
module.exports = { APP_MARKER, I18N_MARKER, patchAppSource, patchI18nSource };
