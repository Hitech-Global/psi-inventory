'use strict';

const assert = require('assert');
const { analyticsPgConfig } = require('../src/pg');

assert.deepStrictEqual(
  analyticsPgConfig({ SHOPEE_ANALYTICS_DATABASE_URL: 'postgres://example' }),
  { connectionString: 'postgres://example' },
);

assert.deepStrictEqual(
  analyticsPgConfig({
    SHOPEE_ANALYTICS_PGHOST: 'postgres',
    SHOPEE_ANALYTICS_PGPORT: '5432',
    SHOPEE_ANALYTICS_PGDATABASE: 'shopee_analytics',
    SHOPEE_ANALYTICS_PGUSER: 'shopee',
    SHOPEE_ANALYTICS_PGPASSWORD: 'secret',
  }),
  {
    host: 'postgres',
    port: 5432,
    database: 'shopee_analytics',
    user: 'shopee',
    password: 'secret',
  },
);

assert.throws(
  () => analyticsPgConfig({ DATABASE_URL: 'postgres://must-not-be-used' }),
  /existing inventory DATABASE_URL is never used implicitly/,
);

console.log('shopee PostgreSQL config tests: ok');
