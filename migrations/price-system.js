'use strict';

// 价格体系独立数据表。幂等迁移；不修改 SKU 主数据、库存或 WAC 表。
function ensurePriceSystemSchema(run, isPg) {
  const now = isPg ? 'NOW()' : "(datetime('now'))";
  run(`CREATE TABLE IF NOT EXISTS price_system_schemes (
    id TEXT PRIMARY KEY NOT NULL,
    country TEXT NOT NULL,
    brand TEXT NOT NULL,
    platform TEXT NOT NULL,
    shop_name TEXT NOT NULL DEFAULT '',
    currency TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    srp_formula TEXT NOT NULL DEFAULT '',
    srp_formula_rules TEXT NOT NULL DEFAULT '{}',
    srp_source_scheme_id TEXT NOT NULL DEFAULT '',
    srp_source_field_key TEXT NOT NULL DEFAULT '',
    srp_sort_order INTEGER NOT NULL DEFAULT 999999,
    freeze_field_key TEXT NOT NULL DEFAULT '__sku',
    sync_wac INTEGER NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL DEFAULT '',
    created_at TEXT DEFAULT ${now},
    updated_at TEXT DEFAULT ${now},
    UNIQUE (country, brand, platform, shop_name)
  )`);
  run(`CREATE TABLE IF NOT EXISTS price_system_fields (
    id TEXT PRIMARY KEY NOT NULL,
    scheme_id TEXT NOT NULL,
    field_key TEXT NOT NULL,
    field_name TEXT NOT NULL,
    field_type TEXT NOT NULL DEFAULT 'amount',
    unit TEXT NOT NULL DEFAULT '',
    applicable_categories TEXT NOT NULL DEFAULT '[]',
    formula TEXT NOT NULL DEFAULT '',
    formula_rules TEXT NOT NULL DEFAULT '{}',
    display_format TEXT NOT NULL DEFAULT 'auto',
    decimal_places INTEGER NOT NULL DEFAULT 2,
    sync_wac INTEGER NOT NULL DEFAULT 0,
    sync_quotation INTEGER NOT NULL DEFAULT 0,
    source_scheme_id TEXT NOT NULL DEFAULT '',
    source_field_key TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT ${now},
    updated_at TEXT DEFAULT ${now},
    UNIQUE (scheme_id, field_key)
  )`);
  run(`CREATE TABLE IF NOT EXISTS price_system_values (
    id TEXT PRIMARY KEY NOT NULL,
    scheme_id TEXT NOT NULL,
    sku_code TEXT NOT NULL,
    field_key TEXT NOT NULL,
    value NUMERIC(18,6),
    currency TEXT NOT NULL DEFAULT '',
    updated_by TEXT NOT NULL DEFAULT '',
    updated_at TEXT DEFAULT ${now},
    UNIQUE (scheme_id, sku_code, field_key)
  )`);
  run(`CREATE TABLE IF NOT EXISTS price_system_versions (
    id TEXT PRIMARY KEY NOT NULL,
    scheme_id TEXT NOT NULL,
    version_no INTEGER NOT NULL,
    snapshot_json TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL DEFAULT '',
    created_by_name TEXT NOT NULL DEFAULT '',
    created_at TEXT DEFAULT ${now},
    UNIQUE (scheme_id, version_no)
  )`);
  // Idempotent upgrade for existing price-system installations.
  try { run('ALTER TABLE price_system_fields ADD COLUMN sync_wac INTEGER NOT NULL DEFAULT 0'); } catch (e) { if (!/duplicate column|already exists/i.test(String(e && e.message || e))) throw e; }
  try { run('ALTER TABLE price_system_fields ADD COLUMN sync_quotation INTEGER NOT NULL DEFAULT 0'); } catch (e) { if (!/duplicate column|already exists/i.test(String(e && e.message || e))) throw e; }
  try { run("ALTER TABLE price_system_values ADD COLUMN currency TEXT NOT NULL DEFAULT ''"); } catch (e) { if (!/duplicate column|already exists/i.test(String(e && e.message || e))) throw e; }
  try { run("ALTER TABLE price_system_fields ADD COLUMN formula_rules TEXT NOT NULL DEFAULT '{}'"); } catch (e) { if (!/duplicate column|already exists/i.test(String(e && e.message || e))) throw e; }
  try { run("ALTER TABLE price_system_fields ADD COLUMN display_format TEXT NOT NULL DEFAULT 'auto'"); } catch (e) { if (!/duplicate column|already exists/i.test(String(e && e.message || e))) throw e; }
  try { run('ALTER TABLE price_system_fields ADD COLUMN decimal_places INTEGER NOT NULL DEFAULT 2'); } catch (e) { if (!/duplicate column|already exists/i.test(String(e && e.message || e))) throw e; }
  try { run("ALTER TABLE price_system_fields ADD COLUMN source_scheme_id TEXT NOT NULL DEFAULT ''"); } catch (e) { if (!/duplicate column|already exists/i.test(String(e && e.message || e))) throw e; }
  try { run("ALTER TABLE price_system_fields ADD COLUMN source_field_key TEXT NOT NULL DEFAULT ''"); } catch (e) { if (!/duplicate column|already exists/i.test(String(e && e.message || e))) throw e; }
  try { run("ALTER TABLE price_system_schemes ADD COLUMN srp_formula_rules TEXT NOT NULL DEFAULT '{}'"); } catch (e) { if (!/duplicate column|already exists/i.test(String(e && e.message || e))) throw e; }
  try { run("ALTER TABLE price_system_schemes ADD COLUMN srp_source_scheme_id TEXT NOT NULL DEFAULT ''"); } catch (e) { if (!/duplicate column|already exists/i.test(String(e && e.message || e))) throw e; }
  try { run("ALTER TABLE price_system_schemes ADD COLUMN srp_source_field_key TEXT NOT NULL DEFAULT ''"); } catch (e) { if (!/duplicate column|already exists/i.test(String(e && e.message || e))) throw e; }
  try { run('ALTER TABLE price_system_schemes ADD COLUMN srp_sort_order INTEGER NOT NULL DEFAULT 999999'); } catch (e) { if (!/duplicate column|already exists/i.test(String(e && e.message || e))) throw e; }
  try { run("ALTER TABLE price_system_schemes ADD COLUMN freeze_field_key TEXT NOT NULL DEFAULT '__sku'"); } catch (e) { if (!/duplicate column|already exists/i.test(String(e && e.message || e))) throw e; }
  run('CREATE INDEX IF NOT EXISTS idx_price_system_schemes_scope ON price_system_schemes(country, brand, status)');
  run('CREATE INDEX IF NOT EXISTS idx_price_system_fields_scheme ON price_system_fields(scheme_id, sort_order)');
  run('CREATE INDEX IF NOT EXISTS idx_price_system_values_scheme_sku ON price_system_values(scheme_id, sku_code)');
  run('CREATE INDEX IF NOT EXISTS idx_price_system_versions_scheme ON price_system_versions(scheme_id, version_no DESC)');
  run('CREATE TABLE IF NOT EXISTS price_system_landing_costs (id TEXT PRIMARY KEY NOT NULL, scheme_id TEXT NOT NULL, sku_code TEXT NOT NULL, wac_history_id TEXT NOT NULL, value NUMERIC(18,6) NOT NULL, currency TEXT NOT NULL DEFAULT \'\', warehouse TEXT NOT NULL DEFAULT \'\', ci_no TEXT NOT NULL DEFAULT \'\', version_no INTEGER NOT NULL DEFAULT 0, confirmed_at TEXT NOT NULL DEFAULT \'\', last_inbound_date TEXT NOT NULL DEFAULT \'\', updated_by TEXT NOT NULL DEFAULT \'\', updated_at TEXT DEFAULT ' + now + ', UNIQUE (scheme_id, sku_code))');
  run('CREATE TABLE IF NOT EXISTS price_system_srp_values (id TEXT PRIMARY KEY NOT NULL, scheme_id TEXT NOT NULL, sku_code TEXT NOT NULL, value NUMERIC(18,6) NOT NULL, updated_by TEXT NOT NULL DEFAULT \'\', updated_at TEXT DEFAULT ' + now + ', UNIQUE (scheme_id, sku_code))');
  run('CREATE INDEX IF NOT EXISTS idx_price_system_landing_costs_scheme_sku ON price_system_landing_costs(scheme_id, sku_code)');
  run('CREATE INDEX IF NOT EXISTS idx_price_system_srp_values_scheme_sku ON price_system_srp_values(scheme_id, sku_code)');
  run('CREATE INDEX IF NOT EXISTS idx_price_system_fields_source_ref ON price_system_fields(source_scheme_id, source_field_key, is_active)');
  run('CREATE INDEX IF NOT EXISTS idx_price_system_fields_scheme_ref ON price_system_fields(scheme_id, field_type, is_active)');
}

module.exports = { ensurePriceSystemSchema };
