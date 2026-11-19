'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'assets/ci-summary-compact.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const vm = require('node:vm');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

const rendererStart = app.indexOf('function renderPurchaseAmountSummary(operationalData,historicalData){');
const rendererEnd = app.indexOf('\n}', rendererStart) + 2;
assert.ok(rendererStart >= 0 && rendererEnd > rendererStart, 'CI purchase summary renderer must exist');

const renderContext = {
  summary: {
    operationalRows: [
      {
        ci_status: 'completed', currency: 'RMB', goods_amount: 999.5,
        balance_paid_amount: 100, actual_deducted_deposit: 20,
        balance_deduction_amount: 10, balance_rounding_amount: 0.2,
        balance_unpaid_amount: 869.3
      },
      {
        ci_status: 'completed', currency: 'USD', goods_amount: 12,
        balance_paid_amount: 5, actual_deducted_deposit: 0,
        balance_deduction_amount: 0, balance_rounding_amount: 0,
        balance_unpaid_amount: 7
      }
    ],
    historicalRows: [{
      currency: 'RMB', gross_goods_amount: 888,
      historical_paid_amount: 50, subsequent_paid_amount: 100,
      deduction_amount: 30, rounding_amount: 0.3, unpaid_amount: 707.7
    }],
    rmb_note: 'This explanatory note must not appear in the total card.'
  },
  t: (key, fallback) => fallback,
  esc: value => String(value)
};
vm.runInNewContext(app.slice(rendererStart, rendererEnd) + '\nresult = renderPurchaseAmountSummary(summary);', renderContext);
const renderedSummary = renderContext.result;
assert.equal((renderedSummary.match(/class="stat-card"/g) || []).length, 3, 'procurement summary must render total, paid and unpaid cards');
assert.match(renderedSummary, /采购金额合计/);
assert.match(renderedSummary, /RMB 1,887\.50/);
assert.match(renderedSummary, /USD 12\.00/);
assert.match(renderedSummary, /3 张；人民币待补 1 张/);
assert.match(renderedSummary, /已付款总金额/);
assert.match(renderedSummary, /现金付款金额：RMB 250\.00/);
assert.match(renderedSummary, /抵扣：RMB 60\.00/);
assert.match(renderedSummary, /抹零：RMB 0\.50/);
assert.match(renderedSummary, /剩余未付款总金额/);
assert.match(renderedSummary, /RMB 1,577\.00/);
assert.match(renderedSummary, /USD 7\.00/);
assert.doesNotMatch(renderedSummary, /运营采购金额|历史采购金额|采购金额合计（按币种）/);
assert.doesNotMatch(renderedSummary, /This explanatory note/);


assert.match(script, /运营采购金额/);
assert.match(script, /历史采购金额/);
assert.match(script, /采购金额合计/);
assert.match(script, /Total Procurement Amount by Currency/);
assert.match(script, /Total Purchase Amount/);
assert.match(script, /matchesLabelText/);
assert.match(script, /characterData: true/);
assert.match(script, /Historical Purchase Amount/);
assert.match(script, /Operational Purchase Amount/);
assert.match(script, /psi-ci-summary-hidden/);
assert.match(script, /psi-ci-summary-total/);
assert.match(script, /psi-ci-summary-note-hidden/);
assert.match(script, /仅原币为/);
assert.match(script, /跨币种裸加/);
assert.match(script, /other currencies without explicit exchange/);
assert.match(script, /MutationObserver/);
assert.match(script, /getBoundingClientRect/);
assert.match(html, /assets\/ci-summary-compact\.js\?v=/);

// The display-only adapter must not rewrite financial amounts or replace page markup.
assert.doesNotMatch(script, /\.innerHTML\s*=/);
assert.doesNotMatch(script, /(?:node|card|labelNode|descendants\[[^\]]+\])\.textContent\s*=/);
assert.doesNotMatch(script, /\.innerText\s*=/);
assert.doesNotMatch(script, /fetch\s*\(/);
assert.doesNotMatch(script, /XMLHttpRequest/);


const adapterContext = {};
let adapterMarkup = [
  '<div class="stats-grid mb-16">',
  '<div class="stat-card"><div class="stat-number" style="font-size:17px">RMB 5,304,702.08 · USD 218,692.65</div><div>31 张</div></div>',
  '<div class="stat-card"><div class="stat-number" style="font-size:17px">RMB 5,059,922.16 · USD 218,692.65</div><div>',
  '<div>现金付款金额：RMB 4,823,711.23 · USD 218,692.65</div>',
  '<div>抵扣：RMB 236,207.41 · USD 0.00</div>',
  '<div>抹零：RMB 3.52 · USD 0.00</div>',
  '</div></div>',
  '<div class="stat-card"><div class="stat-number" style="font-size:17px">RMB 174,564.42 · USD 0.00</div></div>',
  '</div>'
].join('');
adapterContext.renderPurchaseAmountSummary = () => adapterMarkup;
adapterContext.window = adapterContext;
vm.runInNewContext(script, {
  window: adapterContext,
  document: { readyState: 'loading', addEventListener: () => {} }
});
const formattedSummary = adapterContext.renderPurchaseAmountSummary();
assert.match(formattedSummary, /RMB 5,304,702\.08<br>USD 218,692\.65/);
assert.match(formattedSummary, /RMB 5,059,922\.16<br>USD 218,692\.65/);
assert.match(formattedSummary, /现金付款金额：RMB 4,823,711\.23<br>USD 218,692\.65/);
assert.match(formattedSummary, /抵扣：RMB 236,207\.41<br>USD 0\.00/);
assert.match(formattedSummary, /抹零：RMB 3\.52<br>USD 0\.00/);
assert.match(formattedSummary, /class="stat-number" style="font-size:17px">RMB 174,564\.42<\/div>/);
assert.doesNotMatch(formattedSummary, /RMB 174,564\.42<br>USD 0\.00/);

adapterMarkup = '<div class="stat-card"><div class="stat-number">RMB 1.00</div></div>' +
  '<div class="stat-card"><div class="stat-number">RMB 1.00</div></div>' +
  '<div class="stat-card"><div class="stat-number">USD 0.00</div></div>';
const zeroOnlyUnpaid = adapterContext.renderPurchaseAmountSummary();
assert.match(zeroOnlyUnpaid, /class="stat-number">—<\/div>/);
assert.doesNotMatch(zeroOnlyUnpaid, /USD 0\.00/);
assert.match(script, /CI-SUMMARY-CURRENCY-LINES-20261119/);
assert.match(script, /installCurrencyLineRenderer/);

console.log('CI compact procurement summary source contract: PASS');
