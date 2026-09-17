'use strict';
const fs = require('node:fs');
const path = require('node:path');

const INDEX_HTML = path.join(__dirname, '..', 'index.html');
const MARKER = '/* CI-DETAIL-MAC-STYLE-V1 */';

function cssPatch() {
  return `
${MARKER}
/* Operational CI detail only. Pure CSS: no API, listener, timer or render-path change. */
.modal-overlay.ci-mode:has(.modal-ci-create #ci-acc-items){background:rgba(242,242,247,.86)}
.modal-overlay.ci-mode .modal-ci-create:has(#ci-acc-items){background:#f5f5f7;border:1px solid rgba(0,0,0,.08);border-radius:18px;box-shadow:0 18px 48px rgba(0,0,0,.14);color:#1d1d1f}
.modal-overlay.ci-mode .modal-ci-create:has(#ci-acc-items) .modal-header{padding:14px 20px;background:rgba(255,255,255,.96);border-bottom:.5px solid #d2d2d7;min-height:52px}
.modal-overlay.ci-mode .modal-ci-create:has(#ci-acc-items) .modal-title{font-size:19px;font-weight:650;letter-spacing:-.2px;color:#1d1d1f}
.modal-overlay.ci-mode .modal-ci-create:has(#ci-acc-items) .modal-close{width:30px;height:30px;padding:0;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#86868b;font-size:22px;line-height:1}
.modal-overlay.ci-mode .modal-ci-create:has(#ci-acc-items) .modal-close:hover{background:#ececef;color:#1d1d1f}
.modal-overlay.ci-mode .modal-ci-create:has(#ci-acc-items) .modal-body{padding:18px 20px 22px;background:#f5f5f7}
.modal-overlay.ci-mode .modal-ci-create:has(#ci-acc-items) .detail-card{background:#fff!important;border:1px solid #e5e5ea!important;border-radius:14px!important;padding:16px!important;box-shadow:none!important;margin-bottom:12px}
.modal-overlay.ci-mode .modal-ci-create:has(#ci-acc-items) .detail-grid{gap:10px 12px}
.modal-overlay.ci-mode .modal-ci-create:has(#ci-acc-items) .detail-item{min-width:0;padding:10px 12px;background:#f8f8fa;border:1px solid #ededf0;border-radius:10px}
.modal-overlay.ci-mode .modal-ci-create:has(#ci-acc-items) .detail-label{display:block;margin-bottom:4px;color:#6e6e73;font-size:11px;font-weight:600;letter-spacing:.01em}
.modal-overlay.ci-mode .modal-ci-create:has(#ci-acc-items) .detail-value{display:block;color:#1d1d1f;font-size:13px;font-weight:550;line-height:1.45;overflow-wrap:anywhere}
.modal-overlay.ci-mode .modal-ci-create:has(#ci-acc-items) .detail-section,
.modal-overlay.ci-mode .modal-ci-create:has(#ci-acc-items) .ci-acc{margin-top:12px;background:#fff;border:1px solid #e5e5ea;border-radius:14px;box-shadow:none;overflow:hidden}
.modal-overlay.ci-mode .modal-ci-create:has(#ci-acc-items) .detail-section>h3,
.modal-overlay.ci-mode .modal-ci-create:has(#ci-acc-items) .ci-acc-head{margin:0!important;padding:12px 14px!important;background:#fff;color:#1d1d1f;font-size:14px!important;font-weight:650!important;line-height:1.3;border-bottom:1px solid transparent}
.modal-overlay.ci-mode .modal-ci-create:has(#ci-acc-items) .ci-acc-head:hover{background:#f8f8fa}
.modal-overlay.ci-mode .modal-ci-create:has(#ci-acc-items) .ci-acc-caret{display:inline-block;width:14px;color:#86868b;font-size:11px}
.modal-overlay.ci-mode .modal-ci-create:has(#ci-acc-items) .ci-acc-count{color:#86868b;font-weight:500}
.modal-overlay.ci-mode .modal-ci-create:has(#ci-acc-items) .ci-acc-body:not([hidden]){padding:0 12px 12px;border-top:1px solid #ededf0}
.modal-overlay.ci-mode .modal-ci-create:has(#ci-acc-items) .table-container{margin-top:10px;background:#fff;border:1px solid #e1e1e6;border-radius:12px;overflow:auto;box-shadow:none!important}
.modal-overlay.ci-mode .modal-ci-create:has(#ci-acc-items) .data-table{width:100%;margin:0!important;border-collapse:separate;border-spacing:0;background:#fff;font-size:12px}
.modal-overlay.ci-mode .modal-ci-create:has(#ci-acc-items) .data-table th{position:sticky;top:0;z-index:2;padding:8px 10px!important;background:#f2f2f4!important;color:#6e6e73!important;font-size:12px!important;font-weight:600!important;white-space:nowrap;border-bottom:1px solid #dcdce1!important;text-align:left!important}
.modal-overlay.ci-mode .modal-ci-create:has(#ci-acc-items) .data-table td{padding:8px 10px!important;background:#fff;color:#3a3a3c;border-bottom:1px solid #ededf0!important;vertical-align:middle;white-space:nowrap;text-align:left!important}
.modal-overlay.ci-mode .modal-ci-create:has(#ci-acc-items) .data-table tbody tr:last-child td{border-bottom:none!important}
.modal-overlay.ci-mode .modal-ci-create:has(#ci-acc-items) .data-table tbody tr:hover td{background:#fafafa}
.modal-overlay.ci-mode .modal-ci-create:has(#ci-acc-items) .data-table .text-right,
.modal-overlay.ci-mode .modal-ci-create:has(#ci-acc-items) .data-table .text-center,
.modal-overlay.ci-mode .modal-ci-create:has(#ci-acc-items) .data-table .cell-id,
.modal-overlay.ci-mode .modal-ci-create:has(#ci-acc-items) .data-table .cell-date,
.modal-overlay.ci-mode .modal-ci-create:has(#ci-acc-items) .data-table .cell-actions{ text-align:left!important}
.modal-overlay.ci-mode .modal-ci-create:has(#ci-acc-items) .table-container::-webkit-scrollbar{width:8px;height:8px}
.modal-overlay.ci-mode .modal-ci-create:has(#ci-acc-items) .table-container::-webkit-scrollbar-thumb{background:#c7c7cc;border-radius:999px;border:2px solid #fff}
.modal-overlay.ci-mode .modal-ci-create:has(#ci-acc-items) .empty-state{color:#86868b;background:#fafafa;border-radius:10px}
.modal-overlay.ci-mode .modal-ci-create:has(#ci-acc-items) .modal-footer{padding:11px 20px;background:rgba(255,255,255,.97);border-top:.5px solid #d2d2d7;gap:8px}
.modal-overlay.ci-mode .modal-ci-create:has(#ci-acc-items) .modal-footer .btn,
.modal-overlay.ci-mode .modal-ci-create:has(#ci-acc-items) .ci-edit-entry{min-height:34px;border-radius:9px;padding:6px 13px;font-size:13px;font-weight:600;box-shadow:none;transform:none}
.modal-overlay.ci-mode .modal-ci-create:has(#ci-acc-items) .btn-secondary{background:#fff;border-color:#d2d2d7;color:#1d1d1f}
.modal-overlay.ci-mode .modal-ci-create:has(#ci-acc-items) .btn-primary{background:#1d1d1f;border-color:#1d1d1f;color:#fff}
.modal-overlay.ci-mode .modal-ci-create:has(#ci-acc-items) .btn-primary:hover{background:#000;border-color:#000}
`;
}

function patchIndexSource(src) {
  if (src.includes(MARKER)) return src;
  const close = '</style>';
  const pos = src.lastIndexOf(close);
  if (pos < 0) throw new Error('[CI-DETAIL-MAC] index style anchor missing');
  return src.slice(0, pos) + cssPatch() + '\n' + src.slice(pos);
}

function apply() {
  const src = fs.readFileSync(INDEX_HTML, 'utf8');
  const out = patchIndexSource(src);
  if (out !== src) fs.writeFileSync(INDEX_HTML, out, 'utf8');
  console.log('[CI-DETAIL-MAC] CSS-only CI detail style + left alignment applied');
}

if (require.main === module) apply();
module.exports = { MARKER, cssPatch, patchIndexSource };
