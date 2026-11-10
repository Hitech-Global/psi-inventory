'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function extractShowPage(source) {
  const start = source.indexOf('function showPage(page){');
  assert.notEqual(start, -1, 'showPage must exist');
  const end = source.indexOf('\n}\n', start);
  assert.notEqual(end, -1, 'showPage must have a top-level closing brace');
  return source.slice(start, end + 2);
}

function runNavigationWithModal(mode) {
  const classes = new Set(['show', ...(mode ? [mode] : [])]);
  const overlay = {
    classList: {
      contains(name) { return classes.has(name); },
      remove(...names) { names.forEach(name => classes.delete(name)); },
      add(...names) { names.forEach(name => classes.add(name)); }
    }
  };
  const content = { innerHTML: '' };
  let closeCount = 0;
  let submitCount = 0;
  let inventoryRenderCount = 0;

  const context = {
    NAV_MODULES: [],
    PAGE_TO_MODULE: { inventory: 'inventory' },
    currentPage: 'inbound',
    currentModule: 'inventory',
    hasPermission: () => true,
    showToast: () => {},
    t: (_key, fallback) => fallback,
    closeModal: () => {
      closeCount += 1;
      overlay.classList.remove('show', 'ci-mode', 'ci-sb-collapsed', 'wac-mode', 'wac-sb-collapsed');
    },
    submitWacConfirm: () => { submitCount += 1; },
    renderInventory: () => { inventoryRenderCount += 1; },
    document: {
      getElementById(id) {
        if (id === 'modal-overlay') return overlay;
        if (id === 'content-inner') return content;
        return null;
      },
      querySelectorAll() { return []; }
    }
  };

  [
    'renderDashboard','renderSKUs','renderConsignment','renderOutbound','renderReplenishment',
    'renderStagnant','renderCheck','renderPO','renderPI','renderCI','renderInbound',
    'renderWacHistoryMatrix','renderCost','renderPayment','renderPayableCockpit',
    'renderPayableList','renderForwarderAnalysis','renderLogisticsDecision','renderCountries',
    'renderWarehouses','renderSuppliers','renderFreightForwarders','renderCurrencies',
    'renderConfig','renderPaymentTerms','renderApprovalFlows','renderApprovalCenter',
    'renderExpenseTypes','renderAllocationRules','renderUsers','renderRoles','renderBatchTasks',
    'renderBrandSettings','renderOperationLogs','renderPaymentCategories','renderPayerEntities',
    'renderTopNav','renderSidebar'
  ].forEach(name => { context[name] = context[name] || (() => {}); });

  vm.runInNewContext(extractShowPage(appSource) + '\n;globalThis.__showPage = showPage;', context);
  context.__showPage('inventory');

  return {
    closeCount,
    submitCount,
    inventoryRenderCount,
    modalStillOpen: classes.has('show'),
    modeStillPresent: mode ? classes.has(mode) : false
  };
}

test('switching pages closes the WAC confirmation modal without confirming WAC', () => {
  const result = runNavigationWithModal('wac-mode');
  assert.equal(result.closeCount, 1);
  assert.equal(result.modalStillOpen, false);
  assert.equal(result.modeStillPresent, false);
  assert.equal(result.submitCount, 0, 'navigation must never submit/confirm WAC');
  assert.equal(result.inventoryRenderCount, 1, 'the destination page must still render');
});

test('switching pages continues to close the existing CI page modal', () => {
  const result = runNavigationWithModal('ci-mode');
  assert.equal(result.closeCount, 1);
  assert.equal(result.modalStillOpen, false);
  assert.equal(result.submitCount, 0);
  assert.equal(result.inventoryRenderCount, 1);
});

test('switching pages does not close unrelated generic modals', () => {
  const result = runNavigationWithModal(null);
  assert.equal(result.closeCount, 0);
  assert.equal(result.modalStillOpen, true);
  assert.equal(result.inventoryRenderCount, 1);
});
