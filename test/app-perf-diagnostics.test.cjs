'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app-perf.js'), 'utf8');

function createBrowser({ search = '', localPerf = null } = {}) {
  const listeners = Object.create(null);
  const logs = [];
  const storage = Object.create(null);
  if (localPerf != null) storage.psi_perf = String(localPerf);

  const sandbox = {
    location: { search, href: 'https://psi-inventory.onrender.com/' },
    localStorage: {
      getItem(key) { return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null; },
      setItem(key, value) { storage[key] = String(value); },
      removeItem(key) { delete storage[key]; }
    },
    console: {
      log(...args) { logs.push(args); },
      groupCollapsed(...args) { logs.push(args); },
      table(...args) { logs.push(args); },
      groupEnd() {}
    },
    addEventListener(name, callback) {
      (listeners[name] || (listeners[name] = [])).push(callback);
    },
    setTimeout,
    clearTimeout
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'app-perf.js' });

  return {
    sandbox,
    logs,
    fireDOMContentLoaded() {
      (listeners.DOMContentLoaded || []).forEach((callback) => callback());
    }
  };
}

test('diagnostics are disabled by default and do not wrap application functions', () => {
  const browser = createBrowser();
  const originalShowPage = function () {};
  const originalApi = async function () { return { ok: true }; };
  browser.sandbox.showPage = originalShowPage;
  browser.sandbox.api = originalApi;
  browser.sandbox.renderInventory = async function () {};
  browser.fireDOMContentLoaded();

  assert.equal(browser.sandbox.PSIPerfDiagnostics.enabled, false);
  assert.equal(browser.sandbox.showPage, originalShowPage);
  assert.equal(browser.sandbox.api, originalApi);
  assert.equal(browser.sandbox.PSIPerfDiagnostics.snapshot().pageCoverage.installed, 0);
  assert.deepEqual(browser.sandbox.PSIPerfDiagnostics.snapshot().pageRender, []);
});

test('query opt-in records page render, navigation, and API timings without query data', async () => {
  const browser = createBrowser({ search: '?perf=1' });
  const win = browser.sandbox;
  win.api = async function () {
    await Promise.resolve();
    return { ok: true };
  };
  win.renderInventory = async function () {
    await win.api('/api/inventory?country=ID&keyword=private-search-term');
  };
  win.showPage = function (page) {
    win.currentPage = page;
    return win.renderInventory();
  };
  browser.fireDOMContentLoaded();

  await win.showPage('inventory');
  const report = win.PSIPerfDiagnostics.snapshot();

  assert.equal(report.enabled, true);
  assert.equal(report.pageCoverage.configured, 37);
  assert.equal(report.pageCoverage.installed, 1);
  assert.equal(report.pageRender.length, 1);
  assert.equal(report.pageRender[0].key, 'inventory');
  assert.equal(report.navigation[0].key, 'inventory');
  assert.equal(report.apiByRoute.length, 1);
  assert.equal(report.apiByRoute[0].key, 'GET /api/inventory');
  assert.equal(report.apiByPage[0].key, 'inventory');
  assert.equal(JSON.stringify(report).includes('private-search-term'), false);
  assert.equal(JSON.stringify(report).includes('country=ID'), false);
});

test('failed page render and API calls are counted and errors still propagate', async () => {
  const browser = createBrowser({ localPerf: '1' });
  const win = browser.sandbox;
  win.api = async function () {
    throw new Error('expected test failure');
  };
  win.renderInventory = async function () {
    await win.api('/api/inventory');
  };
  win.showPage = function (page) {
    win.currentPage = page;
    return win.renderInventory();
  };
  browser.fireDOMContentLoaded();

  await assert.rejects(win.showPage('inventory'), /expected test failure/);
  const report = win.PSIPerfDiagnostics.snapshot();

  assert.equal(report.pageRender[0].errors, 1);
  assert.equal(report.apiByRoute[0].errors, 1);
  assert.equal(report.apiByPage[0].errors, 1);
});
