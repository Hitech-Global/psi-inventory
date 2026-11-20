'use strict';

const DEFAULT_FIELDS = [
  { key: 'BM', name: 'BM', group: 'cost', value: 'percent', include: 0 },
  { key: 'PPN', name: 'PPN', group: 'cost', value: 'percent', include: 0 },
  { key: 'PPH_IMPORT', name: 'PPH（进口）', group: 'cost', value: 'percent', include: 0 },
  { key: 'FREIGHT', name: 'Freight', group: 'cost', value: 'percent', include: 0 },
  { key: 'OTHERS', name: 'Others', group: 'cost', value: 'percent', include: 0 },
  { key: 'LANDING_COST_CNY', name: 'Landing Cost/CNY', group: 'cost', value: 'currency', include: 0 },
  { key: 'LANDING_COST_LOCAL', name: 'Landing Cost/本币', group: 'cost', value: 'currency', include: 1 },
  { key: 'COMMISSION_FEE', name: 'Commission Fee', group: 'fee', value: 'percent', include: 1 },
  { key: 'PAYMENT_FEE', name: 'Payment Fee', group: 'fee', value: 'percent', include: 1 },
  { key: 'FREE_SHIPPING_XTRA', name: 'Free Shipping Xtra', group: 'fee', value: 'percent', include: 1 },
  { key: 'PPH_SALES', name: 'PPH（销售）', group: 'fee', value: 'currency', include: 1 },
  { key: 'ORDER_PROCESSING_FEE', name: 'Order Processing Fee', group: 'fee', value: 'currency', include: 1 },
  { key: 'ADS_COST', name: 'Ads Cost', group: 'fee', value: 'percent', include: 1 }
];

function ensurePricingTables(db) {
  const run = db.run;
  const query = db.query;
  const queryOne = db.queryOne;
  const genId = db.genId || (prefix => prefix + '_' + Date.now().toString(36));

  run('CREATE TABLE IF NOT EXISTS pricing_schemes (' +
    'id TEXT PRIMARY KEY, country TEXT NOT NULL, brand TEXT NOT NULL, platform TEXT NOT NULL, ' +
    "store TEXT DEFAULT '', currency TEXT DEFAULT '', exchange_rate NUMERIC DEFAULT 0, " +
    "status TEXT DEFAULT 'draft', description TEXT DEFAULT '', effective_date TEXT DEFAULT '', " +
    "srp_formula TEXT DEFAULT '', current_version INTEGER DEFAULT 0, created_by TEXT DEFAULT '', " +
    "updated_by TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)");

  run('CREATE TABLE IF NOT EXISTS pricing_fields (' +
    'id TEXT PRIMARY KEY, scheme_id TEXT NOT NULL, field_key TEXT NOT NULL, field_name TEXT NOT NULL, ' +
    "group_type TEXT DEFAULT 'fee', value_type TEXT DEFAULT 'currency', calculation_type TEXT DEFAULT 'manual', " +
    "formula TEXT DEFAULT '', default_value NUMERIC, currency TEXT DEFAULT '', include_in_profit INTEGER DEFAULT 1, " +
    "is_active INTEGER DEFAULT 1, display_order INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, " +
    'updated_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(scheme_id, field_key))');

  run('CREATE TABLE IF NOT EXISTS pricing_rules (' +
    'id TEXT PRIMARY KEY, scheme_id TEXT NOT NULL, field_id TEXT NOT NULL, ' +
    "scope_type TEXT DEFAULT 'global', scope_value TEXT DEFAULT '', calculation_type TEXT DEFAULT 'manual', " +
    "basis TEXT DEFAULT 'SRP', rate NUMERIC DEFAULT 0, fixed_amount NUMERIC, cap_amount NUMERIC, floor_amount NUMERIC, " +
    "formula TEXT DEFAULT '', currency TEXT DEFAULT '', per_order INTEGER DEFAULT 0, items_per_order NUMERIC DEFAULT 1, " +
    "priority INTEGER DEFAULT 0, status TEXT DEFAULT 'active', effective_from TEXT DEFAULT '', effective_to TEXT DEFAULT '', " +
    "created_by TEXT DEFAULT '', updated_by TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)");

  run('CREATE TABLE IF NOT EXISTS pricing_sku_values (' +
    'id TEXT PRIMARY KEY, scheme_id TEXT NOT NULL, sku_code TEXT NOT NULL, field_key TEXT NOT NULL, value NUMERIC, ' +
    "is_applicable INTEGER DEFAULT 1, updated_by TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP, " +
    'updated_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(scheme_id, sku_code, field_key))');

  run('CREATE TABLE IF NOT EXISTS pricing_scheme_versions (' +
    'id TEXT PRIMARY KEY, scheme_id TEXT NOT NULL, version_no INTEGER NOT NULL, change_summary TEXT DEFAULT '', ' +
    'snapshot_json TEXT NOT NULL, created_by TEXT DEFAULT \'\', created_at TEXT DEFAULT CURRENT_TIMESTAMP, ' +
    'UNIQUE(scheme_id, version_no))');

  run('CREATE INDEX IF NOT EXISTS idx_pricing_schemes_filter ON pricing_schemes(country, brand, platform, status)');
  run('CREATE INDEX IF NOT EXISTS idx_pricing_fields_scheme_order ON pricing_fields(scheme_id, display_order)');
  run('CREATE INDEX IF NOT EXISTS idx_pricing_rules_scheme_field ON pricing_rules(scheme_id, field_id, status)');
  run('CREATE INDEX IF NOT EXISTS idx_pricing_sku_values_scheme_sku ON pricing_sku_values(scheme_id, sku_code)');
  run('CREATE INDEX IF NOT EXISTS idx_pricing_versions_scheme_version ON pricing_scheme_versions(scheme_id, version_no DESC)');

  const existing = queryOne('SELECT id FROM pricing_schemes ORDER BY created_at LIMIT 1');
  if (existing) return { created: false, scheme_id: existing.id };

  const country = queryOne("SELECT name, default_currency FROM countries WHERE name IN ('印度尼西亚','Indonesia') AND status = 'active' ORDER BY CASE WHEN name='印度尼西亚' THEN 0 ELSE 1 END LIMIT 1");
  const brand = queryOne("SELECT brand FROM skus WHERE brand = 'Redragon' LIMIT 1");
  if (!country || !brand) return { created: false, scheme_id: null };

  const schemeId = genId('price');
  const now = new Date().toISOString();
  const currency = String(country.default_currency || 'IDR').toUpperCase();
  run('INSERT INTO pricing_schemes ' +
    '(id, country, brand, platform, store, currency, exchange_rate, status, description, effective_date, srp_formula, current_version, created_at, updated_at) ' +
    "VALUES (?, ?, ?, ?, ?, ?, 0, 'draft', ?, ?, '', 1, ?, ?)",
    [schemeId, country.name, brand.brand, 'Shopee', '', currency, 'Shopee price structure - initial draft', now.slice(0, 10), now, now]);

  DEFAULT_FIELDS.forEach((field, index) => {
    run('INSERT INTO pricing_fields ' +
      '(id, scheme_id, field_key, field_name, group_type, value_type, calculation_type, include_in_profit, is_active, display_order, currency, created_at, updated_at) ' +
      "VALUES (?, ?, ?, ?, ?, ?, 'manual', ?, 1, ?, ?, ?, ?)",
      [genId('pfield'), schemeId, field.key, field.name, field.group, field.value, field.include, index + 1, currency, now, now]);
  });

  const snapshot = {
    scheme: queryOne('SELECT * FROM pricing_schemes WHERE id = ?', [schemeId]),
    fields: query('SELECT * FROM pricing_fields WHERE scheme_id = ? ORDER BY display_order, field_name', [schemeId]).rows,
    rules: [],
    sku_values: []
  };
  run('INSERT INTO pricing_scheme_versions (id, scheme_id, version_no, change_summary, snapshot_json, created_by, created_at) ' +
    'VALUES (?, ?, 1, ?, ?, \'\', ?)',
    [genId('pversion'), schemeId, '创建初始 Indonesia / Redragon / Shopee 价格方案', JSON.stringify(snapshot), now]);
  return { created: true, scheme_id: schemeId };
}

module.exports = { ensurePricingTables, DEFAULT_FIELDS };
