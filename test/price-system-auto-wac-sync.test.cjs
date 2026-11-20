'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'assets/price-system.js'), 'utf8');
const api = fs.readFileSync(path.join(root, 'price-system-api.js'), 'utf8');

function createHarness() {
  const schemes = [
    { id: 'scheme-shopee', country: '\u5370\u5c3c', brand: 'Netac', platform: 'Shopee', currency: 'IDR', status: 'active' },
    { id: 'scheme-tiktok', country: 'Indonesia', brand: 'Netac', platform: 'TikTok Shop', currency: 'IDR', status: 'active' },
    { id: 'scheme-malaysia', country: 'Malaysia', brand: 'Netac', platform: 'Shopee', currency: 'MYR', status: 'active' },
    { id: 'scheme-redragon', country: 'Indonesia', brand: 'Redragon', platform: 'Shopee', currency: 'IDR', status: 'active' },
    { id: 'scheme-disabled', country: 'Indonesia', brand: 'Netac', platform: 'Old', currency: 'IDR', status: 'disabled' }
  ];
  const skus = [1, 2, 3].map(n => ({ sku_code: 'SKU-' + n, brand: 'Netac' }));
  const wacs = [
    { id: 'wac-1-old', sku_code: 'SKU-1', brand: 'Netac', country: 'Indonesia', warehouse: 'Bekasi Warehouse', new_avg_cost: 100, local_currency: 'IDR', ci_no: 'CI-OLD', version_no: 1, confirmed_at: '2026-11-01 12:00:00', last_inbound_date: '2026-10-31', is_locked: 1, confirmation_status: 'confirmed', created_at: '2026-11-01 12:00:00' },
    { id: 'wac-1-new', sku_code: 'SKU-1', brand: 'Netac', country: 'Indonesia', warehouse: 'Bekasi Warehouse', new_avg_cost: 120, local_currency: 'IDR', ci_no: 'CI-NEW', version_no: 2, confirmed_at: '2026-11-18 12:00:00', last_inbound_date: '2026-11-17', is_locked: 1, confirmation_status: 'confirmed', created_at: '2026-11-18 12:00:00' },
    { id: 'wac-1-reversed', sku_code: 'SKU-1', brand: 'Netac', country: 'Indonesia', warehouse: 'Bekasi Warehouse', new_avg_cost: 300, local_currency: 'IDR', ci_no: 'CI-REVERSED', version_no: 3, confirmed_at: '2026-11-19 12:00:00', last_inbound_date: '2026-11-19', is_locked: 0, confirmation_status: 'reversed', created_at: '2026-11-19 12:00:00' },
    { id: 'wac-1-pending', sku_code: 'SKU-1', brand: 'Netac', country: 'Indonesia', warehouse: 'Bekasi Warehouse', new_avg_cost: 999, local_currency: 'IDR', ci_no: 'CI-PENDING', version_no: 4, confirmed_at: '2026-11-20 14:00:00', last_inbound_date: '2026-11-20', is_locked: 0, confirmation_status: 'pending', created_at: '2026-11-20 14:00:00' },
    { id: 'wac-2-new', sku_code: 'SKU-2', brand: 'Netac', country: 'Indonesia', warehouse: 'Bekasi Warehouse', new_avg_cost: 220, local_currency: 'IDR', ci_no: 'CI-2', version_no: 1, confirmed_at: '2026-11-15 12:00:00', last_inbound_date: '2026-11-14', is_locked: 1, confirmation_status: 'confirmed', created_at: '2026-11-15 12:00:00' },
    { id: 'wac-2-reversed', sku_code: 'SKU-2', brand: 'Netac', country: 'Indonesia', warehouse: 'Bekasi Warehouse', new_avg_cost: 250, local_currency: 'IDR', ci_no: 'CI-2-REVERSED', version_no: 2, confirmed_at: '2026-11-20 12:00:00', last_inbound_date: '2026-11-20', is_locked: 0, confirmation_status: 'reversed', created_at: '2026-11-20 12:00:00' },
    { id: 'wac-3-reversed', sku_code: 'SKU-3', brand: 'Netac', country: 'Indonesia', warehouse: 'Bekasi Warehouse', new_avg_cost: 350, local_currency: 'IDR', ci_no: 'CI-3-REVERSED', version_no: 1, confirmed_at: '2026-11-20 13:00:00', last_inbound_date: '2026-11-20', is_locked: 0, confirmation_status: 'reversed', created_at: '2026-11-20 13:00:00' }
  ];
  const landing = new Map([
    ['scheme-shopee|SKU-1', { id: 'old-1', scheme_id: 'scheme-shopee', sku_code: 'SKU-1', wac_history_id: 'wac-1-old', value: 100, currency: 'IDR', warehouse: 'Bekasi Warehouse', ci_no: 'CI-OLD', version_no: 1, confirmed_at: '2026-11-01 12:00:00', last_inbound_date: '2026-10-31' }],
    ['scheme-shopee|SKU-3', { id: 'old-3a', scheme_id: 'scheme-shopee', sku_code: 'SKU-3', wac_history_id: 'wac-3-reversed', value: 350, currency: 'IDR' }],
    ['scheme-tiktok|SKU-2', { id: 'old-2', scheme_id: 'scheme-tiktok', sku_code: 'SKU-2', wac_history_id: 'wac-2-reversed', value: 250, currency: 'IDR' }],
    ['scheme-tiktok|SKU-3', { id: 'old-3b', scheme_id: 'scheme-tiktok', sku_code: 'SKU-3', wac_history_id: 'wac-3-reversed', value: 350, currency: 'IDR' }]
  ]);
  const versions = [];
  const queries = [];
  const runs = [];
  let nextId = 0;
  function query(sql, params = []) {
    queries.push({ sql, params });
    if (sql.includes('SELECT sku_code, brand FROM skus WHERE sku_code IN')) {
      const set = new Set(params); return { rows: skus.filter(row => set.has(row.sku_code)) };
    }
    if (sql.includes("FROM price_system_schemes WHERE status = 'active'")) {
      return { rows: schemes.filter(row => row.status === 'active' && row.brand.toLowerCase() === String(params[0]).toLowerCase()) };
    }
    if (sql.includes('FROM wac_history wh')) {
      const skuCount = sql.slice(sql.indexOf('wh.sku_code IN'), sql.indexOf('AND LOWER(wh.country)')).split('?').length - 1;
      const aliasCount = sql.slice(sql.indexOf('LOWER(wh.country) IN'), sql.indexOf('AND (COALESCE(wh.brand')).split('?').length - 1;
      const skuSet = new Set(params.slice(0, skuCount));
      const aliases = new Set(params.slice(skuCount, skuCount + aliasCount).map(x => String(x).toLowerCase()));
      const brand = String(params[skuCount + aliasCount] || '').toLowerCase();
      const rows = wacs.filter(row => skuSet.has(row.sku_code) && aliases.has(String(row.country).toLowerCase()) && (!row.brand || row.brand.toLowerCase() === brand) && Number(row.is_locked) === 1 && !['reversed', 'void', 'cancelled'].includes(String(row.confirmation_status || 'confirmed').toLowerCase()) && row.confirmed_at);
      rows.sort((a, b) => String(b.confirmed_at).localeCompare(String(a.confirmed_at)) || Number(b.version_no) - Number(a.version_no));
      return { rows };
    }
    if (sql.includes('FROM price_system_landing_costs WHERE scheme_id = ? AND sku_code IN')) {
      const schemeId = params[0], codes = new Set(params.slice(1));
      return { rows: Array.from(landing.values()).filter(row => row.scheme_id === schemeId && codes.has(row.sku_code)) };
    }
    if (sql.includes('FROM price_system_fields')) return { rows: [] };
    if (sql.includes('FROM price_system_values')) return { rows: [] };
    if (sql.includes('FROM price_system_srp_values')) return { rows: [] };
    if (sql.includes('FROM price_system_landing_costs WHERE scheme_id = ? ORDER BY sku_code')) return { rows: Array.from(landing.values()).filter(row => row.scheme_id === params[0]) };
    return { rows: [] };
  }
  function queryOne(sql, params = []) {
    queries.push({ sql, params });
    if (sql.includes('SELECT code FROM countries')) return { code: ({ Indonesia: 'ID', '\u5370\u5c3c': 'ID', Malaysia: 'MY', Thailand: 'TH', Singapore: 'SG' })[params[0]] || '' };
    if (sql.includes('SELECT * FROM price_system_schemes WHERE id = ?')) return schemes.find(row => row.id === params[0]) || null;
    if (sql.includes('MAX(version_no)')) return { max_version: Math.max(0, ...versions.filter(row => row.scheme_id === params[0]).map(row => row.version_no)) };
    return null;
  }
  function run(sql, params = []) {
    runs.push({ sql, params });
    if (sql.includes('INSERT INTO price_system_landing_costs')) {
      const [id, scheme_id, sku_code, wac_history_id, value, currency, warehouse, ci_no, version_no, confirmed_at, last_inbound_date, updated_by] = params;
      landing.set(scheme_id + '|' + sku_code, { id, scheme_id, sku_code, wac_history_id, value, currency, warehouse, ci_no, version_no, confirmed_at, last_inbound_date, updated_by });
    } else if (sql.includes('DELETE FROM price_system_landing_costs')) {
      landing.delete(params[0] + '|' + params[1]);
    } else if (sql.includes('INSERT INTO price_system_versions')) {
      versions.push({ id: params[0], scheme_id: params[1], version_no: params[2], snapshot_json: params[3], note: params[4], created_by: params[5], created_by_name: params[6] });
    }
  }
  return { schemes, skus, wacs, landing, versions, queries, runs, query, queryOne, run, genId: prefix => prefix + '-' + (++nextId) };
}

test('confirmed WAC automatically updates every active country/brand platform scheme and records one version per scheme', () => {
  const { createPriceSystemWacSync } = require('../price-system-api');
  const db = createHarness();
  const sync = createPriceSystemWacSync(db);
  const result = sync([1, 2, 3].map(n => ({ sku_code: 'SKU-' + n, country: 'Indonesia', brand: 'Netac' })), { id: 'user-1', name: 'Operator' }, 'WAC confirmation');
  assert.equal(result.schemes_updated, 2);
  assert.equal(result.sku_updated, 4);
  assert.equal(result.sku_cleared, 2);
  assert.equal(db.landing.get('scheme-shopee|SKU-1').wac_history_id, 'wac-1-new');
  assert.equal(db.landing.get('scheme-tiktok|SKU-1').wac_history_id, 'wac-1-new');
  assert.equal(db.landing.get('scheme-shopee|SKU-2').value, 220);
  assert.equal(db.landing.get('scheme-tiktok|SKU-2').value, 220);
  assert.equal(db.landing.has('scheme-shopee|SKU-3'), false);
  assert.equal(db.landing.has('scheme-tiktok|SKU-3'), false);
  assert.equal(db.landing.has('scheme-malaysia|SKU-1'), false);
  assert.equal(db.landing.has('scheme-redragon|SKU-1'), false);
  assert.equal(db.versions.length, 2);
  db.schemes.push({ id: 'scheme-lazada', country: 'Indonesia', brand: 'Netac', platform: 'Lazada', currency: 'IDR', status: 'active' });
  const newSchemeSync = sync([1, 2, 3].map(n => ({ sku_code: 'SKU-' + n, country: 'Indonesia', brand: 'Netac' })), { id: 'user-1', name: 'Operator' }, 'New scheme sync');
  assert.equal(newSchemeSync.schemes_updated, 1, 'newly created schemes must be visible to the next sync call');
  assert.equal(db.landing.get('scheme-lazada|SKU-1').wac_history_id, 'wac-1-new');
  assert.equal(db.landing.get('scheme-lazada|SKU-2').wac_history_id, 'wac-2-new');
  assert.ok(db.versions.every(row => row.created_by === 'user-1' && row.created_by_name === 'Operator'));

  const unchanged = sync([1, 2, 3].map(n => ({ sku_code: 'SKU-' + n, country: 'Indonesia', brand: 'Netac' })), { id: 'user-1', name: 'Operator' }, 'Duplicate WAC event');
  assert.equal(unchanged.schemes_updated, 0);
  assert.equal(db.versions.length, 3, 'idempotent reprocessing must not create another price version');
});

test('reversing the latest WAC falls back to the previous valid WAC or clears Landing Cost when none remains', () => {
  const { createPriceSystemWacSync } = require('../price-system-api');
  const db = createHarness();
  const sync = createPriceSystemWacSync(db);
  const keys = [1, 2, 3].map(n => ({ sku_code: 'SKU-' + n, country: 'Indonesia', brand: 'Netac' }));
  sync(keys, { id: 'user-1', name: 'Operator' }, 'Initial WAC');
  db.wacs.find(row => row.id === 'wac-1-new').confirmation_status = 'reversed';
  db.wacs.find(row => row.id === 'wac-1-new').is_locked = 0;
  db.wacs.find(row => row.id === 'wac-2-new').confirmation_status = 'reversed';
  db.wacs.find(row => row.id === 'wac-2-new').is_locked = 0;
  const result = sync(keys, { id: 'user-2', name: 'Reversal operator' }, 'CI reversal WAC reconciliation');
  assert.equal(result.schemes_updated, 2);
  assert.equal(result.sku_updated, 2);
  assert.equal(result.sku_cleared, 2);
  assert.equal(db.landing.get('scheme-shopee|SKU-1').wac_history_id, 'wac-1-old');
  assert.equal(db.landing.get('scheme-tiktok|SKU-1').wac_history_id, 'wac-1-old');
  assert.equal(db.landing.has('scheme-shopee|SKU-2'), false);
  assert.equal(db.landing.has('scheme-tiktok|SKU-2'), false);
  assert.equal(db.versions.length, 4);
});

test('WAC auto-sync is wired to every WAC write/reversal path and the UI no longer asks for manual sync', () => {
  assert.ok(server.split('syncPriceSystemLandingCostsForWacKeys(wacSyncKeys').length - 1 >= 2);
  assert.ok(server.includes('syncPriceSystemLandingCostsForWacKeys(syncKeys'));
  assert.ok(server.includes('wacPriceSyncKeys'));
  assert.ok(server.includes('startupPriceWacKeys'));
  assert.ok(api.includes('syncPriceSystemLandingCostsForWacKeys(schemeSkuKeys'));
  assert.ok(!ui.includes('psOpenWacSyncModal') && !ui.includes('psConfirmWacSync') && !ui.includes('landing-cost/sync-wac'));
  assert.ok(ui.includes('psDownloadImportTemplate'));
});
