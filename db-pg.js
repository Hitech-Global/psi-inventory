/**
 * PostgreSQL 数据访问层（INVENTORY-PG-REBUILD-01 · R1）
 *
 * 仅当 DB_DRIVER=pg 时由 db.js 加载。业务规则（PO/PI/CI/PL/Inbound、Payment、
 * WAC 算法、Approval、Forecast、Feishu Auth/Notify、PUR-OPS-COLLAB）全部冻结，
 * 本文件只替换数据库底座，不改动任何业务逻辑。
 *
 * 设计要点：
 *  - pg.Pool + Supabase 直连/Session 池（5432）；禁用 Transaction 池（6542/6543），
 *    因为事务跨多 await 需独占连接（与 free 层连接池冲突）。
 *  - AsyncLocalStorage 路由事务连接：每事务独立 async 上下文，并发安全；
 *    严禁模块级全局 txClient（R0 已否决）。
 *  - query/run/transaction 执行前经 normalizeSql 把 server.js 传入的 SQLite 方言
 *    翻译为 PostgreSQL（? -> $N、datetime/date/julianday/strftime/instr/GLOB/printf/
 *    COLLATE NOCASE 等），使 server.js 无需改动（R2 再做 async 化）。
 *  - NUMERIC/BIGINT 类型解析为 JS 数值，避免 server.js 字符串拼接式算术出错。
 */

const { Pool } = require('pg');
const { types } = require('pg');
const { AsyncLocalStorage } = require('async_hooks');

// NUMERIC(1700) -> number；BIGINT(20)/INTEGER(23) -> integer。
// 否则 COUNT/SUM 返回字符串，server.js 的 `a + b` 会变成字符串拼接。
types.setTypeParser(1700, parseFloat);
types.setTypeParser(20, parseInt);
types.setTypeParser(23, parseInt);

const als = new AsyncLocalStorage();

let pool = null;

function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('[DB-PG] 缺少环境变量 DATABASE_URL（DB_DRIVER=pg 时必须提供 Supabase 直连/Session 池连接串，禁用 Transaction 池 6543）');
    }
    const max = parseInt(process.env.PG_POOL_MAX || '10', 10);
    const poolMax = Number.isFinite(max) ? max : 10;
    // Supabase 直连强制 ssl；Render free 反代下也需 ssl。
    const useSsl = /(sslmode=require|ssl=true|amazonaws|supabase|render\.com)/i.test(connectionString);
    pool = new Pool({
      connectionString,
      max: poolMax,
      ssl: useSsl ? { rejectUnauthorized: false } : false,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    });
    pool.on('error', (err) => {
      console.error('[DB-PG] 连接池意外错误:', err.message);
    });
    console.log('[DB-PG] PostgreSQL 连接池已创建 (max=' + poolMax + ')');
  }
  return pool;
}

// ==================== SQL 归一化层：SQLite 方言 -> PostgreSQL ====================

// 按顶层逗号切分（忽略括号内的逗号），用于解析函数参数。
function splitTopLevelCommas(str) {
  const parts = [];
  let depth = 0, cur = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; }
    else cur += ch;
  }
  if (cur.length > 0 || parts.length > 0) parts.push(cur);
  return parts;
}

// 带括号平衡的函数调用替换：replacer(inner) 收到括号内内容。
function replaceBalanced(sql, fnName, replacer) {
  const re = new RegExp('\\b' + fnName + '\\s*\\(', 'g');
  let out = '', last = 0, m;
  while ((m = re.exec(sql))) {
    const start = m.index + m[0].length;
    let depth = 1, i = start;
    while (i < sql.length && depth > 0) {
      const ch = sql[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      if (depth === 0) break;
      i++;
    }
    const inner = sql.slice(start, i);
    out += sql.slice(last, m.index) + replacer(inner);
    last = i + 1;
    re.lastIndex = i + 1;
  }
  out += sql.slice(last);
  return out;
}

// SQLite GLOB 模式 -> PG 正则（大小写敏感、锚定 ^...$）。
// 转换规则：* -> .* ；? -> .；[!x] -> [^x]；其余正则元字符转义。
function globToRegex(pattern) {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') out += '.*';
    else if (c === '?') out += '.';
    else if (c === '[') {
      if (pattern[i + 1] === '!') { out += '[^'; i++; }
      else out += '[';
    }
    else if (c === ']') out += ']';
    else if ('.+^${}()|\\/'.includes(c)) out += '\\' + c;
    else out += c;
  }
  return out;
}

// SQLite strftime 格式 -> PG TO_CHAR 格式。
function convertStrftimeFmt(fmt) {
  return fmt
    .replace(/%Y/g, 'YYYY')
    .replace(/%y/g, 'YY')
    .replace(/%m/g, 'MM')
    .replace(/%d/g, 'DD')
    .replace(/%H/g, 'HH24')
    .replace(/%M/g, 'MI')
    .replace(/%S/g, 'SS');
}

// printf('%04d-%02d-%02d', a, b, c) -> LPAD(CAST(a AS TEXT),4,'0')||'-'||LPAD(CAST(b AS TEXT),2,'0')||'-'||LPAD(CAST(c AS TEXT),2,'0')
// printf('%s%02d-...', s, a, b, c) -> s||LPAD(CAST(a AS TEXT),2,'0')||'-'||...
function expandPrintf(sql) {
  const re = /printf\(/g;
  let out = '', last = 0, m;
  while ((m = re.exec(sql))) {
    const start = m.index + m[0].length;
    let depth = 1, i = start;
    while (i < sql.length && depth > 0) {
      const ch = sql[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      if (depth === 0) break;
      i++;
    }
    const inner = sql.slice(start, i);
    out += sql.slice(last, m.index) + expandPrintfInner(inner);
    last = i + 1;
    re.lastIndex = i + 1;
  }
  out += sql.slice(last);
  return out;
}

function expandPrintfInner(inner) {
  const parts = splitTopLevelCommas(inner).map((s) => s.trim());
  const fmt = parts[0].replace(/^'|'$/g, '');
  const args = parts.slice(1);
  const frags = [];
  let i = 0, argIdx = 0;
  while (i < fmt.length) {
    if (fmt[i] === '%') {
      let width = 0, p = i + 1;
      if (fmt[p] === '0') { width = parseInt(fmt[p + 1], 10); p += 2; }
      const type = fmt[p];
      const arg = args[argIdx++];
      if (type === 'd') {
        frags.push(width ? `LPAD(CAST(${arg} AS TEXT), ${width}, '0')` : `CAST(${arg} AS TEXT)`);
      } else if (type === 's') {
        frags.push(arg);
      } else {
        frags.push(`'%${type}'`);
      }
      i = p + 1;
    } else {
      let lit = '';
      while (i < fmt.length && fmt[i] !== '%') { lit += fmt[i]; i++; }
      frags.push(`'${lit.replace(/'/g, "''")}'`);
    }
  }
  return frags.join(' || ');
}

/**
 * 把 server.js 传入的 SQLite 风格 SQL 翻译为 PostgreSQL 可执行语句。
 * 顺序很重要：COLLATE / datetime / date / julianday / strftime / instr / GLOB /
 * printf 等转换不得引入裸 '?'，最后一步才把 '?' 替换为 '$N'。
 */
function normalizeSql(sql) {
  if (!sql) return sql;
  let s = sql;

  // 1. COLLATE NOCASE 谓词 -> lower() 比较（保留 ? 占位符，须在 ?->$N 之前）
  s = s.replace(/\b(\w+)\s*=\s*\?\s+COLLATE\s+NOCASE/g, 'lower($1) = lower(?)');

  // 2. datetime('now') / datetime('now', '+N unit')
  s = s.replace(/datetime\(\s*'now'\s*\)/g, 'NOW()');
  s = s.replace(/datetime\(\s*'now'\s*,\s*'\+(\d+)\s+(\w+)'\s*\)/g, "NOW() + INTERVAL '$1 $2'");

  // 3. date('now') / date('now', '[+-]N days|months')
  //    - 偏移符号与 INTERVAL 幅度分离，避免双重负号变成未来日期（修复 F2）。
  //    - 带修饰符的 date() 返回 TEXT 'YYYY-MM-DD'（与 SQLite 的 date() 返回类型一致），
  //      使结果可直接与 TEXT 日期列（order_date / depart_date 等）比较，
  //      对应 server.js:7666/7702/7780 的 `col >= date('now','-N days')` 写法。
  s = s.replace(/date\(\s*'now'\s*\)/g, 'CURRENT_DATE');
  s = s.replace(/date\(\s*'now'\s*,\s*'([+-]?)(\d+)\s+(days|months)'\s*\)/g,
    (m, sign, num, unit) => `TO_CHAR(CURRENT_DATE ${sign === '-' ? '-' : '+'} INTERVAL '${num} ${unit}', 'YYYY-MM-DD')`);

  // 4. julianday(x) -> EXTRACT(EPOCH FROM (CAST(x AS timestamp)))/86400.0（天数差）
  s = replaceBalanced(s, 'julianday', (inner) =>
    `EXTRACT(EPOCH FROM (CAST(${inner} AS timestamp)))/86400.0`);

  // 5. strftime('fmt', col) -> TO_CHAR(CAST(NULLIF(col,'') AS timestamp), 'PGfmt')
  //    包一层 CAST(NULLIF(col,'')) 以兼容 TEXT 日期列（含空字符串 '' -> NULL），避免 to_char(text,unknown) 重载歧义
  s = replaceBalanced(s, 'strftime', (inner) => {
    const parts = splitTopLevelCommas(inner).map((x) => x.trim());
    const fmt = parts[0].replace(/^'|'$/g, '');
    const col = parts[1] || '';
    return `TO_CHAR(CAST(NULLIF(${col}, '') AS timestamp), '${convertStrftimeFmt(fmt)}')`;
  });

  // 6. instr(a, b) -> strpos(a, b)
  s = replaceBalanced(s, 'instr', (inner) => `strpos(${inner})`);

  // 7. GLOB 'pat' -> ~ '^pat$'（大小写敏感；用 ~ 而非 ~*）
  s = s.replace(/\b(\w+)\s+GLOB\s+'([^']*)'/g, (m, col, pat) =>
    `${col} ~ '^${globToRegex(pat)}$'`);

  // 8. printf('fmt', args) -> LPAD/CAST/|| 拼接
  s = expandPrintf(s);

  // 9. 防御性：IFNULL -> COALESCE（server.js 当前未使用，留作兜底）
  s = s.replace(/\bIFNULL\s*\(/g, 'COALESCE(');

  // 10. ? -> $1, $2, ...（必须最后，确保以上转换不引入裸 ?）
  let n = 0;
  s = s.replace(/\?/g, () => '$' + (++n));

  return s;
}

// ==================== 核心 DAL 函数 ====================

async function query(sql, params = []) {
  const store = als.getStore();
  const pgSql = normalizeSql(sql);
  const res = store
    ? await store.client.query(pgSql, params)
    : await getPool().query(pgSql, params);
  return { rows: res.rows };
}

async function queryOne(sql, params = []) {
  const store = als.getStore();
  const pgSql = normalizeSql(sql);
  const res = store
    ? await store.client.query(pgSql, params)
    : await getPool().query(pgSql, params);
  return res.rows[0] || null;
}

async function run(sql, params = []) {
  const store = als.getStore();
  const pgSql = normalizeSql(sql);
  const res = store
    ? await store.client.query(pgSql, params)
    : await getPool().query(pgSql, params);
  return { changes: res.rowCount == null ? 0 : res.rowCount };
}

// 嵌套事务守卫：外层事务内再调用 transaction() 时改用 SAVEPOINT，复用同一连接。
let spCounter = 0;
async function transaction(fn) {
  const existing = als.getStore();
  if (existing) {
    const sp = 'sp_' + (++spCounter);
    await existing.client.query('SAVEPOINT ' + sp);
    try {
      const result = await fn();
      await existing.client.query('RELEASE SAVEPOINT ' + sp);
      return result;
    } catch (e) {
      await existing.client.query('ROLLBACK TO SAVEPOINT ' + sp);
      throw e;
    }
  }
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await als.run({ client }, fn);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

function getDB() {
  // PG 无单文件句柄概念；返回连接池以兼容极少数潜在调用方（server.js 当前不使用 getDB）。
  return getPool();
}

// ==================== 初始化数据库表（PostgreSQL 全量 schema） ====================

async function initDatabase() {
  const p = getPool();
  const exec = async (sql) => { await p.query(sql); };

  // ---------- 系统管理表 ----------

  await exec(`
    CREATE TABLE IF NOT EXISTS roles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      permissions TEXT DEFAULT '[]',
      is_system INTEGER DEFAULT 0,
      created_at TEXT DEFAULT NOW()
    )
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password TEXT DEFAULT '',
      role_id TEXT DEFAULT 'role_viewer',
      status TEXT DEFAULT 'active',
      email TEXT DEFAULT '',
      created_at TEXT DEFAULT NOW(),
      auth_source TEXT NOT NULL DEFAULT 'feishu',
      feishu_open_id TEXT NOT NULL DEFAULT '',
      feishu_union_id TEXT NOT NULL DEFAULT '',
      feishu_user_id TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL DEFAULT '',
      last_login_at TEXT NOT NULL DEFAULT ''
    )
  `);
  await exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_union_id ON users(feishu_union_id) WHERE feishu_union_id <> ''");
  await exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_open_id ON users(feishu_open_id) WHERE feishu_open_id <> ''");

  await exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      user_agent TEXT DEFAULT '',
      ip_address TEXT DEFAULT ''
    )
  `);
  await exec("CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)");
  await exec("CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)");

  await exec(`
    CREATE TABLE IF NOT EXISTS oauth_states (
      state TEXT PRIMARY KEY,
      created_at TEXT DEFAULT NOW(),
      expires_at TEXT NOT NULL
    )
  `);
  await exec("CREATE INDEX IF NOT EXISTS idx_oauth_states_expires ON oauth_states(expires_at)");

  await exec(`
    CREATE TABLE IF NOT EXISTS login_audit (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      username TEXT DEFAULT '',
      auth_source TEXT NOT NULL,
      success INTEGER NOT NULL,
      fail_reason TEXT DEFAULT '',
      ip TEXT DEFAULT '',
      user_agent TEXT DEFAULT '',
      created_at TEXT DEFAULT NOW()
    )
  `);
  await exec("CREATE INDEX IF NOT EXISTS idx_login_audit_user ON login_audit(user_id)");
  await exec("CREATE INDEX IF NOT EXISTS idx_login_audit_created ON login_audit(created_at)");

  await exec(`
    CREATE TABLE IF NOT EXISTS countries (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT NOT NULL,
      default_currency TEXT DEFAULT '',
      status TEXT DEFAULT 'active',
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT NOW()
    )
  `);

  await exec(`
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
      created_at TEXT DEFAULT NOW()
    )
  `);

  await exec(`
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
      created_at TEXT DEFAULT NOW(),
      last_used_payment_term_id TEXT DEFAULT ''
    )
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS supplier_payment_terms (
      id TEXT PRIMARY KEY,
      supplier_id TEXT NOT NULL,
      term_name TEXT DEFAULT '',
      term_type TEXT DEFAULT 'advance',
      credit_days INTEGER DEFAULT 0,
      is_default INTEGER DEFAULT 0,
      display_order INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT NOW()
    )
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS brand_settings (
      brand TEXT PRIMARY KEY,
      procurement_status TEXT DEFAULT 'active',
      note TEXT DEFAULT '',
      updated_at TEXT DEFAULT NOW()
    )
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS freight_forwarders (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      short_name TEXT DEFAULT '',
      contact_person TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      email TEXT DEFAULT '',
      service_types TEXT DEFAULT '',
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT NOW()
    )
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS currencies (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      symbol TEXT DEFAULT '',
      is_base INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT NOW()
    )
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS exchange_rates (
      id TEXT PRIMARY KEY,
      from_currency TEXT NOT NULL,
      to_currency TEXT NOT NULL,
      rate NUMERIC(18,8) NOT NULL,
      rate_date TEXT NOT NULL,
      rate_type TEXT DEFAULT 'realtime',
      created_at TEXT DEFAULT NOW()
    )
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS payment_terms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      payee_type TEXT DEFAULT 'factory',
      payment_type TEXT DEFAULT 'goods',
      payment_stage TEXT DEFAULT 'deposit',
      payment_node TEXT DEFAULT 'after_pi',
      ratio DOUBLE PRECISION DEFAULT 0,
      remind_days_before INTEGER DEFAULT 7,
      is_enabled INTEGER DEFAULT 1,
      created_at TEXT DEFAULT NOW()
    )
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS approval_flows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      business_type TEXT NOT NULL,
      levels TEXT DEFAULT '[]',
      is_enabled INTEGER DEFAULT 1,
      created_at TEXT DEFAULT NOW()
    )
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS expense_types (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT DEFAULT '',
      is_freight INTEGER DEFAULT 0,
      is_cost INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT NOW()
    )
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS allocation_rules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      transport_mode TEXT DEFAULT 'sea',
      expense_type TEXT DEFAULT 'freight',
      allocation_basis TEXT DEFAULT 'cbm',
      is_enabled INTEGER DEFAULT 1,
      created_at TEXT DEFAULT NOW()
    )
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS system_config (
      key TEXT PRIMARY KEY,
      value TEXT DEFAULT '',
      description TEXT DEFAULT '',
      updated_at TEXT DEFAULT NOW()
    )
  `);

  await exec(`
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
      created_at TEXT DEFAULT NOW(),
      updated_at TEXT DEFAULT NOW()
    )
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS business_participants (
      id TEXT PRIMARY KEY,
      business_type TEXT NOT NULL,
      business_id TEXT NOT NULL,
      participant_type TEXT NOT NULL,
      user_id TEXT NOT NULL,
      user_name TEXT DEFAULT '',
      created_at TEXT DEFAULT NOW()
    )
  `);

  // ---------- 业务表 ----------

  await exec(`
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
      standard_purchase_price NUMERIC(18,4) DEFAULT 0,
      purchase_price_rmb NUMERIC(18,4) DEFAULT 0,
      purchase_price_usd NUMERIC(18,4) DEFAULT 0,
      reference_customs_rate NUMERIC(18,8) DEFAULT NULL,
      weighted_avg_cost NUMERIC(18,4) DEFAULT 0,
      carton_spec TEXT DEFAULT '',
      qty_per_carton INTEGER DEFAULT 0,
      unit_weight DOUBLE PRECISION DEFAULT 0,
      unit_cbm DOUBLE PRECISION DEFAULT 0,
      is_new_product INTEGER DEFAULT 0,
      launch_date TEXT DEFAULT '',
      new_product_protection_days INTEGER DEFAULT 90,
      lifecycle_status TEXT DEFAULT 'new_test',
      auto_replenish INTEGER DEFAULT 1,
      status TEXT DEFAULT 'normal',
      remark TEXT DEFAULT '',
      created_at TEXT DEFAULT NOW(),
      updated_at TEXT DEFAULT NOW()
    )
  `);

  await exec(`
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
      snapshot_cutoff_date TEXT DEFAULT '',
      brand TEXT DEFAULT '',
      weighted_avg_cost NUMERIC(18,4) DEFAULT 0,
      created_at TEXT DEFAULT NOW()
    )
  `);

  await exec(`
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
      weighted_avg_cost NUMERIC(18,4) DEFAULT 0,
      inventory_value NUMERIC(18,4) DEFAULT 0,
      last_import_date TEXT DEFAULT '',
      last_inbound_date TEXT DEFAULT '',
      first_inbound_date TEXT DEFAULT '',
      last_outbound_date TEXT DEFAULT '',
      turnover_months DOUBLE PRECISION DEFAULT 0,
      inventory_status TEXT DEFAULT 'normal',
      is_focused INTEGER DEFAULT 0,
      safety_stock INTEGER DEFAULT 0,
      target_turnover_months DOUBLE PRECISION DEFAULT 0,
      replenishment_rule TEXT DEFAULT '',
      inventory_remark TEXT DEFAULT '',
      snapshot_cutoff_date TEXT DEFAULT '',
      updated_at TEXT DEFAULT NOW()
    )
  `);

  await exec(`
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
      outbound_status TEXT DEFAULT 'normal',
      void_reason TEXT DEFAULT '',
      voided_at TEXT DEFAULT '',
      voided_by TEXT DEFAULT '',
      import_mode TEXT DEFAULT '',
      inventory_effect TEXT DEFAULT 'none',
      applied_to_inventory INTEGER DEFAULT 0,
      snapshot_cutoff_date TEXT DEFAULT '',
      import_batch_id TEXT DEFAULT '',
      platform_order_no TEXT DEFAULT '',
      created_at TEXT DEFAULT NOW()
    )
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS sales_data (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      sku_code TEXT DEFAULT '',
      country TEXT DEFAULT '',
      channel TEXT DEFAULT '',
      platform TEXT DEFAULT '',
      quantity INTEGER DEFAULT 0,
      amount NUMERIC(18,4) DEFAULT 0,
      created_at TEXT DEFAULT NOW()
    )
  `);

  await exec(`
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
      created_at TEXT DEFAULT NOW(),
      updated_at TEXT DEFAULT NOW()
    )
  `);
  await exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_records_unique ON sales_records(source_system, order_no, sku_code, COALESCE(shop_platform, ''))`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_sales_records_sku ON sales_records(sku_code)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_sales_records_date ON sales_records(order_date)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_sales_records_valid ON sales_records(is_valid_order)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_sales_records_batch ON sales_records(import_batch_id)`);

  await exec(`
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
      avg_sales_4m DOUBLE PRECISION DEFAULT 0,
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
      current_turnover_months DOUBLE PRECISION DEFAULT 0,
      after_order_turnover_months DOUBLE PRECISION DEFAULT 0,
      target_stock_months DOUBLE PRECISION DEFAULT 0,
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
      online_suggested_qty INTEGER DEFAULT 0,
      offline_suggested_qty INTEGER DEFAULT 0,
      other_suggested_qty INTEGER DEFAULT 0,
      online_target_turnover DOUBLE PRECISION DEFAULT 2,
      offline_target_turnover DOUBLE PRECISION DEFAULT 2,
      online_target_stock INTEGER DEFAULT 0,
      offline_target_stock INTEGER DEFAULT 0,
      other_target_stock INTEGER DEFAULT 0,
      final_order_qty INTEGER DEFAULT -1,
      adjustment_reason TEXT DEFAULT '',
      online_reservation_method TEXT DEFAULT '',
      online_reservation_months DOUBLE PRECISION DEFAULT 0,
      online_reservation_qty INTEGER DEFAULT 0,
      online_remark TEXT DEFAULT '',
      offline_reservation_method TEXT DEFAULT '',
      offline_reservation_months DOUBLE PRECISION DEFAULT 0,
      offline_reservation_qty INTEGER DEFAULT 0,
      offline_remark TEXT DEFAULT '',
      avg_sales_period DOUBLE PRECISION DEFAULT 0,
      online_avg_sales_period DOUBLE PRECISION DEFAULT 0,
      offline_avg_sales_period DOUBLE PRECISION DEFAULT 0,
      created_at TEXT DEFAULT NOW()
    )
  `);

  await exec(`
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
      total_amount NUMERIC(18,4) DEFAULT 0,
      created_by TEXT DEFAULT '',
      created_by_name TEXT DEFAULT '',
      approver_id TEXT DEFAULT '',
      approver_name TEXT DEFAULT '',
      po_status TEXT DEFAULT 'draft',
      approval_status TEXT DEFAULT 'pending',
      from_suggestion INTEGER DEFAULT 0,
      attachment TEXT DEFAULT '',
      remark TEXT DEFAULT '',
      created_at TEXT DEFAULT NOW(),
      updated_at TEXT DEFAULT NOW()
    )
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS purchase_order_items (
      id TEXT PRIMARY KEY,
      po_id TEXT NOT NULL,
      po_no TEXT DEFAULT '',
      sku_code TEXT NOT NULL,
      po_qty INTEGER DEFAULT 0,
      unit_price NUMERIC(18,4) DEFAULT 0,
      po_amount NUMERIC(18,4) DEFAULT 0,
      transferred_pi_qty INTEGER DEFAULT 0,
      untransferred_pi_qty INTEGER DEFAULT 0,
      forecast_turnover_months DOUBLE PRECISION DEFAULT 0,
      remark TEXT DEFAULT '',
      created_at TEXT DEFAULT NOW()
    )
  `);

  await exec(`
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
      total_amount NUMERIC(18,4) DEFAULT 0,
      payment_terms TEXT DEFAULT '',
      need_deposit INTEGER DEFAULT 1,
      deposit_ratio DOUBLE PRECISION DEFAULT 0,
      balance_ratio DOUBLE PRECISION DEFAULT 100,
      payable_deposit NUMERIC(18,4) DEFAULT 0,
      paid_deposit NUMERIC(18,4) DEFAULT 0,
      deducted_deposit NUMERIC(18,4) DEFAULT 0,
      available_deduct_deposit NUMERIC(18,4) DEFAULT 0,
      shipped_amount NUMERIC(18,4) DEFAULT 0,
      unshipped_amount NUMERIC(18,4) DEFAULT 0,
      deposit_payment_status TEXT DEFAULT 'unpaid',
      goods_payment_status TEXT DEFAULT 'unpaid',
      pi_status TEXT DEFAULT 'pending',
      expected_delivery TEXT DEFAULT '',
      attachment TEXT DEFAULT '',
      remark TEXT DEFAULT '',
      payment_term_id TEXT DEFAULT '',
      created_at TEXT DEFAULT NOW(),
      updated_at TEXT DEFAULT NOW()
    )
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS proforma_invoice_items (
      id TEXT PRIMARY KEY,
      pi_id TEXT NOT NULL,
      pi_no TEXT DEFAULT '',
      po_no TEXT DEFAULT '',
      sku_code TEXT NOT NULL,
      po_qty INTEGER DEFAULT 0,
      pi_confirmed_qty INTEGER DEFAULT 0,
      unit_price NUMERIC(18,4) DEFAULT 0,
      pi_amount NUMERIC(18,4) DEFAULT 0,
      shipped_qty INTEGER DEFAULT 0,
      unshipped_qty INTEGER DEFAULT 0,
      discount DOUBLE PRECISION DEFAULT 0,
      created_at TEXT DEFAULT NOW()
    )
  `);

  await exec(`
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
      goods_amount NUMERIC(18,4) DEFAULT 0,
      pi_total_amount NUMERIC(18,4) DEFAULT 0,
      amount_difference NUMERIC(18,4) DEFAULT 0,
      difference_reason TEXT DEFAULT '',
      ci_status TEXT DEFAULT 'draft',
      should_deduct_deposit NUMERIC(18,4) DEFAULT 0,
      actual_deducted_deposit NUMERIC(18,4) DEFAULT 0,
      payable_balance NUMERIC(18,4) DEFAULT 0,
      paid_balance NUMERIC(18,4) DEFAULT 0,
      unpaid_balance NUMERIC(18,4) DEFAULT 0,
      balance_payment_status TEXT DEFAULT 'unpaid',
      transport_basis TEXT DEFAULT NULL,
      import_duty_total NUMERIC(18,4) DEFAULT 0,
      attachment TEXT DEFAULT '',
      pl_attachment TEXT DEFAULT '',
      remark TEXT DEFAULT '',
      has_customs_duty INTEGER DEFAULT 0,
      has_inspection_fee INTEGER DEFAULT 0,
      cost_confirmed INTEGER DEFAULT 0,
      cost_allocated INTEGER DEFAULT 0,
      landing_total_cost NUMERIC(18,4) DEFAULT 0,
      original_inventory_imported INTEGER DEFAULT 0,
      wac_version_id TEXT DEFAULT '',
      actual_ship_date TEXT NOT NULL DEFAULT '',
      payment_term_id TEXT NOT NULL DEFAULT '',
      credit_days INTEGER NOT NULL DEFAULT 0,
      ops_owner_id TEXT NOT NULL DEFAULT '',
      ops_plan_listing_date TEXT NOT NULL DEFAULT '',
      ops_ready_status TEXT NOT NULL DEFAULT 'pending',
      wac_confirmed INTEGER DEFAULT 0,
      wac_confirmed_at TEXT DEFAULT '',
      wac_confirmed_by TEXT DEFAULT '',
      created_at TEXT DEFAULT NOW(),
      updated_at TEXT DEFAULT NOW()
    )
  `);

  await exec(`
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
      gross_goods_amount NUMERIC(18,4) NOT NULL,
      historical_paid_amount NUMERIC(18,4) NOT NULL DEFAULT 0,
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
      attachment TEXT NOT NULL DEFAULT '',
      actual_ship_date TEXT NOT NULL DEFAULT '',
      payment_term_id TEXT NOT NULL DEFAULT '',
      credit_days INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT NOW(),
      updated_at TEXT DEFAULT NOW(),
      CHECK (source_mode = 'historical'),
      CHECK (gross_goods_amount > 0),
      CHECK (historical_paid_amount >= 0),
      CHECK (historical_paid_amount <= gross_goods_amount)
    )
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS commercial_invoice_items (
      id TEXT PRIMARY KEY,
      ci_id TEXT NOT NULL,
      ci_no TEXT DEFAULT '',
      pi_no TEXT DEFAULT '',
      sku_code TEXT NOT NULL,
      shipped_qty INTEGER DEFAULT 0,
      unit_price NUMERIC(18,4) DEFAULT 0,
      ci_amount NUMERIC(18,4) DEFAULT 0,
      actual_customs_rate NUMERIC(18,8) DEFAULT NULL,
      inbound_qty INTEGER DEFAULT 0,
      uninbound_qty INTEGER DEFAULT 0,
      created_at TEXT DEFAULT NOW()
    )
  `);

  await exec(`
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
      total_gross_weight DOUBLE PRECISION DEFAULT 0,
      total_net_weight DOUBLE PRECISION DEFAULT 0,
      total_cbm DOUBLE PRECISION DEFAULT 0,
      attachment TEXT DEFAULT '',
      remark TEXT DEFAULT '',
      created_at TEXT DEFAULT NOW()
    )
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS packing_list_items (
      id TEXT PRIMARY KEY,
      pl_id TEXT NOT NULL,
      pl_no TEXT DEFAULT '',
      ci_no TEXT DEFAULT '',
      sku_code TEXT NOT NULL,
      cartons INTEGER DEFAULT 0,
      qty_per_carton INTEGER DEFAULT 0,
      total_qty INTEGER DEFAULT 0,
      gross_weight DOUBLE PRECISION DEFAULT 0,
      net_weight DOUBLE PRECISION DEFAULT 0,
      cbm DOUBLE PRECISION DEFAULT 0,
      remark TEXT DEFAULT '',
      created_at TEXT DEFAULT NOW()
    )
  `);

  await exec(`
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
      total_weight DOUBLE PRECISION DEFAULT 0,
      total_cbm DOUBLE PRECISION DEFAULT 0,
      freight_currency TEXT DEFAULT 'USD',
      international_freight NUMERIC(18,4) DEFAULT 0,
      local_charges NUMERIC(18,4) DEFAULT 0,
      customs_service_fee NUMERIC(18,4) DEFAULT 0,
      delivery_fee NUMERIC(18,4) DEFAULT 0,
      total_freight NUMERIC(18,4) DEFAULT 0,
      customs_duty NUMERIC(18,4) DEFAULT 0,
      vat_gst NUMERIC(18,4) DEFAULT 0,
      other_fees NUMERIC(18,4) DEFAULT 0,
      fee_status TEXT DEFAULT 'unpaid',
      attachment TEXT DEFAULT '',
      remark TEXT DEFAULT '',
      created_at TEXT DEFAULT NOW(),
      updated_at TEXT DEFAULT NOW()
    )
  `);

  await exec(`
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
      source_pl_id TEXT DEFAULT '',
      source_pl_item_id TEXT DEFAULT '',
      created_at TEXT DEFAULT NOW(),
      updated_at TEXT DEFAULT NOW()
    )
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS cost_allocations (
      id TEXT PRIMARY KEY,
      inbound_id TEXT DEFAULT '',
      inbound_no TEXT DEFAULT '',
      logistics_batch_no TEXT DEFAULT '',
      allocation_run_id TEXT DEFAULT '',
      ci_no TEXT DEFAULT '',
      sku_code TEXT NOT NULL,
      allocation_basis TEXT DEFAULT '',
      product_cost NUMERIC(18,4) DEFAULT 0,
      allocated_freight NUMERIC(18,4) DEFAULT 0,
      allocated_duty NUMERIC(18,4) DEFAULT 0,
      allocated_other NUMERIC(18,4) DEFAULT 0,
      total_landing_cost NUMERIC(18,4) DEFAULT 0,
      inbound_qty INTEGER DEFAULT 0,
      unit_landing_cost NUMERIC(18,4) DEFAULT 0,
      currency TEXT DEFAULT 'USD',
      ci_id TEXT DEFAULT '',
      related_po_no TEXT DEFAULT '',
      related_pi_no TEXT DEFAULT '',
      unit_product_cost NUMERIC(18,4) DEFAULT 0,
      unit_allocated_cost NUMERIC(18,4) DEFAULT 0,
      unit_landing_cost_with_fees NUMERIC(18,4) DEFAULT 0,
      original_qty NUMERIC(18,4) DEFAULT 0,
      original_avg_cost NUMERIC(18,4) DEFAULT 0,
      created_at TEXT DEFAULT NOW()
    )
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS cost_allocation_details (
      id TEXT PRIMARY KEY,
      allocation_run_id TEXT NOT NULL,
      ci_id TEXT NOT NULL,
      ci_no TEXT DEFAULT '',
      source_cost_item_id TEXT DEFAULT '',
      fee_key TEXT NOT NULL,
      cost_category TEXT DEFAULT '',
      cost_subcategory TEXT DEFAULT '',
      fee_total NUMERIC(18,4) NOT NULL DEFAULT 0,
      currency TEXT DEFAULT 'USD',
      sku_code TEXT NOT NULL,
      allocation_basis TEXT NOT NULL,
      basis_value DOUBLE PRECISION NOT NULL DEFAULT 0,
      basis_total DOUBLE PRECISION NOT NULL DEFAULT 0,
      ratio DOUBLE PRECISION NOT NULL DEFAULT 0,
      theoretical_amount NUMERIC(18,4) NOT NULL DEFAULT 0,
      rounded_amount NUMERIC(18,4) NOT NULL DEFAULT 0,
      rounding_adjustment NUMERIC(18,4) NOT NULL DEFAULT 0,
      final_allocated_amount NUMERIC(18,4) NOT NULL DEFAULT 0,
      is_rounding_anchor INTEGER NOT NULL DEFAULT 0,
      stable_sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT NOW(),
      UNIQUE(ci_id, fee_key, sku_code)
    )
  `);

  await exec(`
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
      payable_amount NUMERIC(18,4) DEFAULT 0,
      paid_amount NUMERIC(18,4) DEFAULT 0,
      unpaid_amount NUMERIC(18,4) DEFAULT 0,
      currency TEXT DEFAULT 'USD',
      book_rate NUMERIC(18,8) DEFAULT 0,
      actual_rate NUMERIC(18,8) DEFAULT 0,
      local_amount NUMERIC(18,4) DEFAULT 0,
      rmb_amount NUMERIC(18,4) DEFAULT 0,
      usd_amount NUMERIC(18,4) DEFAULT 0,
      payment_terms TEXT DEFAULT '',
      payable_date TEXT DEFAULT '',
      remind_date TEXT DEFAULT '',
      payment_status TEXT DEFAULT 'not_requested',
      approval_status TEXT DEFAULT 'pending',
      payment_voucher TEXT DEFAULT '',
      remark TEXT DEFAULT '',
      has_deduction INTEGER DEFAULT 0,
      deduction_amount NUMERIC(18,4) DEFAULT 0,
      deduction_source_type TEXT DEFAULT '',
      deduction_source_desc TEXT DEFAULT '',
      deduction_ref_no TEXT DEFAULT '',
      deduction_attachment TEXT DEFAULT '',
      actual_pay_amount NUMERIC(18,4) DEFAULT 0,
      related_ci_id TEXT DEFAULT '',
      related_ci_no TEXT DEFAULT '',
      related_po_no TEXT DEFAULT '',
      include_in_landing_cost INTEGER DEFAULT 1,
      attachment TEXT DEFAULT '',
      approval_remark TEXT DEFAULT '',
      approver_name TEXT DEFAULT '',
      approved_at TEXT DEFAULT '',
      paid_date TEXT DEFAULT '',
      rounding_amount NUMERIC(18,4) DEFAULT 0,
      rounding_reason TEXT DEFAULT '',
      expense_country TEXT DEFAULT '',
      created_at TEXT DEFAULT NOW(),
      updated_at TEXT DEFAULT NOW()
    )
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS payable_items (
      id TEXT PRIMARY KEY,
      fee_no TEXT NOT NULL UNIQUE,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      source_no TEXT DEFAULT '',
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
      created_at TEXT DEFAULT NOW(),
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
  await exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_payable_active ON payable_items(source_type, source_id, fee_type) WHERE is_active = 1`);
  await exec(`CREATE INDEX IF NOT EXISTS ix_payable_src ON payable_items(source_type, source_id)`);

  await exec(`
    CREATE TABLE IF NOT EXISTS payment_request_items (
      id TEXT PRIMARY KEY,
      payment_request_id TEXT NOT NULL,
      payable_item_id TEXT NOT NULL,
      requested_amount_minor INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT NOW(),
      CHECK (requested_amount_minor >= 0),
      FOREIGN KEY (payment_request_id) REFERENCES payment_requests(id),
      FOREIGN KEY (payable_item_id) REFERENCES payable_items(id)
    )
  `);
  await exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_pri ON payment_request_items(payment_request_id, payable_item_id)`);
  await exec(`CREATE INDEX IF NOT EXISTS ix_pri_req ON payment_request_items(payment_request_id)`);
  await exec(`CREATE INDEX IF NOT EXISTS ix_pri_item ON payment_request_items(payable_item_id)`);

  await exec(`
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
      created_at TEXT DEFAULT NOW(),
      CHECK (paid_amount_minor >= 0),
      CHECK (trans_status IN ('registered','reconciled','cancelled')),
      FOREIGN KEY (payment_request_id) REFERENCES payment_requests(id)
    )
  `);
  await exec(`CREATE INDEX IF NOT EXISTS ix_tx_req ON payment_transactions(payment_request_id)`);

  await exec(`
    CREATE TABLE IF NOT EXISTS payment_allocations (
      id TEXT PRIMARY KEY,
      transaction_id TEXT NOT NULL,
      payment_request_item_id TEXT NOT NULL,
      allocated_amount_minor INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'reconciled',
      created_at TEXT DEFAULT NOW(),
      CHECK (allocated_amount_minor >= 0),
      CHECK (status IN ('reconciled','cancelled')),
      FOREIGN KEY (transaction_id) REFERENCES payment_transactions(id),
      FOREIGN KEY (payment_request_item_id) REFERENCES payment_request_items(id)
    )
  `);
  await exec(`CREATE INDEX IF NOT EXISTS ix_alloc_tx ON payment_allocations(transaction_id)`);
  await exec(`CREATE INDEX IF NOT EXISTS ix_alloc_item ON payment_allocations(payment_request_item_id)`);

  await exec(`
    CREATE TABLE IF NOT EXISTS payment_categories (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      created_by TEXT DEFAULT '',
      created_at TEXT DEFAULT NOW(),
      updated_at TEXT DEFAULT NOW(),
      CHECK (code != ''),
      CHECK (name != ''),
      CHECK (status IN ('active','inactive'))
    )
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS payment_subcategories (
      id TEXT PRIMARY KEY,
      category_id TEXT NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      payee_type_default TEXT DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      created_by TEXT DEFAULT '',
      created_at TEXT DEFAULT NOW(),
      updated_at TEXT DEFAULT NOW(),
      CHECK (code != ''),
      CHECK (name != ''),
      CHECK (status IN ('active','inactive')),
      FOREIGN KEY (category_id) REFERENCES payment_categories(id) ON DELETE RESTRICT
    )
  `);
  await exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_subcategory_code ON payment_subcategories(category_id, code)`);
  await exec(`CREATE INDEX IF NOT EXISTS ix_payment_subcat_cat ON payment_subcategories(category_id)`);

  await exec(`
    CREATE TABLE IF NOT EXISTS payment_subcategory_sources (
      id TEXT PRIMARY KEY,
      subcategory_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      fee_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_by TEXT DEFAULT '',
      created_at TEXT DEFAULT NOW(),
      updated_at TEXT DEFAULT NOW(),
      CHECK (source_type != ''),
      CHECK (fee_type != ''),
      CHECK (status IN ('active','inactive')),
      FOREIGN KEY (subcategory_id) REFERENCES payment_subcategories(id) ON DELETE RESTRICT
    )
  `);
  await exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_subcategory_source_mapping ON payment_subcategory_sources(source_type, fee_type) WHERE status = 'active'`);
  await exec(`CREATE INDEX IF NOT EXISTS ix_pay_src_sub ON payment_subcategory_sources(subcategory_id)`);

  await exec(`
    CREATE TABLE IF NOT EXISTS payer_entities (
      id TEXT PRIMARY KEY,
      entity_key TEXT NOT NULL,
      entity_name TEXT NOT NULL,
      country_id TEXT NOT NULL,
      default_currency TEXT DEFAULT '',
      is_default INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT NOW(),
      updated_at TEXT DEFAULT NOW(),
      CHECK (entity_key != ''),
      CHECK (entity_name != ''),
      CHECK (is_default IN (0,1)),
      CHECK (status IN ('active','inactive')),
      FOREIGN KEY (country_id) REFERENCES countries(id) ON DELETE RESTRICT
    )
  `);
  await exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_payer_entity_key ON payer_entities(entity_key)`);
  await exec(`CREATE INDEX IF NOT EXISTS ix_payer_entity_country ON payer_entities(country_id)`);
  await exec(`CREATE INDEX IF NOT EXISTS ix_payer_entity_status ON payer_entities(status)`);
  await exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_payer_entity_default_per_country ON payer_entities(country_id) WHERE is_default = 1 AND status = 'active'`);

  await exec(`
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
      diff_amount NUMERIC(18,4) DEFAULT 0,
      diff_reason TEXT DEFAULT '',
      handle_method TEXT DEFAULT '',
      approval_status TEXT DEFAULT 'pending',
      remark TEXT DEFAULT '',
      created_at TEXT DEFAULT NOW()
    )
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS payment_settlement_logs (
      id TEXT PRIMARY KEY,
      payment_request_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      amount NUMERIC(18,4) NOT NULL,
      status TEXT NOT NULL DEFAULT 'applied',
      reason TEXT DEFAULT '',
      paid_date TEXT DEFAULT '',
      payment_voucher TEXT DEFAULT '',
      original_currency TEXT DEFAULT '',
      settlement_country TEXT DEFAULT '',
      local_currency TEXT DEFAULT '',
      local_rate NUMERIC(18,8) DEFAULT 0,
      local_rate_date TEXT DEFAULT '',
      local_rate_type TEXT DEFAULT '',
      local_rate_direction TEXT DEFAULT '',
      local_amount NUMERIC(18,4) DEFAULT 0,
      rmb_rate NUMERIC(18,8) DEFAULT 0,
      rmb_rate_date TEXT DEFAULT '',
      rmb_rate_type TEXT DEFAULT '',
      rmb_rate_direction TEXT DEFAULT '',
      rmb_amount NUMERIC(18,4) DEFAULT 0,
      operator_id TEXT DEFAULT '',
      operator_name TEXT DEFAULT '',
      idempotency_key TEXT DEFAULT '',
      is_legacy INTEGER NOT NULL DEFAULT 0,
      reversal_of TEXT DEFAULT '',
      created_at TEXT DEFAULT NOW(),
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
  await exec(`CREATE INDEX IF NOT EXISTS ix_payment_settlement_request ON payment_settlement_logs(payment_request_id, event_type, status)`);
  await exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_settlement_legacy_baseline ON payment_settlement_logs(payment_request_id, event_type) WHERE is_legacy = 1`);
  await exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_settlement_payment_idempotency ON payment_settlement_logs(idempotency_key) WHERE event_type = 'payment' AND idempotency_key <> ''`);
  await exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_request_active_goods_source ON payment_requests(source_type, source_id, payment_subcategory) WHERE payment_category = 'goods' AND payment_subcategory IN ('deposit','balance') AND source_id <> '' AND payment_status NOT IN ('rejected','cancelled')`);

  await exec(`
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
      created_at TEXT DEFAULT NOW()
    )
  `);

  await exec(`
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
      started_at TEXT DEFAULT NOW(),
      finished_at TEXT DEFAULT ''
    )
  `);

  await exec(`
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
      executed_at TEXT DEFAULT NOW(),
      created_at TEXT DEFAULT NOW()
    )
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS ci_cost_items (
      id TEXT PRIMARY KEY,
      ci_id TEXT NOT NULL,
      ci_no TEXT DEFAULT '',
      payment_request_id TEXT DEFAULT '',
      request_no TEXT DEFAULT '',
      cost_category TEXT DEFAULT '',
      cost_subcategory TEXT DEFAULT '',
      payable_amount NUMERIC(18,4) DEFAULT 0,
      paid_amount NUMERIC(18,4) DEFAULT 0,
      include_in_landing_cost INTEGER DEFAULT 1,
      payee_name TEXT DEFAULT '',
      currency TEXT DEFAULT 'USD',
      remark TEXT DEFAULT '',
      created_at TEXT DEFAULT NOW()
    )
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS cost_update_logs (
      id TEXT PRIMARY KEY,
      sku_code TEXT NOT NULL,
      country TEXT DEFAULT '',
      warehouse TEXT DEFAULT '',
      related_po_no TEXT DEFAULT '',
      related_pi_no TEXT DEFAULT '',
      related_ci_no TEXT DEFAULT '',
      original_qty NUMERIC(18,4) DEFAULT 0,
      old_avg_cost NUMERIC(18,4) DEFAULT 0,
      inbound_qty NUMERIC(18,4) DEFAULT 0,
      ci_unit_cost NUMERIC(18,4) DEFAULT 0,
      unit_landing_cost NUMERIC(18,4) DEFAULT 0,
      new_qty NUMERIC(18,4) DEFAULT 0,
      new_avg_cost NUMERIC(18,4) DEFAULT 0,
      operator_id TEXT DEFAULT '',
      operator_name TEXT DEFAULT '',
      import_file TEXT DEFAULT '',
      remark TEXT DEFAULT '',
      created_at TEXT DEFAULT NOW()
    )
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS original_inventory_imports (
      id TEXT PRIMARY KEY,
      ci_id TEXT DEFAULT '',
      ci_no TEXT DEFAULT '',
      po_no TEXT DEFAULT '',
      sku_code TEXT NOT NULL,
      country TEXT DEFAULT '',
      warehouse TEXT DEFAULT '',
      original_qty NUMERIC(18,4) DEFAULT 0,
      remark TEXT DEFAULT '',
      imported_at TEXT DEFAULT NOW()
    )
  `);

  await exec(`
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
      original_qty NUMERIC(18,4) DEFAULT 0,
      original_avg_cost NUMERIC(18,4) DEFAULT 0,
      original_inventory_value NUMERIC(18,4) DEFAULT 0,
      inbound_qty NUMERIC(18,4) DEFAULT 0,
      unit_landing_cost NUMERIC(18,4) DEFAULT 0,
      inbound_total_cost NUMERIC(18,4) DEFAULT 0,
      new_avg_cost NUMERIC(18,4) DEFAULT 0,
      settlement_date TEXT DEFAULT '',
      confirmation_status TEXT DEFAULT 'confirmed',
      is_locked INTEGER DEFAULT 1,
      confirmed_by TEXT DEFAULT '',
      confirmed_at TEXT DEFAULT '',
      created_at TEXT DEFAULT NOW()
    )
  `);

  // ---------- 索引 ----------
  await exec(`CREATE INDEX IF NOT EXISTS idx_inv_sku ON inventory(sku_code)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_inv_country_wh ON inventory(country, warehouse)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_outbound_sku ON outbound_records(sku_code)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_outbound_status ON outbound_records(outbound_status)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_outbound_batch ON outbound_records(import_batch_id)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_outbound_effect ON outbound_records(inventory_effect)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_outbound_platform_order ON outbound_records(platform_order_no, sku_code)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_outbound_snapshot_cutoff ON outbound_records(snapshot_cutoff_date)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_sales_sku ON sales_data(sku_code)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_po_status ON purchase_orders(po_status)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_pi_status ON proforma_invoices(pi_status)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_ci_status ON commercial_invoices(ci_status)`);
  await exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_historical_ci_idempotency ON historical_commercial_invoices(idempotency_key)`);
  // COLLATE NOCASE 唯一索引 -> lower() 表达式索引
  await exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_historical_ci_identity ON historical_commercial_invoices(LOWER(historical_ci_no), supplier_identity, LOWER(country))`);
  await exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_historical_ci_payment_request ON historical_commercial_invoices(payment_request_id) WHERE payment_request_id != ''`);
  await exec(`CREATE INDEX IF NOT EXISTS ix_historical_ci_date ON historical_commercial_invoices(ci_date)`);
  await exec(`CREATE INDEX IF NOT EXISTS ix_historical_ci_supplier ON historical_commercial_invoices(supplier_identity)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_log_status ON logistics_batches(logistics_status)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_inbound_ci ON inbound_records(source_ci_no)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_inbound_pl_item ON inbound_records(source_pl_item_id)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_payment_status ON payment_requests(payment_status)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_ci_cost_items_ci ON ci_cost_items(ci_id)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_cost_allocation_details_ci ON cost_allocation_details(ci_id)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_cost_allocation_details_run ON cost_allocation_details(allocation_run_id)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_cost_logs_sku ON cost_update_logs(sku_code)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_orig_inv_ci ON original_inventory_imports(ci_id)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_orig_inv_sku ON original_inventory_imports(sku_code)`);
  await exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_wac_history_version ON wac_history(sku_code, country, warehouse, version_no)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_wac_history_latest ON wac_history(sku_code, country, warehouse, confirmation_status, is_locked)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_wac_history_ci ON wac_history(ci_id)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_approval_business ON approval_records(business_type, business_id)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_business_participants ON business_participants(business_type, business_id, participant_type)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_oplog_page ON operation_logs(page)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_batchtask_status ON batch_tasks(status)`);

  // ---------- P1-03-C WAC 锁定触发器（错误串逐字符不变） ----------
  await exec(`
    CREATE OR REPLACE FUNCTION trg_block_wac_history_update() RETURNS trigger AS $$
    BEGIN
      IF OLD.is_locked = 1 THEN
        RAISE EXCEPTION 'LOCKED_WAC_HISTORY_UPDATE_FORBIDDEN';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
  await exec(`DROP TRIGGER IF EXISTS trg_wac_history_block_update ON wac_history`);
  await exec(`
    CREATE TRIGGER trg_wac_history_block_update
      BEFORE UPDATE ON wac_history
      FOR EACH ROW EXECUTE FUNCTION trg_block_wac_history_update();
  `);

  await exec(`
    CREATE OR REPLACE FUNCTION trg_block_wac_history_delete() RETURNS trigger AS $$
    BEGIN
      IF OLD.is_locked = 1 THEN
        RAISE EXCEPTION 'LOCKED_WAC_HISTORY_DELETE_FORBIDDEN';
      END IF;
      RETURN OLD;
    END;
    $$ LANGUAGE plpgsql;
  `);
  await exec(`DROP TRIGGER IF EXISTS trg_wac_history_block_delete ON wac_history`);
  await exec(`
    CREATE TRIGGER trg_wac_history_block_delete
      BEFORE DELETE ON wac_history
      FOR EACH ROW EXECUTE FUNCTION trg_block_wac_history_delete();
  `);

  // 校验两触发器真实存在，缺失即中止启动（与 SQLite 版行为一致）
  const triggers = await p.query(
    "SELECT tgname FROM pg_trigger WHERE tgrelid='wac_history'::regclass AND tgname IN ('trg_wac_history_block_update','trg_wac_history_block_delete')"
  );
  if (triggers.rows.length !== 2) {
    throw new Error('P1-03-C migration failed: wac_history triggers missing. Found=' + JSON.stringify(triggers.rows.map((r) => r.tgname)));
  }

  // ---------- 默认数据（幂等，ON CONFLICT DO NOTHING） ----------
  const roleCount = (await queryOne('SELECT COUNT(*) as cnt FROM roles')).cnt;
  if (roleCount === 0) {
    const allPerms = JSON.stringify([
      'dashboard_view','sku_view','sku_create','sku_edit','sku_delete','sku_import','sku_export',
      'inventory_view','inventory_import','inventory_export',
      'outbound_view','outbound_create','outbound_import',
      'replenishment_view','replenishment_edit',
      'po_view','po_create','po_edit','po_approve','po_export',
      'pi_view','pi_create','pi_edit',
      'ci_view','ci_create','ci_edit',
      'logistics_view','logistics_create','logistics_edit',
      'inbound_view','inbound_create','inbound_edit','inbound_confirm',
      'cost_view',
      'payment_view','payment_create','payment_approve','payment_import','payment_export',
      'check_view','check_create','check_approve','check_import','check_export',
      'stagnant_view','stagnant_export',
      'forwarder_view','forwarder_export',
      'user_manage','role_manage','system_config'
    ]);
    const operatorPerms = JSON.stringify([
      'dashboard_view','sku_view','sku_create','sku_edit','sku_import','sku_export',
      'inventory_view','inventory_import','inventory_export',
      'outbound_view','outbound_create','outbound_import',
      'replenishment_view','replenishment_edit',
      'po_view','po_create','po_edit','po_export',
      'pi_view','pi_create','pi_edit',
      'ci_view','ci_create','ci_edit',
      'logistics_view','logistics_create','logistics_edit',
      'inbound_view','inbound_create','inbound_edit','inbound_confirm',
      'cost_view',
      'payment_view','payment_create',
      'check_view','check_create','check_import','check_export',
      'stagnant_view','stagnant_export',
      'forwarder_view','forwarder_export'
    ]);
    const viewerPerms = JSON.stringify([
      'dashboard_view','sku_view','inventory_view',
      'outbound_view','replenishment_view',
      'po_view','pi_view','ci_view','logistics_view','inbound_view',
      'cost_view','payment_view','check_view',
      'stagnant_view','forwarder_view'
    ]);
    await run(`INSERT INTO roles (id, name, description, permissions, is_system) VALUES (?, ?, ?, ?, 1) ON CONFLICT (id) DO NOTHING`,
      ['role_admin', '超级管理员', '拥有系统全部管理权限', allPerms]);
    await run(`INSERT INTO roles (id, name, description, permissions, is_system) VALUES (?, ?, ?, ?, 1) ON CONFLICT (id) DO NOTHING`,
      ['role_operator', '运营人员', '业务操作权限，含审批与导入导出', operatorPerms]);
    await run(`INSERT INTO roles (id, name, description, permissions, is_system) VALUES (?, ?, ?, ?, 1) ON CONFLICT (id) DO NOTHING`,
      ['role_viewer', '普通用户', '只读查看权限', viewerPerms]);
    await run(`INSERT INTO users (id, username, name, password, role_id, status, auth_source, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
      ['user_admin', 'admin', '超级管理员', '', 'role_admin', 'active', 'local', '']);
    console.log('[DB-PG] 已插入默认角色和管理员账号');
  }

  const countryCount = (await queryOne('SELECT COUNT(*) as cnt FROM countries')).cnt;
  if (countryCount === 0) {
    await run(`INSERT INTO countries (id, name, code, default_currency, sort_order) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
      ['country_id', '印尼', 'ID', 'IDR', 1]);
    await run(`INSERT INTO countries (id, name, code, default_currency, sort_order) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
      ['country_my', '马来', 'MY', 'MYR', 2]);
    await run(`INSERT INTO countries (id, name, code, default_currency, sort_order) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
      ['country_th', '泰国', 'TH', 'THB', 3]);
    console.log('[DB-PG] 已插入默认国家');
  }

  const currencyCount = (await queryOne('SELECT COUNT(*) as cnt FROM currencies')).cnt;
  if (currencyCount === 0) {
    const currencies = [
      ['cur_usd', 'USD', '美元', '$', 0, 1],
      ['cur_rmb', 'RMB', '人民币', '¥', 0, 2],
      ['cur_idr', 'IDR', '印尼盾', 'Rp', 0, 3],
      ['cur_myr', 'MYR', '马来林吉特', 'RM', 0, 4],
      ['cur_thb', 'THB', '泰铢', '฿', 0, 5]
    ];
    for (const c of currencies) {
      await run(`INSERT INTO currencies (id, code, name, symbol, is_base, sort_order) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`, c);
    }
    console.log('[DB-PG] 已插入默认币种');
  }

  const whCount = (await queryOne('SELECT COUNT(*) as cnt FROM warehouses')).cnt;
  if (whCount === 0) {
    await run(`INSERT INTO warehouses (id, name, country_id, country_name, warehouse_type, sort_order) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
      ['wh_id_self', '印尼自有仓', 'country_id', '印尼', 'self', 1]);
    await run(`INSERT INTO warehouses (id, name, country_id, country_name, warehouse_type, sort_order) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
      ['wh_id_3rd', '印尼第三方仓', 'country_id', '印尼', 'third_party', 2]);
    await run(`INSERT INTO warehouses (id, name, country_id, country_name, warehouse_type, sort_order) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
      ['wh_my', '马来仓', 'country_my', '马来', 'self', 3]);
    await run(`INSERT INTO warehouses (id, name, country_id, country_name, warehouse_type, sort_order) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
      ['wh_th', '泰国仓', 'country_th', '泰国', 'self', 4]);
    console.log('[DB-PG] 已插入默认仓库');
  }

  const expCount = (await queryOne('SELECT COUNT(*) as cnt FROM expense_types')).cnt;
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
    for (const e of expenses) {
      await run(`INSERT INTO expense_types (id, name, code, is_freight, is_cost, sort_order) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`, e);
    }
    console.log('[DB-PG] 已插入默认费用类型');
  }

  const allocCount = (await queryOne('SELECT COUNT(*) as cnt FROM allocation_rules')).cnt;
  if (allocCount === 0) {
    await run(`INSERT INTO allocation_rules (id, name, transport_mode, expense_type, allocation_basis) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
      ['alloc_sea', '海运分摊', 'sea', 'freight', 'cbm']);
    await run(`INSERT INTO allocation_rules (id, name, transport_mode, expense_type, allocation_basis) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
      ['alloc_air', '空运分摊', 'air', 'freight', 'weight']);
    await run(`INSERT INTO allocation_rules (id, name, transport_mode, expense_type, allocation_basis) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
      ['alloc_express', '快递分摊', 'express', 'freight', 'weight']);
    await run(`INSERT INTO allocation_rules (id, name, transport_mode, expense_type, allocation_basis) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
      ['alloc_duty', '关税分摊', 'sea', 'duty', 'amount']);
    console.log('[DB-PG] 已插入默认分摊规则');
  }

  const cfgCount = (await queryOne('SELECT COUNT(*) as cnt FROM system_config')).cnt;
  if (cfgCount === 0) {
    const defaults = [
      ['target_stock_months', '4', '目标库存月数'],
      ['stagnant_light_days', '30', '轻度呆滞天数'],
      ['stagnant_medium_days', '60', '中度呆滞天数'],
      ['stagnant_heavy_days', '90', '重度呆滞天数'],
      ['stagnant_dead_days', '180', '死亡库存天数'],
      ['payment_remind_days', '7', '付款提前提醒天数'],
      ['large_payment_threshold', '50000', '大额付款提醒阈值(USD)']
    ];
    for (const d of defaults) {
      await run(`INSERT INTO system_config (key, value, description) VALUES (?, ?, ?) ON CONFLICT (key) DO NOTHING`, d);
    }
    console.log('[DB-PG] 已插入默认系统配置');
  }

  const brandCfgExist = (await queryOne("SELECT COUNT(*) as cnt FROM system_config WHERE key = 'brand_target_stock_months'")).cnt;
  if (brandCfgExist === 0) {
    await run(`INSERT INTO system_config (key, value, description) VALUES (?, ?, ?) ON CONFLICT (key) DO NOTHING`,
      ['brand_target_stock_months', JSON.stringify({ 'Redragon': 4, 'Netac': 2, '__default__': 3 }), '品牌目标周转月数(JSON)：Redragon=4,Netac=2,其他=3']);
    console.log('[DB-PG] 已插入默认品牌目标周转配置');
  }

  const statsDaysExist = (await queryOne("SELECT COUNT(*) as cnt FROM system_config WHERE key = 'sales_stats_days'")).cnt;
  if (statsDaysExist === 0) {
    await run(`INSERT INTO system_config (key, value, description) VALUES (?, ?, ?) ON CONFLICT (key) DO NOTHING`,
      ['sales_stats_days', '90', '销量统计周期(天)：60/90/120，仅影响月均销量与当前可用周转显示']);
    console.log('[DB-PG] 已插入销量统计周期配置');
  }

  const flowCount = (await queryOne('SELECT COUNT(*) as cnt FROM approval_flows')).cnt;
  if (flowCount === 0) {
    const flowTypes = [
      ['flow_po', 'PO审批', 'po', '[{"level":1,"name":"一级审批","approver_role":"role_operator"},{"level":2,"name":"二级审批","approver_role":"role_admin"}]'],
      ['flow_pay_deposit', '货款定金付款审批', 'payment_deposit', '[{"level":1,"name":"一级审批","approver_role":"role_operator"},{"level":2,"name":"二级审批","approver_role":"role_admin"}]'],
      ['flow_pay_balance', '货款尾款付款审批', 'payment_balance', '[{"level":1,"name":"一级审批","approver_role":"role_operator"},{"level":2,"name":"二级审批","approver_role":"role_admin"}]'],
      ['flow_pay_freight', '运费付款审批', 'payment_freight', '[{"level":1,"name":"一级审批","approver_role":"role_operator"},{"level":2,"name":"二级审批","approver_role":"role_admin"}]'],
      ['flow_pay_duty', '关税付款审批', 'payment_duty', '[{"level":1,"name":"一级审批","approver_role":"role_operator"},{"level":2,"name":"二级审批","approver_role":"role_admin"}]'],
      ['flow_inbound_abnormal', '入库异常审批', 'inbound_abnormal', '[{"level":1,"name":"一级审批","approver_role":"role_operator"}]'],
      ['flow_check_diff', '盘点差异审批', 'check_diff', '[{"level":1,"name":"一级审批","approver_role":"role_operator"},{"level":2,"name":"二级审批","approver_role":"role_admin"}]'],
      ['flow_scrap', '报废审批', 'scrap', '[{"level":1,"name":"一级审批","approver_role":"role_operator"},{"level":2,"name":"二级审批","role_admin"}]'],
      ['flow_mdf_outbound', 'MDF出库审批', 'mdf_outbound', '[{"level":1,"name":"一级审批","approver_role":"role_operator"}]'],
      ['flow_transfer', '调拨审批', 'transfer', '[{"level":1,"name":"一级审批","approver_role":"role_operator"}]']
    ];
    for (const f of flowTypes) {
      await run(`INSERT INTO approval_flows (id, name, business_type, levels) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`, f);
    }
    console.log('[DB-PG] 已插入默认审批流');
  }

  // 默认品牌采购状态：BOYA 停采（仅首次插入，不覆盖用户后续手动修改）
  await run(`INSERT INTO brand_settings (brand, procurement_status, note) VALUES ('BOYA', 'stopped', '已停止合作，仍售库存，不参与补货') ON CONFLICT (brand) DO NOTHING`);

  // L1B 付款类目种子
  const seedCats = [
    { code: 'goods', name: '货款', sort_order: 1 },
    { code: 'warehouse_arrival', name: '到仓费用', sort_order: 2 },
    { code: 'customs_duty', name: '关税', sort_order: 3 },
    { code: 'inspection_fee', name: '商检费用', sort_order: 4 }
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
    { cat: 'inspection_fee', code: 'inspection', name: '商检费', payee_type_default: 'inspection_org', sort_order: 1 }
  ];
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
    { cat: 'inspection_fee', sub: 'inspection', source_type: 'ci', fee_type: 'inspection' }
  ];
  for (const c of seedCats) {
    await run(`INSERT INTO payment_categories (id, code, name, sort_order, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', 'seed', NOW(), NOW()) ON CONFLICT (code) DO NOTHING`,
      ['cat_' + c.code, c.code, c.name, c.sort_order]);
  }
  for (const s of seedSubs) {
    const catId = 'cat_' + s.cat;
    await run(`INSERT INTO payment_subcategories (id, category_id, code, name, payee_type_default, sort_order, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'active', 'seed', NOW(), NOW()) ON CONFLICT (category_id, code) DO NOTHING`,
      ['sub_' + s.cat + '_' + s.code, catId, s.code, s.name, s.payee_type_default, s.sort_order]);
  }
  for (const s of seedSources) {
    const subId = 'sub_' + s.cat + '_' + s.sub;
    await run(`INSERT INTO payment_subcategory_sources (id, subcategory_id, source_type, fee_type, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', 'seed', NOW(), NOW()) ON CONFLICT (source_type, fee_type) WHERE status = 'active' DO NOTHING`,
      ['src_' + s.cat + '_' + s.sub + '_' + s.source_type, subId, s.source_type, s.fee_type]);
  }

  console.log('[DB-PG] 数据库表初始化完成');
  return true;
}

module.exports = { query, queryOne, run, transaction, initDatabase, getDB };
