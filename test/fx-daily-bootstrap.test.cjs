'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseProviderDataDate, patchServerSource } = require('../scripts/fx-daily-bootstrap.cjs');

test('provider RFC-1123 UTC date is preserved', () => {
  assert.equal(
    parseProviderDataDate({ time_last_update_utc: 'Sun, 13 Sep 2026 00:02:31 +0000' }, '2026-09-13'),
    '2026-09-13'
  );
});

test('yesterday provider snapshot stays yesterday instead of being stamped today', () => {
  assert.equal(
    parseProviderDataDate({ time_last_update_utc: 'Sat, 12 Sep 2026 23:59:59 +0000' }, '2026-09-13'),
    '2026-09-12'
  );
});

test('missing, invalid, or future provider date fails closed', () => {
  assert.equal(parseProviderDataDate({}, '2026-09-13'), null);
  assert.equal(parseProviderDataDate({ time_last_update_utc: 'not-a-date' }, '2026-09-13'), null);
  assert.equal(
    parseProviderDataDate({ time_last_update_utc: 'Mon, 14 Sep 2026 00:02:31 +0000' }, '2026-09-13'),
    null
  );
});

test('bootstrap transforms the current server source and isolates inventory FX reads', () => {
  const serverPath = path.resolve(__dirname, '..', 'server.js');
  const original = fs.readFileSync(serverPath, 'utf8');
  const patched = patchServerSource(original);

  assert.notEqual(patched, original);
  assert.match(patched, /function getInventoryProviderDataDate\(data, today\)/);
  assert.match(patched, /date: dataDate, source: 'realtime'/);
  assert.match(patched, /providerDataDate \|\| today/);
  assert.match(patched, /id NOT LIKE 'fxauto_%'/);
  assert.match(patched, /rate_date = \? AND rate_type = 'realtime' AND id LIKE 'rate_%'/);
  assert.doesNotMatch(patched, /refreshed\[curr\] = Math\.round\(foreignToRmb \* 1000000\) \/ 1000000/);
});
