'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const APP = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function extractFunction(name) {
  const re = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(');
  const match = re.exec(APP);
  assert.ok(match, 'production function must exist: ' + name);
  const open = APP.indexOf('{', match.index);
  let depth = 0;
  let quote = null;
  let lineComment = false;
  let blockComment = false;
  let end = open;
  for (; end < APP.length; end++) {
    const ch = APP[end];
    const next = APP[end + 1];
    if (lineComment) {
      if (ch === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === '*' && next === '/') { blockComment = false; end++; }
      continue;
    }
    if (quote) {
      if (ch === '\\') { end++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; end++; continue; }
    if (ch === '/' && next === '*') { blockComment = true; end++; continue; }
    if (ch === "'" || ch === '"' || ch === '\`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  assert.ok(end < APP.length, 'production function must be balanced: ' + name);
  return APP.slice(match.index, end + 1);
}

const saveStart = APP.indexOf('function rpGetSaveState(channel, rid){');
const saveEnd = APP.indexOf('// 页面卸载兜底：keepalive 尽力发送尚未确认的手工作业', saveStart);
assert.ok(saveStart >= 0 && saveEnd > saveStart, 'manual save pipeline source boundaries must exist');
const SAVE_PIPELINE = APP.slice(saveStart, saveEnd);

function serverResponse(value, revision) {
  return {
    success: true,
    stale: false,
    data: {
      id: 'row-1',
      online_suggested_qty: value,
      offline_suggested_qty: 2,
      suggested_qty: value + 2,
      online_write_seq: revision,
      offline_write_seq: 0,
      recalc_revision: 0
    }
  };
}

function makeSaveHarness(api, options = {}) {
  const row = {
    id: 'row-1',
    online_suggested_qty: 1,
    offline_suggested_qty: 2,
    suggested_qty: 3,
    online_write_seq: 0,
    offline_write_seq: 0,
    recalc_revision: 0,
    _serverRevOnline: 0,
    _serverRevOffline: 0,
    _serverRecalc: 0,
    _channelC: {
      online: { suggestedQty: 1 },
      offline: { suggestedQty: 2 }
    }
  };
  const channelData = { online: { 'row-1': row }, offline: { 'row-1': row } };
  if (options.missingChannel) delete channelData[options.missingChannel]['row-1'];
  const window = {
    _rpChannelData: channelData,
    _rpManualStock: { online: {}, offline: {} },
    _rpSnapshot: {
      status: options.snapshotStatus || 'ready',
      rows: options.snapshotRows === false ? [] : [row]
    }
  };
  const context = {
    window,
    sessionStorage: { setItem() {}, removeItem() {} },
    api,
    rpSetManualStock(channel, rid, value) {
      window._rpManualStock[channel][rid] = value;
    },
    rpPatchSnapshotRow(data) {
      const snapshot = window._rpSnapshot;
      if (!snapshot || snapshot.status !== 'ready') return false;
      const target = (snapshot.rows || []).find(item => String(item.id) === String(data.id));
      if (!target) return false;
      Object.assign(target, data);
      return true;
    },
    async rpEnsureSnapshotReady() {
      if (window._rpSnapshot.status !== 'ready') {
        window._rpSnapshot.status = 'ready';
        if (options.hydrateRowOnEnsure && !window._rpSnapshot.rows.length) {
          window._rpSnapshot.rows.push(row);
        }
      }
      return window._rpSnapshot.status === 'ready';
    },
    rpGetChannelC: (channel, current) => current._channelC[channel],
    rpClearDataCache() {},
    rpInvalidateSuggestionViews() {},
    clearTimeout() {},
    setTimeout() { return 1; },
    console
  };
  vm.createContext(context);
  vm.runInContext(SAVE_PIPELINE, context);
  return { context, row, window };
}

test('drain waits for the latest coalesced edit before declaring the save complete', async () => {
  let resolveFirst;
  const calls = [];
  const h = makeSaveHarness((_url, _method, body) => {
    calls.push(body);
    if (calls.length === 1) return new Promise(resolve => { resolveFirst = resolve; });
    return Promise.resolve(serverResponse(body.online_suggested_qty, 2));
  });

  const state = h.context.rpGetSaveState('online', 'row-1');
  state.pending = 5;
  const draining = h.context.rpDrainAllPending();

  await Promise.resolve();
  assert.equal(calls.length, 1, 'first save should be in flight');

  state.pending = 8;
  h.context.rpSetManualStock('online', 'row-1', 8);
  resolveFirst(serverResponse(5, 1));

  assert.equal(await draining, true);
  assert.deepEqual(calls.map(call => call.online_suggested_qty), [5, 8]);
  assert.equal(calls[1].expected_online_write_seq, 1, 'the retry must use the latest server revision');
  assert.equal(h.row.online_suggested_qty, 8);
  assert.equal(h.row.suggested_qty, 10);
  assert.equal(state.pending, null);
  assert.equal(state.failed, false);
});

test('cross-channel pending save uses the full snapshot when its channel cache is not loaded', async () => {
  const calls = [];
  const h = makeSaveHarness((_url, _method, body) => {
    calls.push(body);
    return Promise.resolve({
      success: true,
      stale: false,
      data: {
        id: 'row-1',
        online_suggested_qty: 1,
        offline_suggested_qty: 6,
        suggested_qty: 7,
        online_write_seq: 0,
        offline_write_seq: 1,
        recalc_revision: 0
      }
    });
  }, { missingChannel: 'offline' });

  const state = h.context.rpGetSaveState('offline', 'row-1');
  state.pending = 6;

  assert.equal(await h.context.rpDrainAllPending(), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].expected_offline_write_seq, 0);
  assert.equal(h.row.offline_suggested_qty, 6);
  assert.equal(state.pending, null);
  assert.equal(state.failed, false);
});

test('journal replay waits for snapshot hydration before sending the CAS write', async () => {
  const calls = [];
  const h = makeSaveHarness((_url, _method, body) => {
    calls.push(body);
    return Promise.resolve({
      success: true,
      stale: false,
      data: {
        id: 'row-1',
        online_suggested_qty: 1,
        offline_suggested_qty: 6,
        suggested_qty: 7,
        online_write_seq: 0,
        offline_write_seq: 8,
        recalc_revision: 3
      }
    });
  }, {
    missingChannel: 'offline',
    snapshotStatus: 'loading',
    snapshotRows: false,
    hydrateRowOnEnsure: true
  });

  h.row._serverRevOffline = undefined;
  h.row._serverRecalc = undefined;
  h.row.offline_write_seq = 7;
  h.row.recalc_revision = 3;

  const state = h.context.rpGetSaveState('offline', 'row-1');
  state.journal = { baseRecalcRevision: 3 };
  state.pending = 6;

  assert.equal(await h.context.rpDrainAllPending(), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].expected_offline_write_seq, 7);
  assert.equal(calls[0].expected_recalc_revision, 3);
  assert.equal(state.pending, null);
  assert.equal(state.failed, false);
  assert.equal(h.window._rpSnapshot.status, 'ready');
});

test('a confirmed server save is not marked failed when the snapshot has not hydrated yet', async () => {
  const calls = [];
  const h = makeSaveHarness((_url, _method, body) => {
    calls.push(body);
    return Promise.resolve({
      success: true,
      stale: false,
      data: {
        id: 'row-1',
        online_suggested_qty: 1,
        offline_suggested_qty: 6,
        suggested_qty: 7,
        online_write_seq: 0,
        offline_write_seq: 5,
        recalc_revision: 3
      }
    });
  }, { missingChannel: 'offline', snapshotStatus: 'loading', snapshotRows: false });

  const state = h.context.rpGetSaveState('offline', 'row-1');
  state.serverRevOffline = 4;
  state.serverRecalc = 3;
  state.journal = { baseRecalcRevision: 3 };
  state.pending = 6;

  assert.equal(await h.context.rpDrainAllPending(), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].expected_offline_write_seq, 4);
  assert.equal(calls[0].expected_recalc_revision, 3);
  assert.equal(state.pending, null);
  assert.equal(state.failed, false);
  assert.equal(state.serverRevOffline, 5);
  assert.equal(state.serverRecalc, 3);
});

test('a failed save stays pending, does not retry forever, and can be retried explicitly', async () => {
  let calls = 0;
  const h = makeSaveHarness(() => {
    calls++;
    if (calls === 1) return Promise.reject(new Error('network unavailable'));
    return Promise.resolve(serverResponse(4, 1));
  });

  const state = h.context.rpGetSaveState('online', 'row-1');
  state.pending = 4;

  assert.equal(await h.context.rpDrainAllPending(), false);
  assert.equal(calls, 1, 'one failed value must not start an automatic retry loop');
  assert.equal(state.pending, 4, 'the failed value must remain available for retry');
  assert.equal(state.failed, true);

  assert.equal(await h.context.rpDrainAllPending(), true);
  assert.equal(calls, 2, 'a new explicit drain retries the pending value once');
  assert.equal(state.pending, null);
  assert.equal(state.failed, false);
  assert.equal(h.row.online_suggested_qty, 4);
});

test('manual quantity change only shows saved feedback after the server confirms it', async () => {
  const feedback = [];
  const context = {
    window: { _rpChannelData: { online: {}, offline: {} } },
    rpIsRecalcInFlight: () => false,
    rpGetSaveState: () => ({ timer: null, pending: null, failed: false }),
    clearTimeout() {},
    rpSetManualStock() {},
    rpWriteJournal() {},
    rpGetChannelC: () => null,
    rpActiveContainer: () => null,
    document: { querySelector: () => null },
    rpDrainOne: async () => false,
    showRpAutoSaved: () => feedback.push('saved'),
    showRpSaveFailed: () => feedback.push('failed')
  };
  vm.createContext(context);
  vm.runInContext(extractFunction('onChannelTargetStockChange'), context);

  const input = {
    dataset: { rid: 'row-1', channel: 'online' },
    value: '9',
    closest: () => null
  };
  await context.onChannelTargetStockChange(input);
  assert.deepEqual(feedback, ['failed']);
});

test('tab and mode switches are blocked when pending manual saves cannot be confirmed', async () => {
  const messages = [];
  let drains = 0;
  const context = {
    window: { _rpCache: { views: {} } },
    rpTab: 'total',
    rpMode: 'monthly',
    performance: { now: () => 1 },
    getLang: () => 'zh',
    rpDrainAllPending: async () => { drains++; return false; },
    showToast: (message, type) => messages.push({ message, type })
  };
  vm.createContext(context);
  vm.runInContext([
    extractFunction('rpEnsurePendingSavesBeforeViewChange'),
    extractFunction('switchRpTab'),
    extractFunction('switchRpMode')
  ].join(String.fromCharCode(10)), context);

  await context.switchRpTab('online');
  await context.switchRpMode('daily');

  assert.equal(context.rpTab, 'total');
  assert.equal(context.rpMode, 'monthly');
  assert.equal(drains, 2);
  assert.equal(messages.length, 2);
  assert.ok(messages.every(item => item.type === 'danger'));
});

test('all user-driven forecast view and filter changes pass through the save gate', () => {
  for (const name of [
    'onRpCountryChange',
    'onRpBrandChange',
    'onRpFilterChange',
    'onRpWarehouseChange',
    'onRpSearchSubmit',
    'resetRpFilters',
    'switchRpTab',
    'switchRpMode'
  ]) {
    assert.match(extractFunction(name), /rpEnsurePendingSavesBeforeViewChange/);
  }
});

console.log('rp-manual-suggested-qty-save: regression coverage loaded');
