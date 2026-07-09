/**
 * 数据库连接模块
 * 本地开发使用 SQLite（better-sqlite3），无需安装数据库
 * 云端部署时可切换为 PostgreSQL（参考售后系统 db.js）
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

let db = null;

function getDB() {
  if (db) return db;

  const dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'inventory.db');
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

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
 */
function transaction(fn) {
  const d = getDB();
  return d.transaction(fn)();
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
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

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

  // 系统配置
  d.exec(`
    CREATE TABLE IF NOT EXISTS system_config (
      key TEXT PRIMARY KEY,
      value TEXT DEFAULT '',
      description TEXT DEFAULT '',
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
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  // 唯一索引：来源系统 + 订单号 + SKU + 店铺/平台（防止重复导入）
  d.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_records_unique ON sales_records(source_system, order_no, sku_code, COALESCE(shop_platform, ''))`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_sales_records_sku ON sales_records(sku_code)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_sales_records_date ON sales_records(order_date)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_sales_records_valid ON sales_records(is_valid_order)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_sales_records_batch ON sales_records(import_batch_id)`);

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
      attachment TEXT DEFAULT '',
      pl_attachment TEXT DEFAULT '',
      remark TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // CI 明细
  d.exec(`
    CREATE TABLE IF NOT EXISTS commercial_invoice_items (
      id TEXT PRIMARY KEY,
      ci_id TEXT NOT NULL,
      ci_no TEXT DEFAULT '',
      pi_no TEXT DEFAULT '',
      sku_code TEXT NOT NULL,
      shipped_qty INTEGER DEFAULT 0,
      unit_price REAL DEFAULT 0,
      ci_amount REAL DEFAULT 0,
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
   'remark TEXT DEFAULT \'\''
  ].forEach(col => {
    try { d.exec(`ALTER TABLE suppliers ADD COLUMN ${col}`); } catch(e) {}
  });

  [
    'brand TEXT DEFAULT \'\'',
    'country TEXT DEFAULT \'\'',
    'target_warehouse TEXT DEFAULT \'\'',
    'need_deposit INTEGER DEFAULT 1',
    'expected_delivery TEXT DEFAULT \'\''
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
    'original_inventory_imported INTEGER DEFAULT 0'
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
    'include_in_landing_cost INTEGER DEFAULT 1'
  ].forEach(col => {
    try { d.exec(`ALTER TABLE payment_requests ADD COLUMN ${col}`); } catch(e) {}
  });

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
  d.exec(`CREATE INDEX IF NOT EXISTS idx_log_status ON logistics_batches(logistics_status)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_inbound_ci ON inbound_records(source_ci_no)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_payment_status ON payment_requests(payment_status)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_ci_cost_items_ci ON ci_cost_items(ci_id)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_cost_logs_sku ON cost_update_logs(sku_code)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_orig_inv_ci ON original_inventory_imports(ci_id)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_orig_inv_sku ON original_inventory_imports(sku_code)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_approval_business ON approval_records(business_type, business_id)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_oplog_page ON operation_logs(page)`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_batchtask_status ON batch_tasks(status)`);

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
      'payment_view', 'payment_create', 'payment_approve', 'payment_import', 'payment_export',
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
    run(`INSERT INTO users (id, username, name, password, role_id, status) VALUES (?, ?, ?, ?, ?, ?)`,
      ['user_admin', 'admin', '超级管理员', 'admin', 'role_admin', 'active']);

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

  // 默认审批流
  const flowCount = queryOne('SELECT COUNT(*) as cnt FROM approval_flows').cnt;
  if (flowCount === 0) {
    const flowTypes = [
      ['flow_po', 'PO审批', 'po', '[{"level":1,"name":"一级审批","approver_role":"role_operator"},{"level":2,"name":"二级审批","approver_role":"role_admin"}]'],
      ['flow_pay_deposit', '货款定金付款审批', 'payment_deposit', '[{"level":1,"name":"一级审批","approver_role":"role_operator"},{"level":2,"name":"二级审批","approver_role":"role_admin"}]'],
      ['flow_pay_balance', '货款尾款付款审批', 'payment_balance', '[{"level":1,"name":"一级审批","approver_role":"role_operator"},{"level":2,"name":"二级审批","approver_role":"role_admin"}]'],
      ['flow_pay_freight', '运费付款审批', 'payment_freight', '[{"level":1,"name":"一级审批","approver_role":"role_operator"},{"level":2,"name":"二级审批","approver_role":"role_admin"}]'],
      ['flow_pay_duty', '关税付款审批', 'payment_duty', '[{"level":1,"name":"一级审批","approver_role":"role_operator"},{"level":2,"name":"二级审批","approver_role":"role_admin"}]'],
      ['flow_inbound_abnormal', '入库异常审批', 'inbound_abnormal', '[{"level":1,"name":"一级审批","approver_role":"role_operator"}]'],
      ['flow_check_diff', '盘点差异审批', 'check_diff', '[{"level":1,"name":"一级审批","approver_role":"role_operator"},{"level":2,"name":"二级审批","approver_role":"role_admin"}]'],
      ['flow_scrap', '报废审批', 'scrap', '[{"level":1,"name":"一级审批","approver_role":"role_operator"},{"level":2,"name":"二级审批","approver_role":"role_admin"}]'],
      ['flow_mdf_outbound', 'MDF出库审批', 'mdf_outbound', '[{"level":1,"name":"一级审批","approver_role":"role_operator"}]'],
      ['flow_transfer', '调拨审批', 'transfer', '[{"level":1,"name":"一级审批","approver_role":"role_operator"}]']
    ];
    flowTypes.forEach(f => run(`INSERT INTO approval_flows (id, name, business_type, levels) VALUES (?, ?, ?, ?)`, f));
    console.log('[DB] 已插入默认审批流');
  }

  console.log('[DB] 数据库表初始化完成');
  return true;
}

module.exports = { getDB, query, queryOne, run, transaction, genId, initDatabase };
