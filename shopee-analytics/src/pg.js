'use strict';

const { Pool } = require('pg');

function analyticsPgConfig(env = process.env) {
  if (env.SHOPEE_ANALYTICS_DATABASE_URL) {
    return {
      connectionString: env.SHOPEE_ANALYTICS_DATABASE_URL,
    };
  }

  const host = env.SHOPEE_ANALYTICS_PGHOST;
  const database = env.SHOPEE_ANALYTICS_PGDATABASE;
  const user = env.SHOPEE_ANALYTICS_PGUSER;
  const password = env.SHOPEE_ANALYTICS_PGPASSWORD;

  if (!host || !database || !user || password === undefined) {
    throw new Error(
      'SHOPEE_ANALYTICS_DATABASE_URL or dedicated SHOPEE_ANALYTICS_PGHOST/PGDATABASE/PGUSER/PGPASSWORD is required; existing inventory DATABASE_URL is never used implicitly',
    );
  }

  const port = Number(env.SHOPEE_ANALYTICS_PGPORT || 5432);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error('SHOPEE_ANALYTICS_PGPORT must be 1..65535');
  }

  return {
    host,
    port,
    database,
    user,
    password,
  };
}

function createAnalyticsPool({
  connectionString,
  max = 5,
  env = process.env,
} = {}) {
  const base = connectionString
    ? { connectionString }
    : analyticsPgConfig(env);

  return new Pool({
    ...base,
    max,
    application_name: 'shopee-analytics-v1',
  });
}

module.exports = { analyticsPgConfig, createAnalyticsPool };
