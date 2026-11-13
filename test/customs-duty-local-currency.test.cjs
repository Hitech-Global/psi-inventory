'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const start = appSource.indexOf('async function createCustomsDutyPay(ciId){');
const end = appSource.indexOf('async function saveCustomsDutyPay(ciId){', start);
assert.ok(start >= 0 && end > start, 'customs duty modal function must exist');
const functionSource = appSource.slice(start, end);

function makeHarness(options) {
  const calls = [];
  const modals = [];
  const toasts = [];
  const context = {
    api: async (url) => {
      calls.push(url);
      if (url === '/api/commercial-invoices/ci-1') return options.ci;
      if (url === '/api/countries') return options.countries;
      if (url === '/api/currencies') return options.currencies;
      throw new Error('Unexpected API: ' + url);
    },
    t: (key, fallback) => key === 'modal.body.createCustomsDutyPay'
      ? (options.translatedBody || fallback)
      : fallback,
    esc: (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch])),
    openModal: (...args) => modals.push(args),
    showToast: (...args) => toasts.push(args)
  };
  vm.runInNewContext(functionSource + '\nglobalThis.__runCustomsDutyModal = createCustomsDutyPay;', context);
  return {
    calls,
    modals,
    toasts,
    run: () => context.__runCustomsDutyModal('ci-1')
  };
}

test('customs duty modal defaults to the CI country currency and keeps active manual choices', async () => {
  const h = makeHarness({
    ci: { id: 'ci-1', country: '印度尼西亚', currency: 'USD' },
    countries: [
      { name: '印尼', code: 'ID', default_currency: 'IDR', status: 'active' },
      { name: '马来', code: 'MY', default_currency: 'MYR', status: 'active' }
    ],
    currencies: [
      { code: 'USD', status: 'active' },
      { code: 'RMB', status: 'active' },
      { code: 'IDR', status: 'active' },
      { code: 'MYR', status: 'active' },
      { code: 'THB', status: 'active' },
      { code: 'SGD', status: 'active' },
      { code: 'XXX', status: 'disabled' }
    ],
    translatedBody: '<div><label>Payee</label><select id="dut-cur"><option>USD</option><option>RMB</option></select></div>'
  });

  await h.run();

  assert.equal(h.modals.length, 1);
  const body = h.modals[0][1];
  assert.match(body, /<label>Payee<\/label>/, 'translated labels should remain intact');
  assert.match(body, /<option value="IDR" selected>IDR<\/option>/, 'country master currency should be selected');
  assert.match(body, /<option value="USD">USD<\/option>/, 'USD should remain manually selectable');
  assert.match(body, /<option value="SGD">SGD<\/option>/, 'all active currencies should remain selectable');
  assert.doesNotMatch(body, /XXX/, 'disabled currencies should not be offered');
  assert.deepEqual(h.calls.sort(), [
    '/api/commercial-invoices/ci-1',
    '/api/countries',
    '/api/currencies'
  ].sort());
  assert.equal(h.toasts.length, 0);
});

test('customs duty modal resolves legacy Malaysia country names and keeps an unlisted configured currency', async () => {
  const h = makeHarness({
    ci: { id: 'ci-1', country: '马来西亚', currency: 'USD' },
    countries: [{ name: '马来', code: 'MY', default_currency: 'MYR', status: 'active' }],
    currencies: [
      { code: 'USD', status: 'active' },
      { code: 'RMB', status: 'active' }
    ]
  });

  await h.run();

  const body = h.modals[0][1];
  assert.match(body, /<option value="MYR" selected>MYR<\/option>/, 'legacy country alias should resolve to country master');
  assert.match(body, /<option value="USD">USD<\/option>/, 'configured local currency should not remove manual alternatives');
  assert.equal(h.toasts.length, 0);
});
