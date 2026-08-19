/**
 * Gate 1 / D ordering invariant micro-test (no DB, no server boot).
 * Replicates the EXACT response/finish/refresh pattern now in server.js PI PUT
 * and proves the causal ordering:
 *   commit (T1) -> response finish (T2) -> refresh start (T3) -> refresh done/err (T4)
 *
 * Uses deterministic execution-order FLAGS (not wall-clock) so sub-ms gaps
 * cannot produce false failures. Wall-clock printed only as informational.
 *
 * Mirrors the real server.js structure, including:
 *   updateInventoryTransitData().catch(err => console.error(...))  // log only, NEVER rethrow
 *
 * This validates the *pattern semantics* only. Full route integration (A/B/C/E)
 * requires a live PostgreSQL (DB_DRIVER=pg) and lives in test-pi-put-p0.cjs.
 */
const assert = require('assert');

function makeFakeRes() {
  const listeners = {};
  let jsonPayload = null;
  let statusCode = 200;
  return {
    status(code) { statusCode = code; return this; },
    // Real Express flushes asynchronously, so finish fires on a later tick.
    json(payload) { jsonPayload = payload; setImmediate(() => this._emit('finish')); return this; },
    once(evt, cb) { (listeners[evt] = listeners[evt] || []).push(cb); },
    _emit(evt) { (listeners[evt] || []).forEach(cb => cb()); },
    _getStatus() { return statusCode; },
    _getJson() { return jsonPayload; }
  };
}

// Mirrors the EXACT pattern in server.js PI PUT (P0-B + Gate 1 fix):
//   res.status(200).json({...});
//   res.once('finish', () => { if (!invAffectingChanged) return;
//     setImmediate(() => { updateInventoryTransitData().catch(err => logOnly); }); });
function piPutPattern(res, invAffectingChanged, refreshFn, flags) {
  flags.committedBeforeResponse = true;          // T1 done
  res.status(200).json({ success: true, id: 'HIT20260717-1C', total_amount: 44460.44 });
  res.once('finish', () => {
    flags.responseFinished = true;               // T2
    if (!invAffectingChanged) return;
    setImmediate(() => {
      flags.refreshStarted = true;               // T3 -- MUST be after responseFinished
      assert(flags.responseFinished === true, 'refresh started BEFORE response finish (T2<T3 violated)');
      assert(flags.committedBeforeResponse === true, 'refresh started before commit (T1<=T2 violated)');
      // mirror: updateInventoryTransitData().catch(err => console.error(...))  -> log only
      Promise.resolve().then(refreshFn).then(() => {
        flags.refreshDone = true;                // T4 (success path)
      }).catch((e) => {
        flags.refreshErrored = true;             // T4 (error path) -- must NOT rethrow
      });
    });
  });
}

function runCase(label, invAffectingChanged, refreshDelayMs, refreshThrows) {
  return new Promise((resolve, reject) => {
    const flags = { committedBeforeResponse: false, responseFinished: false, refreshStarted: false, refreshDone: false, refreshErrored: false };
    const res = makeFakeRes();
    const refreshFn = () => new Promise((resolve2, reject2) => {
      setTimeout(() => {
        if (refreshThrows) reject2(new Error('simulated refresh failure'));
        else resolve2();
      }, refreshDelayMs);
    });
    try {
      piPutPattern(res, invAffectingChanged, refreshFn, flags);
    } catch (e) { return reject(e); }

    setTimeout(() => {
      try {
        assert(res._getStatus() === 200 && res._getJson().success === true, 'response must be 200 success');
        assert(flags.responseFinished === true, 'response finish never fired');
        if (invAffectingChanged) {
          assert(flags.refreshStarted === true, 'refresh not scheduled when invAffectingChanged');
          if (refreshThrows) {
            assert(flags.refreshErrored === true, 'refresh error was not caught by .catch');
            assert(flags.refreshDone === false, 'refresh should not be "done" on error path');
          } else {
            assert(flags.refreshDone === true, 'refresh did not complete');
          }
        } else {
          assert(flags.refreshStarted === false, 'refresh wrongly scheduled when !invAffectingChanged');
        }
        console.log(`  PASS [${label}] invAffectingChanged=${invAffectingChanged} delay=${refreshDelayMs}ms throws=${refreshThrows} -> 200/success, ordering enforced, error handled`);
        resolve();
      } catch (e) { reject(e); }
    }, refreshDelayMs + 50);
  });
}

(async () => {
  // Trap any leaked unhandled rejection from the test itself (should be none).
  process.on('unhandledRejection', (e) => {
    console.error('\nUNEXPECTED unhandledRejection in test harness:', e && e.message);
    process.exit(1);
  });
  try {
    await runCase('fast-refresh', true, 5, false);
    await runCase('slow-refresh', true, 200, false);   // simulates DB-SYNC blocking refresh
    await runCase('throwing-refresh', true, 5, true);  // .catch must swallow, no unhandledRejection
    await runCase('no-refresh', false, 5, false);
    console.log('\nGate 1 ordering invariant: PASS (causal ordering T1<=T2<T3<=T4 proven via execution flags)');
  } catch (e) {
    console.error('\nGate 1 ordering invariant: FAIL ->', e.message);
    process.exit(1);
  }
})();
