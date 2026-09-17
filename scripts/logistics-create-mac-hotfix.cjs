'use strict';
const fs = require('node:fs');
const path = require('node:path');

const INDEX_HTML = path.join(__dirname, '..', 'index.html');
const MARKER = '/* LOGISTICS-CREATE-MAC-STYLE-V1 */';

function cssPatch() {
  return `
${MARKER}
/* New logistics batch flow only. Pure CSS: no API, listener, timer or render-path change. */
.modal-overlay.ci-mode:has(.modal-ci-create #npl-no),
.modal-overlay.ci-mode:has(.modal-ci-create .data-table button[onclick*="selectCIForPL"]){background:rgba(242,242,247,.86)}
.modal-overlay.ci-mode .modal-ci-create:has(#npl-no),
.modal-overlay.ci-mode .modal-ci-create:has(.data-table button[onclick*="selectCIForPL"]){background:#f5f5f7;border:1px solid rgba(0,0,0,.08);border-radius:18px;box-shadow:0 18px 48px rgba(0,0,0,.14);color:#1d1d1f}
.modal-overlay.ci-mode .modal-ci-create:has(#npl-no) .modal-header,
.modal-overlay.ci-mode .modal-ci-create:has(.data-table button[onclick*="selectCIForPL"]) .modal-header{padding:14px 20px;background:rgba(255,255,255,.96);border-bottom:.5px solid #d2d2d7;min-height:52px}
.modal-overlay.ci-mode .modal-ci-create:has(#npl-no) .modal-title,
.modal-overlay.ci-mode .modal-ci-create:has(.data-table button[onclick*="selectCIForPL"]) .modal-title{font-size:19px;font-weight:650;letter-spacing:-.2px;color:#1d1d1f}
.modal-overlay.ci-mode .modal-ci-create:has(#npl-no) .modal-close,
.modal-overlay.ci-mode .modal-ci-create:has(.data-table button[onclick*="selectCIForPL"]) .modal-close{width:30px;height:30px;padding:0;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#86868b;font-size:22px;line-height:1}
.modal-overlay.ci-mode .modal-ci-create:has(#npl-no) .modal-close:hover,
.modal-overlay.ci-mode .modal-ci-create:has(.data-table button[onclick*="selectCIForPL"]) .modal-close:hover{background:#ececef;color:#1d1d1f}
.modal-overlay.ci-mode .modal-ci-create:has(#npl-no) .modal-body,
.modal-overlay.ci-mode .modal-ci-create:has(.data-table button[onclick*="selectCIForPL"]) .modal-body{padding:18px 20px 22px;background:#f5f5f7}
.modal-overlay.ci-mode .modal-ci-create:has(#npl-no) .form-card{background:transparent!important;box-shadow:none!important}
.modal-overlay.ci-mode .modal-ci-create:has(#npl-no) .detail-section{margin:0 0 12px;background:#fff;border:1px solid #e5e5ea;border-radius:14px;padding:14px;box-shadow:none;overflow:hidden}
.modal-overlay.ci-mode .modal-ci-create:has(#npl-no) .detail-section>h3{margin:-14px -14px 14px!important;padding:11px 14px!important;background:#fbfbfd;border-bottom:1px solid #ededf0;color:#1d1d1f;font-size:14px!important;font-weight:650!important;line-height:1.35}
.modal-overlay.ci-mode .modal-ci-create:has(#npl-no) .form-grid{gap:10px 14px}
.modal-overlay.ci-mode .modal-ci-create:has(#npl-no) .form-group{margin-bottom:10px}
.modal-overlay.ci-mode .modal-ci-create:has(#npl-no) .form-group>label{display:block;margin-bottom:6px;color:#6e6e73;font-size:12px;font-weight:600}
.modal-overlay.ci-mode .modal-ci-create:has(#npl-no) input:not([type="checkbox"]):not([type="radio"]),
.modal-overlay.ci-mode .modal-ci-create:has(#npl-no) select,
.modal-overlay.ci-mode .modal-ci-create:has(#npl-no) textarea{min-height:38px;background:#fff;border:1px solid #d2d2d7;border-radius:10px;color:#1d1d1f;font-size:14px;padding:8px 11px;box-shadow:0 1px 1px rgba(0,0,0,.02)}
.modal-overlay.ci-mode .modal-ci-create:has(#npl-no) input:not([type="checkbox"]):not([type="radio"]):focus,
.modal-overlay.ci-mode .modal-ci-create:has(#npl-no) select:focus,
.modal-overlay.ci-mode .modal-ci-create:has(#npl-no) textarea:focus{outline:none;border-color:#007aff;box-shadow:0 0 0 3px rgba(0,122,255,.12)}
.modal-overlay.ci-mode .modal-ci-create:has(#npl-no) input:disabled,
.modal-overlay.ci-mode .modal-ci-create:has(#npl-no) input[readonly]{background:#f2f2f4!important;color:#6e6e73!important}
.modal-overlay.ci-mode .modal-ci-create:has(#npl-no) #npl-total-ctn{width:90px!important;min-height:30px!important;padding:4px 8px!important;margin-left:6px}
.modal-overlay.ci-mode .modal-ci-create:has(#npl-no) #pl-drop-zone{background:#fafafa!important;border:1.5px dashed #c7c7cc!important;border-radius:12px!important;padding:22px!important;color:#6e6e73}
.modal-overlay.ci-mode .modal-ci-create:has(#npl-no) #pl-drop-zone:hover{background:#f5f5f7!important;border-color:#86868b!important}
.modal-overlay.ci-mode .modal-ci-create:has(#npl-no) #ci-readonly-costs{background:#f8f8fa!important;border:1px solid #ededf0;border-radius:10px!important;padding:10px 12px!important}
.modal-overlay.ci-mode .modal-ci-create:has(#npl-no) #total-freight-display{font-weight:700;color:#1d1d1f}
.modal-overlay.ci-mode .modal-ci-create:has(#npl-no) .cc-list{background:#f8f8fa;border:1px solid #ededf0;border-radius:10px;padding:8px 10px}
.modal-overlay.ci-mode .modal-ci-create:has(#npl-no) #other-fees-list{display:grid;gap:8px;margin-top:8px}
.modal-overlay.ci-mode .modal-ci-create:has(#npl-no) #other-fees-list input,
.modal-overlay.ci-mode .modal-ci-create:has(#npl-no) #other-fees-list select{min-height:34px}
.modal-overlay.ci-mode .modal-ci-create:has(#npl-no) .table-container,
.modal-overlay.ci-mode .modal-ci-create:has(.data-table button[onclick*="selectCIForPL"]) .table-container{background:#fff;border:1px solid #e1e1e6;border-radius:12px;overflow:auto;box-shadow:none!important}
.modal-overlay.ci-mode .modal-ci-create:has(#npl-no) .data-table,
.modal-overlay.ci-mode .modal-ci-create:has(.data-table button[onclick*="selectCIForPL"]) .data-table{width:100%;margin:0!important;border-collapse:separate;border-spacing:0;background:#fff;font-size:12px}
.modal-overlay.ci-mode .modal-ci-create:has(#npl-no) .data-table th,
.modal-overlay.ci-mode .modal-ci-create:has(.data-table button[onclick*="selectCIForPL"]) .data-table th{position:sticky;top:0;z-index:2;padding:9px 10px!important;background:#f2f2f4!important;color:#6e6e73!important;font-size:12px!important;font-weight:600!important;white-space:nowrap;border-bottom:1px solid #dcdce1!important;text-align:left!important}
.modal-overlay.ci-mode .modal-ci-create:has(#npl-no) .data-table td,
.modal-overlay.ci-mode .modal-ci-create:has(.data-table button[onclick*="selectCIForPL"]) .data-table td{padding:9px 10px!important;background:#fff;color:#3a3a3c;border-bottom:1px solid #ededf0!important;vertical-align:middle;white-space:nowrap;text-align:left!important}
.modal-overlay.ci-mode .modal-ci-create:has(#npl-no) .data-table .text-right,
.modal-overlay.ci-mode .modal-ci-create:has(#npl-no) .data-table .text-center,
.modal-overlay.ci-mode .modal-ci-create:has(.data-table button[onclick*="selectCIForPL"]) .data-table .text-right,
.modal-overlay.ci-mode .modal-ci-create:has(.data-table button[onclick*="selectCIForPL"]) .data-table .text-center{ text-align:left!important}
.modal-overlay.ci-mode .modal-ci-create:has(#npl-no) .data-table tbody tr:hover td,
.modal-overlay.ci-mode .modal-ci-create:has(.data-table button[onclick*="selectCIForPL"]) .data-table tbody tr:hover td{background:#fafafa}
.modal-overlay.ci-mode .modal-ci-create:has(.data-table button[onclick*="selectCIForPL"]) .empty-state{background:#fff;border:1px solid #e5e5ea;border-radius:14px;color:#86868b;padding:36px}
.modal-overlay.ci-mode .modal-ci-create:has(#npl-no) .modal-footer,
.modal-overlay.ci-mode .modal-ci-create:has(.data-table button[onclick*="selectCIForPL"]) .modal-footer{padding:11px 20px;background:rgba(255,255,255,.97);border-top:.5px solid #d2d2d7;gap:8px}
.modal-overlay.ci-mode .modal-ci-create:has(#npl-no) .btn,
.modal-overlay.ci-mode .modal-ci-create:has(.data-table button[onclick*="selectCIForPL"]) .btn{border-radius:9px;box-shadow:none;transform:none;font-weight:600}
.modal-overlay.ci-mode .modal-ci-create:has(#npl-no) .btn-secondary,
.modal-overlay.ci-mode .modal-ci-create:has(.data-table button[onclick*="selectCIForPL"]) .btn-secondary{background:#fff;border-color:#d2d2d7;color:#1d1d1f}
.modal-overlay.ci-mode .modal-ci-create:has(#npl-no) .btn-primary,
.modal-overlay.ci-mode .modal-ci-create:has(.data-table button[onclick*="selectCIForPL"]) .btn-primary{background:#1d1d1f;border-color:#1d1d1f;color:#fff}
.modal-overlay.ci-mode .modal-ci-create:has(#npl-no) .btn-primary:hover,
.modal-overlay.ci-mode .modal-ci-create:has(.data-table button[onclick*="selectCIForPL"]) .btn-primary:hover{background:#000;border-color:#000}
.modal-overlay.ci-mode .modal-ci-create:has(#npl-no) .table-container::-webkit-scrollbar,
.modal-overlay.ci-mode .modal-ci-create:has(.data-table button[onclick*="selectCIForPL"]) .table-container::-webkit-scrollbar{width:8px;height:8px}
.modal-overlay.ci-mode .modal-ci-create:has(#npl-no) .table-container::-webkit-scrollbar-thumb,
.modal-overlay.ci-mode .modal-ci-create:has(.data-table button[onclick*="selectCIForPL"]) .table-container::-webkit-scrollbar-thumb{background:#c7c7cc;border-radius:999px;border:2px solid #fff}
`;
}

function patchIndexSource(src) {
  if (src.includes(MARKER)) return src;
  const close = '</style>';
  const pos = src.lastIndexOf(close);
  if (pos < 0) throw new Error('[LOGISTICS-CREATE-MAC] index style anchor missing');
  return src.slice(0, pos) + cssPatch() + '\n' + src.slice(pos);
}

function apply() {
  const src = fs.readFileSync(INDEX_HTML, 'utf8');
  const out = patchIndexSource(src);
  if (out !== src) fs.writeFileSync(INDEX_HTML, out, 'utf8');
  console.log('[LOGISTICS-CREATE-MAC] CSS-only create logistics Mac style applied');
}

if (require.main === module) apply();
module.exports = { MARKER, cssPatch, patchIndexSource };
