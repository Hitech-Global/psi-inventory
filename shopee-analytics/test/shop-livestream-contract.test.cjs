'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const srcDir = path.join(__dirname, '..', 'src');
const schemaPath = path.join(__dirname, '..', 'schema.sql');

test('the livestream endpoint is registered against the principal role', () => {
  const catalog = fs.readFileSync(path.join(srcDir, 'catalog.js'), 'utf8');
  assert.ok(
    catalog.includes("shopLivestreamPerformance: { app: 'BRAND_PORTAL'"),
    'the endpoint must belong to the Brand Portal role',
  );
  assert.ok(
    catalog.includes('/api/v2/principal/get_shop_livestream_performance'),
    'the endpoint path must be the principal livestream one',
  );
});

test('the livestream figures have somewhere to live', () => {
  const schema = fs.readFileSync(schemaPath, 'utf8');
  assert.ok(schema.includes('CREATE TABLE IF NOT EXISTS shopee_shop_livestream_daily'), 'a table must exist');
  for (const column of ['live_sessions', 'live_hours', 'live_views', 'live_viewers', 'confirmed_orders', 'confirmed_sales']) {
    assert.ok(schema.includes(column), `${column} must be a column`);
  }
});

test('the daily cycle and the backfill both reach the livestream figures', () => {
  const runner = fs.readFileSync(path.join(srcDir, 'shop-sync-runner.js'), 'utf8');
  const backfill = fs.readFileSync(path.join(srcDir, 'backfill-runner.js'), 'utf8');
  assert.ok(runner.includes('shop-livestream-yesterday'), 'the daily cycle must fetch them');
  assert.ok(backfill.includes('BACKFILL_SHOP_LIVESTREAM'), 'the backfill must fetch them');
});

test('the repository writes the figures', () => {
  const repository = fs.readFileSync(path.join(srcDir, 'shop-livestream-repository.js'), 'utf8');
  assert.ok(repository.includes('shopee_shop_livestream_daily'), 'the repository must write to the table');
  assert.ok(repository.includes('ON CONFLICT'), 'the repository must be safe to run twice');
});
