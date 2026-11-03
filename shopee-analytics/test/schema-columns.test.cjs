'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const schema = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

test('a column is added to an existing table by its own statement', () => {
  // `CREATE TABLE IF NOT EXISTS` is skipped whole when the table is
  // already there, so a column written inside it never appears — and
  // nothing says so. A column added to a table that already exists has
  // to be added by a statement of its own.
  const createBlocks = [...schema.matchAll(/CREATE TABLE IF NOT EXISTS \w+ \(([\s\S]*?)\n\);/g)]
    .map(match => match[1]);
  for (const block of createBlocks) {
    assert.ok(
      !/ADD\s+COLUMN/i.test(block),
      'a column added inside CREATE TABLE IF NOT EXISTS never appears on a table that already exists',
    );
  }
});

test('the columns the code writes are declared', () => {
  // The reading of a shop's standards is written to the table; if the
  // table does not have the column, the write fails at runtime.
  assert.ok(
    /ALTER TABLE shopee_shop_health_daily\s+ADD COLUMN IF NOT EXISTS targets_json/i.test(schema),
    'the shop\'s health table must have a column for the standards',
  );
});
