'use strict';

const assert = require('assert');
const Module = require('module');
const path = require('path');

let poolInstance = null;
class FakePool {
  constructor(config) {
    this.config = config;
    this.active = 0;
    this.maxActive = 0;
    this.calls = [];
    poolInstance = this;
  }
  on() {}
  query(sql, params) {
    this.calls.push({ sql, params });
    this.active++;
    this.maxActive = Math.max(this.maxActive, this.active);
    return new Promise(resolve => setTimeout(() => {
      this.active--;
      resolve({ rows: [{ sql, paramCount: (params || []).length }], rowCount: 1 });
    }, 15));
  }
  async end() {}
}

async function main() {
  const originalLoad = Module._load;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgres://async-read-test.invalid/psi';
  Module._load = function(request, parent, isMain) {
    if (request === 'pg') return { Pool: FakePool };
    if (request === './db-pg' && parent && path.basename(parent.filename) === 'pg-async.js') {
      return {
        _normalizeSql: sql => 'NORMALIZED ' + sql,
        _getClientConfig: () => ({ connectionString: 'postgres://async-read-test.invalid/psi' })
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const asyncDbPath = require.resolve('../pg-async');
    delete require.cache[asyncDbPath];
    const { queryAsync, queryBatchAsync, getGeneratePool } = require('../pg-async');

    const single = await queryAsync('SELECT 1 AS value', [7]);
    assert.strictEqual(single.rows[0].sql, 'NORMALIZED SELECT 1 AS value');
    assert.strictEqual(single.rows[0].paramCount, 1);

    const batch = await queryBatchAsync([
      { sql: 'SELECT 1', params: [] },
      { sql: 'SELECT 2', params: [] },
      { sql: 'SELECT 3', params: [] }
    ]);
    assert.strictEqual(batch.length, 3);
    assert.strictEqual(poolInstance.maxActive > 1, true, 'batch queries must be started concurrently');
    assert.strictEqual(getGeneratePool(), poolInstance, 'async reads must reuse the shared pool');
    assert.strictEqual(poolInstance.config.max, 2, 'async reads must retain the existing pool connection cap');

    await assert.rejects(() => queryAsync('UPDATE inventory SET available_qty = 0'), e => e && e.code === 'DB_ASYNC_READ_ONLY');
    await assert.rejects(() => queryBatchAsync(new Array(26).fill({ sql: 'SELECT 1', params: [] })), e => e && e.code === 'DB_ASYNC_BATCH_INVALID');

    console.log('pg-async-query: all tests passed');
  } finally {
    Module._load = originalLoad;
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  }
}

main().catch(err => { console.error(err); process.exitCode = 1; });
