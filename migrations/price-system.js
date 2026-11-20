'use strict';

// 价格体系独立数据表。幂等迁移；不修改 SKU 主数据、库存或 WAC 表。
function ensurePriceSystemSchema(run, isPg) {
  const now = isPg ? 'NOW()' : "(datetime('now'))";
  run(\`CREATE TABLE IF NOT EXISTS price_system_schemes (
    id TEXT PRIMARY KEY NOT NULL,
    country TEXT NOT NULL,
    brand TEXT NOT NULL,
    platform TEXT NOT NULL,
    shop_name TEXT NOT NULL DEFAULT '',
    currency TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    srp_formula TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL DEFAULT '',
    created_at TEXT DEFAULT \${now},
    updated_at TEXT DEFAULT \${now},
    UNIQUE (country, brand, platform, shop_name)
  )\`);
  run(\`CREATE TABLE IF NOT EXISTS price_system_fields (
    id TEXT PRIMARY KEY NOT NULL,
    scheme_id TEXT NOT NULL,
    field_key TEXT NOT NULL,
    field_name TEXT NOT NULL,
    field_type TEXT NOT NULL DEFAULT 'amount',
    unit TEXT NOT NULL DEFAULT '',
    applicable_categories TEXT NOT NULL DEFAULT '[]',
    formula TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT \${now},
    updated_at TEXT DEFAULT \${now},
    UNIQUE (scheme_id, field_key)
  )\`);
  run(\`CREATE TABLE IF NOT EXISTS price_system_values (
    id TEXT PRIMARY KEY NOT NULL,
    scheme_id TEXT NOT NULL,
    sku_code TEXT NOT NULL,
    field_key TEXT NOT NULL,
    value NUMERIC(18,6),
    updated_by TEXT NOT NULL DEFAULT '',
    updated_at TEXT DEFAULT \${now},
    UNIQUE (scheme_id, sku_code, field_key)
  )\`);
  run(\`CREATE TABLE IF NOT EXISTS price_system_versions (
    id TEXT PRIMARY KEY NOT NULL,
    scheme_id TEXT NOT NULL,
    version_no INTEGER NOT NULL,
    snapshot_json TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL DEFAULT '',
    created_by_name TEXT NOT NULL DEFAULT '',
    created_at TEXT DEFAULT \${now},
    UNIQUE (scheme_id, version_no)
  )\`);
  run('CREATE INDEX IF NOT EXISTS idx_price_system_schemes_scope ON price_system_schemes(country, brand, status)');
  run('CREATE INDEX IF NOT EXISTS idx_price_system_fields_scheme ON price_system_fields(scheme_id, sort_order)');
  run('CREATE INDEX IF NOT EXISTS idx_price_system_values_scheme_sku ON price_system_values(scheme_id, sku_code)');
  run('CREATE INDEX IF NOT EXISTS idx_price_system_versions_scheme ON price_system_versions(scheme_id, version_no DESC)');
}

module.exports = { ensurePriceSystemSchema };
