'use strict';

// Historical CI clearance type is independent of operational CI and must not
// affect historical payable, inventory, WAC, or forecast calculations.
function ensureHistoricalCIClearanceColumn(run, query, isPg) {
  if (typeof run !== 'function' || typeof query !== 'function') {
    throw new Error('[HCI-CLEARANCE] run/query DB adapters are required');
  }
  let exists = false;
  if (isPg) {
    const result = query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'historical_commercial_invoices' AND column_name = 'clearance_type'"
    );
    exists = !!(result && Array.isArray(result.rows) && result.rows.some(r => r.column_name === 'clearance_type'));
  } else {
    const result = query('PRAGMA table_info(historical_commercial_invoices)');
    exists = !!(result && Array.isArray(result.rows) && result.rows.some(r => r.name === 'clearance_type'));
  }
  if (!exists) run('ALTER TABLE historical_commercial_invoices ADD COLUMN clearance_type TEXT');
  return { added: !exists };
}

module.exports = { ensureHistoricalCIClearanceColumn };
