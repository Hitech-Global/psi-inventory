'use strict';

const { Pool } = require('pg');

function createAnalyticsPool({
  connectionString = process.env.SHOPEE_ANALYTICS_DATABASE_URL,
  max = 5,
} = {}) {
  if (!connectionString) {
    throw new Error('SHOPEE_ANALYTICS_DATABASE_URL is required; existing inventory DATABASE_URL is never used implicitly');
  }
  return new Pool({
    connectionString,
    max,
    application_name: 'shopee-analytics-v1',
  });
}

module.exports = { createAnalyticsPool };
