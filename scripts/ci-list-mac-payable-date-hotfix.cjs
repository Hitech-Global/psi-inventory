'use strict';
const fs = require('node:fs');
const path = require('node:path');

const APP_JS = path.join(__dirname, '..', 'app.js');
const I18N_JS = path.join(__dirname, '..', 'i18n.js');
const INDEX_HTML = path.join(__dirname, '..', 'index.html');

const APP_MARKER = '// CI-LIST-PAYABLE-DATE-V1';
const I18N_MARKER = '// CI-LIST-PAYABLE-DATE-I18N-V1';
const CSS_MARKER = '/* CI-LIST-MAC-STYLE-V1 */';
const LEGACY_FINAL_EN_ANCHOR = 'Payable Balance</th><th>Payable Date</th><th>Diff';
const LEGACY_FINAL_ID_ANCHOR = 'Sisa yang Harus Dibayar</th><th>Tanggal Jatuh Tempo</th><th>Selisih';
const CURRENT_FINAL_EN_ANCHOR = '<th>CI No.</th><th>CI Type</th><th>Related PI</th><th>Supplier</th><th>Brand</th><th>Country</th><th>Warehouse</th><th>Ship Date</th><th>Currency</th><th>CI Amount</th><th>Paid Deposit</th><th>Payable Balance</th><th>Paid Balance</th><th>Balance Payment Status</th><th>Related Logistics Batch</th><th>Logistics Status</th><th>Inbound Status</th><th>Status</th><th>Actions</th>';

function countOf(src, needle) {
  return src.split(needle).length - 1;
}

function isKnownFinalI18nState(src) {
  if (src.includes(I18N_MARKER)) return true;
  const legacyFinal = countOf(src, LEGACY_FINAL_EN_ANCHOR) === 1
    && countOf(src, LEGACY_FINAL_ID_ANCHOR) === 1;
  const currentFinal = countOf(src, CURRENT_FINAL_EN_ANCHOR) === 1;
  return legacyFinal || currentFinal;
}

function patchAppSource(src) {
  if (src.includes(APP_MARKER)) return src;

  const fnAnchor = 'function renderOperationalCITable(data){';
  const headerAnchor = '<th>应付尾款</th><th>已付尾款</th>';
  const rowAnchor = '<td class="text-right">\'+fmtMoney(c.balance_unpaid_amount)+\'</td><td class="text-right">\'+fmtMoney(c.balance_paid_amount)+\'</td>';

  if (countOf(src, fnAnchor) !== 1) throw new Error('[CI-LIST-MAC] renderOperationalCITable anchor mismatch');
  if (countOf(src, headerAnchor) !== 1) throw new Error('[CI-LIST-MAC] payable header anchor mismatch');
  if (countOf(src, rowAnchor) !== 1) throw new Error('[CI-LIST-MAC] payable row anchor mismatch');

  let out = src.replace(headerAnchor, '<th>应付尾款</th><th>应付日期</th><th>已付尾款</th>');
  out = out.replace(
    rowAnchor,
    '<td class="text-right">\'+fmtMoney(c.balance_unpaid_amount)+\'</td><td class="cell-date">\'+(fmtDate(c.payable_date)||\'—\')+\'</td><td class="text-right">\'+fmtMoney(c.balance_paid_amount)+\'</td>'
  );
  out = out.replace(fnAnchor, APP_MARKER + '\n' + fnAnchor);
  return out;
}

function patchI18nSource(src) {
  if (isKnownFinalI18nState(src)) return src;

  const markerAnchor = '  I18N.dict.en["gen.L5761.2"]';
  const enAnchor = 'Payable Balance</th><th>Diff';
  const idAnchor = 'Sisa yang Harus Dibayar</th><th>Selisih';

  if (countOf(src, markerAnchor) !== 1) throw new Error('[CI-LIST-MAC] i18n table header anchor mismatch');
  if (countOf(src, enAnchor) !== 1) throw new Error('[CI-LIST-MAC] English payable header anchor mismatch');
  if (countOf(src, idAnchor) !== 1) throw new Error('[CI-LIST-MAC] Indonesian payable header anchor mismatch');

  let out = src.replace(enAnchor, LEGACY_FINAL_EN_ANCHOR);
  out = out.replace(idAnchor, LEGACY_FINAL_ID_ANCHOR);
  out = out.replace(markerAnchor, '  ' + I18N_MARKER + '\n' + markerAnchor);
  return out;
}

function cssPatch() {
  return `
${CSS_MARKER}
/* CI list page only. Pure CSS: no API/listener/timer/render-path work. */
.content-inner:has(#ci-source-mode){padding:4px 2px 18px}
.content-inner:has(#ci-source-mode) .filter-bar{margin-bottom:14px;padding:14px 16px;background:#fff;border:1px solid #e5e5ea;border-radius:16px;box-shadow:0 1px 2px rgba(0,0,0,.04),0 6px 20px rgba(0,0,0,.035)}
.content-inner:has(#ci-source-mode) .filter-form{gap:10px 12px;align-items:flex-end}
.content-inner:has(#ci-source-mode) .filter-group{gap:5px}
.content-inner:has(#ci-source-mode) .filter-group label{color:#6e6e73;font-size:11px;font-weight:600;letter-spacing:.01em}
.content-inner:has(#ci-source-mode) .filter-group select{min-height:36px;padding:6px 30px 6px 10px;background:#fff;border:1px solid #d2d2d7;border-radius:9px;color:#1d1d1f;font-size:13px;box-shadow:none}
.content-inner:has(#ci-source-mode) .filter-group select:focus{outline:none;border-color:#0071e3;box-shadow:0 0 0 3px rgba(0,113,227,.12)}
.content-inner:has(#ci-source-mode) .filter-group select:disabled{background:#f5f5f7;color:#86868b}
.content-inner:has(#ci-source-mode) .filter-actions{gap:8px}
.content-inner:has(#ci-source-mode) .filter-actions .btn{min-height:34px;padding:6px 13px;border-radius:9px;font-size:13px;font-weight:600;box-shadow:none;transform:none}
.content-inner:has(#ci-source-mode) .filter-actions .btn-primary{background:#1d1d1f;border-color:#1d1d1f;color:#fff}
.content-inner:has(#ci-source-mode) .filter-actions .btn-primary:hover{background:#000;border-color:#000}
.content-inner:has(#ci-source-mode) .filter-actions .btn-secondary{background:#fff;border-color:#d2d2d7;color:#1d1d1f}
.content-inner:has(#ci-source-mode) .table-section{background:#fff;border:1px solid #e5e5ea;border-radius:18px;box-shadow:0 1px 2px rgba(0,0,0,.04),0 8px 24px rgba(0,0,0,.035);overflow:hidden}
.content-inner:has(#ci-source-mode) .table-section-title{padding:14px 16px;background:#fff;border-bottom:1px solid #ededf0}
.content-inner:has(#ci-source-mode) .table-section-title-left{color:#1d1d1f;font-size:15px;font-weight:650;letter-spacing:-.1px}
.content-inner:has(#ci-source-mode) #ci-purchase-summary{padding:14px 16px 0;background:#fff}
.content-inner:has(#ci-source-mode) #ci-purchase-summary .stats-grid{gap:10px;margin-bottom:14px!important}
.content-inner:has(#ci-source-mode) #ci-purchase-summary .stat-card{padding:14px 16px;background:#f8f8fa;border:1px solid #ededf0;border-radius:13px;box-shadow:none;transform:none}
.content-inner:has(#ci-source-mode) #ci-purchase-summary .stat-card:hover{box-shadow:none;transform:none;background:#f8f8fa}
.content-inner:has(#ci-source-mode) #ci-purchase-summary .stat-label{color:#6e6e73;font-size:11px;font-weight:600}
.content-inner:has(#ci-source-mode) #ci-purchase-summary .stat-number{margin-top:5px;color:#1d1d1f!important;font-weight:650;letter-spacing:-.1px}
.content-inner:has(#ci-source-mode) #ci-table{padding:0 16px 16px;background:#fff}
.content-inner:has(#ci-source-mode) #ci-table .table-container{margin:0;background:#fff;border:1px solid #e1e1e6;border-radius:12px!important;overflow:auto;box-shadow:none!important}
.content-inner:has(#ci-source-mode) #ci-table .data-table{width:100%;margin:0;border-collapse:separate;border-spacing:0;background:#fff;font-size:12px}
.content-inner:has(#ci-source-mode) #ci-table .data-table th{position:sticky;top:0;z-index:2;padding:9px 10px;background:#f2f2f4;color:#6e6e73;font-size:11px;font-weight:650;white-space:nowrap;text-align:left;border-bottom:1px solid #dcdce1}
.content-inner:has(#ci-source-mode) #ci-table .data-table td{padding:9px 10px;background:#fff;color:#3a3a3c;border-bottom:1px solid #ededf0;vertical-align:middle;white-space:nowrap}
.content-inner:has(#ci-source-mode) #ci-table .data-table tbody tr:last-child td{border-bottom:none}
.content-inner:has(#ci-source-mode) #ci-table .data-table tbody tr:hover td{background:#fafafa}
.content-inner:has(#ci-source-mode) #ci-table .link-text{color:#0071e3;font-weight:600;text-decoration:none}
.content-inner:has(#ci-source-mode) #ci-table .link-text:hover{text-decoration:underline}
.content-inner:has(#ci-source-mode) #ci-table .action-btn{width:30px;height:30px;padding:0;border:1px solid #e5e5ea;border-radius:8px;background:#f5f5f7;color:#1d1d1f;box-shadow:none;transform:none}
.content-inner:has(#ci-source-mode) #ci-table .action-btn:hover{background:#ececf0;border-color:#d2d2d7}
.content-inner:has(#ci-source-mode) #ci-table .table-container::-webkit-scrollbar{width:8px;height:8px}
.content-inner:has(#ci-source-mode) #ci-table .table-container::-webkit-scrollbar-thumb{background:#c7c7cc;border-radius:999px;border:2px solid #fff}
.content-inner:has(#ci-source-mode) #ci-table .table-container::-webkit-scrollbar-track{background:#fff}
.content-inner:has(#ci-source-mode) #ci-table .empty-state{margin:0;padding:36px 18px;background:#fafafa;border:1px solid #ededf0;border-radius:12px;color:#86868b}
`;
}

function patchIndexSource(src) {
  if (src.includes(CSS_MARKER)) return src;
  const close = '</style>';
  const pos = src.lastIndexOf(close);
  if (pos < 0) throw new Error('[CI-LIST-MAC] index style anchor missing');
  return src.slice(0, pos) + cssPatch() + '\n' + src.slice(pos);
}

function patchSources(sources) {
  if (isKnownFinalI18nState(sources.i18n)) {
    return { app: sources.app, i18n: sources.i18n, html: sources.html, noop: true };
  }
  return {
    app: patchAppSource(sources.app),
    i18n: patchI18nSource(sources.i18n),
    html: patchIndexSource(sources.html),
    noop: false
  };
}

function apply() {
  const appSrc = fs.readFileSync(APP_JS, 'utf8');
  const i18nSrc = fs.readFileSync(I18N_JS, 'utf8');
  const htmlSrc = fs.readFileSync(INDEX_HTML, 'utf8');
  const out = patchSources({ app: appSrc, i18n: i18nSrc, html: htmlSrc });
  if (out.noop) {
    console.log('[CI-LIST-MAC] payable date hotfix already materialized; no-op');
    return;
  }
  if (out.app !== appSrc) fs.writeFileSync(APP_JS, out.app, 'utf8');
  if (out.i18n !== i18nSrc) fs.writeFileSync(I18N_JS, out.i18n, 'utf8');
  if (out.html !== htmlSrc) fs.writeFileSync(INDEX_HTML, out.html, 'utf8');

  console.log('[CI-LIST-MAC] payable date column + Mac list style applied');
}

if (require.main === module) apply();
module.exports = { APP_MARKER, I18N_MARKER, CSS_MARKER, patchAppSource, patchI18nSource, patchIndexSource, patchSources, isKnownFinalI18nState, cssPatch };
