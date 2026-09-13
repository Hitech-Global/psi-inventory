'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const M = require('../migrations/inventory-imports-latest-index');

const SCRIPT = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'create-inventory-imports-index-concurrently.cjs'), 'utf8');

test('BULK-1 index state classifier is fail-closed', () => {
  assert.equal(M.classifyPgIndexRows([]), 'missing');
  assert.equal(M.classifyPgIndexRows([{ indisvalid: true, indisready: true }]), 'ready');
  assert.equal(M.classifyPgIndexRows([{ indisvalid: false, indisready: true }]), 'unhealthy');
  assert.equal(M.classifyPgIndexRows([{ indisvalid: true, indisready: false }]), 'unhealthy');
  assert.equal(M.classifyPgIndexRows([{ indisvalid: false, indisready: false }]), 'unhealthy');
});

test('startup PG guard checks validity/readiness and refuses large/stale-low tables before CREATE INDEX', () => {
  const s = M.PG_ENSURE_SQL;
  assert.match(s, /indisvalid/i);
  assert.match(s, /indisready/i);
  assert.match(s, /RAISE EXCEPTION[\s\S]*索引 .*已存在但不可用/i);
  assert.match(s, /reltuples[\s\S]*250000/i);
  assert.match(s, /SELECT count\(\*\)::bigint FROM public\.inventory_imports/i);
  assert.match(s, /CREATE INDEX idx_inventory_imports_latest ON public\.inventory_imports/);
  assert.ok(
    s.indexOf('SELECT count(*)::bigint FROM public.inventory_imports') < s.indexOf('CREATE INDEX idx_inventory_imports_latest'),
    '精确规模复核必须发生在普通 CREATE INDEX 之前'
  );
});

test('production DDL is concurrent and schema-scoped', () => {
  assert.match(
    M.PG_CONCURRENTLY_SQL,
    /^CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inventory_imports_latest ON public\.inventory_imports /
  );
});

test('ops script rejects unhealthy index and verifies post-create valid+ready', () => {
  assert.match(SCRIPT, /classifyPgIndexRows\(exists\.rows\)/);
  assert.match(SCRIPT, /state === 'unhealthy'/);
  assert.match(SCRIPT, /DROP INDEX CONCURRENTLY IF EXISTS public\./);
  assert.match(SCRIPT, /classifyPgIndexRows\(after\.rows\)/);
  assert.match(SCRIPT, /afterState !== 'ready'/);
  assert.match(SCRIPT, /indisvalid=true, indisready=true/);
});
