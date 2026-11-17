'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'assets/ci-summary-compact.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const vm = require('node:vm');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

const rendererStart = app.indexOf('function renderPurchaseAmountSummary(summary){');
const rendererEnd = app.indexOf('\n}', rendererStart) + 2;
assert.ok(rendererStart >= 0 && rendererEnd > rendererStart, 'CI purchase summary renderer must exist');

const renderContext = {
  summary: {
    operational: { by_currency: [{ currency: 'RMB', amount: 999 }], count: 1, rmb_pending_count: 0 },
    historical: { by_currency: [{ currency: 'RMB', amount: 888 }], count: 1, rmb_pending_count: 0 },
    total: {
      by_currency: [{ currency: 'RMB', amount: 1887.5 }, { currency: 'USD', amount: 12 }],
      count: 8,
      rmb_pending_count: 2
    },
    rmb_note: 'This explanatory note must not appear in the total card.'
  },
  t: (key, fallback) => fallback,
  esc: value => String(value)
};
vm.runInNewContext(app.slice(rendererStart, rendererEnd) + '\nresult = renderPurchaseAmountSummary(summary);', renderContext);
const renderedSummary = renderContext.result;
assert.equal((renderedSummary.match(/class="stat-card"/g) || []).length, 1, 'only one procurement summary card should be rendered');
assert.match(renderedSummary, /采购金额合计/);
assert.match(renderedSummary, /RMB 1,887\.50/);
assert.match(renderedSummary, /USD 12\.00/);
assert.match(renderedSummary, /8 张；人民币待补 2 张/);
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

console.log('CI compact procurement summary source contract: PASS');
