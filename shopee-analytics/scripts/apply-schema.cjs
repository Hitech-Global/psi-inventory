'use strict';

const fs = require('fs');
const path = require('path');
const { createAnalyticsPool } = require('../src/pg');

const SCHEMA_FILES = [
  'schema.sql',
  'schema-import-jobs.sql',
  'schema-shop-profile-corrections.sql',
  'schema-product-ads-overview.sql',
  'schema-product-ad-source-metrics.sql',
  'schema-brand-portal-principal.sql',
];

/**
 * Where in the file the error happened.
 *
 * The database says where in the text it gave up, which is a character
 * count and not much use to a reader. Turning it into the line and the
 * line itself is the difference between knowing what is wrong and
 * hunting for it.
 */
function locate(text, position) {
  if (!position || position < 1) return null;
  const before = text.slice(0, position - 1);
  const line = before.split('\n').length;
  const lines = text.split('\n');
  const content = lines[line - 1] || '';
  return {
    line,
    column: position - before.lastIndexOf('\n'),
    content: content.trim().slice(0, 160),
  };
}

async function main() {
  if (process.env.SHOPEE_ANALYTICS_APPLY_SCHEMA !== 'YES') {
    throw new Error('Refusing schema write. Set SHOPEE_ANALYTICS_APPLY_SCHEMA=YES explicitly.');
  }
  const pool = createAnalyticsPool();
  try {
    // One file at a time, so that a mistake says which file it was in.
    // Applied together, the whole thing fails on the first wrong word and
    // says nothing about where it was.
    for (const name of SCHEMA_FILES) {
      const text = fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
      await pool.query('BEGIN');
      try {
        await pool.query(text);
        await pool.query('COMMIT');
        console.log(`  ${name} applied`);
      } catch (error) {
        await pool.query('ROLLBACK');
        const where = locate(text, error.position);
        const detail = where ? `${name}:${where.line}:${where.column} — ${where.content}` : name;
        throw new Error(`${detail}\n${error.message}`);
      }
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
