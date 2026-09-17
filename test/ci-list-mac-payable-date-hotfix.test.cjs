'use strict';
const assert = require('node:assert/strict');
const {
  APP_MARKER,
  I18N_MARKER,
  CSS_MARKER,
  patchAppSource,
  patchI18nSource,
  patchIndexSource
} = require('../scripts/ci-list-mac-payable-date-hotfix.cjs');

const appFixture = `
function renderOperationalCITable(data){
  return '<table><thead><tr><th>已付定金</th><th>应付尾款</th><th>已付尾款</th><th>尾款状态</th></tr></thead><tbody>'+
    data.map(c=>'<tr><td class="text-right">'+fmtMoney(c.actual_deducted_deposit)+'</td><td class="text-right">'+fmtMoney(c.balance_unpaid_amount)+'</td><td class="text-right">'+fmtMoney(c.balance_paid_amount)+'</td><td>'+c.balance_payment_status+'</td></tr>').join('')+
    '</tbody></table>';
}
`;
const appOnce = patchAppSource(appFixture);
const appTwice = patchAppSource(appOnce);
assert.equal(appTwice, appOnce, 'app patch must be idempotent');
assert.match(appOnce, /CI-LIST-PAYABLE-DATE-V1/);
assert.match(appOnce, /应付尾款<\/th><th>应付日期<\/th><th>已付尾款/, 'payable date header must be immediately after payable balance');
assert.match(appOnce, /balance_unpaid_amount[\s\S]*fmtDate\(c\.payable_date\)[\s\S]*balance_paid_amount/, 'payable date cell must be between unpaid and paid balance');
assert.ok(appOnce.includes("fmtDate(c.payable_date)||'—'"), 'empty payable date must render em dash');

const i18nFixture = `
  I18N.dict.en["gen.L5761.2"] = "<th>Payable Balance</th><th>Diff</th>";
  I18N.dict.id["gen.L5761.2"] = "<th>Sisa yang Harus Dibayar</th><th>Selisih</th>";
`;
const i18nOnce = patchI18nSource(i18nFixture);
const i18nTwice = patchI18nSource(i18nOnce);
assert.equal(i18nTwice, i18nOnce, 'i18n patch must be idempotent');
assert.match(i18nOnce, /CI-LIST-PAYABLE-DATE-I18N-V1/);
assert.match(i18nOnce, /Payable Balance<\/th><th>Payable Date<\/th><th>Diff/);
assert.match(i18nOnce, /Sisa yang Harus Dibayar<\/th><th>Tanggal Jatuh Tempo<\/th><th>Selisih/);

const html = '<!doctype html><html><head><style>.base{color:#111}</style></head><body></body></html>';
const htmlOnce = patchIndexSource(html);
const htmlTwice = patchIndexSource(htmlOnce);
assert.equal(htmlTwice, htmlOnce, 'CSS patch must be idempotent');
assert.match(htmlOnce, /CI-LIST-MAC-STYLE-V1/);
assert.match(htmlOnce, /\.content-inner:has\(#ci-source-mode\) \.filter-bar/, 'Mac style must be scoped to CI list page');
assert.match(htmlOnce, /#ci-table \.table-container\{[^}]*border-radius:12px!important/s, 'CI table must use rounded Mac card styling');
assert.match(htmlOnce, /#ci-purchase-summary \.stat-card/, 'purchase summary cards must be restyled');
assert.doesNotMatch(htmlOnce.slice(htmlOnce.indexOf(CSS_MARKER)), /addEventListener|setTimeout|setInterval|fetch\(|api\(/, 'CSS patch must add no runtime/network work');

console.log('ci-list-mac-payable-date hotfix: PASS');
