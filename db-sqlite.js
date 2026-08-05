/**
 * 数据库连接模块
 * 本地开发使用 SQLite（better-sqlite3），无需安装数据库
 * 云端部署时可切换为 PostgreSQL（参考售后系统 db.js）
 */

const path = require('path');
const fs = require('fs');

// node:sqlite 兼容层（better-sqlite3 原生绑定不可用时回退）
function createNodeSqliteDB(dbPath) {
  const { DatabaseSync } = require('node:sqlite');
  const _db = new DatabaseSync(dbPath);
  let _inTx = false;
  return {
    _db,
    get inTransaction() { return _inTx; },
    pragma(str) { return _db.prepare(`PRAGMA ${str}`).all(); },
    exec(sql) {
      _db.exec(sql);
      const u = sql.trim().toUpperCase();
      if (u.startsWith('BEGIN')) _inTx = true;
      else if (u.startsWith('COMMIT')) _inTx = false;
      else if (u.startsWith('ROLLBACK') && !u.startsWith('ROLLBACK TO')) _inTx = false;
    },
    prepare(sql) { return _db.prepare(sql); },
    close() { return _db.close(); },
  };
}

let db = null;

function getDB() {
  if (db) return db;

  const dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'inventory.db');
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

  // 优先 better-sqlite3，回退 node:sqlite（环境修复，非业务变更）
  try {
    const BetterDB = require('better-sqlite3');
    db = new BetterDB(dbPath);
  } catch (_e) {
    db = createNodeSqliteDB(dbPath);
    console.log('[DB] better-sqlite3 原生绑定不可用，回退到 node:sqlite');
  }
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  // 为 server.js salesOrderDateExpr 提供跨库兼容函数（PG 原生支持 strpos）
  try {
    if (typeof db.function === 'function') {
      db.function('strpos', (text, search) => {
        const s = text == null ? '' : String(text);
        const t = search == null ? '' : String(search);
        return t === '' ? 0 : s.indexOf(t) + 1;
      });
    }
  } catch (_e) { /* 忽略自定义函数注册失败 */ }

  console.log('[DB] SQLite 数据库已连接:', dbPath);
  return db;
}

/**
 * 执行查询（返回所有行）
 */
function query(sql, params = []) {
  const d = getDB();
  const stmt = d.prepare(sql);
  const result = stmt.all(...params);
  return { rows: result };
}

/**
 * 执行查询（返回单行）
 */
function queryOne(sql, params = []) {
  const d = getDB();
  const stmt = d.prepare(sql);
  return stmt.get(...params);
}

/**
 * 执行写操作（INSERT/UPDATE/DELETE），返回变化行数
 */
function run(sql, params = []) {
  const d = getDB();
  const stmt = d.prepare(sql);
  const info = stmt.run(...params);
  return info;
}

/**
 * 批量执行（事务）
 *
 * 统一 SQLite 与 PG 的 async transaction 语义：
 * - sync 回调：开启事务后同步执行回调，成功 COMMIT / 失败 ROLLBACK（与原 better-sqlite3 行为一致，零回归）。
 * - async 回调：开启事务后 await 回调，成功 COMMIT / 失败 ROLLBACK（支持 PG 化的 async DAL）。
 * - 嵌套事务：若已在事务内（含外层 SAVEPOINT），则使用 SAVEPOINT 而非 BEGIN，回滚到保存点，
 *   保留 better-sqlite3 原生嵌套/savepoint 语义。
 * 注意：本函数对回调仅调用一次（同步执行以取其返回值/ Promise），不会重复执行。
 */
let _txSavepointSeq = 0;

function isThenable(v) {
  return v && (typeof v === 'object' || typeof v === 'function') && typeof v.then === 'function';
}

function transaction(fn) {
  const d = getDB();
  const inTx = d.inTransaction;
  const spName = inTx ? `inv_tx_sp_${++_txSavepointSeq}` : null;

  if (inTx) {
    d.exec(`SAVEPOINT ${spName}`);
  } else {
    d.exec('BEGIN');
  }

  let result;
  try {
    result = fn();
  } catch (err) {
    if (inTx) d.exec(`ROLLBACK TO ${spName}`);
    else d.exec('ROLLBACK');
    throw err;
  }

  // 同步回调：立即提交并返回结果（含回调的返回值）
  if (!isThenable(result)) {
    if (inTx) d.exec(`RELEASE SAVEPOINT ${spName}`);
    else d.exec('COMMIT');
    return result;
  }

  // 异步回调：等待 Promise 完成后再提交
  return result.then(
    (val) => {
      if (inTx) d.exec(`RELEASE SAVEPOINT ${spName}`);
      else d.exec('COMMIT');
      return val;
    },
    (err) => {
      if (inTx) d.exec(`ROLLBACK TO ${spName}`);
      else d.exec('ROLLBACK');
      throw err;
    }
  );
}

/**
 * 生成 UUID
 */
function genId(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * 初始化数据库表
 */
function initDatabase() {
  const d = getDB();

  // ==================== 系统管理表 ====================

  // 角色
  d.exec(`
    CREATE TABLE IF NOT EXISTS roles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      permissions TEXT DEFAULT '[]',
      is_system INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // 用户
  d.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password TEXT DEFAULT '',
      role_id TEXT DEFAULT 'role_viewer',
      status TEXT DEFAULT 'active',
      email TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // ==================== AUTH-FEISHU 认证扩展（幂等迁移） ====================
  (function authFeishuMigration(){
    const userCols = [
      "ALTER TABLE users ADD COLUMN auth_source TEXT NOT NULL DEFAULT 'feishu'",
      "ALTER TABLE users ADD COLUMN feishu_open_id TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE users ADD COLUMN feishu_union_id TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE users ADD COLUMN feishu_user_id TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE users ADD COLUMN password_hash TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE users ADD COLUMN last_login_at TEXT NOT NULL DEFAULT ''",
      // I18N-100P-B1：用户语言偏好（飞书通知按收件人语言发送）；默认 zh；白名单校验在 API 层
      "ALTER TABLE users ADD COLUMN language_preference TEXT NOT NULL DEFAULT 'zh'"
    ];
    for (const sql of userCols) { try { d.exec(sql); } catch(e) {} }

    try { d.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_union_id ON users(feishu_union_id) WHERE feishu_union_id <> ''"); } catch(e) {}
    try { d.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_open_id ON users(feishu_open_id) WHERE feishu_open_id <> ''"); } catch(e) {}

    d.exec(`CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      user_agent TEXT DEFAULT '',
      ip_address TEXT DEFAULT ''
    )`);
    d.exec("CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)");
    d.exec("CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)");

    d.exec(`CREATE TABLE IF NOT EXISTS oauth_states (
      state TEXT PRIMARY KEY,
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    )`);
    d.exec("CREATE INDEX IF NOT EXISTS idx_oauth_states_expires ON oauth_states(expires_at)");

    d.exec(`CREATE TABLE IF NOT EXISTS login_audit (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      username TEXT DEFAULT '',
      auth_source TEXT NOT NULL,
      success INTEGER NOT NULL,
      fail_reason TEXT DEFAULT '',
      ip TEXT DEFAULT '',
      user_agent TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )`);
    d.exec("CREATE INDEX IF NOT EXISTS idx_login_audit_user ON login_audit(user_id)");
    d.exec("CREATE INDEX IF NOT EXISTS idx_login_audit_created ON login_audit(created_at)");
  })();

  // 国家
  d.exec(`
    CREATE TABLE IF NOT EXISTS countries (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT NOT NULL,
      default_currency TEXT DEFAULT '',
      status TEXT DEFAULT 'active',
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // 仓库
  d.exec(`
    CREATE TABLE IF NOT EXISTS warehouses (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      country_id TEXT DEFAULT '',
      country_name TEXT DEFAULT '',
      warehouse_type TEXT DEFAULT 'self',
      address TEXT DEFAULT '',
      status TEXT DEFAULT 'active',
      brands TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  // 兼容升级：已存在的旧表添加 brands 列
  try { d.exec("ALTER TABLE warehouses ADD COLUMN brands TEXT DEFAULT ''"); } catch(e) {}

  // 供应商
  d.exec(`
    CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      short_name TEXT DEFAULT '',
      contact_person TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      email TEXT DEFAULT '',
      address TEXT DEFAULT '',
      associated_brands TEXT DEFAULT '[]',
      default_currency TEXT DEFAULT 'USD',
      payment_terms TEXT DEFAULT '',
      remark TEXT DEFAULT '',
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // 供应商付款条件（结构化多条，独立于付款申请模块的 payment_terms 目录表）
  // term_type: advance(预付) / credit(信用) / other(其他)；credit/other 可填 credit_days（信用天数，手动输入）
  d.exec(`
    CREATE TABLE IF NOT EXISTS supplier_payment_terms (
      id TEXT PRIMARY KEY,
      supplier_id TEXT NOT NULL,
      term_name TEXT DEFAULT '',
      term_type TEXT DEFAULT 'advance',
      credit_days INTEGER DEFAULT 0,
      is_default INTEGER DEFAULT 0,
      display_order INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // 供应商供应关系配置（一行=一个有效供应组合 supplier+brand+country+warehouse）
  // warehouse_id 关联 warehouses.id；页面显示时 LEFT JOIN warehouses 带出 warehouse_name
  d.exec(`
    CREATE TABLE IF NOT EXISTS supplier_brand_configs (
      id TEXT PRIMARY KEY,
      supplier_id TEXT NOT NULL,
      brand TEXT DEFAULT '',
      country TEXT DEFAULT '',
      warehouse_id TEXT DEFAULT '',
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // 品牌采购状态主数据（停采品牌系统级规则）：brand=品牌名(主键)，procurement_status=active(可采购)/stopped(停采)
  d.exec(`
    CREATE TABLE IF NOT EXISTS brand_settings (
      brand TEXT PRIMARY KEY,
      procurement_status TEXT DEFAULT 'active',
      note TEXT DEFAULT '',
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // 货代
  d.exec(`
    CREATE TABLE IF NOT EXISTS freight_forwarders (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      short_name TEXT DEFAULT '',
      contact_person TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      email TEXT DEFAULT '',
      service_types TEXT DEFAULT '',
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // 币种
  d.exec(`
    CREATE TABLE IF NOT EXISTS currencies (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      symbol TEXT DEFAULT '',
      is_base INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // 汇率
  d.exec(`
    CREATE TABLE IF NOT EXISTS exchange_rates (
      id TEXT PRIMARY KEY,
      from_currency TEXT NOT NULL,
      to_currency TEXT NOT NULL,
      rate REAL NOT NULL,
      rate_date TEXT NOT NULL,
      rate_type TEXT DEFAULT 'realtime',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // 付款条件
  d.exec(`
    CREATE TABLE IF NOT EXISTS payment_terms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      payee_type TEXT DEFAULT 'factory',
      payment_type TEXT DEFAULT 'goods',
      payment_stage TEXT DEFAULT 'deposit',
      payment_node TEXT DEFAULT 'after_pi',
      ratio REAL DEFAULT 0,
      remind_days_before INTEGER DEFAULT 7,
      is_enabled INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // 审批流配置
  d.exec(`
    CREATE TABLE IF NOT EXISTS approval_flows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      business_type TEXT NOT NULL,
      levels TEXT DEFAULT '[]',
      is_enabled INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      completion_cc_user_ids TEXT DEFAULT '[]'
    )
  `);
  // PAY-CORE Phase 1：兼容升级，已存在的旧表添加 completion_cc_user_ids 列（幂等）
  try { d.exec("ALTER TABLE approval_flows ADD COLUMN completion_cc_user_ids TEXT DEFAULT '[]'"); } catch(e) {}

  // 费用类型
  d.exec(`
    CREATE TABLE IF NOT EXISTS expense_types (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT DEFAULT '',
      is_freight INTEGER DEFAULT 0,
      is_cost INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // 分摊规则
  d.exec(`
    CREATE TABLE IF NOT EXISTS allocation_rules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      transport_mode TEXT DEFAULT 'sea',
      expense_type TEXT DEFAULT 'freight',
      allocation_basis TEXT DEFAULT 'cbm',
      is_enabled INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // SKU 渠道比例人工配置（CHANNEL-ALLOCATION-MODEL）
  d.exec(`
    CREATE TABLE IF NOT EXISTS sku_channel_configs (
      id           TEXT PRIMARY KEY,
      sku_code     TEXT NOT NULL,
      country_id   TEXT NOT NULL,
      online_pct   REAL NOT NULL,
      offline_pct  REAL NOT NULL,
      status       TEXT DEFAULT 'active',
      remark       TEXT DEFAULT '',
      created_at   TEXT DEFAULT (datetime('now')),
      updated_at   TEXT DEFAULT (datetime('now')),
      UNIQUE (sku_code, country_id)
    )
  `);

  // 系统配置
  d.exec(`
    CREATE TABLE IF NOT EXISTS system_config (
      key TEXT PRIMARY KEY,
      value TEXT DEFAULT '',
      description TEXT DEFAULT '',
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // 订单预测页面用户偏好（账号级、跨浏览器；独立于全局系统配置）
  d.exec(`
    CREATE TABLE IF NOT EXISTS forecast_page_preferences (
      user_id TEXT PRIMARY KEY,
      preferences TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // 审批记录
  d.exec(`
    CREATE TABLE IF NOT EXISTS approval_records (
      id TEXT PRIMARY KEY,
      business_type TEXT NOT NULL,
      business_id TEXT NOT NULL,
      business_code TEXT DEFAULT '',
      submitter_id TEXT DEFAULT '',
      submitter_name TEXT DEFAULT '',
      current_level INTEGER DEFAULT 0,
      max_level INTEGER DEFAULT 1,
      approvers TEXT DEFAULT '[]',
      approval_history TEXT DEFAULT '[]',
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // 业务参与人（通用 CC / Owner 模型；V1 仅实现 participant_type='cc'，owner 仅预留列、不进任何代码逻辑）
  // business_type 区分业务对象（V1='approval'；预留 'ci_prep'/'payment_reminder'），business_id 为业务对象主键；
  // 不绑定 approval 专属，为 CI 运营准备 / 付款提醒等未来场景预留复用。
  d.exec(`
    CREATE TABLE IF NOT EXISTS business_participants (
      id TEXT PRIMARY KEY,
      business_type TEXT NOT NULL,
      business_id TEXT NOT NULL,
      participant_type TEXT NOT NULL,
      user_id TEXT NOT NULL,
      user_name TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // ==================== 业务表 ====================

  // SKU 主数据
  d.exec(`
    CREATE TABLE IF NOT EXISTS skus (
      id TEXT PRIMARY KEY,
      sku_code TEXT NOT NULL UNIQUE,
      product_name TEXT DEFAULT '',
      brand TEXT DEFAULT '',
      category TEXT DEFAULT '',
      model TEXT DEFAULT '',
      color_spec TEXT DEFAULT '',
      barcode TEXT DEFAULT '',
      default_supplier_id TEXT DEFAULT '',
      default_supplier_name TEXT DEFAULT '',
      purchase_currency TEXT DEFAULT 'USD',
      standard_purchase_price REAL DEFAULT 0,
      purchase_price_rmb REAL DEFAULT 0,
      purchase_price_usd REAL DEFAULT 0,
      reference_customs_rate REAL DEFAULT NULL,
      weighted_avg_cost REAL DEFAULT 0,
      carton_spec TEXT DEFAULT '',
      qty_per_carton INTEGER DEFAULT 0,
      unit_weight REAL DEFAULT 0,
      unit_cbm REAL DEFAULT 0,
      is_new_product INTEGER DEFAULT 0,
      launch_date TEXT DEFAULT '',
      new_product_protection_days INTEGER DEFAULT 90,
      lifecycle_status TEXT DEFAULT 'new_test',
      auto_replenish INTEGER DEFAULT 1,
      status TEXT DEFAULT 'normal',
      remark TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // 库存导入记录
  d.exec(`
    CREATE TABLE IF NOT EXISTS inventory_imports (
      id TEXT PRIMARY KEY,
      import_date TEXT NOT NULL,
      country TEXT DEFAULT '',
      warehouse TEXT DEFAULT '',
      channel TEXT DEFAULT '',
      sku_code TEXT DEFAULT '',
      available_qty INTEGER DEFAULT 0,
      last_inbound_date TEXT DEFAULT '',
      first_inbound_date TEXT DEFAULT '',
      remark TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // 库存总表
  d.exec(`
    CREATE TABLE IF NOT EXISTS inventory (
      id TEXT PRIMARY KEY,
      sku_code TEXT NOT NULL,
      country TEXT DEFAULT '',
      warehouse TEXT DEFAULT '',
      available_qty INTEGER DEFAULT 0,
      in_transit_qty INTEGER DEFAULT 0,
      pi_confirmed_unshipped_qty INTEGER DEFAULT 0,
      po_unconfirmed_pi_qty INTEGER DEFAULT 0,
      after_sales_defective_qty INTEGER DEFAULT 0,
      mdf_outbound_qty INTEGER DEFAULT 0,
      weighted_avg_cost REAL DEFAULT 0,
      inventory_value REAL DEFAULT 0,
      last_import_date TEXT DEFAULT '',
      last_inbound_date TEXT DEFAULT '',
      first_inbound_date TEXT DEFAULT '',
      last_outbound_date TEXT DEFAULT '',
      turnover_months REAL DEFAULT 0,
      inventory_status TEXT DEFAULT 'normal',
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `)

  // 出库记录
  d.exec(`
    CREATE TABLE IF NOT EXISTS outbound_records (
      id TEXT PRIMARY KEY,
      outbound_no TEXT NOT NULL UNIQUE,
      outbound_date TEXT NOT NULL,
      country TEXT DEFAULT '',
      warehouse TEXT DEFAULT '',
      sku_code TEXT DEFAULT '',
      quantity INTEGER DEFAULT 0,
      outbound_type TEXT DEFAULT '',
      channel TEXT DEFAULT '',
      platform TEXT DEFAULT '',
      mdf_type TEXT DEFAULT '',
      related_project TEXT DEFAULT '',
      count_for_forecast INTEGER DEFAULT 1,
      consume_inventory INTEGER DEFAULT 1,
      remark TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // 销量数据（旧表，保留兼容）
  d.exec(`
    CREATE TABLE IF NOT EXISTS sales_data (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      sku_code TEXT DEFAULT '',
      country TEXT DEFAULT '',
      channel TEXT DEFAULT '',
      platform TEXT DEFAULT '',
      quantity INTEGER DEFAULT 0,
      amount REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // 销售明细数据（新表 —— 从BigSeller/至速/EDA等系统导入，统一格式）
  d.exec(`
    CREATE TABLE IF NOT EXISTS sales_records (
      id TEXT PRIMARY KEY,
      source_system TEXT DEFAULT '',
      order_no TEXT DEFAULT '',
      order_detail_id TEXT DEFAULT '',
      order_date TEXT NOT NULL,
      shop_platform TEXT DEFAULT '',
      brand TEXT DEFAULT '',
      sku_code TEXT NOT NULL,
      quantity INTEGER DEFAULT 0,
      is_valid_order INTEGER DEFAULT 1,
      original_order_status TEXT DEFAULT '',
      remark TEXT DEFAULT '',
      import_batch_id TEXT DEFAULT '',
      country TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  // 幂等迁移：sales_records 增加 country 列（旧库可能不存在）
  try { d.exec(`ALTER TABLE sales_records ADD COLUMN country TEXT DEFAULT ''`); } catch (e) { /* 列已存在 */ }
  // 唯一索引：来源系统 + 订单号 + SKU + 店铺/平台（防止重复导入）
  d.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_records_unique ON sales_records(source_system, order_no, sku_code, COALESCE(shop_platform, ''))`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_sales_records_sku ON sales_records(sku_code)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_sales_records_date ON sales_records(order_date)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_sales_records_valid ON sales_records(is_valid_order)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_sales_records_batch ON sales_records(import_batch_id)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_sales_records_country ON sales_records(country)`);

  // 销售导入控制表：记录可恢复的阶段进度、幂等指纹和最终结果。
  d.exec(`
    CREATE TABLE IF NOT EXISTS sales_import_runs (
      import_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      phase TEXT NOT NULL DEFAULT '',
      percent INTEGER,
      processed_count INTEGER NOT NULL DEFAULT 0,
      total_count INTEGER NOT NULL DEFAULT 0,
      inserted INTEGER NOT NULL DEFAULT 0,
      updated INTEGER NOT NULL DEFAULT 0,
      skipped INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0,
      errors_json TEXT NOT NULL DEFAULT '[]',
      timings_json TEXT NOT NULL DEFAULT '{}',
      metrics_json TEXT NOT NULL DEFAULT '{}',
      result_json TEXT NOT NULL DEFAULT '{}',
      commit_state TEXT NOT NULL DEFAULT 'uncommitted',
      recalc_status TEXT NOT NULL DEFAULT 'pending',
      request_fingerprint TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_sales_import_runs_status ON sales_import_runs(status)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_sales_import_runs_updated ON sales_import_runs(updated_at)`);

  // 补货建议
  d.exec(`
    CREATE TABLE IF NOT EXISTS replenishment_suggestions (
      id TEXT PRIMARY KEY,
      sku_code TEXT NOT NULL,
      country TEXT DEFAULT '',
      target_warehouse TEXT DEFAULT '',
      available_qty INTEGER DEFAULT 0,
      in_transit_qty INTEGER DEFAULT 0,
      pi_confirmed_unshipped_qty INTEGER DEFAULT 0,
      po_unconfirmed_pi_qty INTEGER DEFAULT 0,
      total_inventory_pool INTEGER DEFAULT 0,
      sales_m1 INTEGER DEFAULT 0,
      sales_m2 INTEGER DEFAULT 0,
      sales_m3 INTEGER DEFAULT 0,
      sales_m4 INTEGER DEFAULT 0,
      avg_sales_4m REAL DEFAULT 0,
      online_sales_30d INTEGER DEFAULT 0,
      online_sales_60d INTEGER DEFAULT 0,
      online_sales_90d INTEGER DEFAULT 0,
      offline_sales_30d INTEGER DEFAULT 0,
      offline_sales_60d INTEGER DEFAULT 0,
      offline_sales_90d INTEGER DEFAULT 0,
      manual_forecast_online INTEGER DEFAULT 0,
      manual_forecast_offline INTEGER DEFAULT 0,
      mdf_forecast_monthly INTEGER DEFAULT 0,
      total_monthly_forecast INTEGER DEFAULT 0,
      current_turnover_months REAL DEFAULT 0,
      after_order_turnover_months REAL DEFAULT 0,
      target_stock_months REAL DEFAULT 0,
      suggested_qty INTEGER DEFAULT 0,
      user_adjusted_qty INTEGER DEFAULT -1,
      moq_qty INTEGER DEFAULT 0,
      carton_adjusted_qty INTEGER DEFAULT 0,
      is_new_product INTEGER DEFAULT 0,
      lifecycle_status TEXT DEFAULT '',
      sales_group TEXT DEFAULT '',
      suggestion TEXT DEFAULT '',
      risk_level TEXT DEFAULT '',
      arrival_month TEXT DEFAULT '',
      generate_po INTEGER DEFAULT 0,
      sales_status TEXT DEFAULT '',
      risk_tags TEXT DEFAULT '',
      sales_reason TEXT DEFAULT '',
      action TEXT DEFAULT '',
      ai_business_advice TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // 补货建议表字段迁移（兼容旧数据库）
  try {
    d.exec(`ALTER TABLE replenishment_suggestions ADD COLUMN total_inventory_pool INTEGER DEFAULT 0`);
  } catch(e) {}
  try {
    d.exec(`ALTER TABLE replenishment_suggestions ADD COLUMN sales_m1 INTEGER DEFAULT 0`);
  } catch(e) {}
  try {
    d.exec(`ALTER TABLE replenishment_suggestions ADD COLUMN sales_m2 INTEGER DEFAULT 0`);
  } catch(e) {}
  try {
    d.exec(`ALTER TABLE replenishment_suggestions ADD COLUMN sales_m3 INTEGER DEFAULT 0`);
  } catch(e) {}
  try {
    d.exec(`ALTER TABLE replenishment_suggestions ADD COLUMN sales_m4 INTEGER DEFAULT 0`);
  } catch(e) {}
  try {
    d.exec(`ALTER TABLE replenishment_suggestions ADD COLUMN avg_sales_4m REAL DEFAULT 0`);
  } catch(e) {}
  try {
    d.exec(`ALTER TABLE replenishment_suggestions ADD COLUMN after_order_turnover_months REAL DEFAULT 0`);
  } catch(e) {}
  try {
    d.exec(`ALTER TABLE replenishment_suggestions ADD COLUMN target_stock_months REAL DEFAULT 0`);
  } catch(e) {}
  try {
    d.exec(`ALTER TABLE replenishment_suggestions ADD COLUMN user_adjusted_qty INTEGER DEFAULT -1`);
  } catch(e) {}
  try {
    d.exec(`ALTER TABLE replenishment_suggestions ADD COLUMN risk_level TEXT DEFAULT ''`);
  } catch(e) {}
  try {
    d.exec(`ALTER TABLE replenishment_suggestions ADD COLUMN arrival_month TEXT DEFAULT ''`);
  } catch(e) {}
  try {
    d.exec(`ALTER TABLE replenishment_suggestions ADD COLUMN sales_group TEXT DEFAULT ''`);
  } catch(e) {}
  // 新增：线上/线下分月销量字段（用于SKU动销与订单预测页面Tab切换）
  ['online_sales_m1','online_sales_m2','online_sales_m3','online_sales_m4',
   'offline_sales_m1','offline_sales_m2','offline_sales_m3','offline_sales_m4',
   'online_avg_sales_4m','offline_avg_sales_4m',
   'online_after_order_turnover_months','offline_after_order_turnover_months'].forEach(col => {
    try { d.exec(`ALTER TABLE replenishment_suggestions ADD COLUMN ${col} REAL DEFAULT 0`); } catch(e) {}
  });
  // 新增：线上/线下额外预留字段（用于线上预测/线下预测 Tab 的按月模式调整）
  ['online_reservation_method TEXT DEFAULT \'\'',
   'online_reservation_months REAL DEFAULT 0',
   'online_reservation_qty INTEGER DEFAULT 0',
   'online_remark TEXT DEFAULT \'\'',
   'offline_reservation_method TEXT DEFAULT \'\'',
   'offline_reservation_months REAL DEFAULT 0',
   'offline_reservation_qty INTEGER DEFAULT 0',
   'offline_remark TEXT DEFAULT \'\''
  ].forEach(col => {
    try { d.exec(`ALTER TABLE replenishment_suggestions ADD COLUMN ${col}`); } catch(e) {}
  });
  // 新增：目标周转/最终下单/调整原因字段（用于按月模式重构）
  ['online_target_turnover REAL DEFAULT 2',
   'offline_target_turnover REAL DEFAULT 2',
   'online_target_stock INTEGER DEFAULT 0',
   'offline_target_stock INTEGER DEFAULT 0',
   'other_target_stock INTEGER DEFAULT 0',
   'final_order_qty INTEGER DEFAULT -1',
   'adjustment_reason TEXT DEFAULT \'\''
  ].forEach(col => {
    try { d.exec(`ALTER TABLE replenishment_suggestions ADD COLUMN ${col}`); } catch(e) {}
  });
  // 新增：统一判断层字段（sales_status 互斥主状态；risk_tags 并行风险标签；sales_reason/action/ai_business_advice）
  ['sales_status TEXT DEFAULT \'\'',
   'risk_tags TEXT DEFAULT \'\'',
   'sales_reason TEXT DEFAULT \'\'',
   'action TEXT DEFAULT \'\'',
   'ai_business_advice TEXT DEFAULT \'\''
  ].forEach(col => {
    try { d.exec(`ALTER TABLE replenishment_suggestions ADD COLUMN ${col}`); } catch(e) {}
  });
  // D1 新增：销量统计周期月均字段（按 sales_stats_days 计算的月均销量，仅用于展示层）
  ['avg_sales_period REAL DEFAULT 0',
   'online_avg_sales_period REAL DEFAULT 0',
   'offline_avg_sales_period REAL DEFAULT 0'
  ].forEach(col => {
    try { d.exec(`ALTER TABLE replenishment_suggestions ADD COLUMN ${col}`); } catch(e) {}
  });
  // 三页建议采购口径统一：渠道分量列（单源口径；suggested_qty = 三分量之和）
  ['online_suggested_qty INTEGER DEFAULT 0',
   'offline_suggested_qty INTEGER DEFAULT 0',
   'other_suggested_qty INTEGER DEFAULT 0'
  ].forEach(col => {
    try { d.exec(`ALTER TABLE replenishment_suggestions ADD COLUMN ${col}`); } catch(e) {}
  });

  // CHANNEL-ALLOCATION-MODEL：渠道分配模型字段
  ['channel_ratio_source TEXT DEFAULT \'\'',
   'channel_allocation_status TEXT DEFAULT \'\'',
   'resolved_online_pct REAL',
   'resolved_at TEXT DEFAULT \'\''
  ].forEach(col => {
    try { d.exec(`ALTER TABLE replenishment_suggestions ADD COLUMN ${col}`); } catch(e) {}
  });

  // PI 明细：折扣列（比例 0~1，默认 0；向后兼容，已有明细折扣=0 行为不变）
  try { d.exec(`ALTER TABLE proforma_invoice_items ADD COLUMN discount REAL DEFAULT 0`); } catch(e) {}

  // PO 主表
  d.exec(`
    CREATE TABLE IF NOT EXISTS purchase_orders (
      id TEXT PRIMARY KEY,
      po_no TEXT NOT NULL UNIQUE,
      supplier_id TEXT DEFAULT '',
      supplier_name TEXT DEFAULT '',
      brand TEXT DEFAULT '',
      country TEXT DEFAULT '',
      target_warehouse TEXT DEFAULT '',
      po_date TEXT NOT NULL,
      expected_delivery TEXT DEFAULT '',
      currency TEXT DEFAULT 'USD',
      total_amount REAL DEFAULT 0,
      created_by TEXT DEFAULT '',
      created_by_name TEXT DEFAULT '',
      approver_id TEXT DEFAULT '',
      approver_name TEXT DEFAULT '',
      po_status TEXT DEFAULT 'draft',
      approval_status TEXT DEFAULT 'pending',
      from_suggestion INTEGER DEFAULT 0,
      attachment TEXT DEFAULT '',
      remark TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // PO 明细
  d.exec(`
    CREATE TABLE IF NOT EXISTS purchase_order_items (
      id TEXT PRIMARY KEY,
      po_id TEXT NOT NULL,
      po_no TEXT DEFAULT '',
      sku_code TEXT NOT NULL,
      po_qty INTEGER DEFAULT 0,
      unit_price REAL DEFAULT 0,
      po_amount REAL DEFAULT 0,
      transferred_pi_qty INTEGER DEFAULT 0,
      untransferred_pi_qty INTEGER DEFAULT 0,
      forecast_turnover_months REAL DEFAULT 0,
      remark TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // PI 主表
  d.exec(`
    CREATE TABLE IF NOT EXISTS proforma_invoices (
      id TEXT PRIMARY KEY,
      pi_no TEXT NOT NULL UNIQUE,
      related_po_id TEXT DEFAULT '',
      related_po_no TEXT DEFAULT '',
      supplier_id TEXT DEFAULT '',
      supplier_name TEXT DEFAULT '',
      brand TEXT DEFAULT '',
      country TEXT DEFAULT '',
      target_warehouse TEXT DEFAULT '',
      pi_date TEXT NOT NULL,
      currency TEXT DEFAULT 'USD',
      total_amount REAL DEFAULT 0,
      payment_terms TEXT DEFAULT '',
      need_deposit INTEGER DEFAULT 1,
      deposit_ratio REAL DEFAULT 0,
      balance_ratio REAL DEFAULT 100,
      payable_deposit REAL DEFAULT 0,
      paid_deposit REAL DEFAULT 0,
      deducted_deposit REAL DEFAULT 0,
      available_deduct_deposit REAL DEFAULT 0,
      shipped_amount REAL DEFAULT 0,
      unshipped_amount REAL DEFAULT 0,
      deposit_payment_status TEXT DEFAULT 'unpaid',
      goods_payment_status TEXT DEFAULT 'unpaid',
      pi_status TEXT DEFAULT 'pending',
      expected_delivery TEXT DEFAULT '',
      attachment TEXT DEFAULT '',
      remark TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // PI 明细
  d.exec(`
    CREATE TABLE IF NOT EXISTS proforma_invoice_items (
      id TEXT PRIMARY KEY,
      pi_id TEXT NOT NULL,
      pi_no TEXT DEFAULT '',
      po_no TEXT DEFAULT '',
      sku_code TEXT NOT NULL,
      po_qty INTEGER DEFAULT 0,
      pi_confirmed_qty INTEGER DEFAULT 0,
      unit_price REAL DEFAULT 0,
      pi_amount REAL DEFAULT 0,
      shipped_qty INTEGER DEFAULT 0,
      unshipped_qty INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // CI 主表
  d.exec(`
    CREATE TABLE IF NOT EXISTS commercial_invoices (
      id TEXT PRIMARY KEY,
      ci_no TEXT NOT NULL UNIQUE,
      related_po_id TEXT DEFAULT '',
      related_po_no TEXT DEFAULT '',
      related_pi_id TEXT DEFAULT '',
      related_pi_no TEXT DEFAULT '',
      related_pi_ids TEXT DEFAULT '',
      related_pi_nos TEXT DEFAULT '',
      supplier_id TEXT DEFAULT '',
      supplier_name TEXT DEFAULT '',
      brand TEXT DEFAULT '',
      country TEXT DEFAULT '',
      target_warehouse TEXT DEFAULT '',
      ci_date TEXT NOT NULL,
      shipment_batch INTEGER DEFAULT 1,
      currency TEXT DEFAULT 'USD',
      goods_amount REAL DEFAULT 0,
      pi_total_amount REAL DEFAULT 0,
      amount_difference REAL DEFAULT 0,
      difference_reason TEXT DEFAULT '',
      ci_status TEXT DEFAULT 'draft',
      should_deduct_deposit REAL DEFAULT 0,
      actual_deducted_deposit REAL DEFAULT 0,
      payable_balance REAL DEFAULT 0,
      paid_balance REAL DEFAULT 0,
      unpaid_balance REAL DEFAULT 0,
      balance_payment_status TEXT DEFAULT 'unpaid',
      transport_basis TEXT DEFAULT NULL,
      import_duty_total REAL DEFAULT 0,
      attachment TEXT DEFAULT '',
      pl_attachment TEXT DEFAULT '',
      remark TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // 历史 CI 财务导入：与运营 CI 完全隔离，只承载历史货款及其应付结算。
  d.exec(`
    CREATE TABLE IF NOT EXISTS historical_commercial_invoices (
      id TEXT PRIMARY KEY,
      historical_ci_no TEXT NOT NULL,
      supplier_id TEXT DEFAULT '',
      supplier_name TEXT NOT NULL,
      supplier_identity TEXT NOT NULL,
      brand_id TEXT DEFAULT '',
      brand_name TEXT NOT NULL,
      country TEXT NOT NULL,
      ci_date TEXT NOT NULL,
      currency TEXT NOT NULL,
      gross_goods_amount REAL NOT NULL,
      historical_paid_amount REAL NOT NULL DEFAULT 0,
      historical_paid_date TEXT DEFAULT NULL,
      payment_terms TEXT DEFAULT '',
      due_date TEXT DEFAULT '',
      source_note TEXT DEFAULT '',
      source_mode TEXT NOT NULL DEFAULT 'historical',
      idempotency_key TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      payment_request_id TEXT DEFAULT '',
      created_by TEXT DEFAULT '',
      created_by_name TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      CHECK (source_mode = 'historical'),
      CHECK (gross_goods_amount > 0),
      CHECK (historical_paid_amount >= 0),
      CHECK (historical_paid_amount <= gross_goods_amount)
    )
  `);

  // 历史 CI SKU 级明细（价格快照，创建后不可编辑）
  d.exec(`
    CREATE TABLE IF NOT EXISTS historical_commercial_invoice_items (
      id TEXT PRIMARY KEY,
      hci_id TEXT NOT NULL,
      hci_no TEXT DEFAULT '',
      pi_id TEXT DEFAULT '',
      pi_no TEXT DEFAULT '',
      sku_code TEXT NOT NULL,
      shipped_qty INTEGER DEFAULT 0,
      unit_price REAL DEFAULT 0,
      discount REAL DEFAULT 0,
      net_unit_price REAL DEFAULT 0,
      ci_amount REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  d.exec(`CREATE INDEX IF NOT EXISTS ix_hci_items_hci_id ON historical_commercial_invoice_items(hci_id)`);

  // CI 明细
  d.exec(`
    CREATE TABLE IF NOT EXISTS commercial_invoice_items (
      id TEXT PRIMARY KEY,
      ci_id TEXT NOT NULL,
      ci_no TEXT DEFAULT '',
      pi_no TEXT DEFAULT '',
      pi_id TEXT DEFAULT '',
      sku_code TEXT NOT NULL,
      shipped_qty INTEGER DEFAULT 0,
      unit_price REAL DEFAULT 0,
      ci_amount REAL DEFAULT 0,
      actual_customs_rate REAL DEFAULT NULL,
      inbound_qty INTEGER DEFAULT 0,
      uninbound_qty INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // PL 主表
  d.exec(`
    CREATE TABLE IF NOT EXISTS packing_lists (
      id TEXT PRIMARY KEY,
      pl_no TEXT NOT NULL UNIQUE,
      related_po_id TEXT DEFAULT '',
      related_po_no TEXT DEFAULT '',
      related_pi_id TEXT DEFAULT '',
      related_pi_no TEXT DEFAULT '',
      related_ci_id TEXT DEFAULT '',
      related_ci_no TEXT DEFAULT '',
      supplier_id TEXT DEFAULT '',
      supplier_name TEXT DEFAULT '',
      brand TEXT DEFAULT '',
      country TEXT DEFAULT '',
      target_warehouse TEXT DEFAULT '',
      pl_date TEXT DEFAULT '',
      total_qty INTEGER DEFAULT 0,
      total_cartons INTEGER DEFAULT 0,
      total_gross_weight REAL DEFAULT 0,
      total_net_weight REAL DEFAULT 0,
      total_cbm REAL DEFAULT 0,
      attachment TEXT DEFAULT '',
      remark TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // PL 明细
  d.exec(`
    CREATE TABLE IF NOT EXISTS packing_list_items (
      id TEXT PRIMARY KEY,
      pl_id TEXT NOT NULL,
      pl_no TEXT DEFAULT '',
      ci_no TEXT DEFAULT '',
      sku_code TEXT NOT NULL,
      cartons INTEGER DEFAULT 0,
      qty_per_carton INTEGER DEFAULT 0,
      total_qty INTEGER DEFAULT 0,
      gross_weight REAL DEFAULT 0,
      net_weight REAL DEFAULT 0,
      cbm REAL DEFAULT 0,
      remark TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // LOGISTICS-CLOSED-LOOP-PHASE1: packing_lists 新增状态/物流关联/更新时间
  try { d.exec("ALTER TABLE packing_lists ADD COLUMN status TEXT DEFAULT 'draft'"); } catch(e) {}
  try { d.exec("ALTER TABLE packing_lists ADD COLUMN logistics_batch_id TEXT DEFAULT ''"); } catch(e) {}
  try { d.exec("ALTER TABLE packing_lists ADD COLUMN updated_at TEXT DEFAULT (datetime('now'))"); } catch(e) {}

  // LOGISTICS-CLOSED-LOOP-PHASE1: packing_list_items 新增单箱重量/尺寸字段
  // 字段含义：gross_weight=总毛重, net_weight=总净重, cbm=总体积（已有，不新增）
  // 新增 per_carton 字段存储单箱值，length/width/height 存储箱规尺寸
  try { d.exec("ALTER TABLE packing_list_items ADD COLUMN gross_weight_per_carton REAL DEFAULT 0"); } catch(e) {}
  try { d.exec("ALTER TABLE packing_list_items ADD COLUMN net_weight_per_carton REAL DEFAULT 0"); } catch(e) {}
  try { d.exec("ALTER TABLE packing_list_items ADD COLUMN cbm_per_carton REAL DEFAULT 0"); } catch(e) {}
  try { d.exec("ALTER TABLE packing_list_items ADD COLUMN length REAL DEFAULT 0"); } catch(e) {}
  try { d.exec("ALTER TABLE packing_list_items ADD COLUMN width REAL DEFAULT 0"); } catch(e) {}
  try { d.exec("ALTER TABLE packing_list_items ADD COLUMN height REAL DEFAULT 0"); } catch(e) {}

  // 物流批次
  d.exec(`
    CREATE TABLE IF NOT EXISTS logistics_batches (
      id TEXT PRIMARY KEY,
      batch_no TEXT NOT NULL UNIQUE,
      related_ci_id TEXT DEFAULT '',
      related_ci_no TEXT DEFAULT '',
      forwarder_id TEXT DEFAULT '',
      forwarder_name TEXT DEFAULT '',
      transport_mode TEXT DEFAULT 'sea',
      origin_port TEXT DEFAULT '',
      dest_port TEXT DEFAULT '',
      target_country TEXT DEFAULT '',
      target_warehouse TEXT DEFAULT '',
      pickup_date TEXT DEFAULT '',
      depart_date TEXT DEFAULT '',
      eta_date TEXT DEFAULT '',
      actual_arrival_date TEXT DEFAULT '',
      customs_start_date TEXT DEFAULT '',
      customs_end_date TEXT DEFAULT '',
      delivery_date TEXT DEFAULT '',
      inbound_complete_date TEXT DEFAULT '',
      logistics_status TEXT DEFAULT 'pending',
      total_cartons INTEGER DEFAULT 0,
      total_weight REAL DEFAULT 0,
      total_cbm REAL DEFAULT 0,
      freight_currency TEXT DEFAULT 'USD',
      international_freight REAL DEFAULT 0,
      local_charges REAL DEFAULT 0,
      customs_service_fee REAL DEFAULT 0,
      delivery_fee REAL DEFAULT 0,
      total_freight REAL DEFAULT 0,
      customs_duty REAL DEFAULT 0,
      vat_gst REAL DEFAULT 0,
      other_fees REAL DEFAULT 0,
      fee_status TEXT DEFAULT 'unpaid',
      attachment TEXT DEFAULT '',
      remark TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // 入库单
  d.exec(`
    CREATE TABLE IF NOT EXISTS inbound_records (
      id TEXT PRIMARY KEY,
      inbound_no TEXT NOT NULL UNIQUE,
      source_ci_id TEXT DEFAULT '',
      source_ci_no TEXT DEFAULT '',
      source_pi_no TEXT DEFAULT '',
      source_logistics_batch_no TEXT DEFAULT '',
      delivery_batch_no TEXT DEFAULT '',
      country TEXT DEFAULT '',
      warehouse TEXT DEFAULT '',
      inbound_date TEXT NOT NULL,
      sku_code TEXT DEFAULT '',
      ci_shipped_qty INTEGER DEFAULT 0,
      expected_qty INTEGER DEFAULT 0,
      actual_qty INTEGER DEFAULT 0,
      accumulated_qty INTEGER DEFAULT 0,
      uninbound_qty INTEGER DEFAULT 0,
      abnormal_qty INTEGER DEFAULT 0,
      abnormal_reason TEXT DEFAULT '',
      inbound_status TEXT DEFAULT 'pending',
      attachment TEXT DEFAULT '',
      remark TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // 成本分摊记录
  d.exec(`
    CREATE TABLE IF NOT EXISTS cost_allocations (
      id TEXT PRIMARY KEY,
      inbound_id TEXT DEFAULT '',
      inbound_no TEXT DEFAULT '',
      logistics_batch_no TEXT DEFAULT '',
      allocation_run_id TEXT DEFAULT '',
      ci_no TEXT DEFAULT '',
      sku_code TEXT NOT NULL,
      allocation_basis TEXT DEFAULT '',
      product_cost REAL DEFAULT 0,
      allocated_freight REAL DEFAULT 0,
      allocated_duty REAL DEFAULT 0,
      allocated_other REAL DEFAULT 0,
      total_landing_cost REAL DEFAULT 0,
      inbound_qty INTEGER DEFAULT 0,
      unit_landing_cost REAL DEFAULT 0,
      currency TEXT DEFAULT 'USD',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // 每笔费用按 SKU 的分摊证据。cost_allocations 仍保留 SKU 汇总结果供 WAC 使用。
  d.exec(`
    CREATE TABLE IF NOT EXISTS cost_allocation_details (
      id TEXT PRIMARY KEY,
      allocation_run_id TEXT NOT NULL,
      ci_id TEXT NOT NULL,
      ci_no TEXT DEFAULT '',
      source_cost_item_id TEXT DEFAULT '',
      fee_key TEXT NOT NULL,
      cost_category TEXT DEFAULT '',
      cost_subcategory TEXT DEFAULT '',
      fee_total REAL NOT NULL DEFAULT 0,
      currency TEXT DEFAULT 'USD',
      sku_code TEXT NOT NULL,
      allocation_basis TEXT NOT NULL,
      basis_value REAL NOT NULL DEFAULT 0,
      basis_total REAL NOT NULL DEFAULT 0,
      ratio REAL NOT NULL DEFAULT 0,
      theoretical_amount REAL NOT NULL DEFAULT 0,
      rounded_amount REAL NOT NULL DEFAULT 0,
      rounding_adjustment REAL NOT NULL DEFAULT 0,
      final_allocated_amount REAL NOT NULL DEFAULT 0,
      is_rounding_anchor INTEGER NOT NULL DEFAULT 0,
      stable_sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(ci_id, fee_key, sku_code)
    )
  `);

  // 付款申请
  d.exec(`
    CREATE TABLE IF NOT EXISTS payment_requests (
      id TEXT PRIMARY KEY,
      request_no TEXT NOT NULL UNIQUE,
      payment_category TEXT DEFAULT '',
      payment_subcategory TEXT DEFAULT '',
      source_type TEXT DEFAULT '',
      source_id TEXT DEFAULT '',
      source_no TEXT DEFAULT '',
      payee_type TEXT DEFAULT '',
      payee_key TEXT NOT NULL DEFAULT '',
      payee_name_snapshot TEXT NOT NULL DEFAULT '',
      supplier_name TEXT DEFAULT '',
      payable_amount REAL DEFAULT 0,
      paid_amount REAL DEFAULT 0,
      unpaid_amount REAL DEFAULT 0,
      currency TEXT DEFAULT 'USD',
      book_rate REAL DEFAULT 0,
      actual_rate REAL DEFAULT 0,
      local_amount REAL DEFAULT 0,
      rmb_amount REAL DEFAULT 0,
      usd_amount REAL DEFAULT 0,
      payment_terms TEXT DEFAULT '',
      payable_date TEXT DEFAULT '',
      remind_date TEXT DEFAULT '',
      payment_status TEXT DEFAULT 'not_requested',
      approval_status TEXT DEFAULT 'pending',
      payment_voucher TEXT DEFAULT '',
      remark TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // PAY-CORE Phase 1.5 Task 0：payment_requests 付款模式字段（V5 修正 2：显式 single/multi，不自动推断）
  // payment_mode: single（单费用）/ multi（多费用）；旧数据默认 single
  try { d.exec("ALTER TABLE payment_requests ADD COLUMN payment_mode TEXT NOT NULL DEFAULT 'single'"); } catch(e) {}
  try { d.exec("CREATE INDEX IF NOT EXISTS idx_payment_requests_mode ON payment_requests(payment_mode)"); } catch(e) {}

  // PAY-CORE Phase 1.5 Task 2：payment_requests 收款方字段（multi 模式校验同 payee_key；single 模式写入派生值）
  // payee_key 格式：${payee_type}:${identity}（与 payable_items.payee_key 一致）
  // payee_name_snapshot：收款方名称快照（与 payable_items.payee_name_snapshot 一致）
  // 历史数据保持空字符串，不回填
  try { d.exec("ALTER TABLE payment_requests ADD COLUMN payee_key TEXT NOT NULL DEFAULT ''"); } catch(e) {}
  try { d.exec("ALTER TABLE payment_requests ADD COLUMN payee_name_snapshot TEXT NOT NULL DEFAULT ''"); } catch(e) {}
  try { d.exec("CREATE INDEX IF NOT EXISTS idx_payment_requests_payee_key ON payment_requests(payee_key)"); } catch(e) {}

  // ==================== 付款闭环核心表（L1A：仅建表与约束，不改任何现有流程） ====================
  // 费用单主表：统一承载 PI定金 / CI尾款 / 运费 / 关税 / 商检 等应付费用
  // 金额统一用 INTEGER 最小单位（分），不保存 paid_amount / settlement_status 等派生缓存
  d.exec(`
    CREATE TABLE IF NOT EXISTS payable_items (
      id TEXT PRIMARY KEY,
      fee_no TEXT NOT NULL UNIQUE,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      source_no TEXT DEFAULT '',
      source_ci_id TEXT DEFAULT '',
      fee_type TEXT NOT NULL,
      category_code TEXT DEFAULT '',
      subcategory_code TEXT DEFAULT '',
      payee_type TEXT DEFAULT '',
      payee_key TEXT NOT NULL,
      payee_name_snapshot TEXT DEFAULT '',
      payer_entity_key TEXT NOT NULL,
      payer_name_snapshot TEXT DEFAULT '',
      currency TEXT NOT NULL,
      payable_amount_minor INTEGER NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_by TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      cancelled_by TEXT DEFAULT '',
      cancelled_at TEXT DEFAULT '',
      cancel_reason TEXT DEFAULT '',
      CHECK (currency != ''),
      CHECK (payee_key != ''),
      CHECK (payer_entity_key != ''),
      CHECK (payable_amount_minor > 0),
      CHECK (is_active IN (0,1))
    )
  `);

  // 有效费用单唯一约束（部分唯一索引）：同一 (source_type, source_id, fee_type, source_ci_id) 只允许一张 is_active=1
  // source_ci_id 用于多PI CI场景：同一PI在不同CI下各有一条active balance payable_item
  // 作废（is_active=0）不进入索引，可无限累积历史并允许重建
  d.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_payable_active
      ON payable_items(source_type, source_id, fee_type, source_ci_id)
      WHERE is_active = 1
  `);

  // 按来源 / 费用单定位的普通索引
  d.exec(`CREATE INDEX IF NOT EXISTS ix_payable_src ON payable_items(source_type, source_id)`);

  // PAY-CORE Phase 1.5 Task 0：payable_items 生命周期字段（V5 修正 1：与 is_active 解耦）
  // lifecycle_status: active / reserved / paid / cancelled
  // is_active 仅作为历史兼容字段，不再绑定生命周期（paid 视为有效历史财务记录）
  try { d.exec("ALTER TABLE payable_items ADD COLUMN lifecycle_status TEXT NOT NULL DEFAULT 'active'"); } catch(e) {}
  // 历史数据回填：is_active=0 的记录标记为 cancelled（仅回填，不影响新数据）
  try { d.exec("UPDATE payable_items SET lifecycle_status = 'cancelled' WHERE is_active = 0 AND lifecycle_status = 'active'"); } catch(e) {}
  // 生命周期索引
  try { d.exec("CREATE INDEX IF NOT EXISTS idx_payable_items_lifecycle ON payable_items(lifecycle_status)"); } catch(e) {}
  try { d.exec("CREATE INDEX IF NOT EXISTS idx_payable_items_fee_type ON payable_items(fee_type)"); } catch(e) {}

  // ==================== CI 多 PI 改造迁移（2026-07-29） ====================
  // payable_items 增加 source_ci_id：per-PI balance payable_item 的来源 CI 引用
  // 命名 source_ci_id（非 ci_id）：CI 不是付款来源，PI 才是 source；source_ci_id 仅标记该尾款产生自哪个 CI
  try { d.exec("ALTER TABLE payable_items ADD COLUMN source_ci_id TEXT NOT NULL DEFAULT ''"); } catch(e) {}
  // PAY-CORE payable_date 链路统一：payable_items 增加应付日期（CI 尾款到期日 = actual_ship_date + credit_days）
  try { d.exec("ALTER TABLE payable_items ADD COLUMN payable_date TEXT DEFAULT ''"); } catch(e) {}
  // commercial_invoices 增加多 PI 数组字段
  try { d.exec("ALTER TABLE commercial_invoices ADD COLUMN related_pi_ids TEXT DEFAULT ''"); } catch(e) {}
  try { d.exec("ALTER TABLE commercial_invoices ADD COLUMN related_pi_nos TEXT DEFAULT ''"); } catch(e) {}
  // commercial_invoice_items 增加 pi_id：每行明细的来源 PI
  try { d.exec("ALTER TABLE commercial_invoice_items ADD COLUMN pi_id TEXT DEFAULT ''"); } catch(e) {}
  // CI 明细增加折扣字段：discount（PI折扣快照）、net_unit_price（折后单价）
  try { d.exec("ALTER TABLE commercial_invoice_items ADD COLUMN discount REAL DEFAULT 0"); } catch(e) {}
  try { d.exec("ALTER TABLE commercial_invoice_items ADD COLUMN net_unit_price REAL DEFAULT 0"); } catch(e) {}

  // UNIQUE 索引迁移：从 3 列 (source_type, source_id, fee_type) 扩展为 4 列 (+ source_ci_id)
  // 存量数据 source_ci_id 全部 ''，3列唯一等价于4列唯一，不会产生冲突
  try { d.exec("DROP INDEX IF EXISTS uq_payable_active"); } catch(e) {}
  try { d.exec("CREATE UNIQUE INDEX IF NOT EXISTS uq_payable_active ON payable_items(source_type, source_id, fee_type, source_ci_id) WHERE is_active = 1"); } catch(e) {}

  // 存量回填：ci_items.pi_id = ci.related_pi_id（存量单 PI CI）
  try { d.exec("UPDATE commercial_invoice_items SET pi_id = (SELECT ci.related_pi_id FROM commercial_invoices ci WHERE ci.id = commercial_invoice_items.ci_id) WHERE pi_id = ''"); } catch(e) {}
  // 存量回填：ci.related_pi_ids = JSON 数组（存量单 PI CI）
  try { d.exec("UPDATE commercial_invoices SET related_pi_ids = ('[\"' || related_pi_id || '\"]') WHERE related_pi_ids = '' AND related_pi_id != ''"); } catch(e) {}
  try { d.exec("UPDATE commercial_invoices SET related_pi_nos = ('[\"' || related_pi_no || '\"]') WHERE related_pi_nos = '' AND related_pi_no != ''"); } catch(e) {}

  // 付款申请明细：一笔付款申请关联多张费用单行
  // 提交审批后明细冻结、驳回/撤回只改父申请状态，故无 is_active 软删列
  d.exec(`
    CREATE TABLE IF NOT EXISTS payment_request_items (
      id TEXT PRIMARY KEY,
      payment_request_id TEXT NOT NULL,
      payable_item_id TEXT NOT NULL,
      requested_amount_minor INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      CHECK (requested_amount_minor >= 0),
      FOREIGN KEY (payment_request_id) REFERENCES payment_requests(id),
      FOREIGN KEY (payable_item_id) REFERENCES payable_items(id)
    )
  `);

  // 同一付款申请内费用单唯一（普通唯一，非 partial）
  d.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_pri
      ON payment_request_items(payment_request_id, payable_item_id)
  `);

  d.exec(`CREATE INDEX IF NOT EXISTS ix_pri_req ON payment_request_items(payment_request_id)`);
  d.exec(`CREATE INDEX IF NOT EXISTS ix_pri_item ON payment_request_items(payable_item_id)`);

  // 实际付款记录
  d.exec(`
    CREATE TABLE IF NOT EXISTS payment_transactions (
      id TEXT PRIMARY KEY,
      trans_no TEXT NOT NULL UNIQUE,
      payment_request_id TEXT NOT NULL,
      paid_amount_minor INTEGER NOT NULL DEFAULT 0,
      paid_date TEXT DEFAULT '',
      payment_account TEXT DEFAULT '',
      bank_ref_no TEXT DEFAULT '',
      trans_status TEXT NOT NULL DEFAULT 'registered',
      operator_id TEXT DEFAULT '',
      operator_name TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      CHECK (paid_amount_minor >= 0),
      CHECK (trans_status IN ('registered','reconciled','cancelled')),
      FOREIGN KEY (payment_request_id) REFERENCES payment_requests(id)
    )
  `);
  // 注意：CREATE TABLE 语法限制，新增列通过下方 ALTER TABLE 迁移添加（ settlement_log_id/currency/FX 快照字段 ）

  d.exec(`CREATE INDEX IF NOT EXISTS ix_tx_req ON payment_transactions(payment_request_id)`);

  // PAY-CORE Phase 1.5 Task 0：payment_transactions 水单附件字段（V5 修正：URL/path，非 base64）
  // 文件与数据库分离，voucher_attachment 保存文件路径
  try { d.exec("ALTER TABLE payment_transactions ADD COLUMN voucher_attachment TEXT DEFAULT ''"); } catch(e) {}
  // V5 修正 3：trans_status 状态约束通过应用层校验（避免 SQLite 重建表）
  // 应用层允许值：paid_pending_allocation / allocated / cancelled
  // 数据库 CHECK 保留旧值（registered/reconciled/cancelled）以保证向后兼容
  // 新代码写入 trans_status 时使用应用层校验后的新值

  // PAY-CORE Phase 2：新增 settlement_log_id 关联结算事实源 + currency 真实付款币种
  // settlement_log_id: 关联 payment_settlement_logs.id（1:1），NULL 兼容历史数据
  // currency: 真实付款币种（如 USD/IDR/MYR），NULL 兼容历史数据，不设 DEFAULT 避免伪造币种
  try { d.exec("ALTER TABLE payment_transactions ADD COLUMN settlement_log_id TEXT"); } catch(e) {}
  try { d.exec("ALTER TABLE payment_transactions ADD COLUMN currency TEXT"); } catch(e) {}

  // PAY-CORE Phase 2-FX：付款事实必须保存 FX 快照（按实际付款日期 paid_date 锁定）
  try { d.exec("ALTER TABLE payment_transactions ADD COLUMN settlement_country TEXT DEFAULT ''"); } catch(e) {}
  try { d.exec("ALTER TABLE payment_transactions ADD COLUMN local_currency TEXT DEFAULT ''"); } catch(e) {}
  try { d.exec("ALTER TABLE payment_transactions ADD COLUMN local_rate REAL DEFAULT 0"); } catch(e) {}
  try { d.exec("ALTER TABLE payment_transactions ADD COLUMN local_rate_date TEXT DEFAULT ''"); } catch(e) {}
  try { d.exec("ALTER TABLE payment_transactions ADD COLUMN local_rate_type TEXT DEFAULT ''"); } catch(e) {}
  try { d.exec("ALTER TABLE payment_transactions ADD COLUMN local_rate_direction TEXT DEFAULT ''"); } catch(e) {}
  try { d.exec("ALTER TABLE payment_transactions ADD COLUMN local_amount REAL DEFAULT 0"); } catch(e) {}
  try { d.exec("ALTER TABLE payment_transactions ADD COLUMN rmb_rate REAL DEFAULT 0"); } catch(e) {}
  try { d.exec("ALTER TABLE payment_transactions ADD COLUMN rmb_rate_date TEXT DEFAULT ''"); } catch(e) {}
  try { d.exec("ALTER TABLE payment_transactions ADD COLUMN rmb_rate_type TEXT DEFAULT ''"); } catch(e) {}
  try { d.exec("ALTER TABLE payment_transactions ADD COLUMN rmb_rate_direction TEXT DEFAULT ''"); } catch(e) {}
  try { d.exec("ALTER TABLE payment_transactions ADD COLUMN rmb_amount REAL DEFAULT 0"); } catch(e) {}
  // 唯一索引：防止同一 settlement_log 重复生成 transaction（SQLite UNIQUE 索引允许多个 NULL）
  d.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_tx_settlement_log ON payment_transactions(settlement_log_id)`);

  // 付款分摊核销：经 payment_request_items 定位费用单，不冗余存 payable_item_id
  d.exec(`
    CREATE TABLE IF NOT EXISTS payment_allocations (
      id TEXT PRIMARY KEY,
      transaction_id TEXT NOT NULL,
      payment_request_item_id TEXT NOT NULL,
      allocated_amount_minor INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'reconciled',
      created_at TEXT DEFAULT (datetime('now')),
      CHECK (allocated_amount_minor >= 0),
      CHECK (status IN ('reconciled','cancelled')),
      FOREIGN KEY (transaction_id) REFERENCES payment_transactions(id),
      FOREIGN KEY (payment_request_item_id) REFERENCES payment_request_items(id)
    )
  `);

  d.exec(`CREATE INDEX IF NOT EXISTS ix_alloc_tx ON payment_allocations(transaction_id)`);
  d.exec(`CREATE INDEX IF NOT EXISTS ix_alloc_item ON payment_allocations(payment_request_item_id)`);

  // ==================== 付款类目（L1B：独立两表，不改动 expense_types） ====================
  // 付款大类：用于付款闭环费用单归类，仅启用/停用，不提供物理删除
  d.exec(`
    CREATE TABLE IF NOT EXISTS payment_categories (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      created_by TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      CHECK (code != ''),
      CHECK (name != ''),
      CHECK (status IN ('active','inactive'))
    )
  `);

  // 付款子类：仅承载类目属性（名称/编码/默认收款方等）；来源映射已分离到 payment_subcategory_sources
  // 外键 ON DELETE RESTRICT：大类被引用时禁止删除（大类本就不提供物理删除）
  d.exec(`
    CREATE TABLE IF NOT EXISTS payment_subcategories (
      id TEXT PRIMARY KEY,
      category_id TEXT NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      payee_type_default TEXT DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      created_by TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      CHECK (code != ''),
      CHECK (name != ''),
      CHECK (status IN ('active','inactive')),
      FOREIGN KEY (category_id) REFERENCES payment_categories(id) ON DELETE RESTRICT
    )
  `);

  // 同一大类下子类编码唯一
  d.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_subcategory_code
      ON payment_subcategories(category_id, code)
  `);

  d.exec(`CREATE INDEX IF NOT EXISTS ix_payment_subcat_cat ON payment_subcategories(category_id)`);

  // ==================== 付款子类来源映射（L1B 结构修正：类目与来源映射分离） ====================
  // 一个子类可对应多组 (source_type, fee_type) 来源映射，解决到仓费用等「ci / manual 双来源」问题
  // 费用自动匹配以本表为准（按 active 映射定位 subcategory）；停用(inactive)不进入部分唯一索引，可保留历史
  d.exec(`
    CREATE TABLE IF NOT EXISTS payment_subcategory_sources (
      id TEXT PRIMARY KEY,
      subcategory_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      fee_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_by TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      CHECK (source_type != ''),
      CHECK (fee_type != ''),
      CHECK (status IN ('active','inactive')),
      FOREIGN KEY (subcategory_id) REFERENCES payment_subcategories(id) ON DELETE RESTRICT
    )
  `);

  // 有效映射唯一约束（部分唯一索引）：同一 (source_type, fee_type) 只允许一条 active，避免自动匹配歧义
  d.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_subcategory_source_mapping
      ON payment_subcategory_sources(source_type, fee_type)
      WHERE status = 'active'
  `);

  d.exec(`CREATE INDEX IF NOT EXISTS ix_pay_src_sub ON payment_subcategory_sources(subcategory_id)`);

  // ==================== 付款主体主数据（L2A-2A-3：基础维护层，仅主数据，不接入采购业务链） ====================
  // entity_key：稳定业务代码，唯一；创建后若被业务引用则不可修改（编辑时由 API 引用计数保护）
  // country_id：稳定关联 countries.id，不使用国家名称/code 作为长期键（FK RESTRICT 保护）
  // default_currency：仅默认提示，允许空；非空时由 API 校验存在于 currencies 且 active
  // is_default：同一 country_id 至多一个 status='active' 且 is_default=1 的主体（partial unique index 保护）
  // status：active/inactive，仅软停，不提供物理删除
  d.exec(`
    CREATE TABLE IF NOT EXISTS payer_entities (
      id TEXT PRIMARY KEY,
      entity_key TEXT NOT NULL,
      entity_name TEXT NOT NULL,
      country_id TEXT NOT NULL,
      default_currency TEXT DEFAULT '',
      is_default INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      CHECK (entity_key != ''),
      CHECK (entity_name != ''),
      CHECK (is_default IN (0,1)),
      CHECK (status IN ('active','inactive')),
      FOREIGN KEY (country_id) REFERENCES countries(id) ON DELETE RESTRICT
    )
  `);

  d.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_payer_entity_key ON payer_entities(entity_key)`);
  d.exec(`CREATE INDEX IF NOT EXISTS ix_payer_entity_country ON payer_entities(country_id)`);
  d.exec(`CREATE INDEX IF NOT EXISTS ix_payer_entity_status ON payer_entities(status)`);
  // 同一国家至多一个 active 默认主体（partial unique index）
  d.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_payer_entity_default_per_country
      ON payer_entities(country_id)
      WHERE is_default = 1 AND status = 'active'
  `);

  // 迁移：既有库 payment_subcategories 仍含 source_type/fee_type 列（且带对应 CHECK），
  // SQLite 的 DROP COLUMN 不支持删除被 CHECK 引用的列，故采用"重建表"方式剥离旧列（幂等：仅旧库存在）
  // 注意：SQLite 的 DDL 会隐式提交事务，故此处用顺序 d.exec（每条 DDL 各自提交），不套事务包装
  try {
    const cols = d.pragma('table_info(payment_subcategories)').map(r => r.name);
    if (cols.includes('source_type')) {
      d.exec(`DROP INDEX IF EXISTS uq_payment_subcategory_mapping`);
      d.exec(`DROP INDEX IF EXISTS uq_payment_subcategory_code`);
      d.exec(`DROP INDEX IF EXISTS ix_payment_subcat_cat`);
      d.exec(`ALTER TABLE payment_subcategories RENAME TO payment_subcategories_old`);
      d.exec(`
        CREATE TABLE payment_subcategories (
          id TEXT PRIMARY KEY,
          category_id TEXT NOT NULL,
          code TEXT NOT NULL,
          name TEXT NOT NULL,
          payee_type_default TEXT DEFAULT '',
          sort_order INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'active',
          created_by TEXT DEFAULT '',
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now')),
          CHECK (code != ''),
          CHECK (name != ''),
          CHECK (status IN ('active','inactive')),
          FOREIGN KEY (category_id) REFERENCES payment_categories(id) ON DELETE RESTRICT
        )
      `);
      d.exec(`INSERT INTO payment_subcategories (id, category_id, code, name, payee_type_default, sort_order, status, created_by, created_at, updated_at)
              SELECT id, category_id, code, name, payee_type_default, sort_order, status, created_by, created_at, updated_at FROM payment_subcategories_old`);
      d.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_subcategory_code ON payment_subcategories(category_id, code)`);
      d.exec(`CREATE INDEX IF NOT EXISTS ix_payment_subcat_cat ON payment_subcategories(category_id)`);

      // 重建 payment_subcategory_sources：RENAME payment_subcategories 时，本表的 FK 会被 SQLite 自动改写为
      // 指向 payment_subcategories_old（悬空引用，导致后续 seed 报 no such table）。此处重建该表，使其 FK 重新
      // 指向新的 payment_subcategories。迁移时该表仅由后续 seed 填充（空表）；若存在极少量数据则先备份再回拷
      // （subcategory_id 在新 payment_subcategories 中同名存在）。无任何表引用本表，重建安全。
      const srcCount = d.prepare('SELECT COUNT(*) AS c FROM payment_subcategory_sources').get().c;
      if (srcCount > 0) {
        d.exec(`ALTER TABLE payment_subcategory_sources RENAME TO payment_subcategory_sources_old`);
      }
      d.exec(`DROP TABLE IF EXISTS payment_subcategory_sources`);
      d.exec(`
        CREATE TABLE IF NOT EXISTS payment_subcategory_sources (
          id TEXT PRIMARY KEY,
          subcategory_id TEXT NOT NULL,
          source_type TEXT NOT NULL,
          fee_type TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active',
          created_by TEXT DEFAULT '',
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now')),
          CHECK (source_type != ''),
          CHECK (fee_type != ''),
          CHECK (status IN ('active','inactive')),
          FOREIGN KEY (subcategory_id) REFERENCES payment_subcategories(id) ON DELETE RESTRICT
        )
      `);
      d.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_subcategory_source_mapping
        ON payment_subcategory_sources(source_type, fee_type) WHERE status = 'active'`);
      d.exec(`CREATE INDEX IF NOT EXISTS ix_pay_src_sub ON payment_subcategory_sources(subcategory_id)`);
      if (srcCount > 0) {
        d.exec(`INSERT INTO payment_subcategory_sources (id, subcategory_id, source_type, fee_type, status, created_by, created_at, updated_at)
                SELECT id, subcategory_id, source_type, fee_type, status, created_by, created_at, updated_at FROM payment_subcategory_sources_old`);
        d.exec(`DROP TABLE payment_subcategory_sources_old`);
      }
      d.exec(`DROP TABLE payment_subcategories_old`);
    }
  } catch (e) { console.warn('[DB] payment_subcategories 旧列迁移跳过:', e.message); }

  // 库存盘点
  d.exec(`
    CREATE TABLE IF NOT EXISTS inventory_checks (
      id TEXT PRIMARY KEY,
      check_no TEXT NOT NULL UNIQUE,
      country TEXT DEFAULT '',
      warehouse TEXT DEFAULT '',
      check_date TEXT NOT NULL,
      sku_code TEXT DEFAULT '',
      system_qty INTEGER DEFAULT 0,
      actual_qty INTEGER DEFAULT 0,
      diff_qty INTEGER DEFAULT 0,
      diff_amount REAL DEFAULT 0,
      diff_reason TEXT DEFAULT '',
      handle_method TEXT DEFAULT '',
      approval_status TEXT DEFAULT 'pending',
      remark TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // ==================== 字段迁移（兼容旧数据库） ====================

  // inventory_imports 表新增字段
  ['associated_brands TEXT DEFAULT \'[]\'',
   'remark TEXT DEFAULT \'\'',
   'last_used_payment_term_id TEXT DEFAULT \'\''
  ].forEach(col => {
    try { d.exec(`ALTER TABLE suppliers ADD COLUMN ${col}`); } catch(e) {}
  });

  [
    'brand TEXT DEFAULT \'\'',
    'country TEXT DEFAULT \'\'',
    'target_warehouse TEXT DEFAULT \'\'',
    'need_deposit INTEGER DEFAULT 1',
    'expected_delivery TEXT DEFAULT \'\'',
    'payment_term_id TEXT DEFAULT \'\''
  ].forEach(col => {
    try { d.exec(`ALTER TABLE proforma_invoices ADD COLUMN ${col}`); } catch(e) {}
  });

  [
    'related_po_id TEXT DEFAULT \'\'',
    'related_po_no TEXT DEFAULT \'\'',
    'brand TEXT DEFAULT \'\'',
    'country TEXT DEFAULT \'\'',
    'target_warehouse TEXT DEFAULT \'\'',
    'pi_total_amount REAL DEFAULT 0',
    'amount_difference REAL DEFAULT 0',
    'difference_reason TEXT DEFAULT \'\'',
    'pl_attachment TEXT DEFAULT \'\'',
    'has_customs_duty INTEGER DEFAULT 0',
    'has_inspection_fee INTEGER DEFAULT 0',
    'cost_confirmed INTEGER DEFAULT 0',
    'cost_allocated INTEGER DEFAULT 0',
    'landing_total_cost REAL DEFAULT 0',
    'transport_basis TEXT DEFAULT NULL',
    'import_duty_total REAL DEFAULT 0',
    'original_inventory_imported INTEGER DEFAULT 0',
    'wac_version_id TEXT DEFAULT \'\''
  ].forEach(col => {
    try { d.exec(`ALTER TABLE commercial_invoices ADD COLUMN ${col}`); } catch(e) {}
  });

  [
    'related_po_id TEXT DEFAULT \'\'',
    'related_po_no TEXT DEFAULT \'\'',
    'related_pi_id TEXT DEFAULT \'\'',
    'related_pi_no TEXT DEFAULT \'\'',
    'supplier_id TEXT DEFAULT \'\'',
    'supplier_name TEXT DEFAULT \'\'',
    'brand TEXT DEFAULT \'\'',
    'country TEXT DEFAULT \'\'',
    'target_warehouse TEXT DEFAULT \'\'',
    'pl_date TEXT DEFAULT \'\'',
    'total_qty INTEGER DEFAULT 0'
  ].forEach(col => {
    try { d.exec(`ALTER TABLE packing_lists ADD COLUMN ${col}`); } catch(e) {}
  });

  // inventory_imports 表新增字段
  ['snapshot_cutoff_date TEXT DEFAULT \'\'',
   'brand TEXT DEFAULT \'\'',
   'weighted_avg_cost REAL DEFAULT 0',
   'last_inbound_date TEXT DEFAULT \'\'',
   'first_inbound_date TEXT DEFAULT \'\''
  ].forEach(col => {
    try { d.exec(`ALTER TABLE inventory_imports ADD COLUMN ${col}`); } catch(e) {}
  });

  // payment_requests 表新增抵扣字段
  [
    'has_deduction INTEGER DEFAULT 0',
    'deduction_amount REAL DEFAULT 0',
    'deduction_source_type TEXT DEFAULT \'\'',
    'deduction_source_desc TEXT DEFAULT \'\'',
    'deduction_ref_no TEXT DEFAULT \'\'',
    'deduction_attachment TEXT DEFAULT \'\'',
    'actual_pay_amount REAL DEFAULT 0',
    'related_ci_id TEXT DEFAULT \'\'',
    'related_ci_no TEXT DEFAULT \'\'',
    'related_po_no TEXT DEFAULT \'\'',
    'include_in_landing_cost INTEGER DEFAULT 1',
    'attachment TEXT DEFAULT \'\'',
    'approval_remark TEXT DEFAULT \'\'',
    'approver_name TEXT DEFAULT \'\'',
    'approved_at TEXT DEFAULT \'\'',
    'paid_date TEXT DEFAULT \'\'',
    'rounding_amount REAL DEFAULT 0',
    'rounding_reason TEXT DEFAULT \'\'',
    'expense_country TEXT DEFAULT \'\''
  ].forEach(col => {
    try { d.exec(`ALTER TABLE payment_requests ADD COLUMN ${col}`); } catch(e) {}
  });

  // 付款与抵扣的最小结算事件日志。payment_requests 仍是运营主表，本表仅保存累计事实、汇率快照与冲销证据。
  d.exec(`
    CREATE TABLE IF NOT EXISTS payment_settlement_logs (
      id TEXT PRIMARY KEY,
      payment_request_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      amount REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'applied',
      reason TEXT DEFAULT '',
      paid_date TEXT DEFAULT '',
      payment_voucher TEXT DEFAULT '',
      original_currency TEXT DEFAULT '',
      settlement_country TEXT DEFAULT '',
      local_currency TEXT DEFAULT '',
      local_rate REAL DEFAULT 0,
      local_rate_date TEXT DEFAULT '',
      local_rate_type TEXT DEFAULT '',
      local_rate_direction TEXT DEFAULT '',
      local_amount REAL DEFAULT 0,
      rmb_rate REAL DEFAULT 0,
      rmb_rate_date TEXT DEFAULT '',
      rmb_rate_type TEXT DEFAULT '',
      rmb_rate_direction TEXT DEFAULT '',
      rmb_amount REAL DEFAULT 0,
      operator_id TEXT DEFAULT '',
      operator_name TEXT DEFAULT '',
      idempotency_key TEXT DEFAULT '',
      is_legacy INTEGER NOT NULL DEFAULT 0,
      reversal_of TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      reversed_at TEXT DEFAULT '',
      reversed_by TEXT DEFAULT '',
      reversal_reason TEXT DEFAULT '',
      CHECK (event_type IN ('payment','deduction','rounding','rounding_reversal')),
      CHECK (status IN ('applied','reversed')),
      CHECK (amount > 0),
      CHECK (is_legacy IN (0,1)),
      FOREIGN KEY (payment_request_id) REFERENCES payment_requests(id) ON DELETE RESTRICT
    )
  `);
  try { d.exec(`ALTER TABLE payment_settlement_logs ADD COLUMN idempotency_key TEXT DEFAULT ''`); } catch(e) {}
  d.exec(`CREATE INDEX IF NOT EXISTS ix_payment_settlement_request ON payment_settlement_logs(payment_request_id, event_type, status)`);
  d.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_settlement_legacy_baseline
      ON payment_settlement_logs(payment_request_id, event_type)
      WHERE is_legacy = 1
  `);
  d.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_settlement_payment_idempotency
      ON payment_settlement_logs(idempotency_key)
      WHERE event_type = 'payment' AND idempotency_key != ''
  `);
  d.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_request_active_goods_source
      ON payment_requests(source_type, source_id, payment_subcategory)
      WHERE payment_category = 'goods'
        AND payment_subcategory IN ('deposit', 'balance')
        AND source_id != ''
        AND payment_status NOT IN ('rejected', 'cancelled')
  `);

  // cost_allocations 表新增字段
  [
    'ci_id TEXT DEFAULT \'\'',
    'related_po_no TEXT DEFAULT \'\'',
    'related_pi_no TEXT DEFAULT \'\'',
    'unit_product_cost REAL DEFAULT 0',
    'unit_allocated_cost REAL DEFAULT 0',
    'unit_landing_cost_with_fees REAL DEFAULT 0',
    'original_qty REAL DEFAULT 0',
    'original_avg_cost REAL DEFAULT 0'
  ].forEach(col => {
    try { d.exec(`ALTER TABLE cost_allocations ADD COLUMN ${col}`); } catch(e) {}
  });

  // inventory 表新增字段
  ['is_focused INTEGER DEFAULT 0',
   'safety_stock INTEGER DEFAULT 0',
   'target_turnover_months REAL DEFAULT 0',
   'replenishment_rule TEXT DEFAULT \'\'',
   'inventory_remark TEXT DEFAULT \'\'',
   'snapshot_cutoff_date TEXT DEFAULT \'\'',
   'first_inbound_date TEXT DEFAULT \'\''
  ].forEach(col => {
    try { d.exec(`ALTER TABLE inventory ADD COLUMN ${col}`); } catch(e) {}
  });

  // outbound_records 表新增字段
  ['outbound_status TEXT DEFAULT \'normal\'',
   'void_reason TEXT DEFAULT \'\'',
   'voided_at TEXT DEFAULT \'\'',
   'voided_by TEXT DEFAULT \'\'',
   'import_mode TEXT DEFAULT \'\'',
   'inventory_effect TEXT DEFAULT \'none\'',
   'applied_to_inventory INTEGER DEFAULT 0',
   'snapshot_cutoff_date TEXT DEFAULT \'\'',
   'import_batch_id TEXT DEFAULT \'\'',
   'platform_order_no TEXT DEFAULT \'\''
  ].forEach(col => {
    try { d.exec(`ALTER TABLE outbound_records ADD COLUMN ${col}`); } catch(e) {}
  });

  // ==================== 批量操作 & 日志表 ====================

  // 操作日志
  d.exec(`
    CREATE TABLE IF NOT EXISTS operation_logs (
      id TEXT PRIMARY KEY,
      operator_id TEXT DEFAULT '',
      operator_name TEXT DEFAULT '',
      page TEXT DEFAULT '',
      operation_type TEXT DEFAULT '',
      target_ids TEXT DEFAULT '[]',
      affected_count INTEGER DEFAULT 0,
      old_values TEXT DEFAULT '',
      new_values TEXT DEFAULT '',
      reason TEXT DEFAULT '',
      triggered_recalc INTEGER DEFAULT 0,
      is_rollbackable INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // 批量任务
  d.exec(`
    CREATE TABLE IF NOT EXISTS batch_tasks (
      id TEXT PRIMARY KEY,
      task_name TEXT NOT NULL,
      operation_type TEXT DEFAULT '',
      operator_id TEXT DEFAULT '',
      operator_name TEXT DEFAULT '',
      page TEXT DEFAULT '',
      status TEXT DEFAULT 'running',
      total_count INTEGER DEFAULT 0,
      success_count INTEGER DEFAULT 0,
      failed_count INTEGER DEFAULT 0,
      skipped_count INTEGER DEFAULT 0,
      error_report TEXT DEFAULT '[]',
      is_rollbackable INTEGER DEFAULT 0,
      started_at TEXT DEFAULT (datetime('now')),
      finished_at TEXT DEFAULT ''
    )
  `);

  // 库存调整单
  d.exec(`
    CREATE TABLE IF NOT EXISTS inventory_adjustments (
      id TEXT PRIMARY KEY,
      adj_no TEXT NOT NULL UNIQUE,
      inventory_id TEXT DEFAULT '',
      sku_code TEXT NOT NULL,
      country TEXT DEFAULT '',
      warehouse TEXT DEFAULT '',
      before_qty INTEGER DEFAULT 0,
      adjust_qty INTEGER DEFAULT 0,
      after_qty INTEGER DEFAULT 0,
      adjust_type TEXT DEFAULT 'manual',
      reason TEXT DEFAULT '',
      operator_id TEXT DEFAULT '',
      operator_name TEXT DEFAULT '',
      approval_status TEXT DEFAULT 'approved',
      executed_at TEXT DEFAULT (datetime('now')),
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // CI 费用归集（关联 payment_requests 到 CI，用于落地成本计算）
  d.exec(`
    CREATE TABLE IF NOT EXISTS ci_cost_items (
      id TEXT PRIMARY KEY,
      ci_id TEXT NOT NULL,
      ci_no TEXT DEFAULT '',
      payment_request_id TEXT DEFAULT '',
      request_no TEXT DEFAULT '',
      cost_category TEXT DEFAULT '',
      cost_subcategory TEXT DEFAULT '',
      payable_amount REAL DEFAULT 0,
      paid_amount REAL DEFAULT 0,
      include_in_landing_cost INTEGER DEFAULT 1,
      payee_name TEXT DEFAULT '',
      currency TEXT DEFAULT 'USD',
      remark TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // 成本更新日志（每次更新加权平均成本时记录）
  d.exec(`
    CREATE TABLE IF NOT EXISTS cost_update_logs (
      id TEXT PRIMARY KEY,
      sku_code TEXT NOT NULL,
      country TEXT DEFAULT '',
      warehouse TEXT DEFAULT '',
      related_po_no TEXT DEFAULT '',
      related_pi_no TEXT DEFAULT '',
      related_ci_no TEXT DEFAULT '',
      original_qty REAL DEFAULT 0,
      old_avg_cost REAL DEFAULT 0,
      inbound_qty REAL DEFAULT 0,
      ci_unit_cost REAL DEFAULT 0,
      unit_landing_cost REAL DEFAULT 0,
      new_qty REAL DEFAULT 0,
      new_avg_cost REAL DEFAULT 0,
      operator_id TEXT DEFAULT '',
      operator_name TEXT DEFAULT '',
      import_file TEXT DEFAULT '',
      remark TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // 原库存数量导入（采购入库前，用于加权平均成本计算）
  d.exec(`
    CREATE TABLE IF NOT EXISTS original_inventory_imports (
      id TEXT PRIMARY KEY,
      ci_id TEXT DEFAULT '',
      ci_no TEXT DEFAULT '',
      po_no TEXT DEFAULT '',
      sku_code TEXT NOT NULL,
      country TEXT DEFAULT '',
      warehouse TEXT DEFAULT '',
      original_qty REAL DEFAULT 0,
      remark TEXT DEFAULT '',
      imported_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // 加权平均成本历史（P1-03-B：每次成本确认生成并锁定的版本）
  d.exec(`
    CREATE TABLE IF NOT EXISTS wac_history (
      id TEXT PRIMARY KEY,
      version_no INTEGER NOT NULL,
      ci_id TEXT DEFAULT '',
      ci_no TEXT DEFAULT '',
      po_id TEXT DEFAULT '',
      po_no TEXT DEFAULT '',
      pi_id TEXT DEFAULT '',
      pi_no TEXT DEFAULT '',
      sku_code TEXT NOT NULL,
      model TEXT DEFAULT '',
      brand TEXT DEFAULT '',
      country TEXT DEFAULT '',
      warehouse TEXT DEFAULT '',
      original_qty REAL DEFAULT 0,
      original_avg_cost REAL DEFAULT 0,
      original_inventory_value REAL DEFAULT 0,
      inbound_qty REAL DEFAULT 0,
      unit_landing_cost REAL DEFAULT 0,
      inbound_total_cost REAL DEFAULT 0,
      new_avg_cost REAL DEFAULT 0,
      settlement_date TEXT DEFAULT '',
      confirmation_status TEXT DEFAULT 'confirmed',
      is_locked INTEGER DEFAULT 1,
      confirmed_by TEXT DEFAULT '',
      confirmed_at TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // ==================== 创建索引 ====================
  d.exec(`CREATE INDEX IF NOT EXISTS idx_inv_sku ON inventory(sku_code)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_inv_country_wh ON inventory(country, warehouse)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_outbound_sku ON outbound_records(sku_code)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_outbound_status ON outbound_records(outbound_status)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_outbound_batch ON outbound_records(import_batch_id)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_outbound_effect ON outbound_records(inventory_effect)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_outbound_platform_order ON outbound_records(platform_order_no, sku_code)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_outbound_snapshot_cutoff ON outbound_records(snapshot_cutoff_date)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_sales_sku ON sales_data(sku_code)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_po_status ON purchase_orders(po_status)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_pi_status ON proforma_invoices(pi_status)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_ci_status ON commercial_invoices(ci_status)`);
  d.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_historical_ci_idempotency ON historical_commercial_invoices(idempotency_key)`);
  d.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_historical_ci_identity
    ON historical_commercial_invoices(historical_ci_no COLLATE NOCASE, supplier_identity, country COLLATE NOCASE)`);
  d.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_historical_ci_payment_request
    ON historical_commercial_invoices(payment_request_id) WHERE payment_request_id != ''`);
  d.exec(`CREATE INDEX IF NOT EXISTS ix_historical_ci_date ON historical_commercial_invoices(ci_date)`);
  d.exec(`CREATE INDEX IF NOT EXISTS ix_historical_ci_supplier ON historical_commercial_invoices(supplier_identity)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_log_status ON logistics_batches(logistics_status)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_inbound_ci ON inbound_records(source_ci_no)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_payment_status ON payment_requests(payment_status)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_ci_cost_items_ci ON ci_cost_items(ci_id)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_cost_allocation_details_ci ON cost_allocation_details(ci_id)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_cost_allocation_details_run ON cost_allocation_details(allocation_run_id)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_cost_logs_sku ON cost_update_logs(sku_code)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_orig_inv_ci ON original_inventory_imports(ci_id)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_orig_inv_sku ON original_inventory_imports(sku_code)`);
  // wac_history 索引
  d.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_wac_history_version ON wac_history(sku_code, country, warehouse, version_no)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_wac_history_latest ON wac_history(sku_code, country, warehouse, confirmation_status, is_locked)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_wac_history_ci ON wac_history(ci_id)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_approval_business ON approval_records(business_type, business_id)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_business_participants ON business_participants(business_type, business_id, participant_type)`);

  // ==================== P1-03-C 严格 migration（禁止静默吞错） ====================
  (function p1cStrictMigration() {
    const d = getDB();
    // 1. 探测并新增 commercial_invoices 汇总字段（仅"列已存在"才跳过，绝不静默吞错）
    const ciCols = d.prepare("PRAGMA table_info(commercial_invoices)").all().map(c => c.name);
    const p103cCols = [
      { name: 'wac_confirmed', sql: 'INTEGER DEFAULT 0' },
      { name: 'wac_confirmed_at', sql: "TEXT DEFAULT ''" },
      { name: 'wac_confirmed_by', sql: "TEXT DEFAULT ''" }
    ];
    for (const col of p103cCols) {
      if (!ciCols.includes(col.name)) {
        d.exec("ALTER TABLE commercial_invoices ADD COLUMN " + col.name + " " + col.sql);
      }
    }
    // 2. 创建 locked 版本不可变触发器（IF NOT EXISTS；创建失败必须抛错停机）
    d.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_wac_history_block_update
      BEFORE UPDATE ON wac_history
      WHEN OLD.is_locked = 1
      BEGIN
        SELECT RAISE(ABORT, 'LOCKED_WAC_HISTORY_UPDATE_FORBIDDEN');
      END;
    `);
    d.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_wac_history_block_delete
      BEFORE DELETE ON wac_history
      WHEN OLD.is_locked = 1
      BEGIN
        SELECT RAISE(ABORT, 'LOCKED_WAC_HISTORY_DELETE_FORBIDDEN');
      END;
    `);
    // 3. 完成后查 sqlite_master 校验两触发器真实存在，缺失即中止启动
    const triggers = d.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name IN ('trg_wac_history_block_update','trg_wac_history_block_delete')").all().map(t => t.name);
    if (triggers.length !== 2) {
      throw new Error('P1-03-C migration failed: wac_history triggers missing. Found=' + JSON.stringify(triggers));
    }
  })();

  // ==================== P1-STATE-01D migration：入库关联 PL 明细 ====================
  // 仅在 inbound_records 新增 source_pl_id / source_pl_item_id 两列（DEFAULT ''），不回填、不修改历史。
  // 历史 6 条 legacy 入库记录保持 source_pl_id/source_pl_item_id 为空，继续允许读取与展示。
  (function p1State01dMigration() {
    const d = getDB();
    const irCols = d.prepare("PRAGMA table_info(inbound_records)").all().map(c => c.name);
    const p1State01dCols = [
      { name: 'source_pl_id', sql: "TEXT DEFAULT ''" },
      { name: 'source_pl_item_id', sql: "TEXT DEFAULT ''" }
    ];
    for (const col of p1State01dCols) {
      if (!irCols.includes(col.name)) {
        d.exec("ALTER TABLE inbound_records ADD COLUMN " + col.name + " " + col.sql);
      }
    }
    d.exec(`CREATE INDEX IF NOT EXISTS idx_inbound_pl_item ON inbound_records(source_pl_item_id)`);
  })();

  (function skuDualPriceMigration() {
    const d = getDB();
    const skuCols = d.prepare("PRAGMA table_info(skus)").all().map(c => c.name);
    const dualCols = [
      { name: 'purchase_price_rmb', sql: "REAL DEFAULT 0" },
      { name: 'purchase_price_usd', sql: "REAL DEFAULT 0" }
    ];
    for (const col of dualCols) {
      if (!skuCols.includes(col.name)) {
        d.exec("ALTER TABLE skus ADD COLUMN " + col.name + " " + col.sql);
      }
    }
  })();

  // P1-WAC-07：仅补运营 CI 分摊输入与证据列，不回填历史值。
  (function p1Wac07Migration() {
    const d = getDB();
    const addColumns = (table, columns) => {
      const existing = d.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
      for (const col of columns) {
        if (!existing.includes(col.name)) d.exec(`ALTER TABLE ${table} ADD COLUMN ${col.name} ${col.sql}`);
      }
    };
    addColumns('skus', [
      { name: 'reference_customs_rate', sql: 'REAL DEFAULT NULL' }
    ]);
    addColumns('commercial_invoices', [
      { name: 'transport_basis', sql: 'TEXT DEFAULT NULL' },
      { name: 'import_duty_total', sql: 'REAL DEFAULT 0' }
    ]);
    addColumns('commercial_invoice_items', [
      { name: 'actual_customs_rate', sql: 'REAL DEFAULT NULL' }
    ]);
    addColumns('cost_allocations', [
      { name: 'allocation_run_id', sql: "TEXT DEFAULT ''" }
    ]);
  })();

  d.exec(`CREATE INDEX IF NOT EXISTS idx_oplog_page ON operation_logs(page)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_batchtask_status ON batch_tasks(status)`);

  // HCI-ATTACH-01：历史 CI 附件（复用既有 dataUrl-in-DB 机制，attachment 列存 JSON 数组）
  (function hciAttachmentMigration() {
    const d = getDB();
    const cols = d.prepare(`PRAGMA table_info(historical_commercial_invoices)`).all().map(c => c.name);
    if (!cols.includes('attachment')) {
      d.exec(`ALTER TABLE historical_commercial_invoices ADD COLUMN attachment TEXT NOT NULL DEFAULT ''`);
    }
  })();

  // CI-SHIP-DATE-01：运营 CI 与历史 CI 实际出货日期（冻结：同名字段 actual_ship_date；不允许默认填充今天）
  (function ciShipDateMigration() {
    const d = getDB();
    const opCols = d.prepare(`PRAGMA table_info(commercial_invoices)`).all().map(c => c.name);
    if (!opCols.includes('actual_ship_date')) {
      d.exec(`ALTER TABLE commercial_invoices ADD COLUMN actual_ship_date TEXT NOT NULL DEFAULT ''`);
    }
    const hCols = d.prepare(`PRAGMA table_info(historical_commercial_invoices)`).all().map(c => c.name);
    if (!hCols.includes('actual_ship_date')) {
      d.exec(`ALTER TABLE historical_commercial_invoices ADD COLUMN actual_ship_date TEXT NOT NULL DEFAULT ''`);
    }
  })();

  // PAY-CREDIT-DUE-01：Credit 天数快照（运营/历史 CI 各自独立快照，与实时供应商配置解耦）
  (function payCreditDueMigration() {
    const d = getDB();
    const opCols = d.prepare(`PRAGMA table_info(commercial_invoices)`).all().map(c => c.name);
    if (!opCols.includes('payment_term_id')) {
      d.exec(`ALTER TABLE commercial_invoices ADD COLUMN payment_term_id TEXT NOT NULL DEFAULT ''`);
    }
    if (!opCols.includes('credit_days')) {
      d.exec(`ALTER TABLE commercial_invoices ADD COLUMN credit_days INTEGER NOT NULL DEFAULT 0`);
    }
    const hCols = d.prepare(`PRAGMA table_info(historical_commercial_invoices)`).all().map(c => c.name);
    if (!hCols.includes('payment_term_id')) {
      d.exec(`ALTER TABLE historical_commercial_invoices ADD COLUMN payment_term_id TEXT NOT NULL DEFAULT ''`);
    }
    if (!hCols.includes('credit_days')) {
      d.exec(`ALTER TABLE historical_commercial_invoices ADD COLUMN credit_days INTEGER NOT NULL DEFAULT 0`);
    }
  })();

  // PUR-OPS-COLLAB-01：电商运营上架准备（V1）— commercial_invoices 新增 3 列；CC/owner 存 business_participants(business_type='ci')
  (function opsPrepMigration() {
    const d = getDB();
    const opCols = d.prepare(`PRAGMA table_info(commercial_invoices)`).all().map(c => c.name);
    if (!opCols.includes('ops_owner_id')) {
      d.exec(`ALTER TABLE commercial_invoices ADD COLUMN ops_owner_id TEXT NOT NULL DEFAULT ''`);
    }
    if (!opCols.includes('ops_plan_listing_date')) {
      d.exec(`ALTER TABLE commercial_invoices ADD COLUMN ops_plan_listing_date TEXT NOT NULL DEFAULT ''`);
    }
    if (!opCols.includes('ops_ready_status')) {
      d.exec(`ALTER TABLE commercial_invoices ADD COLUMN ops_ready_status TEXT NOT NULL DEFAULT 'pending'`);
    }
    if (!opCols.includes('shipping_attachments')) {
      d.exec(`ALTER TABLE commercial_invoices ADD COLUMN shipping_attachments TEXT NOT NULL DEFAULT '[]'`);
    }
  })();

  // ==================== 插入默认数据 ====================

  // 默认角色
  const roleCount = queryOne('SELECT COUNT(*) as cnt FROM roles').cnt;
  if (roleCount === 0) {
    const allPerms = JSON.stringify([
      'dashboard_view', 'sku_view', 'sku_create', 'sku_edit', 'sku_delete', 'sku_import', 'sku_export',
      'inventory_view', 'inventory_import', 'inventory_export',
      'outbound_view', 'outbound_create', 'outbound_import',
      'replenishment_view', 'replenishment_edit',
      'po_view', 'po_create', 'po_edit', 'po_approve', 'po_export',
      'pi_view', 'pi_create', 'pi_edit',
      'ci_view', 'ci_create', 'ci_edit',
      'logistics_view', 'logistics_create', 'logistics_edit',
      'inbound_view', 'inbound_create', 'inbound_edit', 'inbound_confirm',
      'cost_view',
      'payment_view', 'payment_create', 'payment_approve', 'payment_execute', 'payment_import', 'payment_export',
      'check_view', 'check_create', 'check_approve', 'check_import', 'check_export',
      'stagnant_view', 'stagnant_export',
      'forwarder_view', 'forwarder_export',
      'user_manage', 'role_manage', 'system_config'
    ]);
    const operatorPerms = JSON.stringify([
      'dashboard_view', 'sku_view', 'sku_create', 'sku_edit', 'sku_import', 'sku_export',
      'inventory_view', 'inventory_import', 'inventory_export',
      'outbound_view', 'outbound_create', 'outbound_import',
      'replenishment_view', 'replenishment_edit',
      'po_view', 'po_create', 'po_edit', 'po_export',
      'pi_view', 'pi_create', 'pi_edit',
      'ci_view', 'ci_create', 'ci_edit',
      'logistics_view', 'logistics_create', 'logistics_edit',
      'inbound_view', 'inbound_create', 'inbound_edit', 'inbound_confirm',
      'cost_view',
      'payment_view', 'payment_create',
      'check_view', 'check_create', 'check_import', 'check_export',
      'stagnant_view', 'stagnant_export',
      'forwarder_view', 'forwarder_export'
    ]);
    const viewerPerms = JSON.stringify([
      'dashboard_view', 'sku_view', 'inventory_view',
      'outbound_view', 'replenishment_view',
      'po_view', 'pi_view', 'ci_view', 'logistics_view', 'inbound_view',
      'cost_view', 'payment_view', 'check_view',
      'stagnant_view', 'forwarder_view'
    ]);

    run(`INSERT INTO roles (id, name, description, permissions, is_system) VALUES (?, ?, ?, ?, 1)`,
      ['role_admin', '超级管理员', '拥有系统全部管理权限', allPerms]);
    run(`INSERT INTO roles (id, name, description, permissions, is_system) VALUES (?, ?, ?, ?, 1)`,
      ['role_operator', '运营人员', '业务操作权限，含审批与导入导出', operatorPerms]);
    run(`INSERT INTO roles (id, name, description, permissions, is_system) VALUES (?, ?, ?, ?, 1)`,
      ['role_viewer', '普通用户', '只读查看权限', viewerPerms]);

    // 默认管理员
    run(`INSERT INTO users (id, username, name, password, role_id, status, auth_source, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ['user_admin', 'admin', '超级管理员', '', 'role_admin', 'active', 'local', '']);

    console.log('[DB] 已插入默认角色和管理员账号');
  }

  // 默认国家
  const countryCount = queryOne('SELECT COUNT(*) as cnt FROM countries').cnt;
  if (countryCount === 0) {
    run(`INSERT INTO countries (id, name, code, default_currency, sort_order) VALUES (?, ?, ?, ?, ?)`,
      ['country_id', '印尼', 'ID', 'IDR', 1]);
    run(`INSERT INTO countries (id, name, code, default_currency, sort_order) VALUES (?, ?, ?, ?, ?)`,
      ['country_my', '马来', 'MY', 'MYR', 2]);
    run(`INSERT INTO countries (id, name, code, default_currency, sort_order) VALUES (?, ?, ?, ?, ?)`,
      ['country_th', '泰国', 'TH', 'THB', 3]);
    console.log('[DB] 已插入默认国家');
  }

  // 默认币种
  const currencyCount = queryOne('SELECT COUNT(*) as cnt FROM currencies').cnt;
  if (currencyCount === 0) {
    const currencies = [
      ['cur_usd', 'USD', '美元', '$', 0, 1],
      ['cur_rmb', 'RMB', '人民币', '¥', 0, 2],
      ['cur_idr', 'IDR', '印尼盾', 'Rp', 0, 3],
      ['cur_myr', 'MYR', '马来林吉特', 'RM', 0, 4],
      ['cur_thb', 'THB', '泰铢', '฿', 0, 5]
    ];
    currencies.forEach(c => run(`INSERT INTO currencies (id, code, name, symbol, is_base, sort_order) VALUES (?, ?, ?, ?, ?, ?)`, c));
    console.log('[DB] 已插入默认币种');
  }

  // 默认仓库
  const whCount = queryOne('SELECT COUNT(*) as cnt FROM warehouses').cnt;
  if (whCount === 0) {
    run(`INSERT INTO warehouses (id, name, country_id, country_name, warehouse_type, sort_order) VALUES (?, ?, ?, ?, ?, ?)`,
      ['wh_id_self', '印尼自有仓', 'country_id', '印尼', 'self', 1]);
    run(`INSERT INTO warehouses (id, name, country_id, country_name, warehouse_type, sort_order) VALUES (?, ?, ?, ?, ?, ?)`,
      ['wh_id_3rd', '印尼第三方仓', 'country_id', '印尼', 'third_party', 2]);
    run(`INSERT INTO warehouses (id, name, country_id, country_name, warehouse_type, sort_order) VALUES (?, ?, ?, ?, ?, ?)`,
      ['wh_my', '马来仓', 'country_my', '马来', 'self', 3]);
    run(`INSERT INTO warehouses (id, name, country_id, country_name, warehouse_type, sort_order) VALUES (?, ?, ?, ?, ?, ?)`,
      ['wh_th', '泰国仓', 'country_th', '泰国', 'self', 4]);
    console.log('[DB] 已插入默认仓库');
  }

  // 默认费用类型
  const expCount = queryOne('SELECT COUNT(*) as cnt FROM expense_types').cnt;
  if (expCount === 0) {
    const expenses = [
      ['exp_intl', '国际运费', 'intl_freight', 1, 1, 1],
      ['exp_local', '本地杂费', 'local_charges', 1, 1, 2],
      ['exp_delivery', '派送费', 'delivery_fee', 1, 1, 3],
      ['exp_customs_svc', '清关服务费', 'customs_service', 1, 1, 4],
      ['exp_duty', '关税', 'customs_duty', 0, 1, 5],
      ['exp_vat', 'VAT/GST', 'vat_gst', 0, 1, 6],
      ['exp_warehouse', '仓储费', 'warehouse_fee', 0, 0, 7],
      ['exp_other', '其他费用', 'other_fees', 0, 0, 8]
    ];
    expenses.forEach(e => run(`INSERT INTO expense_types (id, name, code, is_freight, is_cost, sort_order) VALUES (?, ?, ?, ?, ?, ?)`, e));
    console.log('[DB] 已插入默认费用类型');
  }

  // 默认分摊规则
  const allocCount = queryOne('SELECT COUNT(*) as cnt FROM allocation_rules').cnt;
  if (allocCount === 0) {
    run(`INSERT INTO allocation_rules (id, name, transport_mode, expense_type, allocation_basis) VALUES (?, ?, ?, ?, ?)`,
      ['alloc_sea', '海运分摊', 'sea', 'freight', 'cbm']);
    run(`INSERT INTO allocation_rules (id, name, transport_mode, expense_type, allocation_basis) VALUES (?, ?, ?, ?, ?)`,
      ['alloc_air', '空运分摊', 'air', 'freight', 'weight']);
    run(`INSERT INTO allocation_rules (id, name, transport_mode, expense_type, allocation_basis) VALUES (?, ?, ?, ?, ?)`,
      ['alloc_express', '快递分摊', 'express', 'freight', 'weight']);
    run(`INSERT INTO allocation_rules (id, name, transport_mode, expense_type, allocation_basis) VALUES (?, ?, ?, ?, ?)`,
      ['alloc_duty', '关税分摊', 'sea', 'duty', 'amount']);
    console.log('[DB] 已插入默认分摊规则');
  }

  // 默认系统配置
  const cfgCount = queryOne('SELECT COUNT(*) as cnt FROM system_config').cnt;
  if (cfgCount === 0) {
    run(`INSERT INTO system_config (key, value, description) VALUES (?, ?, ?)`,
      ['target_stock_months', '4', '目标库存月数']);
    run(`INSERT INTO system_config (key, value, description) VALUES (?, ?, ?)`,
      ['stagnant_light_days', '30', '轻度呆滞天数']);
    run(`INSERT INTO system_config (key, value, description) VALUES (?, ?, ?)`,
      ['stagnant_medium_days', '60', '中度呆滞天数']);
    run(`INSERT INTO system_config (key, value, description) VALUES (?, ?, ?)`,
      ['stagnant_heavy_days', '90', '重度呆滞天数']);
    run(`INSERT INTO system_config (key, value, description) VALUES (?, ?, ?)`,
      ['stagnant_dead_days', '180', '死亡库存天数']);
    run(`INSERT INTO system_config (key, value, description) VALUES (?, ?, ?)`,
      ['payment_remind_days', '7', '付款提前提醒天数']);
    run(`INSERT INTO system_config (key, value, description) VALUES (?, ?, ?)`,
      ['large_payment_threshold', '50000', '大额付款提醒阈值(USD)']);
    console.log('[DB] 已插入默认系统配置');
  }

  // 品牌目标周转月数（统一判断层使用，按品牌区分；__default__ 为兜底）
  const brandCfgExist = queryOne("SELECT COUNT(*) as cnt FROM system_config WHERE key = 'brand_target_stock_months'").cnt;
  if (brandCfgExist === 0) {
    run(`INSERT INTO system_config (key, value, description) VALUES (?, ?, ?)`,
      ['brand_target_stock_months', JSON.stringify({ 'Redragon': 4, 'Netac': 2, '__default__': 3 }), '品牌目标周转月数(JSON)：Redragon=4,Netac=2,其他=3']);
    console.log('[DB] 已插入默认品牌目标周转配置');
  }

  // D1 新增：销量统计周期（默认 90 天；仅影响月均销量与当前可用周转的展示口径，不影响建议采购/采购重算）
  const statsDaysExist = queryOne("SELECT COUNT(*) as cnt FROM system_config WHERE key = 'sales_stats_days'").cnt;
  if (statsDaysExist === 0) {
    run(`INSERT INTO system_config (key, value, description) VALUES (?, ?, ?)`,
      ['sales_stats_days', '90', '销量统计周期(天)：60/90/120，仅影响月均销量与当前可用周转显示']);
    console.log('[DB] 已插入销量统计周期配置');
  }

  // 默认审批流
  const flowCount = queryOne('SELECT COUNT(*) as cnt FROM approval_flows').cnt;
  if (flowCount === 0) {
    const flowTypes = [
      ['flow_po', 'PO审批', 'po', '[{"level":1,"name":"一级审批","approver_role":"role_operator"},{"level":2,"name":"二级审批","approver_role":"role_admin"}]'],
      // V1 仅 PO 审批由运行时真正读取驱动。其余业务类型（付款定金/尾款/运费/关税、
      // 入库异常/盘点差异/报废/MDF出库/调拨）各自走独立模型（如付款单步硬编码），其审批流
      // 配置为 inert 死数据，故不写入以避免"已配置却不生效"的误导。待后续阶段统一接线。
    ];
    flowTypes.forEach(f => run(`INSERT INTO approval_flows (id, name, business_type, levels) VALUES (?, ?, ?, ?)`, f));
    console.log('[DB] 已插入默认审批流');
  }

  // PAY-CORE Phase 1：付款审批流种子（6 类业务类型，默认 is_enabled=0，等管理员手工配置审批人后启用）
  // 幂等：仅在 id 不存在时插入，不覆盖人工修改。levels=[] 空数组，不预置审批人快照。
  // business_type 与 approval_records.business_type 保持一致，由 paymentRequestToBusinessType() 派生。
  // warehouse_arrival 子类归并规则：freight/customs_clearance/port_charges/delivery → freight；warehouse/other_local → warehouse。
  // 2026-07-29：所有付款审批统一为一个审批流 business_type='payment'
  // 不再按 subcategory 拆分 6 个独立审批流；管理员只需配置一套付款审批流程
  const payFlowSeeds = [
    ['flow_pay', '付款审批', 'payment', '[]']
  ];
  for (const f of payFlowSeeds) {
    run(`INSERT OR IGNORE INTO approval_flows (id, name, business_type, levels, is_enabled) VALUES (?, ?, ?, ?, 0)`, f);
  }

  // 默认品牌采购状态：BOYA 已停合作但仍有库存在售，预设为停采（仅首次插入，不覆盖用户后续手动修改）
  try {
    run(`INSERT OR IGNORE INTO brand_settings (brand, procurement_status, note) VALUES ('BOYA', 'stopped', '已停止合作，仍售库存，不参与补货')`);
  } catch(e) {}

  // L1B 付款类目种子：幂等初始化现有前端硬编码类目到新表（不覆盖人工修改，不删除）
  // 推导依据：仅从现有真实付款接口写入的 source_type / payment_subcategory 反推，不猜测
  //   from-pi-deposit      -> goods/deposit,  source_type='pi',    payee=factory
  //   from-ci-balance      -> goods/balance,  source_type='ci',    payee=factory
  //   customs-duty         -> customs_duty/duty,     source_type='ci', payee=customs
  //   inspection-fee       -> inspection_fee/inspection, source_type='ci', payee=inspection_org
  //   warehouse-arrival    -> warehouse_arrival/*, source_type = ci_id ? 'ci' : 'manual'
  //                          旧接口同一小类既可能 ci 也可能 manual，故来源映射表同时 seed 两组 (ci / manual)，解决"双来源"无法匹配问题
  // 注意：子类表只存类目属性；来源映射写入 payment_subcategory_sources（确定性 id：src_<cat>_<sub>_<source_type>）
  //       使用 INSERT OR IGNORE：重复启动不新增、不改写已人工修改、改名(子类 id 不变)不重建重复行
  try {
    const seedCats = [
      { code: 'goods', name: '货款', sort_order: 1 },
      { code: 'warehouse_arrival', name: '到仓费用', sort_order: 2 },
      { code: 'customs_duty', name: '关税', sort_order: 3 },
      { code: 'inspection_fee', name: '商检费用', sort_order: 4 },
    ];
    const seedSubs = [
      { cat: 'goods', code: 'deposit', name: '定金', payee_type_default: 'factory', sort_order: 1 },
      { cat: 'goods', code: 'balance', name: '尾款', payee_type_default: 'factory', sort_order: 2 },
      { cat: 'warehouse_arrival', code: 'freight', name: '运费', payee_type_default: 'service_provider', sort_order: 1 },
      { cat: 'warehouse_arrival', code: 'customs_clearance', name: '清关费', payee_type_default: 'service_provider', sort_order: 2 },
      { cat: 'warehouse_arrival', code: 'port_charges', name: '港口费', payee_type_default: 'service_provider', sort_order: 3 },
      { cat: 'warehouse_arrival', code: 'delivery', name: '派送费', payee_type_default: 'service_provider', sort_order: 4 },
      { cat: 'warehouse_arrival', code: 'warehouse', name: '仓储费', payee_type_default: 'service_provider', sort_order: 5 },
      { cat: 'warehouse_arrival', code: 'other_local', name: '其他本地费', payee_type_default: 'service_provider', sort_order: 6 },
      { cat: 'customs_duty', code: 'duty', name: '关税', payee_type_default: 'customs', sort_order: 1 },
      { cat: 'inspection_fee', code: 'inspection', name: '商检费', payee_type_default: 'inspection_org', sort_order: 1 },
    ];
    // 来源映射：warehouse_arrival 每个子类同时有 ci 与 manual 两组；其余仅一组
    const seedSources = [
      { cat: 'goods', sub: 'deposit', source_type: 'pi', fee_type: 'deposit' },
      { cat: 'goods', sub: 'balance', source_type: 'ci', fee_type: 'balance' },
      { cat: 'warehouse_arrival', sub: 'freight', source_type: 'ci', fee_type: 'freight' },
      { cat: 'warehouse_arrival', sub: 'freight', source_type: 'manual', fee_type: 'freight' },
      { cat: 'warehouse_arrival', sub: 'customs_clearance', source_type: 'ci', fee_type: 'customs_clearance' },
      { cat: 'warehouse_arrival', sub: 'customs_clearance', source_type: 'manual', fee_type: 'customs_clearance' },
      { cat: 'warehouse_arrival', sub: 'port_charges', source_type: 'ci', fee_type: 'port_charges' },
      { cat: 'warehouse_arrival', sub: 'port_charges', source_type: 'manual', fee_type: 'port_charges' },
      { cat: 'warehouse_arrival', sub: 'delivery', source_type: 'ci', fee_type: 'delivery' },
      { cat: 'warehouse_arrival', sub: 'delivery', source_type: 'manual', fee_type: 'delivery' },
      { cat: 'warehouse_arrival', sub: 'warehouse', source_type: 'ci', fee_type: 'warehouse' },
      { cat: 'warehouse_arrival', sub: 'warehouse', source_type: 'manual', fee_type: 'warehouse' },
      { cat: 'warehouse_arrival', sub: 'other_local', source_type: 'ci', fee_type: 'other_local' },
      { cat: 'warehouse_arrival', sub: 'other_local', source_type: 'manual', fee_type: 'other_local' },
      { cat: 'customs_duty', sub: 'duty', source_type: 'ci', fee_type: 'duty' },
      { cat: 'inspection_fee', sub: 'inspection', source_type: 'ci', fee_type: 'inspection' },
    ];
    seedCats.forEach(c => {
      run(`INSERT OR IGNORE INTO payment_categories (id, code, name, sort_order, status, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'active', 'seed', datetime('now'), datetime('now'))`,
        ['cat_' + c.code, c.code, c.name, c.sort_order]);
    });
    seedSubs.forEach(s => {
      const catId = 'cat_' + s.cat;
      run(`INSERT OR IGNORE INTO payment_subcategories (id, category_id, code, name, payee_type_default, sort_order, status, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'active', 'seed', datetime('now'), datetime('now'))`,
        ['sub_' + s.cat + '_' + s.code, catId, s.code, s.name, s.payee_type_default, s.sort_order]);
    });
    seedSources.forEach(s => {
      const subId = 'sub_' + s.cat + '_' + s.sub;
      run(`INSERT OR IGNORE INTO payment_subcategory_sources (id, subcategory_id, source_type, fee_type, status, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'active', 'seed', datetime('now'), datetime('now'))`,
        ['src_' + s.cat + '_' + s.sub + '_' + s.source_type, subId, s.source_type, s.fee_type]);
    });
  } catch (e) { console.warn('[DB] 付款类目种子部分失败(可忽略):', e.message); }

  console.log('[DB] 数据库表初始化完成');
  return true;
}

module.exports = { getDB, query, queryOne, run, transaction, genId, initDatabase };
