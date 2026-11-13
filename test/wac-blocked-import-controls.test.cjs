'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'assets', 'wac-blocked-import-controls.js'), 'utf8');

function boot(preview) {
  const button = { disabled: false, textContent: '' };
  const sectionChildren = [];
  const blocker = {
    textContent: 'PRODUCT_FX_FREIGHT_PAYMENT_MISSING WAC_INVENTORY_CONTEXT_MISMATCH',
    insertAdjacentElement(position, element) {
      assert.equal(position, 'afterend');
      sectionChildren.push(element);
    }
  };
  const formCard = {
    // Combined logistics/WAC view prepends logistics and PL detail before WAC's
    // batch info and red blocker panel; import controls must still follow blockers.
    children: [
      { className: 'logistics-detail', textContent: 'Logistics detail' },
      { className: 'pl-detail', textContent: 'PL detail' },
      { className: 'batch-info', textContent: 'Batch info' },
      blocker
    ],
    lastElementChild: blocker,
    querySelector(selector) {
      if (selector !== '.wac-blocked-import-section') return null;
      return sectionChildren.find(item => item.className === 'wac-blocked-import-section') || null;
    },
    appendChild(element) { sectionChildren.push(element); }
  };
  const document = {
    readyState: 'complete',
    documentElement: {},
    getElementById(id) { return id === 'wac-confirm-btn' ? button : null; },
    querySelector(selector) { return selector === '#modal-content .form-card' ? formCard : null; },
    createElement() { return { className: '', style: {}, innerHTML: '' }; }
  };
  class FakeMutationObserver {
    constructor(callback) { this.callback = callback; }
    observe() {}
  }
  const window = {
    document,
    MutationObserver: FakeMutationObserver,
    _wacPreview: preview,
    _wacImport: { uploaded: false, matched: [], missing: [], unknown: [], duplicate: [], invalid: [] },
    getLang: () => 'zh',
    t: (_key, fallback) => fallback,
    wacValidateInputs() { button.disabled = false; }
  };
  vm.runInNewContext(source, { window });
  return { window, button, formCard, sectionChildren };
}

const blocked = boot({
  meta: { already_confirmed: false },
  blockers: [{ code: 'PRODUCT_FX_FREIGHT_PAYMENT_MISSING' }],
  items: [{ sku_code: 'SKU-A', batch_qty: 12 }]
});
const section = blocked.formCard.querySelector('.wac-blocked-import-section');
assert.ok(section, 'blocked WAC modal should still show the old-stock import section');
assert.equal(blocked.sectionChildren[0], section,
  'old-stock import controls must be inserted after the blocker panel even when logistics details are prepended');
assert.match(section.innerHTML, /onclick="importWacOldInventory\(\)"/);
assert.match(section.innerHTML, /onclick="exportWacOldInventoryTemplate\(\)"/);
assert.match(section.innerHTML, /id="wac-old-0"/);
assert.match(section.innerHTML, /id="wac-old-value-0"/);
assert.equal(blocked.button.disabled, true, 'server-side blockers must keep Confirm disabled');
blocked.window.wacValidateInputs();
assert.equal(blocked.button.disabled, true, 'import validation must not unlock Confirm while blockers remain');

const clear = boot({
  meta: { already_confirmed: false },
  blockers: [],
  items: [{ sku_code: 'SKU-A', batch_qty: 12 }]
});
assert.equal(clear.formCard.querySelector('.wac-blocked-import-section'), null,
  'normal unblocked WAC modal should keep its existing full import table');
clear.window.wacValidateInputs();
assert.equal(clear.button.disabled, false, 'the blocker guard must not interfere when there are no blockers');

const historical = boot({
  meta: { already_confirmed: true },
  blockers: [{ code: 'historical-read-only' }],
  items: [{ sku_code: 'SKU-A', batch_qty: 12 }]
});
assert.equal(historical.formCard.querySelector('.wac-blocked-import-section'), null,
  'confirmed historical WAC remains read-only');

console.log('wac-blocked-import-controls: PASS');
