'use strict';

const fs = require('fs');
const path = require('path');
const { createAnalyticsPool } = require('../src/pg');

async function main() {
  if (process.env.SHOPEE_ANALYTICS_APPLY_SCHEMA !== 'YES') {
    throw new Error('Refusing schema write. Set SHOPEE_ANALYTICS_APPLY_SCHEMA=YES explicitly.');
  }
  const pool = createAnalyticsPool();
  try {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
    await pool.query('BEGIN');
    try {
      await pool.query(sql);
      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
    console.log('Shopee analytics schema applied.');
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
