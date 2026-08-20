'use strict';

/**
 * Schema Contract Tests — ci_cost_items.payable_item_id
 *
 * 确保三个 canonical schema path 一致定义：
 *   TEXT / NULLABLE / NO DEFAULT
 *
 * TEST 1: Fresh SQLite PRAGMA introspection
 * TEST 2: SQLite initDatabase idempotency (run twice)
 * TEST 3: db.js production migration contract (static)
 * TEST 4: db-pg.js fresh PG schema contract (static)
 */

const { test, describe, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

process.env.DB_DRIVER = 'sqlite';
process.env.DB_PATH = ':memory:';

const dbMod = require('./db');
const { initDatabase, getDB } = dbMod;

describe('TEST 1: Fresh SQLite — ci_cost_items.payable_item_id column', () => {
  before(() => {
    initDatabase();
  });

  test('PRAGMA table_info confirms nullable / no default', () => {
    const d = getDB();
    const cols = d.prepare('PRAGMA table_info(ci_cost_items)').all();
    const col = cols.find(c => c.name === 'payable_item_id');

    assert.ok(col, 'payable_item_id column must exist');
    assert.strictEqual(col.type, 'TEXT', 'type must be TEXT');
    assert.strictEqual(col.notnull, 0, 'must be nullable (notnull=0)');
    assert.strictEqual(col.dflt_value, null, 'must have no default value');
  });
});

describe('TEST 2: SQLite initDatabase idempotency — run twice, column stays correct', () => {
  before(() => {
    initDatabase();
    initDatabase();
  });

  test('second initDatabase() does not error, column unchanged', () => {
    const d = getDB();
    const cols = d.prepare('PRAGMA table_info(ci_cost_items)').all();
    const payableCols = cols.filter(c => c.name === 'payable_item_id');

    assert.strictEqual(payableCols.length, 1, 'exactly one payable_item_id column');
    assert.strictEqual(payableCols[0].notnull, 0, 'still nullable');
    assert.strictEqual(payableCols[0].dflt_value, null, 'still no default');
  });
});

describe('TEST 3: db.js production migration contract', () => {
  const src = fs.readFileSync(path.join(__dirname, 'db.js'), 'utf8');

  test('migrations[] contains ALTER TABLE ci_cost_items ... payable_item_id TEXT', () => {
    const match = src.match(/ALTER TABLE ci_cost_items ADD COLUMN IF NOT EXISTS payable_item_id[^\n\r]*/);
    assert.ok(match, 'db.js must contain payable_item_id migration');
    assert.ok(match[0].includes('IF NOT EXISTS'), 'must use IF NOT EXISTS');
    assert.ok(!match[0].includes('DEFAULT'), 'must NOT contain DEFAULT');
    assert.ok(!match[0].includes('NOT NULL'), 'must NOT contain NOT NULL');
  });
});

describe('TEST 4: db-pg.js fresh PG schema contract', () => {
  const src = fs.readFileSync(path.join(__dirname, 'db-pg.js'), 'utf8');

  test('db-pg.js ALTER TABLE for payable_item_id is nullable / no default', () => {
    const match = src.match(/ALTER TABLE ci_cost_items ADD COLUMN IF NOT EXISTS payable_item_id[^\n\r]*/);
    assert.ok(match, 'db-pg.js must contain payable_item_id migration');
    assert.ok(match[0].includes('IF NOT EXISTS'), 'must use IF NOT EXISTS');
    assert.ok(!match[0].includes('DEFAULT'), 'must NOT contain DEFAULT');
    assert.ok(!match[0].includes('NOT NULL'), 'must NOT contain NOT NULL');
  });
});
