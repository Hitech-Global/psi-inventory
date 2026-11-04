'use strict';

function inventoryValueKey(row) {
  const warehouse = row && row.warehouse != null ? row.warehouse : (row && row.target_warehouse);
  return JSON.stringify([
    String((row && row.sku_code) || ''),
    String((row && row.country) || ''),
    String(warehouse || '')
  ]);
}

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function addConvertedAmount(target, amountField, missingField, amount, currency, fxRates) {
  if (!(amount > 0)) return;
  const code = String(currency || '').trim().toUpperCase();
  const rate = code && fxRates ? Number(fxRates[code]) : NaN;
  if (!code || !Number.isFinite(rate) || rate <= 0) {
    target[missingField] = true;
    return;
  }
  target[amountField] += amount * rate;
}

/**
 * Build CNY asset amounts keyed by the exact inventory row (SKU + country + warehouse).
 *
 * CI amount: CI goods value × effective transit quantity / shipped quantity.
 * PI amount: original PI line value − active current/historical CI shipped value.
 * Currency conversion always uses the source document currency; no 1:1 fallback.
 */
function buildInventoryFinancialValueMap(options) {
  const opts = options || {};
  const inventoryRows = Array.isArray(opts.inventoryRows) ? opts.inventoryRows : [];
  const transitRows = Array.isArray(opts.transitRows) ? opts.transitRows : [];
  const piRows = Array.isArray(opts.piRows) ? opts.piRows : [];
  const fxRates = opts.fxRates || {};
  const canViewAmounts = opts.canViewAmounts !== false;

  const values = new Map();
  inventoryRows.forEach(row => {
    values.set(inventoryValueKey(row), {
      in_transit_amount_cny: canViewAmounts ? 0 : null,
      pi_unshipped_amount_cny: canViewAmounts ? 0 : null,
      in_transit_amount_missing_rate: false,
      pi_unshipped_amount_missing_rate: false,
      inventory_amount_view_allowed: canViewAmounts
    });
  });

  if (!canViewAmounts) return values;

  transitRows.forEach(row => {
    const target = values.get(inventoryValueKey(row));
    if (!target) return;

    const shippedQty = finiteNumber(row.shipped_qty);
    const transitQty = Math.max(0, Math.min(finiteNumber(row.transit_qty), shippedQty));
    const ciAmount = Math.max(0, finiteNumber(row.ci_amount_total));
    if (shippedQty <= 0 || transitQty <= 0 || ciAmount <= 0) return;

    const transitAmount = ciAmount * transitQty / shippedQty;
    addConvertedAmount(
      target,
      'in_transit_amount_cny',
      'in_transit_amount_missing_rate',
      transitAmount,
      row.currency,
      fxRates
    );
  });

  piRows.forEach(row => {
    const target = values.get(inventoryValueKey(row));
    if (!target) return;

    const confirmedQty = Math.max(0, finiteNumber(row.pi_confirmed_qty));
    const shippedQty = Math.max(0, finiteNumber(row.shipped_qty));
    const unshippedQty = Math.max(0, confirmedQty - shippedQty);
    if (unshippedQty <= 0 || confirmedQty <= 0) return;

    let lineAmount;
    if (row.pi_amount !== null && row.pi_amount !== undefined && row.pi_amount !== '') {
      lineAmount = finiteNumber(row.pi_amount);
    } else if (row.fallback_pi_amount !== null && row.fallback_pi_amount !== undefined) {
      lineAmount = finiteNumber(row.fallback_pi_amount);
    } else {
      lineAmount = confirmedQty * finiteNumber(row.unit_price) * (1 - finiteNumber(row.discount));
    }

    const shippedCiAmount = Math.max(0, finiteNumber(row.shipped_ci_amount));
    const remainingAmount = Math.max(0, lineAmount - shippedCiAmount);
    addConvertedAmount(
      target,
      'pi_unshipped_amount_cny',
      'pi_unshipped_amount_missing_rate',
      remainingAmount,
      row.currency,
      fxRates
    );
  });

  values.forEach(value => {
    if (value.in_transit_amount_cny !== null) {
      value.in_transit_amount_cny = Math.round((value.in_transit_amount_cny + Number.EPSILON) * 100) / 100;
    }
    if (value.pi_unshipped_amount_cny !== null) {
      value.pi_unshipped_amount_cny = Math.round((value.pi_unshipped_amount_cny + Number.EPSILON) * 100) / 100;
    }
  });

  return values;
}

module.exports = {
  inventoryValueKey,
  buildInventoryFinancialValueMap
};
