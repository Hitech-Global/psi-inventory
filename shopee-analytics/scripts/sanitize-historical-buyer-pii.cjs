'use strict';

// One-time historical PII minimization. Read-only by default.
// Apply only AFTER: verified backup, reviewed deployment, and maintenance window.
// Never prints source JSON or personal data.
const { createAnalyticsPool } = require('../src/pg');
const {
  sanitizeOrderRaw, sanitizeReturnRaw, sanitizeItemRaw,
  sanitizeShopOrderReturnSnapshot, sanitizeBuyerPii, sanitizeHealthEventRaw,
} = require('../src/buyer-pii-sanitizer');

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
if (apply && !['--backup-verified', '--deployment-verified', '--maintenance-window'].every(x => args.has(x))) {
  throw new Error('Apply blocked: --backup-verified, --deployment-verified, --maintenance-window required');
}

const tables = [
  { table: 'shopee_orders', keys: ['shop_id', 'order_sn'], json: 'raw_json', sanitize: sanitizeOrderRaw },
  { table: 'shopee_order_items', keys: ['shop_id', 'order_sn', 'item_id', 'model_id'], json: 'raw_json', sanitize: sanitizeItemRaw },
  { table: 'shopee_returns', keys: ['shop_id', 'return_sn'], json: 'raw_json', sanitize: sanitizeReturnRaw },
  { table: 'shopee_return_items', keys: ['shop_id', 'return_sn', 'item_id', 'model_id'], json: 'raw_json', sanitize: sanitizeItemRaw },
  { table: 'shopee_shop_health_events', keys: ['shop_id', 'event_date', 'event_kind', 'event_id'], json: 'raw_json', sanitize: sanitizeHealthEventRaw },
  { table: 'shopee_raw_api_snapshots', keys: ['id'], json: 'response_json',
    where: "endpoint_key IN ('orders','orderDetail','returns','returnDetail')",
    sanitize: (row, record) => sanitizeShopOrderReturnSnapshot(record.endpoint_key, row),
    extra: ['endpoint_key'] },
  { table: 'shopee_raw_api_snapshots', keys: ['id'], json: 'request_json',
    where: "endpoint_key IN ('orders','orderDetail','returns','returnDetail')",
    sanitize: sanitizeBuyerPii },
];

function assertIdentifier(s) {
  if (!/^[a-z_]+$/.test(s)) throw new Error('Invalid SQL identifier');
  return s;
}

async function run() {
  const pool = createAnalyticsPool({ max: 2 });
  const results = [];
  try {
    for (const spec of tables) {
      const table = assertIdentifier(spec.table);
      const column = assertIdentifier(spec.json);
      const cols = [...spec.keys, ...(spec.extra || []), column];
      const where = spec.where ? ' WHERE ' + spec.where : '';
      const whereKeys = spec.keys.map((k,i) => assertIdentifier(k) + '=$' + (i + 2)).join(' AND ');
      const update = `UPDATE ${table} SET ${column}=$1::jsonb WHERE ${whereKeys}`;
      let offset = 0;
      let scanned = 0;
      let changed = 0;
      const batchSize = 250;

      while (true) {
        const result = await pool.query(
          `SELECT ${cols.map(assertIdentifier).join(',')} FROM ${table}${where} ORDER BY ${spec.keys.map(assertIdentifier).join(',')} LIMIT $1 OFFSET $2`,
          [batchSize, offset]
        );
        if (!result.rows.length) break;
        scanned += result.rows.length;
        const changedRows = result.rows.map(record => ({
          record,
          safe: spec.sanitize(record[column], record),
        })).filter(x => JSON.stringify(x.safe) !== JSON.stringify(x.record[column]));
        changed += changedRows.length;

        if (apply && changedRows.length) {
          const client = await pool.connect();
          try {
            await client.query('BEGIN');
            for (const { record, safe } of changedRows) {
              await client.query(update, [JSON.stringify(safe), ...spec.keys.map(k => record[k])]);
            }
            await client.query('COMMIT');
          } catch (error) {
            await client.query('ROLLBACK');
            throw error;
          } finally {
            client.release();
          }
        }
        offset += result.rows.length;
      }
      results.push({ table: spec.table, json: spec.json, scanned, changed });
    }
    for (const row of results) console.log(JSON.stringify({ mode: apply ? 'APPLIED' : 'DRY_RUN', ...row }));
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  run().catch(err => { console.error('Migration failed:', err.code || err.name || 'unknown'); process.exitCode = 1; });
}
module.exports = { tables };
