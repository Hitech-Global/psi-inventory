'use strict';

// Keep the CI/PI valuation edge cases aligned with the inventory asset-value endpoint.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  inventoryValueKey,
  buildInventoryFinancialValueMap
} = require('../inventory-asset-values');

const inventoryRows = [
  { id: 'inv-1', sku_code: 'SKU-A', country: 'Indonesia', warehouse: 'Bekasi' },
  { id: 'inv-2', sku_code: 'SKU-B', country: 'Thailand', warehouse: 'Bangkok' }
];

test('CI in-transit value excludes the arrived portion and converts the remaining CI value to CNY', () => {
  const values = buildInventoryFinancialValueMap({
    inventoryRows,
    transitRows: [{
      sku_code: 'SKU-A', country: 'Indonesia', target_warehouse: 'Bekasi',
      shipped_qty: 100, transit_qty: 60, ci_amount_total: 10000, currency: 'USD'
    }],
    fxRates: { USD: 7 }
  });

  assert.equal(values.get(inventoryValueKey(inventoryRows[0])).in_transit_amount_cny, 42000);
  assert.equal(values.get(inventoryValueKey(inventoryRows[1])).in_transit_amount_cny, 0);
});

test('multiple CI rows for the same inventory row are converted and summed by their own currencies', () => {
  const values = buildInventoryFinancialValueMap({
    inventoryRows: [inventoryRows[0]],
    transitRows: [
      { sku_code: 'SKU-A', country: 'Indonesia', target_warehouse: 'Bekasi', shipped_qty: 100, transit_qty: 60, ci_amount_total: 10000, currency: 'USD' },
      { sku_code: 'SKU-A', country: 'Indonesia', target_warehouse: 'Bekasi', shipped_qty: 50, transit_qty: 25, ci_amount_total: 5000, currency: 'RMB' }
    ],
    fxRates: { USD: 7, RMB: 1 }
  });

  assert.equal(values.get(inventoryValueKey(inventoryRows[0])).in_transit_amount_cny, 44500);
});

test('PI unshipped value equals PI line value less current and historical CI shipped value', () => {
  const values = buildInventoryFinancialValueMap({
    inventoryRows: [inventoryRows[0]],
    piRows: [
      {
        sku_code: 'SKU-A', country: 'Indonesia', warehouse: 'Bekasi', currency: 'USD',
        pi_confirmed_qty: 100, shipped_qty: 40, pi_amount: 10000, shipped_ci_amount: 4000
      },
      {
        sku_code: 'SKU-A', country: 'Indonesia', warehouse: 'Bekasi', currency: 'RMB',
        pi_confirmed_qty: 10, shipped_qty: 2, pi_amount: null,
        fallback_pi_amount: 900, shipped_ci_amount: 200
      }
    ],
    fxRates: { USD: 7, RMB: 1 }
  });

  assert.equal(values.get(inventoryValueKey(inventoryRows[0])).pi_unshipped_amount_cny, 42700);
});

test('missing source-currency FX is flagged instead of silently using 1:1', () => {
  const values = buildInventoryFinancialValueMap({
    inventoryRows: [inventoryRows[0]],
    transitRows: [{
      sku_code: 'SKU-A', country: 'Indonesia', target_warehouse: 'Bekasi',
      shipped_qty: 10, transit_qty: 10, ci_amount_total: 1000, currency: 'EUR'
    }],
    fxRates: { USD: 7 }
  });
  const value = values.get(inventoryValueKey(inventoryRows[0]));

  assert.equal(value.in_transit_amount_cny, 0);
  assert.equal(value.in_transit_amount_missing_rate, true);
});

test('amounts are limited to displayed inventory rows and remain hidden without CI amount permission', () => {
  const values = buildInventoryFinancialValueMap({
    inventoryRows: [inventoryRows[0]],
    transitRows: [{
      sku_code: 'SKU-B', country: 'Thailand', target_warehouse: 'Bangkok',
      shipped_qty: 10, transit_qty: 10, ci_amount_total: 1000, currency: 'USD'
    }],
    piRows: [{
      sku_code: 'SKU-A', country: 'Indonesia', warehouse: 'Bekasi', currency: 'USD',
      pi_confirmed_qty: 10, shipped_qty: 0, pi_amount: 1000, shipped_ci_amount: 0
    }],
    fxRates: { USD: 7 },
    canViewAmounts: false
  });
  const value = values.get(inventoryValueKey(inventoryRows[0]));

  assert.equal(value.inventory_amount_view_allowed, false);
  assert.equal(value.in_transit_amount_cny, null);
  assert.equal(value.pi_unshipped_amount_cny, null);
});
