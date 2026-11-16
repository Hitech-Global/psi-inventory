'use strict';

const assert = require('node:assert/strict');
const { MARKER, patchDbSource } = require('../scripts/payment-minor-bigint-hotfix.cjs');

const fixture = [
  "const migrations = [",
  "        // PAY-CORE：payable_items 后续新增列迁移。",
  "        \"ALTER TABLE payable_items ADD COLUMN IF NOT EXISTS source_ci_id TEXT NOT NULL DEFAULT ''\"",
  "      ];"
].join('\n');

const patched = patchDbSource(fixture);
assert.equal((patched.match(new RegExp(MARKER, 'g')) || []).length, 1);
for (const column of [
  'payable_amount_minor',
  'requested_amount_minor',
  'paid_amount_minor',
  'allocated_amount_minor'
]) {
  assert.ok(patched.includes(column), 'missing migration for ' + column);
}
assert.ok(patched.includes('TYPE BIGINT'));
assert.equal(patchDbSource(patched), patched, 'patch must be idempotent');
assert.throws(() => patchDbSource('const migrations = [];'), /marker missing/);
assert.throws(() => patchDbSource(fixture + '\n' + fixture), /marker duplicated/);
new Function(patched); // the injected migration must leave db.js syntactically valid

console.log('PAY-MINOR-BIGINT-HOTFIX tests passed');
