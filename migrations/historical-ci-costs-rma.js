'use strict';

function ensureHistoricalCICostsRmaColumns(run, query, isPg) {
  if (typeof run !== 'function' || typeof query !== 'function') {
    throw new Error('[HCI-COSTS-RMA] run/query DB adapters are required');
  }
  const definitions = [
    ['is_rma', 'BOOLEAN NOT NULL DEFAULT FALSE', 'INTEGER NOT NULL DEFAULT 0'],
    ['historical_freight_amount', 'NUMERIC(18,2)', 'NUMERIC'],
    ['historical_freight_currency', "TEXT NOT NULL DEFAULT ''", "TEXT NOT NULL DEFAULT ''"],
    ['historical_customs_duty_amount', 'NUMERIC(18,2)', 'NUMERIC'],
    ['historical_customs_duty_currency', "TEXT NOT NULL DEFAULT ''", "TEXT NOT NULL DEFAULT ''"],
    ['historical_customs_duty_rmb_amount', 'NUMERIC(18,2)', 'NUMERIC'],
    ['historical_customs_duty_exchange_rate', 'NUMERIC(18,8)', 'NUMERIC']
  ];
  const added = [];
  for (const def of definitions) {
    const name = def[0];
    let exists = false;
    if (isPg) {
      const result = query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'historical_commercial_invoices' AND column_name = ?",
        [name]
      );
      exists = !!(result && Array.isArray(result.rows) && result.rows.some(r => r.column_name === name));
    } else {
      const result = query('PRAGMA table_info(historical_commercial_invoices)');
      exists = !!(result && Array.isArray(result.rows) && result.rows.some(r => r.name === name));
    }
    if (!exists) {
      run('ALTER TABLE historical_commercial_invoices ADD COLUMN ' + name + ' ' + (isPg ? def[1] : def[2]));
      added.push(name);
    }
  }
  return { added };
}
module.exports = { ensureHistoricalCICostsRmaColumns };
