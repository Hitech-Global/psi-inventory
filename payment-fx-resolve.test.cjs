'use strict';

/**
 * Payment FX Resolve — Targeted Tests (TEST 1-12)
 *
 * Helper-level (1-8, 10-11): resolvePaymentFxRate, exactSettlementRate, buildPaymentRateSnapshot
 * Route-level (9, 12): POST /api/payment-requests/:id/payment-fx/resolve
 *
 * Tests:
 *   1) DB direct exact hit → provider 0 calls
 *   2) DB reverse exact hit → reciprocal → provider 0 calls
 *   3) DB miss → provider exact-date hit → cache → return correct rate
 *   4) Repeat resolve same pair/date → exchange_rates auto-cache only 1 row
 *   5) Duplicate auto-resolve insert → deterministic id → no duplicates
 *   6) Provider response date != requested → blocker → DB 0 insert
 *   7) Provider timeout via AbortSignal → blocker → DB 0 insert
 *   8) Goods payment → not blocked by FX resolver
 *   9) Route-level: freight PR + paid_date → resolve returns rate/local_amount
 *   10) Formal settlement → only reads DB exact rate → does not call provider
 *   11) rate_date strict validation → rejects non-canonical / invalid dates
 *   12) Permission gate → 403 without payment_approve/execute, 200 with
 */

const { test, describe, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');

process.env.DB_DRIVER = 'sqlite';
process.env.DB_PATH = ':memory:';

const dbMod = require('./db');
const { query, queryOne, run, genId, initDatabase, getDB } = dbMod;
const serverMod = require('./server');
const { resolvePaymentFxRate, exactSettlementRate, buildPaymentRateSnapshot, isValidRateDate, app } = serverMod;

// ── Helpers ──

function resetDB() {
  const d = getDB();
  d.pragma('foreign_keys = OFF');
  d.exec(`
    DELETE FROM exchange_rates;
    DELETE FROM payment_request_items;
    DELETE FROM payment_requests;
    DELETE FROM ci_cost_items;
    DELETE FROM payable_items;
    DELETE FROM logistics_batches;
    DELETE FROM commercial_invoices;
  `);
  d.pragma('foreign_keys = ON');
}

function seedRate(from, to, date, rate, type) {
  run('INSERT INTO exchange_rates (id, from_currency, to_currency, rate, rate_date, rate_type) VALUES (?, ?, ?, ?, ?, ?)',
    ['rate_' + from + '_' + to + '_' + date + '_' + (type || 'realtime'), from, to, rate, date, type || 'realtime']);
}

function countRates(from, to, date, type) {
  var row = queryOne('SELECT COUNT(*) AS cnt FROM exchange_rates WHERE from_currency=? AND to_currency=? AND rate_date=? AND rate_type=?', [from, to, date, type || 'realtime']);
  return Number(row.cnt);
}

function httpRequest(port, method, pathStr, body, cookie) {
  return new Promise((resolve, reject) => {
    var opts = { hostname: '127.0.0.1', port, method, path: pathStr, headers: {} };
    if (cookie) opts.headers.Cookie = cookie;
    var data = body ? JSON.stringify(body) : null;
    if (data) { opts.headers['Content-Type'] = 'application/json'; opts.headers['Content-Length'] = Buffer.byteLength(data); }
    var req = http.request(opts, (res) => {
      var chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        var raw = Buffer.concat(chunks).toString();
        var json = null;
        try { json = JSON.parse(raw); } catch (_) {}
        resolve({ status: res.statusCode, json, raw });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function createTestSession(userId) {
  var token = crypto.randomBytes(32).toString('hex');
  var tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  var now = new Date().toISOString();
  var expires = new Date(Date.now() + 3600000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
  run('INSERT INTO sessions (id, token_hash, user_id, created_at, expires_at, user_agent, ip_address) VALUES (?,?,?,?,?,?,?)',
    [genId('sess'), tokenHash, userId, now, expires, '', '']);
  return 'session_token=' + token;
}

function seedFreightPR(id, opts) {
  opts = opts || {};
  run('INSERT INTO payment_requests (id, request_no, payment_category, currency, payable_amount, payment_status, approval_status, expense_country, payee_key, payee_name_snapshot) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, opts.requestNo || 'PR-FX-001', 'freight', opts.currency || 'RMB', opts.amount || 13601, 'approved', 'approved', opts.expenseCountry || '印尼', 'supplier:test', 'Test Supplier']);
}

// ── Setup ──

var httpServer, httpPort, adminCookie, noPermCookie;

before(() => {
  initDatabase();

  // Create test users for route-level tests
  var noPermRole = queryOne("SELECT * FROM roles WHERE id = 'role_viewer'");
  if (noPermRole) {
    run("INSERT INTO users (id, username, name, password, role_id, status, auth_source, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ['user_noperm_fx', 'noperm_fx', 'No Perm FX', '', 'role_viewer', 'active', 'local', '']);
  }

  // Admin user already exists (user_admin with role_admin)
  adminCookie = createTestSession('user_admin');
  noPermCookie = createTestSession('user_noperm_fx');

  // Start HTTP server
  httpServer = http.createServer(app);
  httpServer.listen(0);
  httpPort = httpServer.address().port;
});

after(() => {
  if (httpServer) httpServer.close();
});

// ── Tests ──

describe('Payment FX Resolve', () => {

  beforeEach(() => resetDB());

  test('TEST 1 — DB direct exact hit → provider 0 calls', async () => {
    seedRate('RMB', 'IDR', '2026-08-10', 2633.36);
    var callCount = 0;
    var origFetch = global.fetch;
    global.fetch = async () => { callCount++; return { ok: false, json: async () => ({}) }; };

    var result = await resolvePaymentFxRate({ fromCurrency: 'RMB', toCurrency: 'IDR', rateDate: '2026-08-10' });

    global.fetch = origFetch;
    assert.equal(result.rate, 2633.36);
    assert.equal(result.source, 'db_direct');
    assert.equal(callCount, 0, 'provider must not be called when DB has exact rate');
  });

  test('TEST 2 — DB reverse exact hit → reciprocal → provider 0 calls', async () => {
    seedRate('IDR', 'RMB', '2026-08-10', 0.00038);
    var callCount = 0;
    var origFetch = global.fetch;
    global.fetch = async () => { callCount++; return { ok: false, json: async () => ({}) }; };

    var result = await resolvePaymentFxRate({ fromCurrency: 'RMB', toCurrency: 'IDR', rateDate: '2026-08-10' });

    global.fetch = origFetch;
    assert.ok(Math.abs(result.rate - (1 / 0.00038)) < 0.01);
    assert.equal(result.source, 'db_reverse');
    assert.equal(callCount, 0, 'provider must not be called when DB has reverse rate');
  });

  test('TEST 3 — DB miss → provider exact-date hit → cache → return correct rate', async () => {
    var origFetch = global.fetch;
    global.fetch = async function(url) {
      assert.ok(url.includes('2026-08-10'), 'URL must contain exact date');
      assert.ok(url.includes('CNY'), 'URL must use CNY for RMB');
      return {
        ok: true,
        json: async () => ({
          amount: 1.0,
          base: 'CNY',
          date: '2026-08-10',
          rates: { IDR: 2633.36 }
        })
      };
    };

    var result = await resolvePaymentFxRate({ fromCurrency: 'RMB', toCurrency: 'IDR', rateDate: '2026-08-10' });

    global.fetch = origFetch;
    assert.equal(result.rate, 2633.36);
    assert.equal(result.source, 'provider_cached');
    assert.equal(countRates('RMB', 'IDR', '2026-08-10'), 1, 'must cache provider result in DB');
  });

  test('TEST 4 — Repeat resolve same pair/date → exchange_rates auto-cache only 1 row', async () => {
    var origFetch = global.fetch;
    var callCount = 0;
    global.fetch = async function() {
      callCount++;
      return {
        ok: true,
        json: async () => ({
          amount: 1.0,
          base: 'CNY',
          date: '2026-08-10',
          rates: { IDR: 2633.36 }
        })
      };
    };

    await resolvePaymentFxRate({ fromCurrency: 'RMB', toCurrency: 'IDR', rateDate: '2026-08-10' });
    global.fetch = origFetch;

    // Second call — should hit DB (db_direct), not provider
    callCount = 0;
    global.fetch = async () => { callCount++; return { ok: false, json: async () => ({}) }; };
    var result = await resolvePaymentFxRate({ fromCurrency: 'RMB', toCurrency: 'IDR', rateDate: '2026-08-10' });
    global.fetch = origFetch;

    assert.equal(result.source, 'db_direct');
    assert.equal(callCount, 0, 'second resolve must hit DB, not provider');
    assert.equal(countRates('RMB', 'IDR', '2026-08-10'), 1, 'only 1 cached row');
  });

  test('TEST 5 — Duplicate auto-resolve insert → deterministic id → no duplicates', async () => {
    var origFetch = global.fetch;
    global.fetch = async function() {
      return {
        ok: true,
        json: async () => ({
          amount: 1.0,
          base: 'CNY',
          date: '2026-08-10',
          rates: { IDR: 2633.36 }
        })
      };
    };

    // First resolve — inserts auto-cache row
    await resolvePaymentFxRate({ fromCurrency: 'RMB', toCurrency: 'IDR', rateDate: '2026-08-10' });

    // Simulate concurrent insert with same deterministic id
    try {
      run('INSERT INTO exchange_rates (id, from_currency, to_currency, rate, rate_date, rate_type) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING',
        ['fxauto_2026-08-10_RMB_IDR_realtime', 'RMB', 'IDR', 9999, '2026-08-10', 'realtime']);
    } catch (e) { /* expected conflict */ }
    global.fetch = origFetch;

    // Count rows with the deterministic id
    var row = queryOne("SELECT COUNT(*) AS cnt FROM exchange_rates WHERE id = 'fxauto_2026-08-10_RMB_IDR_realtime'");
    assert.equal(Number(row.cnt), 1, 'deterministic id must prevent duplicate');

    // Total auto-cached rows for this pair/date
    assert.equal(countRates('RMB', 'IDR', '2026-08-10'), 1);

    // Verify the cached rate is the original provider rate, not 9999
    var cached = queryOne("SELECT rate FROM exchange_rates WHERE id = 'fxauto_2026-08-10_RMB_IDR_realtime'");
    assert.equal(Number(cached.rate), 2633.36, 'concurrent insert must not overwrite original rate');
  });

  test('TEST 6 — Provider response date != requested → blocker → DB 0 insert', async () => {
    var origFetch = global.fetch;
    global.fetch = async function() {
      // Simulate weekend fallback: requested 2026-08-09, provider returns 2026-08-07
      return {
        ok: true,
        json: async () => ({
          amount: 1.0,
          base: 'CNY',
          date: '2026-08-07',
          rates: { IDR: 2644.73 }
        })
      };
    };

    await assert.rejects(
      resolvePaymentFxRate({ fromCurrency: 'RMB', toCurrency: 'IDR', rateDate: '2026-08-09' }),
      (err) => err.status === 400 && /缺少.*2026-08-09/.test(err.message)
    );
    global.fetch = origFetch;

    assert.equal(countRates('RMB', 'IDR', '2026-08-09'), 0, 'must not cache mismatched date');
  });

  test('TEST 7 — Provider timeout via AbortSignal → blocker → DB 0 insert', async () => {
    var origFetch = global.fetch;
    // Mock fetch that hangs — AbortSignal.timeout will abort it
    global.fetch = async function(url, opts) {
      assert.ok(opts && opts.signal, 'fetch must be called with a signal');
      // Verify the signal is an AbortSignal with timeout
      assert.ok(opts.signal.aborted !== undefined, 'signal must be an AbortSignal');
      // Simulate network delay longer than timeout — the abort will fire
      return new Promise((_, reject) => {
        var timer = setTimeout(() => { /* never resolves normally */ }, 30000);
        if (opts.signal) {
          opts.signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('The operation was aborted'));
          });
        }
      });
    };

    // Use 50ms timeout — fast enough for test, real enough to exercise abort path
    await assert.rejects(
      resolvePaymentFxRate({ fromCurrency: 'RMB', toCurrency: 'IDR', rateDate: '2026-08-10', timeoutMs: 50 }),
      (err) => err.status === 400 && /缺少.*realtime 付款汇率/.test(err.message)
    );
    global.fetch = origFetch;

    assert.equal(countRates('RMB', 'IDR', '2026-08-10'), 0, 'must not cache on provider timeout');
  });

  test('TEST 8 — Goods payment → not blocked by FX resolver', async () => {
    // buildPaymentRateSnapshot for goods must return empty snapshot without calling provider
    var goodsPayment = {
      payment_category: 'goods',
      currency: 'USD',
      request_no: 'PR-GOODS-001',
      expense_country: '印尼'
    };

    var callCount = 0;
    var origFetch = global.fetch;
    global.fetch = async () => { callCount++; return { ok: false, json: async () => ({}) }; };

    var snapshot = await buildPaymentRateSnapshot(goodsPayment, 10000, '2026-08-10');

    global.fetch = origFetch;
    assert.equal(callCount, 0, 'goods payment must never call provider');
    assert.equal(snapshot.local_rate, 0);
    assert.equal(snapshot.local_amount, 0);
    assert.equal(snapshot.rmb_rate, 0);
    assert.equal(snapshot.rmb_amount, 0);
    assert.equal(snapshot.local_currency, '');
    assert.equal(snapshot.settlement_country, '');
  });

  test('TEST 9 — Route-level: freight PR + paid_date → resolve returns rate/local_amount', async () => {
    // Seed a freight payment request
    seedFreightPR('pr_fx_test_01', { amount: 13601, currency: 'RMB' });

    var origFetch = global.fetch;
    global.fetch = async function(url) {
      assert.ok(url.includes('2026-08-10'));
      assert.ok(url.includes('CNY'));
      return {
        ok: true,
        json: async () => ({
          amount: 1.0,
          base: 'CNY',
          date: '2026-08-10',
          rates: { IDR: 2633.36 }
        })
      };
    };

    var res = await httpRequest(httpPort, 'POST', '/api/payment-requests/pr_fx_test_01/payment-fx/resolve',
      { rate_date: '2026-08-10' }, adminCookie);

    global.fetch = origFetch;

    // Route-level contract: PR lookup, goods branch, country resolution, response shape
    assert.equal(res.status, 200, 'should return 200 for valid freight PR');
    assert.ok(res.json, 'response must be JSON');
    assert.equal(res.json.original_currency, 'RMB', 'server resolves original currency from PR');
    assert.equal(res.json.original_amount, 13601, 'server resolves original amount from PR');
    assert.equal(res.json.local_currency, 'IDR', 'server resolves settlement country currency');
    assert.equal(res.json.rate, 2633.36, 'rate from provider');
    assert.equal(res.json.rate_date, '2026-08-10', 'rate date matches requested date');

    // local_amount must equal original_amount × rate, rounded to 2 decimal places
    var expectedLocalAmount = Math.round(13601 * 2633.36 * 100) / 100;
    assert.equal(res.json.local_amount, expectedLocalAmount, 'local_amount = original_amount × rate');
  });

  test('TEST 10 — Formal settlement → only reads DB exact rate → does not call provider', () => {
    var callCount = 0;
    var origFetch = global.fetch;
    global.fetch = async () => { callCount++; return { ok: false, json: async () => ({}) }; };

    // 1. DB has exact rate → returns it
    seedRate('RMB', 'IDR', '2026-08-10', 2633.36);
    var result = exactSettlementRate('RMB', 'IDR', '2026-08-10');
    assert.equal(result.rate, 2633.36);
    assert.equal(result.direction, 'direct');
    assert.equal(callCount, 0, 'exactSettlementRate must never call provider');

    // 2. DB miss → throws SettlementError
    assert.throws(
      () => exactSettlementRate('RMB', 'IDR', '2026-08-11'),
      (err) => err.status === 400 && /缺少.*2026-08-11/.test(err.message)
    );
    assert.equal(callCount, 0, 'exactSettlementRate must never call provider even on miss');

    // 3. Reverse hit works too
    seedRate('IDR', 'RMB', '2026-08-10', 0.00038);
    var revResult = exactSettlementRate('RMB', 'IDR', '2026-08-10');
    assert.equal(revResult.direction, 'direct', 'direct takes priority over reverse');
    assert.equal(callCount, 0);

    global.fetch = origFetch;
  });

  test('TEST 11 — rate_date strict validation → rejects non-canonical / invalid dates', async () => {
    // Helper-level: isValidRateDate
    assert.ok(isValidRateDate('2026-08-10'), 'canonical YYYY-MM-DD accepted');
    assert.ok(!isValidRateDate('2026/08/10'), 'slashes rejected');
    assert.ok(!isValidRateDate('2026-8-10'), 'single-digit month rejected');
    assert.ok(!isValidRateDate('abc'), 'non-date rejected');
    assert.ok(!isValidRateDate(''), 'empty rejected');
    assert.ok(!isValidRateDate('2026-02-31'), 'invalid calendar date rejected');
    assert.ok(!isValidRateDate('2026-13-01'), 'invalid month rejected');
    assert.ok(!isValidRateDate('2026-00-10'), 'month 0 rejected');

    // Route-level: invalid rate_date → 400 before provider call
    var origFetch = global.fetch;
    var callCount = 0;
    global.fetch = async () => { callCount++; return { ok: false, json: async () => ({}) }; };

    var res = await httpRequest(httpPort, 'POST', '/api/payment-requests/pr_fx_test_01/payment-fx/resolve',
      { rate_date: '2026/08/10' }, adminCookie);
    global.fetch = origFetch;

    assert.equal(res.status, 400, 'invalid format must return 400');
    assert.ok(res.json && res.json.error.includes('rate_date'), 'error mentions rate_date');
    assert.equal(callCount, 0, 'provider must not be called for invalid rate_date');
  });

  test('TEST 12 — Permission gate → 403 without payment_approve/execute, 200 with', async () => {
    // Seed a freight PR for this test
    seedFreightPR('pr_fx_perm_01', { amount: 5000, currency: 'RMB' });

    var origFetch = global.fetch;
    global.fetch = async function() {
      return {
        ok: true,
        json: async () => ({
          amount: 1.0, base: 'CNY', date: '2026-08-10', rates: { IDR: 2633.36 }
        })
      };
    };

    // User without payment_approve/execute permission → 403
    var res403 = await httpRequest(httpPort, 'POST', '/api/payment-requests/pr_fx_perm_01/payment-fx/resolve',
      { rate_date: '2026-08-10' }, noPermCookie);
    assert.equal(res403.status, 403, 'user without payment permission must get 403');

    // User with payment_approve permission (admin) → 200
    var res200 = await httpRequest(httpPort, 'POST', '/api/payment-requests/pr_fx_perm_01/payment-fx/resolve',
      { rate_date: '2026-08-10' }, adminCookie);
    assert.equal(res200.status, 200, 'user with payment_approve must get 200');
    assert.ok(res200.json.rate > 0, 'response must contain a valid rate');

    global.fetch = origFetch;
  });

});
