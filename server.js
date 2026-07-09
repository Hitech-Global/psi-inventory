/**
 * 进销存管理系统 - 后端服务
 * 
 * 功能模块：
 * 1. 认证与权限管理
 * 2. 系统管理（国家/仓库/供应商/货代/币种/汇率/付款条件/审批流/费用类型/分摊规则/系统配置）
 * 3. SKU 主数据
 * 4. 库存管理（导入/总表）
 * 5. 出库数据
 * 6. 订单预测/补货建议
 * 7. PO 管理
 * 8. PI 管理
 * 9. CI/PL 管理
 * 10. 物流/货代管理
 * 11. 入库管理
 * 12. 成本管理（分摊/加权平均成本）
 * 13. 付款管理
 * 14. 库存盘点
 * 15. 呆滞库存分析
 * 16. 货代分析
 * 17. 首页看板
 */

require('dotenv').config();
const express = require('express');
const path = require('path');
const { query, queryOne, run, transaction, genId, initDatabase } = require('./db');

// ==================== 配置 ====================
const PORT = process.env.PORT || 3001;
const APP_VERSION = '1.0.0';

console.log('========================================');
console.log('  进销存管理系统 - 后端服务');
console.log('========================================');
console.log(`  版本: ${APP_VERSION}`);
console.log(`  端口: ${PORT}`);
console.log('========================================\n');

// 初始化数据库
initDatabase();

// ==================== Express 初始化 ====================
const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 前端静态文件
function sendNoCacheHtml(res, fileName) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.sendFile(path.join(__dirname, fileName));
}

app.get('/', (req, res) => sendNoCacheHtml(res, 'index.html'));
app.get('/index.html', (req, res) => sendNoCacheHtml(res, 'index.html'));
app.use(express.static(path.join(__dirname), {
  index: false,
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
    }
  }
}));

app.get('/api/version', (req, res) => {
  res.json({ version: APP_VERSION, app: 'inventory-management-system', timestamp: new Date().toISOString() });
});

// ==================== 认证与权限中间件 ====================
function apiAuth(req, res, next) {
  const userId = req.headers['x-user-id'];
  const userName = req.headers['x-user-name'] ? decodeURIComponent(req.headers['x-user-name']) : '';
  const userRole = req.headers['x-user-role'];
  const userPerms = req.headers['x-user-permissions'] || '';
  if (userId) {
    req.currentUserId = userId;
    req.currentUserName = userName;
    req.currentUserRole = userRole || '';
    req.currentUserPermissions = userPerms ? userPerms.split(',').map(s => s.trim()).filter(Boolean) : [];
  }
  next();
}

function requireApiPermission(...perms) {
  return (req, res, next) => {
    if (!req.currentUserId) return res.status(401).json({ error: '未登录' });
    const hasPerm = perms.some(p => (req.currentUserPermissions || []).includes(p));
    if (!hasPerm) return res.status(403).json({ error: '没有该操作的权限' });
    next();
  };
}

function requireLogin(req, res, next) {
  if (!req.currentUserId) return res.status(401).json({ error: '未登录' });
  next();
}

// 所有 /api 路由需要认证
app.use('/api', apiAuth);

// ==================== 登录 ====================
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const user = queryOne('SELECT * FROM users WHERE username = ? AND password = ? AND status = ?', [username, password, 'active']);
  if (!user) return res.status(401).json({ error: '用户名或密码错误' });
  const role = queryOne('SELECT * FROM roles WHERE id = ?', [user.role_id]);
  const permissions = role ? JSON.parse(role.permissions || '[]') : [];
  res.json({
    id: user.id, username: user.username, name: user.name,
    role_id: user.role_id, role_name: role ? role.name : '',
    permissions
  });
});

// ==================== 用户管理 ====================
app.get('/api/users', requireLogin, (req, res) => {
  try {
    const result = query('SELECT * FROM users ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/users', requireApiPermission('user_manage'), (req, res) => {
  try {
    const { id, username, name, password, role_id, status, email } = req.body;
    if (!username || !name) return res.status(400).json({ error: '用户名和姓名不能为空' });
    const exist = queryOne('SELECT id FROM users WHERE username = ?', [username]);
    if (exist) return res.status(400).json({ error: '用户名已存在' });
    const userId = id || genId('user');
    run(`INSERT INTO users (id, username, name, password, role_id, status, email) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [userId, username, name, password || '', role_id || 'role_viewer', status || 'active', email || '']);
    res.json({ id: userId, ...req.body });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/users/:id', requireApiPermission('user_manage'), (req, res) => {
  try {
    const { id } = req.params;
    const { username, name, password, role_id, status, email } = req.body;
    if (!username || !name) return res.status(400).json({ error: '用户名和姓名不能为空' });
    const exist = queryOne('SELECT id FROM users WHERE username = ? AND id != ?', [username, id]);
    if (exist) return res.status(400).json({ error: '用户名已存在' });
    const user = queryOne('SELECT password FROM users WHERE id = ?', [id]);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    run(`UPDATE users SET username=?, name=?, password=?, role_id=?, status=?, email=? WHERE id=?`,
      [username, name, password || user.password, role_id || 'role_viewer', status || 'active', email || '', id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/users/:id', requireApiPermission('user_manage'), (req, res) => {
  try {
    if (req.params.id === 'user_admin') return res.status(400).json({ error: '不能删除超级管理员' });
    run('DELETE FROM users WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== 角色管理 ====================
app.get('/api/roles', requireLogin, (req, res) => {
  try {
    const result = query('SELECT * FROM roles ORDER BY created_at');
    res.json(result.rows.map(r => ({ ...r, permissions: JSON.parse(r.permissions || '[]') })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/roles', requireApiPermission('role_manage'), (req, res) => {
  try {
    const { id, name, description, permissions } = req.body;
    const roleId = id || genId('role');
    run(`INSERT INTO roles (id, name, description, permissions) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, permissions=excluded.permissions`,
      [roleId, name, description || '', JSON.stringify(permissions || [])]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/roles/:id', requireApiPermission('role_manage'), (req, res) => {
  try {
    if (req.params.id === 'role_admin') return res.status(400).json({ error: '不能删除超级管理员角色' });
    run('DELETE FROM roles WHERE id = ? AND is_system = 0', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== 国家管理 ====================
app.get('/api/countries', requireLogin, (req, res) => {
  res.json(query('SELECT * FROM countries ORDER BY sort_order').rows);
});
app.post('/api/countries', requireApiPermission('system_config'), (req, res) => {
  const { id, name, code, default_currency, status, sort_order } = req.body;
  const cId = id || genId('country');
  run(`INSERT INTO countries (id, name, code, default_currency, status, sort_order) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, code=excluded.code, default_currency=excluded.default_currency, status=excluded.status, sort_order=excluded.sort_order`,
    [cId, name, code, default_currency || '', status || 'active', sort_order || 0]);
  res.json({ success: true });
});
app.delete('/api/countries/:id', requireApiPermission('system_config'), (req, res) => {
  run('DELETE FROM countries WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// ==================== 仓库管理 ====================
app.get('/api/warehouses', requireLogin, (req, res) => {
  const { country_id } = req.query;
  let sql = 'SELECT * FROM warehouses';
  const params = [];
  if (country_id) { sql += ' WHERE country_id = ?'; params.push(country_id); }
  sql += ' ORDER BY sort_order';
  res.json(query(sql, params).rows);
});
app.post('/api/warehouses', requireApiPermission('system_config'), (req, res) => {
  const { id, name, country_id, country_name, warehouse_type, address, status, brands, sort_order } = req.body;
  const wId = id || genId('wh');
  run(`INSERT INTO warehouses (id, name, country_id, country_name, warehouse_type, address, status, brands, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, country_id=excluded.country_id, country_name=excluded.country_name, warehouse_type=excluded.warehouse_type, address=excluded.address, status=excluded.status, brands=excluded.brands, sort_order=excluded.sort_order`,
    [wId, name, country_id || '', country_name || '', warehouse_type || 'self', address || '', status || 'active', brands || '', sort_order || 0]);
  res.json({ success: true, id: wId });
});
// 获取仓库所属国家列表（用于下拉联动，数据来源为 warehouses 表）
app.get('/api/warehouses/countries', requireLogin, (req, res) => {
  const rows = query("SELECT DISTINCT country_name FROM warehouses WHERE status = 'active' AND country_name IS NOT NULL AND country_name != '' ORDER BY country_name").rows.map(r => r.country_name);
  res.json(rows);
});
// 按国家筛选仓库（用于订单预测等页面的下拉联动）
app.get('/api/warehouses/by-country', requireLogin, (req, res) => {
  const { country } = req.query;
  let sql = "SELECT id, name, country_name, brands, warehouse_type FROM warehouses WHERE status = 'active'";
  const params = [];
  if (country) { sql += ' AND country_name = ?'; params.push(country); }
  sql += ' ORDER BY sort_order, name';
  res.json(query(sql, params).rows);
});
// 按 (国家, 品牌) 筛选仓库
app.get('/api/warehouses/by-country-brand', requireLogin, (req, res) => {
  const { country, brand } = req.query;
  let sql = `SELECT id, name, country_name, brands, warehouse_type FROM warehouses WHERE status = 'active'`;
  const params = [];
  if (country) { sql += ' AND country_name = ?'; params.push(country); }
  if (brand) {
    sql += ` AND (brands = '' OR brands LIKE ? OR brands LIKE ? OR brands LIKE ? OR brands LIKE ?)`;
    params.push('%'+brand+'%', brand+',%', '%,'+brand, '%,'+brand+',%');
  }
  sql += ' ORDER BY sort_order, name';
  res.json(query(sql, params).rows);
});
// 获取系统中所有出现过的品牌（从 skus + po + pi + ci 聚合）
app.get('/api/brands/all', requireLogin, (req, res) => {
  const rows = query(`
    SELECT DISTINCT brand FROM (
      SELECT brand FROM skus WHERE brand IS NOT NULL AND brand != ''
      UNION SELECT brand FROM purchase_orders WHERE brand IS NOT NULL AND brand != ''
      UNION SELECT brand FROM proforma_invoices WHERE brand IS NOT NULL AND brand != ''
      UNION SELECT brand FROM commercial_invoices WHERE brand IS NOT NULL AND brand != ''
    ) ORDER BY brand
  `).rows.map(r => r.brand);
  res.json(rows);
});
app.delete('/api/warehouses/:id', requireApiPermission('system_config'), (req, res) => {
  run('DELETE FROM warehouses WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// ==================== 供应商管理 ====================
app.get('/api/suppliers', requireLogin, (req, res) => {
  res.json(query('SELECT * FROM suppliers ORDER BY created_at DESC').rows);
});
app.post('/api/suppliers', requireApiPermission('system_config'), (req, res) => {
  const d = req.body;
  const sId = d.id || genId('supplier');
  const associatedBrands = Array.isArray(d.associated_brands) ? JSON.stringify(d.associated_brands) : (d.associated_brands || '[]');
  run(`INSERT INTO suppliers (id, name, short_name, contact_person, phone, email, address, associated_brands, default_currency, payment_terms, remark, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, short_name=excluded.short_name, contact_person=excluded.contact_person, phone=excluded.phone, email=excluded.email, address=excluded.address, associated_brands=excluded.associated_brands, default_currency=excluded.default_currency, payment_terms=excluded.payment_terms, remark=excluded.remark, status=excluded.status`,
    [sId, d.name, d.short_name || '', d.contact_person || '', d.phone || '', d.email || '', d.address || '', associatedBrands, d.default_currency || 'USD', d.payment_terms || '', d.remark || '', d.status || 'active']);
  res.json({ success: true });
});
app.delete('/api/suppliers/:id', requireApiPermission('system_config'), (req, res) => {
  run('DELETE FROM suppliers WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// ==================== 货代管理 ====================
app.get('/api/freight-forwarders', requireLogin, (req, res) => {
  res.json(query('SELECT * FROM freight_forwarders ORDER BY created_at DESC').rows);
});
app.post('/api/freight-forwarders', requireApiPermission('system_config'), (req, res) => {
  const d = req.body;
  const fId = d.id || genId('ff');
  run(`INSERT INTO freight_forwarders (id, name, short_name, contact_person, phone, email, service_types, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, short_name=excluded.short_name, contact_person=excluded.contact_person, phone=excluded.phone, email=excluded.email, service_types=excluded.service_types, status=excluded.status`,
    [fId, d.name, d.short_name || '', d.contact_person || '', d.phone || '', d.email || '', d.service_types || '', d.status || 'active']);
  res.json({ success: true });
});
app.delete('/api/freight-forwarders/:id', requireApiPermission('system_config'), (req, res) => {
  run('DELETE FROM freight_forwarders WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// ==================== 币种管理 ====================
app.get('/api/currencies', requireLogin, (req, res) => {
  res.json(query('SELECT * FROM currencies ORDER BY sort_order').rows);
});
app.post('/api/currencies', requireApiPermission('system_config'), (req, res) => {
  const d = req.body;
  const cId = d.id || genId('cur');
  run(`INSERT INTO currencies (id, code, name, symbol, is_base, sort_order, status) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET code=excluded.code, name=excluded.name, symbol=excluded.symbol, is_base=excluded.is_base, sort_order=excluded.sort_order, status=excluded.status`,
    [cId, d.code, d.name, d.symbol || '', d.is_base || 0, d.sort_order || 0, d.status || 'active']);
  res.json({ success: true });
});
app.delete('/api/currencies/:id', requireApiPermission('system_config'), (req, res) => {
  run('DELETE FROM currencies WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// ==================== 汇率管理 ====================
app.get('/api/exchange-rates', requireLogin, (req, res) => {
  const { from, to } = req.query;
  let sql = 'SELECT * FROM exchange_rates';
  const params = [];
  if (from && to) { sql += ' WHERE from_currency = ? AND to_currency = ?'; params.push(from, to); }
  sql += ' ORDER BY rate_date DESC LIMIT 100';
  res.json(query(sql, params).rows);
});
app.post('/api/exchange-rates', requireApiPermission('system_config'), (req, res) => {
  const d = req.body;
  const rId = d.id || genId('rate');
  run(`INSERT INTO exchange_rates (id, from_currency, to_currency, rate, rate_date, rate_type) VALUES (?, ?, ?, ?, ?, ?)`,
    [rId, d.from_currency, d.to_currency, d.rate, d.rate_date, d.rate_type || 'realtime']);
  res.json({ success: true });
});

// 获取最新汇率
app.get('/api/exchange-rates/latest', requireLogin, (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.json({ rate: 1 });
  if (from === to) return res.json({ rate: 1 });
  const rate = queryOne('SELECT * FROM exchange_rates WHERE from_currency = ? AND to_currency = ? ORDER BY rate_date DESC LIMIT 1', [from, to]);
  if (rate) return res.json(rate);
  // 反向查找
  const reverse = queryOne('SELECT * FROM exchange_rates WHERE from_currency = ? AND to_currency = ? ORDER BY rate_date DESC LIMIT 1', [to, from]);
  if (reverse) return res.json({ ...reverse, rate: 1 / reverse.rate, from_currency: from, to_currency: to });
  return res.json({ rate: 1 });
});

// 获取库存相关国家的货币信息 + 对人民币汇率（自动从免费API获取实时汇率并缓存）
const CURRENCY_API_MAP = { 'RMB': 'CNY' }; // 系统内部用RMB，API用CNY
// 国家名别名映射（库存数据中的名称 → countries表中的标准名）
const COUNTRY_ALIAS_MAP = {
  '印度尼西亚': '印尼', '印度尼西亚共和国': '印尼',
  '马来西亚': '马来', '马来西亚联邦': '马来',
  '泰王国': '泰国',
};
app.get('/api/inventory/currency-rates', requireLogin, async (req, res) => {
  try {
    // 0. 获取countries表的标准国家名→货币映射
    const allCountries = query('SELECT name, default_currency FROM countries WHERE status = ? AND default_currency IS NOT NULL AND default_currency != ?', ['active', '']).rows;
    const countryToCurrency = {}; // 标准名 → {code, ...}
    allCountries.forEach(c => { countryToCurrency[c.name] = c.default_currency; });

    // 获取货币符号映射
    const allCurrencies = query('SELECT code, symbol, name FROM currencies WHERE status = ?', ['active']).rows;
    const currencyInfo = {}; // code → {symbol, name}
    allCurrencies.forEach(c => { currencyInfo[c.code] = { symbol: c.symbol, name: c.name }; });

    // 1. 查库存中涉及的国家
    const invCountries = query(`SELECT DISTINCT country FROM inventory WHERE country IS NOT NULL AND country != '' ORDER BY country`).rows.map(r => r.country);

    // 2. 为每个库存国家匹配货币（支持别名）
    const countries = [];
    invCountries.forEach(country => {
      // 先直接匹配标准名
      let currencyCode = countryToCurrency[country];
      // 再尝试别名匹配
      if (!currencyCode) {
        const alias = COUNTRY_ALIAS_MAP[country];
        if (alias) currencyCode = countryToCurrency[alias];
      }
      const ci = currencyCode ? currencyInfo[currencyCode] : null;
      countries.push({
        country,
        default_currency: currencyCode || null,
        symbol: ci ? ci.symbol : null,
        currency_name: ci ? ci.name : null
      });
    });

    // 2. 收集去重货币
    const currencySet = new Set();
    countries.forEach(c => { if (c.default_currency) currencySet.add(c.default_currency); });
    const currencies = Array.from(currencySet);

    // 3. 逐个查汇率（先查DB，无则从API获取）
    const today = new Date().toISOString().split('T')[0];
    const rates = {};

    for (const curr of currencies) {
      if (curr === 'RMB' || curr === 'CNY') { rates[curr] = { rate: 1, date: today, source: 'base' }; continue; }
      // 查DB中今天的汇率
      let row = queryOne('SELECT rate, rate_date FROM exchange_rates WHERE from_currency = ? AND to_currency = ? AND rate_date = ? ORDER BY created_at DESC LIMIT 1', [curr, 'RMB', today]);
      if (!row) {
        // 查DB中最新汇率（不限日期）
        row = queryOne('SELECT rate, rate_date FROM exchange_rates WHERE from_currency = ? AND to_currency = ? ORDER BY rate_date DESC, created_at DESC LIMIT 1', [curr, 'RMB']);
      }
      if (row) {
        // DB中存的是 1外币=X人民币（foreignToRmb），转换为 1人民币=X外币（cnyToForeign）
        const cnyToForeign = row.rate > 0 ? Math.round((1 / row.rate) * 1000000) / 1000000 : 0;
        rates[curr] = { rate: cnyToForeign, date: row.rate_date, source: row.rate_date === today ? 'db_today' : 'db_cached' };
      } else {
        rates[curr] = null; // 标记为需要从API获取
      }
    }

    // 4. 对缺失的汇率，批量从免费API获取
    const missingCurrencies = currencies.filter(c => c !== 'RMB' && c !== 'CNY' && !rates[c]);
    if (missingCurrencies.length > 0) {
      try {
        const apiCode = 'CNY';
        const resp = await fetch(`https://open.er-api.com/v6/latest/${apiCode}`);
        const data = await resp.json();
        if (data && data.rates) {
          for (const curr of missingCurrencies) {
            const apiCurr = CURRENCY_API_MAP[curr] || curr;
            const cnyToForeign = data.rates[apiCurr]; // 1 CNY = X 外币（API直接返回）
            if (cnyToForeign && cnyToForeign > 0) {
              const foreignToRmb = 1 / cnyToForeign; // 换算为 1外币=X人民币 用于缓存
              rates[curr] = { rate: cnyToForeign, date: today, source: 'realtime' };
              // 缓存到DB（存foreignToRmb方便复用）
              run('INSERT INTO exchange_rates (id, from_currency, to_currency, rate, rate_date, rate_type) VALUES (?, ?, ?, ?, ?, ?)',
                [genId('rate'), curr, 'RMB', foreignToRmb, today, 'realtime']);
            }
          }
        }
      } catch (fetchErr) {
        console.warn('[currency-rates] Failed to fetch real-time rates:', fetchErr.message);
      }
    }

    res.json({ countries, currencies, rates, base_currency: 'RMB', rate_date: today });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 强制刷新汇率（删除今天的缓存，重新从API获取）
app.post('/api/exchange-rates/refresh', requireApiPermission('inventory_view'), async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    // 删除今天的汇率缓存
    run('DELETE FROM exchange_rates WHERE rate_date = ? AND rate_type = ?', [today, 'realtime']);
    // 获取库存中涉及的国家货币
    const countries = query(`
      SELECT DISTINCT c.default_currency FROM inventory i
      JOIN countries c ON i.country = c.name
      WHERE c.default_currency IS NOT NULL AND c.default_currency != '' AND c.default_currency NOT IN ('RMB','CNY')
    `).rows;
    const currencies = [...new Set(countries.map(c => c.default_currency))];
    const refreshed = {};
    if (currencies.length > 0) {
      try {
        const resp = await fetch('https://open.er-api.com/v6/latest/CNY');
        const data = await resp.json();
        if (data && data.rates) {
          for (const curr of currencies) {
            const apiCurr = CURRENCY_API_MAP[curr] || curr;
            const cnyToForeign = data.rates[apiCurr];
            if (cnyToForeign && cnyToForeign > 0) {
              const foreignToRmb = 1 / cnyToForeign;
              refreshed[curr] = Math.round(foreignToRmb * 1000000) / 1000000;
              run('INSERT INTO exchange_rates (id, from_currency, to_currency, rate, rate_date, rate_type) VALUES (?, ?, ?, ?, ?, ?)',
                [genId('rate'), curr, 'RMB', foreignToRmb, today, 'realtime']);
            }
          }
        }
      } catch (fetchErr) {
        return res.status(503).json({ error: '获取实时汇率失败: ' + fetchErr.message });
      }
    }
    res.json({ success: true, refreshed, date: today });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== 付款条件管理 ====================
app.get('/api/payment-terms', requireLogin, (req, res) => {
  res.json(query('SELECT * FROM payment_terms ORDER BY created_at').rows);
});
app.post('/api/payment-terms', requireApiPermission('system_config'), (req, res) => {
  const d = req.body;
  const pId = d.id || genId('pt');
  run(`INSERT INTO payment_terms (id, name, payee_type, payment_type, payment_stage, payment_node, ratio, remind_days_before, is_enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, payee_type=excluded.payee_type, payment_type=excluded.payment_type, payment_stage=excluded.payment_stage, payment_node=excluded.payment_node, ratio=excluded.ratio, remind_days_before=excluded.remind_days_before, is_enabled=excluded.is_enabled`,
    [pId, d.name, d.payee_type || 'factory', d.payment_type || 'goods', d.payment_stage || 'deposit', d.payment_node || 'after_pi', d.ratio || 0, d.remind_days_before || 7, d.is_enabled !== undefined ? d.is_enabled : 1]);
  res.json({ success: true });
});
app.delete('/api/payment-terms/:id', requireApiPermission('system_config'), (req, res) => {
  run('DELETE FROM payment_terms WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// ==================== 审批流管理 ====================
app.get('/api/approval-flows', requireLogin, (req, res) => {
  res.json(query('SELECT * FROM approval_flows ORDER BY created_at').rows.map(f => ({ ...f, levels: JSON.parse(f.levels || '[]') })));
});
app.post('/api/approval-flows', requireApiPermission('system_config'), (req, res) => {
  const d = req.body;
  const fId = d.id || genId('flow');
  run(`INSERT INTO approval_flows (id, name, business_type, levels, is_enabled) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, business_type=excluded.business_type, levels=excluded.levels, is_enabled=excluded.is_enabled`,
    [fId, d.name, d.business_type, JSON.stringify(d.levels || []), d.is_enabled !== undefined ? d.is_enabled : 1]);
  res.json({ success: true });
});

// ==================== 费用类型管理 ====================
app.get('/api/expense-types', requireLogin, (req, res) => {
  res.json(query('SELECT * FROM expense_types ORDER BY sort_order').rows);
});
app.post('/api/expense-types', requireApiPermission('system_config'), (req, res) => {
  const d = req.body;
  const eId = d.id || genId('exp');
  run(`INSERT INTO expense_types (id, name, code, is_freight, is_cost, sort_order, status) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, code=excluded.code, is_freight=excluded.is_freight, is_cost=excluded.is_cost, sort_order=excluded.sort_order, status=excluded.status`,
    [eId, d.name, d.code || '', d.is_freight || 0, d.is_cost || 1, d.sort_order || 0, d.status || 'active']);
  res.json({ success: true });
});
app.delete('/api/expense-types/:id', requireApiPermission('system_config'), (req, res) => {
  run('DELETE FROM expense_types WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// ==================== 分摊规则管理 ====================
app.get('/api/allocation-rules', requireLogin, (req, res) => {
  res.json(query('SELECT * FROM allocation_rules ORDER BY created_at').rows);
});
app.post('/api/allocation-rules', requireApiPermission('system_config'), (req, res) => {
  const d = req.body;
  const aId = d.id || genId('alloc');
  run(`INSERT INTO allocation_rules (id, name, transport_mode, expense_type, allocation_basis, is_enabled) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, transport_mode=excluded.transport_mode, expense_type=excluded.expense_type, allocation_basis=excluded.allocation_basis, is_enabled=excluded.is_enabled`,
    [aId, d.name, d.transport_mode || 'sea', d.expense_type || 'freight', d.allocation_basis || 'cbm', d.is_enabled !== undefined ? d.is_enabled : 1]);
  res.json({ success: true });
});

// ==================== 系统配置 ====================
app.get('/api/system-config', requireLogin, (req, res) => {
  res.json(query('SELECT * FROM system_config').rows);
});
app.post('/api/system-config', requireApiPermission('system_config'), (req, res) => {
  const { configs } = req.body;
  if (Array.isArray(configs)) {
    transaction(() => {
      configs.forEach(c => {
        run(`INSERT INTO system_config (key, value, description, updated_at) VALUES (?, ?, ?, datetime('now'))
             ON CONFLICT(key) DO UPDATE SET value=excluded.value, description=excluded.description, updated_at=datetime('now')`,
          [c.key, c.value, c.description || '']);
      });
    });
  }
  res.json({ success: true });
});

// ==================== SKU 主数据 ====================
app.get('/api/skus', requireApiPermission('sku_view'), (req, res) => {
  const { keyword, status, brand, lifecycle_status, category } = req.query;
  let sql = 'SELECT * FROM skus WHERE 1=1';
  const params = [];
  if (keyword) { sql += ' AND (sku_code LIKE ? OR product_name LIKE ? OR model LIKE ? OR barcode LIKE ?)'; params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (brand) { sql += ' AND brand = ?'; params.push(brand); }
  if (lifecycle_status) { sql += ' AND lifecycle_status = ?'; params.push(lifecycle_status); }
  if (category) { sql += ' AND category = ?'; params.push(category); }
  sql += ' ORDER BY created_at DESC';
  res.json(query(sql, params).rows);
});

app.get('/api/skus/:id', requireApiPermission('sku_view'), (req, res) => {
  const sku = queryOne('SELECT * FROM skus WHERE id = ?', [req.params.id]);
  if (!sku) return res.status(404).json({ error: 'SKU不存在' });
  res.json(sku);
});

app.post('/api/skus', requireApiPermission('sku_create'), (req, res) => {
  try {
    const d = req.body;
    if (!d.sku_code) return res.status(400).json({ error: 'SKU编码不能为空' });
    const exist = queryOne('SELECT id FROM skus WHERE sku_code = ?', [d.sku_code]);
    if (exist) return res.status(400).json({ error: 'SKU编码已存在' });
    const sId = d.id || genId('sku');
    run(`INSERT INTO skus (id, sku_code, product_name, brand, category, model, color_spec, barcode, default_supplier_id, default_supplier_name, purchase_currency, standard_purchase_price, carton_spec, qty_per_carton, unit_weight, unit_cbm, is_new_product, launch_date, new_product_protection_days, lifecycle_status, auto_replenish, status, remark) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [sId, d.sku_code, d.product_name || '', d.brand || '', d.category || '', d.model || '', d.color_spec || '', d.barcode || '', d.default_supplier_id || '', d.default_supplier_name || '', d.purchase_currency || 'USD', d.standard_purchase_price || 0, d.carton_spec || '', d.qty_per_carton || 0, d.unit_weight || 0, d.unit_cbm || 0, d.is_new_product || 0, d.launch_date || '', d.new_product_protection_days || 90, d.lifecycle_status || 'new_test', d.auto_replenish !== undefined ? d.auto_replenish : 1, d.status || 'normal', d.remark || '']);
    res.json({ id: sId, ...d });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/skus/:id', requireApiPermission('sku_edit'), (req, res) => {
  try {
    const d = req.body;
    const { id } = req.params;
    const fields = [];
    const values = [];
    const allowed = ['product_name', 'brand', 'category', 'model', 'color_spec', 'barcode', 'default_supplier_id', 'default_supplier_name', 'purchase_currency', 'standard_purchase_price', 'weighted_avg_cost', 'carton_spec', 'qty_per_carton', 'unit_weight', 'unit_cbm', 'is_new_product', 'launch_date', 'new_product_protection_days', 'lifecycle_status', 'auto_replenish', 'status', 'remark'];
    allowed.forEach(f => {
      if (d[f] !== undefined) { fields.push(`${f} = ?`); values.push(d[f]); }
    });
    fields.push(`updated_at = datetime('now')`);
    values.push(id);
    run(`UPDATE skus SET ${fields.join(', ')} WHERE id = ?`, values);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/skus/:id', requireApiPermission('sku_delete'), (req, res) => {
  try {
    const sku = queryOne('SELECT sku_code FROM skus WHERE id = ?', [req.params.id]);
    if (!sku) return res.status(404).json({ error: 'SKU不存在' });
    const code = sku.sku_code;
    // 检查业务数据关联
    const checks = [
      { table: 'inventory', label: '库存' },
      { table: 'outbound_records', label: '出库记录' },
      { table: 'sales_records', label: '销售明细' },
      { table: 'inventory_imports', label: '库存导入' },
      { table: 'replenishment_suggestions', label: '补货预测' },
      { table: 'purchase_order_items', label: 'PO' },
      { table: 'proforma_invoice_items', label: 'PI' },
      { table: 'commercial_invoice_items', label: 'CI' },
      { table: 'packing_list_items', label: 'PL' },
      { table: 'inbound_records', label: '入库记录' },
    ];
    for (const c of checks) {
      try {
        const r = queryOne(`SELECT COUNT(*) as cnt FROM ${c.table} WHERE sku_code = ?`, [code]);
        if (r && r.cnt > 0) {
          return res.status(400).json({ error: `SKU已关联${c.label}数据（${r.cnt}条），不允许删除，请改为停用` });
        }
      } catch (e) { /* 表可能不存在，跳过 */ }
    }
    run('DELETE FROM skus WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// SKU 批量导入
app.post('/api/skus/bulk-import', requireApiPermission('sku_import'), (req, res) => {
  try {
    const items = req.body.items || [];
    const result = { created: 0, updated: 0, failed: 0, errors: [] };

    // 生命周期中文标签 → 代码
    const LIFECYCLE_MAP = {
      '新品导入':'new_test','新品启动':'new_launch','成长期':'growth','成熟期':'stable',
      '衰退期':'slow','滞销':'stagnant','清仓期':'clearance','停采':'stopped','停产':'stopped',
      '停采/停产':'stopped','new_test':'new_test','new_launch':'new_launch','growth':'growth',
      'stable':'stable','slow':'slow','stagnant':'stagnant','clearance':'clearance','stopped':'stopped'
    };
    // 状态中文标签 → 代码
    const STATUS_MAP = {
      '启用':'normal','正常':'normal','清仓':'clearance','停用':'stopped','停采':'stopped','停产':'discontinued',
      'normal':'normal','clearance':'clearance','stopped':'stopped','discontinued':'discontinued'
    };

    transaction(() => {
      items.forEach((item, i) => {
        try {
          const sku = String(item.sku_code || '').trim();
          if (!sku) { result.failed++; result.errors.push({ row: i + 2, reason: 'SKU编码为空' }); return; }
          if (!item.brand || !String(item.brand).trim()) { result.failed++; result.errors.push({ row: i + 2, reason: '品牌为空' }); return; }

          // 映射生命周期和状态
          const lifecycle = LIFECYCLE_MAP[String(item.lifecycle_status||'').trim()] || (item.lifecycle_status || 'new_test');
          const status = STATUS_MAP[String(item.status||'').trim()] || (item.status || 'normal');

          const exist = queryOne('SELECT id FROM skus WHERE sku_code = ?', [sku]);
          if (exist) {
            run(`UPDATE skus SET product_name=?, brand=?, category=?, model=?, color_spec=?, barcode=?, purchase_currency=?, standard_purchase_price=?, carton_spec=?, qty_per_carton=?, unit_weight=?, unit_cbm=?, lifecycle_status=?, launch_date=?, remark=?, status=?, updated_at=datetime('now') WHERE id=?`,
              [item.product_name || '', item.brand || '', item.category || '', item.model || '', item.color_spec || '', item.barcode || '', item.purchase_currency || 'USD', parseFloat(item.standard_purchase_price) || 0, item.carton_spec || '', parseInt(item.qty_per_carton) || 0, parseFloat(item.unit_weight) || 0, parseFloat(item.unit_cbm) || 0, lifecycle, item.launch_date || '', item.remark || '', status, exist.id]);
            result.updated++;
          } else {
            run(`INSERT INTO skus (id, sku_code, product_name, brand, category, model, color_spec, barcode, purchase_currency, standard_purchase_price, carton_spec, qty_per_carton, unit_weight, unit_cbm, lifecycle_status, launch_date, remark, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [genId('sku'), sku, item.product_name || '', item.brand || '', item.category || '', item.model || '', item.color_spec || '', item.barcode || '', item.purchase_currency || 'USD', parseFloat(item.standard_purchase_price) || 0, item.carton_spec || '', parseInt(item.qty_per_carton) || 0, parseFloat(item.unit_weight) || 0, parseFloat(item.unit_cbm) || 0, lifecycle, item.launch_date || '', item.remark || '', status]);
            result.created++;
          }
        } catch (e) { result.failed++; result.errors.push({ row: i + 2, reason: e.message }); }
      });
    });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// SKU 批量更新
app.post('/api/skus/batch-update', requireApiPermission('sku_edit'), (req, res) => {
  try {
    const { ids, data } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: '未选择SKU' });
    if (!data || Object.keys(data).length === 0) return res.status(400).json({ error: '无更新字段' });
    const allowed = ['product_name', 'brand', 'category', 'model', 'color_spec', 'barcode', 'lifecycle_status', 'status', 'auto_replenish'];
    const fields = [];
    const values = [];
    const LIFECYCLE_MAP = {
      '新品导入':'new_test','新品启动':'new_launch','成长期':'growth','成熟期':'stable',
      '衰退期':'slow','滞销':'stagnant','清仓期':'clearance','停采/停产':'stopped',
      '停采':'stopped','停产':'stopped','new_test':'new_test','new_launch':'new_launch',
      'growth':'growth','stable':'stable','slow':'slow','stagnant':'stagnant','clearance':'clearance','stopped':'stopped'
    };
    const STATUS_MAP = { '启用':'normal','停用':'stopped','正常':'normal','清仓':'clearance','停采':'stopped','停产':'discontinued','normal':'normal','clearance':'clearance','stopped':'stopped','discontinued':'discontinued' };
    allowed.forEach(f => {
      if (data[f] !== undefined && data[f] !== null && data[f] !== '') {
        let val = data[f];
        if (f === 'lifecycle_status') val = LIFECYCLE_MAP[String(val).trim()] || val;
        if (f === 'status') val = STATUS_MAP[String(val).trim()] || val;
        fields.push(`${f} = ?`);
        values.push(val);
      }
    });
    if (fields.length === 0) return res.status(400).json({ error: '无有效更新字段' });
    fields.push(`updated_at = datetime('now')`);
    const placeholders = ids.map(() => '?').join(',');
    values.push(...ids);
    const result = run(`UPDATE skus SET ${fields.join(', ')} WHERE id IN (${placeholders})`, values);
    res.json({ success: true, updated: result.changes || ids.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// SKU 批量删除（带业务数据检查）
app.post('/api/skus/batch-delete', requireApiPermission('sku_delete'), (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: '未选择SKU' });
    const result = { deleted: 0, failed: 0, errors: [] };
    const checks = [
      { table: 'inventory', label: '库存' },
      { table: 'outbound_records', label: '出库记录' },
      { table: 'sales_records', label: '销售明细' },
      { table: 'inventory_imports', label: '库存导入' },
      { table: 'replenishment_suggestions', label: '补货预测' },
      { table: 'purchase_order_items', label: 'PO' },
      { table: 'proforma_invoice_items', label: 'PI' },
      { table: 'commercial_invoice_items', label: 'CI' },
      { table: 'packing_list_items', label: 'PL' },
      { table: 'inbound_records', label: '入库记录' },
    ];
    transaction(() => {
      ids.forEach(id => {
        try {
          const sku = queryOne('SELECT sku_code FROM skus WHERE id = ?', [id]);
          if (!sku) { result.failed++; result.errors.push({ id, reason: 'SKU不存在' }); return; }
          for (const c of checks) {
            try {
              const r = queryOne(`SELECT COUNT(*) as cnt FROM ${c.table} WHERE sku_code = ?`, [sku.sku_code]);
              if (r && r.cnt > 0) {
                result.failed++;
                result.errors.push({ id, sku_code: sku.sku_code, reason: `已关联${c.label}数据（${r.cnt}条），不允许删除` });
                return;
              }
            } catch (e) { /* 表可能不存在 */ }
          }
          run('DELETE FROM skus WHERE id = ?', [id]);
          result.deleted++;
        } catch (e) { result.failed++; result.errors.push({ id, reason: e.message }); }
      });
    });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// SKU 导入记录
app.get('/api/skus/import-records', requireApiPermission('sku_view'), (req, res) => {
  try {
    const records = query(`
      SELECT 'sku_import' as type, 'SKU导入' as label, 
        COUNT(*) as total,
        SUM(CASE WHEN product_name != '' THEN 1 ELSE 0 END) as matched,
        MAX(created_at) as last_import
      FROM skus
    `).rows;
    res.json(records);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/inventory-imports', requireApiPermission('inventory_view'), (req, res) => {
  const { country, warehouse, import_date } = req.query;
  let sql = 'SELECT * FROM inventory_imports WHERE 1=1';
  const params = [];
  if (country) { sql += ' AND country = ?'; params.push(country); }
  if (warehouse) { sql += ' AND warehouse = ?'; params.push(warehouse); }
  if (import_date) { sql += ' AND import_date = ?'; params.push(import_date); }
  sql += ' ORDER BY import_date DESC, created_at DESC LIMIT 500';
  res.json(query(sql, params).rows);
});

app.post('/api/inventory-imports/bulk-import', requireApiPermission('inventory_import'), (req, res) => {
  try {
    const items = req.body.items || [];
    const snapshotCutoffDate = req.body.snapshot_cutoff_date || '';
    const result = { created: 0, updated: 0, failed: 0, errors: [] };
    transaction(() => {
      items.forEach((item, i) => {
        try {
          if (!item.sku_code || !item.import_date) { result.failed++; result.errors.push({ row: i + 2, reason: 'SKU或导入日期为空' }); return; }
          const id = genId('inv_imp');
          run(`INSERT INTO inventory_imports (id, import_date, country, warehouse, channel, sku_code, available_qty, remark, snapshot_cutoff_date, brand, weighted_avg_cost, last_inbound_date, first_inbound_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, item.import_date, item.country || '', item.warehouse || '', item.channel || '', item.sku_code, parseInt(item.available_qty) || 0, item.remark || '', snapshotCutoffDate, item.brand || '', parseFloat(item.weighted_avg_cost) || 0, item.last_inbound_date || '', item.first_inbound_date || '']);
          result.created++;
        } catch (e) { result.failed++; result.errors.push({ row: i + 2, reason: e.message }); }
      });
    });
    // 更新库存总表，传入 snapshotCutoffDate
    refreshInventoryTotals(snapshotCutoffDate);
    res.json({ ...result, snapshot_cutoff_date: snapshotCutoffDate });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== 库存总表 ====================
app.get('/api/inventory', requireApiPermission('inventory_view'), (req, res) => {
  const { country, warehouse, brand, keyword } = req.query;
  let sql = `SELECT i.*, s.product_name, s.brand, s.category, s.model, s.lifecycle_status, s.is_new_product FROM inventory i LEFT JOIN skus s ON i.sku_code = s.sku_code WHERE 1=1`;
  const params = [];
  if (country) { sql += ' AND i.country = ?'; params.push(country); }
  if (warehouse) { sql += ' AND i.warehouse = ?'; params.push(warehouse); }
  if (brand) { sql += ' AND s.brand = ?'; params.push(brand); }
  if (keyword) { sql += ' AND (i.sku_code LIKE ? OR s.product_name LIKE ?)'; params.push(`%${keyword}%`, `%${keyword}%`); }
  sql += ' ORDER BY i.sku_code';
  res.json(query(sql, params).rows);
});

// 库存总表筛选下拉选项（从实际数据动态聚合）
app.get('/api/inventory/filter-options', requireApiPermission('inventory_view'), (req, res) => {
  const countries = query(`SELECT DISTINCT country FROM inventory WHERE country IS NOT NULL AND country != '' ORDER BY country`).rows.map(r => r.country);
  const warehouses = query(`SELECT DISTINCT warehouse FROM inventory WHERE warehouse IS NOT NULL AND warehouse != '' ORDER BY warehouse`).rows.map(r => r.warehouse);
  // 品牌来自 inventory 关联到的 skus 表（有 LEFT JOIN，可能是 NULL）
  const brands = query(`SELECT DISTINCT s.brand FROM inventory i JOIN skus s ON i.sku_code = s.sku_code WHERE s.brand IS NOT NULL AND s.brand != '' ORDER BY s.brand`).rows.map(r => r.brand);
  res.json({ countries, warehouses, brands });
});

// 获取库存快照截止日期（按 国家+仓库 维度返回）
app.get('/api/inventory/snapshot-cutoff-date', requireApiPermission('inventory_view'), (req, res) => {
  const rows = query(`
    SELECT country, warehouse, snapshot_cutoff_date
    FROM inventory
    WHERE snapshot_cutoff_date IS NOT NULL AND snapshot_cutoff_date != ''
    GROUP BY country, warehouse, snapshot_cutoff_date
    ORDER BY country, warehouse
  `).rows;
  // 聚合为 country|warehouse -> snapshot_cutoff_date 的映射
  const cutoffMap = {};
  const cutoffList = [];
  rows.forEach(r => {
    const key = `${r.country || ''}|${r.warehouse || ''}`;
    // 如果同一 country+warehouse 有多个 cutoff_date，取最大的（最新的导入）
    if (!cutoffMap[key] || r.snapshot_cutoff_date > cutoffMap[key]) {
      cutoffMap[key] = r.snapshot_cutoff_date;
    }
  });
  Object.entries(cutoffMap).forEach(([key, date]) => {
    const [country, warehouse] = key.split('|');
    cutoffList.push({ country, warehouse, snapshot_cutoff_date: date });
  });
  res.json({ cutoff_dates: cutoffList, cutoff_map: cutoffMap });
});

// 按 国家+仓库 获取 snapshot_cutoff_date 的辅助函数
function getSnapshotCutoffMap() {
  const rows = query(`
    SELECT country, warehouse, MAX(snapshot_cutoff_date) as snapshot_cutoff_date
    FROM inventory
    WHERE snapshot_cutoff_date IS NOT NULL AND snapshot_cutoff_date != ''
    GROUP BY country, warehouse
  `).rows;
  const map = {};
  rows.forEach(r => {
    map[`${r.country || ''}|${r.warehouse || ''}`] = r.snapshot_cutoff_date;
  });
  return map;
}

// 刷新库存总表（根据导入记录和业务数据重新计算）
function refreshInventoryTotals(snapshotCutoffDate) {
  // 获取每个 SKU+国家+仓库 的最新可用库存（连同 snapshot_cutoff_date、weighted_avg_cost）
  const latestImports = query(`
    SELECT sku_code, country, warehouse, available_qty, import_date, snapshot_cutoff_date, weighted_avg_cost, last_inbound_date, first_inbound_date
    FROM inventory_imports i1
    WHERE import_date = (SELECT MAX(import_date) FROM inventory_imports i2 WHERE i2.sku_code = i1.sku_code AND i2.country = i1.country AND i2.warehouse = i1.warehouse)
  `).rows;

  transaction(() => {
    latestImports.forEach(imp => {
      const cutoff = imp.snapshot_cutoff_date || snapshotCutoffDate || '';
      const wac = parseFloat(imp.weighted_avg_cost) || 0;
      const invValue = (parseInt(imp.available_qty) || 0) * wac;
      const existing = queryOne('SELECT id, last_inbound_date, first_inbound_date FROM inventory WHERE sku_code = ? AND country = ? AND warehouse = ?',
        [imp.sku_code, imp.country, imp.warehouse]);
      // last_inbound_date 更新规则：导入文件有值则更新，否则保留原值
      const newLastInbound = (imp.last_inbound_date && String(imp.last_inbound_date).trim()) ? imp.last_inbound_date : (existing ? existing.last_inbound_date : '');
      // first_inbound_date 更新规则：导入文件填写新日期才更新；为空则保留旧值
      const newFirstInbound = (imp.first_inbound_date && String(imp.first_inbound_date).trim()) ? imp.first_inbound_date : (existing ? existing.first_inbound_date : '');
      if (existing) {
        run(`UPDATE inventory SET available_qty = ?, weighted_avg_cost = ?, inventory_value = ?, last_import_date = ?, snapshot_cutoff_date = ?, last_inbound_date = ?, first_inbound_date = ?, updated_at = datetime('now') WHERE id = ?`,
          [imp.available_qty, wac, invValue, imp.import_date, cutoff, newLastInbound, newFirstInbound, existing.id]);
      } else {
        run(`INSERT INTO inventory (id, sku_code, country, warehouse, available_qty, weighted_avg_cost, inventory_value, last_import_date, snapshot_cutoff_date, last_inbound_date, first_inbound_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [genId('inv'), imp.sku_code, imp.country, imp.warehouse, imp.available_qty, wac, invValue, imp.import_date, cutoff, newLastInbound, newFirstInbound]);
      }
    });
    // 更新在途、PI未发货、PO未确认等
    updateInventoryTransitData();
  });
}

// 更新库存的在途数据
function updateInventoryTransitData() {
  // 采购链只记录单据流转，不自动回写库存总表；库存总表由用户通过导入维护。
  return;
  // CI已发货未入库 = 在途
  const transitData = query(`
    SELECT cii.sku_code, l.target_country as country, l.target_warehouse as warehouse,
           SUM(cii.shipped_qty - cii.inbound_qty) as in_transit_qty
    FROM commercial_invoice_items cii
    JOIN commercial_invoices ci ON cii.ci_id = ci.id
    JOIN logistics_batches l ON l.related_ci_id = ci.id
    WHERE ci.ci_status NOT IN ('cancelled') AND (cii.shipped_qty - cii.inbound_qty) > 0
    GROUP BY cii.sku_code, l.target_country, l.target_warehouse
  `).rows;

  transitData.forEach(td => {
    const inv = queryOne('SELECT id FROM inventory WHERE sku_code = ? AND country = ? AND warehouse = ?',
      [td.sku_code, td.country, td.warehouse]);
    if (inv) {
      run('UPDATE inventory SET in_transit_qty = ? WHERE id = ?', [td.in_transit_qty || 0, inv.id]);
    }
  });

  // PI已确认未发货
  const piData = query(`
    SELECT pii.sku_code, po.country, po.target_warehouse as warehouse,
           SUM(pii.pi_confirmed_qty - pii.shipped_qty) as pi_unshipped
    FROM proforma_invoice_items pii
    JOIN proforma_invoices pi ON pii.pi_id = pi.id
    JOIN purchase_orders po ON pi.related_po_id = po.id
    WHERE pi.pi_status NOT IN ('cancelled', 'completed') AND (pii.pi_confirmed_qty - pii.shipped_qty) > 0
    GROUP BY pii.sku_code, po.country, po.target_warehouse
  `).rows;

  piData.forEach(pd => {
    const inv = queryOne('SELECT id FROM inventory WHERE sku_code = ? AND country = ? AND warehouse = ?',
      [pd.sku_code, pd.country, pd.warehouse]);
    if (inv) {
      run('UPDATE inventory SET pi_confirmed_unshipped_qty = ? WHERE id = ?', [pd.pi_unshipped || 0, inv.id]);
    }
  });

  // PO已生成未确认PI
  const poData = query(`
    SELECT poi.sku_code, po.country, po.target_warehouse as warehouse,
           SUM(poi.po_qty - poi.transferred_pi_qty) as po_unconfirmed
    FROM purchase_order_items poi
    JOIN purchase_orders po ON poi.po_id = po.id
    WHERE po.po_status NOT IN ('cancelled', 'transferred_pi') AND (poi.po_qty - poi.transferred_pi_qty) > 0
    GROUP BY poi.sku_code, po.country, po.target_warehouse
  `).rows;

  poData.forEach(pd => {
    const inv = queryOne('SELECT id FROM inventory WHERE sku_code = ? AND country = ? AND warehouse = ?',
      [pd.sku_code, pd.country, pd.warehouse]);
    if (inv) {
      run('UPDATE inventory SET po_unconfirmed_pi_qty = ? WHERE id = ?', [pd.po_unconfirmed || 0, inv.id]);
    }
  });
}

// ==================== 出库数据 ====================
app.get('/api/outbound-records', requireApiPermission('outbound_view'), (req, res) => {
  const { country, warehouse, brand, outbound_type, outbound_status, channel, start_date, end_date, inventory_effect, import_batch_id } = req.query;
  let sql = `SELECT o.*, s.brand FROM outbound_records o LEFT JOIN skus s ON o.sku_code = s.sku_code WHERE 1=1`;
  const params = [];
  if (country) { sql += ' AND o.country = ?'; params.push(country); }
  if (warehouse) { sql += ' AND o.warehouse = ?'; params.push(warehouse); }
  if (brand) { sql += ' AND s.brand = ?'; params.push(brand); }
  if (outbound_type) { sql += ' AND o.outbound_type = ?'; params.push(outbound_type); }
  if (outbound_status) { sql += ' AND o.outbound_status = ?'; params.push(outbound_status); }
  if (channel) { sql += ' AND o.channel = ?'; params.push(channel); }
  if (start_date) { sql += ' AND o.outbound_date >= ?'; params.push(start_date); }
  if (end_date) { sql += ' AND o.outbound_date <= ?'; params.push(end_date); }
  if (inventory_effect) { sql += ' AND o.inventory_effect = ?'; params.push(inventory_effect); }
  if (import_batch_id) { sql += ' AND o.import_batch_id = ?'; params.push(import_batch_id); }
  sql += ' ORDER BY o.outbound_date DESC, o.created_at DESC LIMIT 500';
  res.json(query(sql, params).rows);
});

// 出库数据筛选下拉选项（从实际数据动态聚合）
app.get('/api/outbound-records/filter-options', requireApiPermission('outbound_view'), (req, res) => {
  const countries = query(`SELECT DISTINCT country FROM outbound_records WHERE country IS NOT NULL AND country != '' ORDER BY country`).rows.map(r => r.country);
  const warehouses = query(`SELECT DISTINCT warehouse FROM outbound_records WHERE warehouse IS NOT NULL AND warehouse != '' ORDER BY warehouse`).rows.map(r => r.warehouse);
  const brands = query(`SELECT DISTINCT s.brand FROM outbound_records o JOIN skus s ON o.sku_code = s.sku_code WHERE s.brand IS NOT NULL AND s.brand != '' ORDER BY s.brand`).rows.map(r => r.brand);
  res.json({ countries, warehouses, brands });
});

app.post('/api/outbound-records', requireApiPermission('outbound_create'), (req, res) => {
  try {
    const d = req.body;
    if (!d.sku_code || !d.outbound_date) return res.status(400).json({ error: 'SKU和出库日期不能为空' });
    const oId = genId('outbound');
    const oNo = d.outbound_no || `OUT-${Date.now()}`;
    const ci = d.consume_inventory !== undefined ? parseInt(d.consume_inventory) : 1;
    const invEffect = ci === 1 ? 'deducted' : 'none';
    run(`INSERT INTO outbound_records (id, outbound_no, outbound_date, country, warehouse, sku_code, quantity, outbound_type, channel, platform, mdf_type, related_project, count_for_forecast, consume_inventory, remark, import_mode, inventory_effect, applied_to_inventory, platform_order_no) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [oId, oNo, d.outbound_date, d.country || '', d.warehouse || '', d.sku_code, d.quantity || 0, d.outbound_type || '', d.channel || '', d.platform || '', d.mdf_type || '', d.related_project || '', d.count_for_forecast !== undefined ? d.count_for_forecast : 1, ci, d.remark || '', 'operational', invEffect, ci, d.platform_order_no || '']);
    // 扣减库存
    if (ci === 1) {
      const inv = queryOne('SELECT id FROM inventory WHERE sku_code=? AND country=? AND warehouse=?', [d.sku_code, d.country || '', d.warehouse || '']);
      if (inv) {
        run('UPDATE inventory SET available_qty=available_qty-?, updated_at=datetime(\'now\') WHERE id=?', [d.quantity || 0, inv.id]);
        recalcInventoryForSku(d.sku_code, d.country || '', d.warehouse || '');
      }
    }
    res.json({ id: oId, outbound_no: oNo, ...d });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 出库类型中文映射
const OB_TYPE_MAP = {'线上销售':'online_sale','线下销售':'offline_sale','MDF达人':'mdf_influencer','MDF活动':'mdf_event','调拨':'transfer','报废':'scrap','样品':'sample','损坏':'damage','退货':'return_out','手工调整':'manual_adjustment'};
const OB_CHANNEL_MAP = {'线上':'online','线下':'offline'};
const OB_FORECAST_TYPES = ['sale','online_sale','offline_sale'];

// 重复校验：检查出库记录是否已存在
// 优先用 platform_order_no(出库单号)+SKU 判断；如果没有出库单号，再用 SKU+日期+国家+仓库+数量+类型+渠道+平台 判断
function checkDuplicateOutbound(item) {
  // 先映射类型和渠道为英文值（与存储一致）
  const rawType = item.outbound_type || '';
  const outboundType = OB_TYPE_MAP[rawType] || rawType || 'online_sale';
  const rawChannel = item.channel || '';
  const channel = OB_CHANNEL_MAP[rawChannel] || rawChannel || 'online';
  const platformOrderNo = (item.platform_order_no || '').trim();

  // 优先用 出库单号+SKU 判断重复
  if (platformOrderNo) {
    const existingByOrder = queryOne(
      `SELECT id FROM outbound_records WHERE platform_order_no=? AND sku_code=? AND outbound_status='normal' LIMIT 1`,
      [platformOrderNo, item.sku_code]
    );
    if (existingByOrder) return true;
    // 即使没有完全匹配，也检查同出库单号是否已存在（不同SKU不算重复，但如果同SKU则重复）
    // 上面已检查 platform_order_no+sku_code 组合，如果没找到则不重复
    return false;
  }

  // 没有出库单号，使用复合键判断
  const existing = queryOne(
    `SELECT id FROM outbound_records WHERE sku_code=? AND outbound_date=? AND country=? AND warehouse=? AND quantity=? AND outbound_type=? AND channel=? AND platform=? AND (platform_order_no IS NULL OR platform_order_no='') AND outbound_status='normal' LIMIT 1`,
    [item.sku_code, item.outbound_date, item.country || '', item.warehouse || '', parseInt(item.quantity) || 0, outboundType, channel, item.platform || '']
  );
  return !!existing;
}

// 预览导入（不执行写入）
app.post('/api/outbound-records/bulk-import-preview', requireApiPermission('outbound_view'), (req, res) => {
  try {
    const items = req.body.items || [];
    const importMode = req.body.import_mode || 'auto_by_snapshot_date'; // historical / auto_by_snapshot_date / operational
    // 获取按 国家+仓库 维度的 snapshot_cutoff_date 映射
    const cutoffMap = importMode === 'auto_by_snapshot_date' ? getSnapshotCutoffMap() : {};
    const stats = { total: items.length, will_deduct: 0, not_deduct: 0, duplicate: 0, invalid: 0, errors: [] };
    items.forEach((item, i) => {
      if (!item.sku_code || !item.outbound_date) { stats.invalid++; stats.errors.push({ row: i + 2, reason: 'SKU或出库日期为空' }); return; }
      // 重复校验
      if (checkDuplicateOutbound(item)) { stats.duplicate++; return; }
      // 判断是否扣减
      let shouldDeduct = false;
      if (importMode === 'historical') {
        shouldDeduct = false;
      } else if (importMode === 'operational') {
        shouldDeduct = true;
      } else { // auto_by_snapshot_date
        // 按记录的 country+warehouse 查找 snapshot_cutoff_date
        const key = `${item.country || ''}|${item.warehouse || ''}`;
        const recordCutoff = cutoffMap[key];
        if (!recordCutoff) {
          // 找不到对应国家+仓库的 snapshot_cutoff_date，标记为异常
          stats.invalid++;
          stats.errors.push({ row: i + 2, reason: `找不到国家「${item.country || ''}」仓库「${item.warehouse || ''}」对应的库存快照截止日期，无法自动判断是否扣减库存。请先在库存总表导入该国家+仓库的库存快照。` });
          return;
        }
        shouldDeduct = item.outbound_date > recordCutoff;
      }
      if (shouldDeduct) stats.will_deduct++;
      else stats.not_deduct++;
    });
    res.json(stats);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 正式导入
app.post('/api/outbound-records/bulk-import', requireApiPermission('outbound_create'), (req, res) => {
  try {
    const items = req.body.items || [];
    const importMode = req.body.import_mode || 'auto_by_snapshot_date'; // historical / auto_by_snapshot_date / operational
    // 获取按 国家+仓库 维度的 snapshot_cutoff_date 映射
    const cutoffMap = importMode === 'auto_by_snapshot_date' ? getSnapshotCutoffMap() : {};
    const batchId = genId('ob_batch');
    const result = { created: 0, failed: 0, duplicate: 0, deducted: 0, not_deducted: 0, total_deducted_qty: 0, errors: [], import_batch_id: batchId };
    const affectedSkus = new Set();

    transaction(() => {
      items.forEach((item, i) => {
        try {
          if (!item.sku_code || !item.outbound_date) { result.failed++; result.errors.push({ row: i + 2, reason: 'SKU或出库日期为空' }); return; }
          // 重复校验
          if (checkDuplicateOutbound(item)) { result.duplicate++; return; }
          // 类型映射
          const rawType = item.outbound_type || '';
          const outboundType = OB_TYPE_MAP[rawType] || rawType || 'online_sale';
          const rawChannel = item.channel || '';
          const channel = OB_CHANNEL_MAP[rawChannel] || rawChannel || 'online';
          const defaultForecast = OB_FORECAST_TYPES.includes(outboundType) ? 1 : 0;
          // 判断是否扣减库存
          let shouldDeduct = false;
          let recordSnapshotCutoff = '';
          if (importMode === 'historical') {
            shouldDeduct = false;
          } else if (importMode === 'operational') {
            shouldDeduct = true;
          } else { // auto_by_snapshot_date
            // 按记录的 country+warehouse 查找 snapshot_cutoff_date
            const key = `${item.country || ''}|${item.warehouse || ''}`;
            recordSnapshotCutoff = cutoffMap[key] || '';
            if (!recordSnapshotCutoff) {
              // 找不到对应国家+仓库的 snapshot_cutoff_date，标记为异常并跳过
              result.failed++;
              result.errors.push({ row: i + 2, reason: `找不到国家「${item.country || ''}」仓库「${item.warehouse || ''}」对应的库存快照截止日期，无法自动判断是否扣减库存。请先在库存总表导入该国家+仓库的库存快照。` });
              return;
            }
            shouldDeduct = item.outbound_date > recordSnapshotCutoff;
          }
          const inventoryEffect = shouldDeduct ? 'deducted' : 'none';
          const appliedToInventory = shouldDeduct ? 1 : 0;
          const qty = parseInt(item.quantity) || 0;
          const platformOrderNo = (item.platform_order_no || '').trim();
          const oId = genId('outbound');
          run(`INSERT INTO outbound_records (id, outbound_no, outbound_date, country, warehouse, sku_code, quantity, outbound_type, channel, platform, mdf_type, related_project, count_for_forecast, consume_inventory, remark, import_mode, inventory_effect, applied_to_inventory, snapshot_cutoff_date, import_batch_id, platform_order_no) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [oId, `OUT-${Date.now()}-${i}`, item.outbound_date, item.country || '', item.warehouse || '', item.sku_code, qty, outboundType, channel, item.platform || '', item.mdf_type || '', item.related_project || '', defaultForecast, appliedToInventory, item.remark || '', importMode, inventoryEffect, appliedToInventory, recordSnapshotCutoff, batchId, platformOrderNo]);
          // 扣减库存
          if (shouldDeduct) {
            const inv = queryOne('SELECT id FROM inventory WHERE sku_code=? AND country=? AND warehouse=?', [item.sku_code, item.country || '', item.warehouse || '']);
            if (inv) {
              run('UPDATE inventory SET available_qty=available_qty-?, updated_at=datetime(\'now\') WHERE id=?', [qty, inv.id]);
              result.deducted++;
              result.total_deducted_qty += qty;
            }
          } else {
            result.not_deducted++;
          }
          affectedSkus.add(`${item.sku_code}|${item.country||''}|${item.warehouse||''}`);
          result.created++;
        } catch (e) { result.failed++; result.errors.push({ row: i + 2, reason: e.message }); }
      });
      // 导入后触发重算
      affectedSkus.forEach(key => {
        const [sku, country, warehouse] = key.split('|');
        recalcInventoryForSku(sku, country, warehouse);
      });
    });
    // 记录操作日志
    logOperation({operator_id:req.currentUserId, operator_name:req.currentUserName, page:'outbound', operation_type:'bulk_import', target_ids:[], affected_count:result.created, old_values:{}, new_values:{import_mode:importMode, batch_id:batchId}, reason:'', triggered_recalc:1, is_rollbackable:0});
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== 销量数据 ====================
app.get('/api/sales-data', requireApiPermission('outbound_view'), (req, res) => {
  const { sku_code, country, channel, start_date, end_date } = req.query;
  let sql = 'SELECT * FROM sales_data WHERE 1=1';
  const params = [];
  if (sku_code) { sql += ' AND sku_code = ?'; params.push(sku_code); }
  if (country) { sql += ' AND country = ?'; params.push(country); }
  if (channel) { sql += ' AND channel = ?'; params.push(channel); }
  if (start_date) { sql += ' AND date >= ?'; params.push(start_date); }
  if (end_date) { sql += ' AND date <= ?'; params.push(end_date); }
  sql += ' ORDER BY date DESC LIMIT 1000';
  res.json(query(sql, params).rows);
});

app.post('/api/sales-data/bulk-import', requireApiPermission('outbound_create'), (req, res) => {
  try {
    const items = req.body.items || [];
    const result = { created: 0, failed: 0, errors: [] };
    transaction(() => {
      items.forEach((item, i) => {
        try {
          if (!item.sku_code || !item.date) { result.failed++; result.errors.push({ row: i + 2, reason: 'SKU或日期为空' }); return; }
          run(`INSERT INTO sales_data (id, date, sku_code, country, channel, platform, quantity, amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [genId('sale'), item.date, item.sku_code, item.country || '', item.channel || '', item.platform || '', parseInt(item.quantity) || 0, parseFloat(item.amount) || 0]);
          result.created++;
        } catch (e) { result.failed++; result.errors.push({ row: i + 2, reason: e.message }); }
      });
    });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== 销售明细数据（新） ====================

// 销售明细列表
app.get('/api/sales-records', requireApiPermission('outbound_view'), (req, res) => {
  const { source_system, order_no, shop_platform, brand, sku_code, is_valid, start_date, end_date, import_batch_id } = req.query;
  let sql = `SELECT sr.*, s.product_name FROM sales_records sr LEFT JOIN skus s ON sr.sku_code = s.sku_code WHERE 1=1`;
  const params = [];
  if (source_system) { sql += ' AND sr.source_system = ?'; params.push(source_system); }
  if (order_no) { sql += ' AND sr.order_no LIKE ?'; params.push(`%${order_no}%`); }
  if (shop_platform) { sql += ' AND sr.shop_platform = ?'; params.push(shop_platform); }
  if (brand) { sql += ' AND sr.brand = ?'; params.push(brand); }
  if (sku_code) { sql += ' AND sr.sku_code LIKE ?'; params.push(`%${sku_code}%`); }
  if (is_valid !== undefined && is_valid !== '') { sql += ' AND sr.is_valid_order = ?'; params.push(parseInt(is_valid)); }
  if (start_date) { sql += ' AND sr.order_date >= ?'; params.push(start_date); }
  if (end_date) { sql += ' AND sr.order_date <= ?'; params.push(end_date); }
  if (import_batch_id) { sql += ' AND sr.import_batch_id = ?'; params.push(import_batch_id); }
  sql += ' ORDER BY sr.order_date DESC, sr.created_at DESC LIMIT 500';
  res.json(query(sql, params).rows);
});

// 销售明细筛选下拉选项
app.get('/api/sales-records/filter-options', requireApiPermission('outbound_view'), (req, res) => {
  const source_systems = query(`SELECT DISTINCT source_system FROM sales_records WHERE source_system IS NOT NULL AND source_system != '' ORDER BY source_system`).rows.map(r => r.source_system);
  const shop_platforms = query(`SELECT DISTINCT shop_platform FROM sales_records WHERE shop_platform IS NOT NULL AND shop_platform != '' ORDER BY shop_platform`).rows.map(r => r.shop_platform);
  const brands = query(`SELECT DISTINCT brand FROM sales_records WHERE brand IS NOT NULL AND brand != '' ORDER BY brand`).rows.map(r => r.brand);
  res.json({ source_systems, shop_platforms, brands });
});

// 销售明细导入预览
app.post('/api/sales-records/bulk-import-preview', requireApiPermission('outbound_view'), (req, res) => {
  try {
    const items = req.body.items || [];
    const preview = items.map((item, i) => {
      const errors = [];
      if (!item.sku_code) errors.push('SKU不能为空');
      if (!item.order_date) errors.push('下单日期不能为空');
      if (!item.source_system) errors.push('来源系统不能为空');
      if (!item.order_no) errors.push('订单号不能为空');
      // is_valid_order 转换
      let isValid = 1;
      if (item.is_valid_order !== undefined && item.is_valid_order !== '') {
        const v = String(item.is_valid_order).toLowerCase().trim();
        isValid = (v === 'true' || v === '1' || v === '是' || v === '有效') ? 1 : 0;
      }
      // 判断是否已存在（upsert预判）
      let existing = null;
      if (item.order_detail_id) {
        existing = queryOne('SELECT id FROM sales_records WHERE source_system=? AND order_detail_id=?', [item.source_system, item.order_detail_id]);
      }
      if (!existing) {
        existing = queryOne('SELECT id, is_valid_order, quantity, shop_platform, original_order_status, remark FROM sales_records WHERE source_system=? AND order_no=? AND sku_code=? AND COALESCE(shop_platform,\'\')=?',
          [item.source_system, item.order_no, item.sku_code, item.shop_platform || '']);
      }
      let action = 'insert';
      if (existing && errors.length === 0) {
        // 判断是否有变化
        if (existing.is_valid_order !== isValid ||
            existing.quantity !== (parseInt(item.quantity) || 0) ||
            (existing.shop_platform || '') !== (item.shop_platform || '') ||
            (existing.original_order_status || '') !== (item.original_order_status || '') ||
            (existing.remark || '') !== (item.remark || '')) {
          action = 'update';
        } else {
          action = 'skip';
        }
      }
      return {
        row: i + 2,
        source_system: item.source_system || '',
        order_no: item.order_no || '',
        order_date: item.order_date || '',
        shop_platform: item.shop_platform || '',
        brand: item.brand || '',
        sku_code: item.sku_code || '',
        quantity: parseInt(item.quantity) || 0,
        is_valid_order: isValid,
        original_order_status: item.original_order_status || '',
        action,
        errors
      };
    });
    res.json({ preview });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 销售明细导入（upsert）
app.post('/api/sales-records/bulk-import', requireApiPermission('outbound_import'), (req, res) => {
  try {
    const items = req.body.items || [];
    const batchId = genId('batch');
    const result = { total: items.length, inserted: 0, updated: 0, skipped: 0, failed: 0, errors: [] };

    transaction(() => {
      items.forEach((item, i) => {
        try {
          if (!item.sku_code) { result.failed++; result.errors.push({ row: i + 2, reason: 'SKU不能为空' }); return; }
          if (!item.order_date) { result.failed++; result.errors.push({ row: i + 2, reason: '下单日期不能为空' }); return; }
          if (!item.source_system) { result.failed++; result.errors.push({ row: i + 2, reason: '来源系统不能为空' }); return; }
          if (!item.order_no) { result.failed++; result.errors.push({ row: i + 2, reason: '订单号不能为空' }); return; }

          // is_valid_order 转换
          let isValid = 1;
          if (item.is_valid_order !== undefined && item.is_valid_order !== '') {
            const v = String(item.is_valid_order).toLowerCase().trim();
            isValid = (v === 'true' || v === '1' || v === '是' || v === '有效') ? 1 : 0;
          }
          const qty = parseInt(item.quantity) || 0;
          const shop = item.shop_platform || '';
          const orderDetailId = item.order_detail_id || '';
          const origStatus = item.original_order_status || '';
          const remark = item.remark || '';
          const brand = item.brand || '';

          // 查找已有记录 —— 优先用 order_detail_id
          let existing = null;
          if (orderDetailId) {
            existing = queryOne('SELECT id, is_valid_order, quantity, shop_platform, original_order_status, brand, remark FROM sales_records WHERE source_system=? AND order_detail_id=?', [item.source_system, orderDetailId]);
          }
          if (!existing) {
            existing = queryOne('SELECT id, is_valid_order, quantity, shop_platform, original_order_status, brand, remark FROM sales_records WHERE source_system=? AND order_no=? AND sku_code=? AND COALESCE(shop_platform,\'\')=?',
              [item.source_system, item.order_no, item.sku_code, shop]);
          }

          if (existing) {
            // 判断是否有变化
            const changed = existing.is_valid_order !== isValid ||
              existing.quantity !== qty ||
              (existing.shop_platform || '') !== shop ||
              (existing.original_order_status || '') !== origStatus ||
              (existing.brand || '') !== brand ||
              (existing.remark || '') !== remark;
            if (changed) {
              run(`UPDATE sales_records SET order_date=?, shop_platform=?, brand=?, quantity=?, is_valid_order=?, original_order_status=?, remark=?, import_batch_id=?, updated_at=datetime('now') WHERE id=?`,
                [item.order_date, shop, brand, qty, isValid, origStatus, remark, batchId, existing.id]);
              result.updated++;
            } else {
              result.skipped++;
            }
          } else {
            run(`INSERT INTO sales_records (id, source_system, order_no, order_detail_id, order_date, shop_platform, brand, sku_code, quantity, is_valid_order, original_order_status, remark, import_batch_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [genId('sale'), item.source_system, item.order_no, orderDetailId, item.order_date, shop, brand, item.sku_code, qty, isValid, origStatus, remark, batchId]);
            result.inserted++;
          }
        } catch (e) {
          if (e.message && e.message.includes('UNIQUE')) {
            result.skipped++;
            result.errors.push({ row: i + 2, reason: '重复记录（唯一约束）' });
          } else {
            result.failed++;
            result.errors.push({ row: i + 2, reason: e.message });
          }
        }
      });
    });

    // 导入后重新计算受影响SKU的周转月
    const affectedSkus = [...new Set(items.filter(i => i.sku_code).map(i => i.sku_code))];
    affectedSkus.forEach(sku => {
      const invs = query('SELECT country, warehouse FROM inventory WHERE sku_code = ?', [sku]).rows;
      invs.forEach(inv => recalcInventoryForSku(sku, inv.country, inv.warehouse));
    });

    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== 补货建议 ====================

function salesOrderDateExpr(col = 'order_date') {
  const rest = `substr(${col}, instr(${col}, '/') + 1)`;
  return `CASE
    WHEN ${col} LIKE '%/%' THEN printf(
      '20%02d-%02d-%02d',
      CAST(substr(${rest}, instr(${rest}, '/') + 1) AS INTEGER),
      CAST(substr(${col}, 1, instr(${col}, '/') - 1) AS INTEGER),
      CAST(substr(${rest}, 1, instr(${rest}, '/') - 1) AS INTEGER)
    )
    ELSE substr(${col}, 1, 10)
  END`;
}

// ==================== 统一动销状态判定层 ====================
// 读取品牌目标周转配置（JSON）：Redragon=4, Netac=2, __default__=3
function loadBrandTargetConfig() {
  try {
    const row = queryOne("SELECT value FROM system_config WHERE key = 'brand_target_stock_months'");
    if (row && row.value) return JSON.parse(row.value);
  } catch (e) {}
  return {};
}

// 品牌目标周转月数：优先级 SKU手动目标 > 品牌默认 > 系统默认3
// cfg 可选：传入已读取的品牌配置避免重复查库
function getBrandTargetMonths(brand, skuTargetTurnover, cfg) {
  if (skuTargetTurnover != null && !isNaN(skuTargetTurnover) && skuTargetTurnover > 0) return parseFloat(skuTargetTurnover);
  let c = cfg;
  if (!c) c = loadBrandTargetConfig();
  c = c || {};
  const b = (brand || '').trim();
  if (b && c[b] != null) return parseFloat(c[b]);
  const found = Object.keys(c).find(k => k && k.toLowerCase() === b.toLowerCase());
  if (found) return parseFloat(c[found]);
  return parseFloat(c['__default__'] != null ? c['__default__'] : 3);
}

// 是否已过新品保护期。参考日期优先级：launch_date > first_inbound_date > first_sale_date
function isPassedNewProductProtection(o, now) {
  const days = (o.new_product_protection_days != null && !isNaN(o.new_product_protection_days)) ? o.new_product_protection_days : 90;
  const refRaw = (o.launch_date && String(o.launch_date).trim())
    || (o.first_inbound_date && String(o.first_inbound_date).trim())
    || (o.first_sale_date && String(o.first_sale_date).trim())
    || '';
  if (!refRaw) return !(o.is_new_product === 1); // 无参考日期：标记新品视为未过，否则视为已过
  const ref = new Date(refRaw);
  if (isNaN(ref.getTime())) return !(o.is_new_product === 1);
  const diffDays = Math.floor((now - ref) / 86400000);
  return diffDays > days;
}

// AI经营建议（规则模板生成，不接外部AI，不重新判断状态）
function buildAiAdvice(sales_status, risk_tags, passedProtection) {
  const MAIN = {
    '清仓': '生命周期不适合正常补货，停止采购，优先消化库存。',
    '停采/停产': '生命周期不适合正常补货，停止采购，优先消化库存。',
    '新品/销售数据不足': '销售时间不足，先人工复核目标周转，避免短期误判。',
    '无有效销售': '暂无有效销量，先检查上架、价格、渠道和库存状态。',
    '缺货': '现货为0，先复核补货；低销量可能由缺货造成。',
    '缺货风险': '现货周转低于0.5个月，优先复核补货，避免断货压低销量。',
    '呆滞': '30天无销量且仍有库存，暂停补货，先清库存。',
    '慢销': '有销量但周转超目标2倍，谨慎补货，先消化库存。',
    '正常动销': '销量和周转正常，按目标周转正常补货。'
  };
  const RISK = {
    '高库存关注': '周转超目标1.5倍，控制采购，避免库存资金堆高。',
    '高库存严重': '周转超目标2倍，减少采购，优先消化库存。',
    '高库龄风险': '库龄超180天且周转偏高，排查老库存、价格和渠道问题。',
    '库龄未知': '缺少入库日期，先补全数据，避免库龄判断失真。'
  };
  let advice = MAIN[sales_status] || '数据不足，建议人工复核销量、库存、周转和生命周期。';
  if (Array.isArray(risk_tags) && risk_tags.length) {
    advice += ' ' + risk_tags.map(t => RISK[t] || '').filter(Boolean).join(' ');
  }
  return advice.trim();
}

// 统一动销状态判定（纯函数，不查库）
// 输入 o: { lifecycle_status, is_new_product, launch_date, first_inbound_date, first_sale_date,
//          new_product_protection_days, available, avg_sales_4m, sales_30d, sales_90d, total_sales_ever,
//          days_since_last_inbound, last_inbound_date, target_months }
// 输出: { sales_status, risk_tags[], sales_reason, action, ai_business_advice }
// 判断顺序：生命周期/新品 → 缺货/缺货风险 → 呆滞 → 慢销 → 高库存/高库龄 → 正常
function classifySkuState(o) {
  const now = new Date();
  const lc = (o.lifecycle_status || 'stable').trim();
  const available = o.available || 0;
  const avg = o.avg_sales_4m || 0;
  const target = o.target_months || 3;
  const availTurnover = avg > 0 ? (available / avg) : null; // null=无销量无法计算
  const passedProtection = isPassedNewProductProtection(o, now);
  const stockout = available <= 0;
  const stockoutRisk = available > 0 && avg > 0 && availTurnover !== null && availTurnover < 0.5;
  const daysSinceInbound = (o.days_since_last_inbound != null) ? o.days_since_last_inbound : null;
  const hasInboundDate = !!(o.last_inbound_date && String(o.last_inbound_date).trim());

  let sales_status = '正常动销';
  let sales_reason = '销量与周转正常';

  if (lc === 'clearance') {
    sales_status = '清仓'; sales_reason = '生命周期为清仓期';
  } else if (lc === 'stopped') {
    sales_status = '停采/停产'; sales_reason = '生命周期为停采/停产';
  } else if (!passedProtection) {
    sales_status = '新品/销售数据不足'; sales_reason = '尚在新品保护期内，销售时间不足';
  } else if ((o.total_sales_ever || 0) === 0) {
    sales_status = '无有效销售'; sales_reason = '已过新品保护期，但历史无有效销量';
  } else if (stockout) {
    sales_status = '缺货'; sales_reason = '当前可用库存为0，近期销量可能被缺货压低';
  } else if (stockoutRisk) {
    sales_status = '缺货风险'; sales_reason = '可用库存周转<0.5个月，近期销量可能被缺货压低';
  } else if ((o.sales_30d || 0) === 0 && available > 0 && passedProtection) {
    sales_status = '呆滞'; sales_reason = '近30天无有效销量且仍有库存';
  } else if ((o.sales_90d || 0) > 0 && availTurnover !== null && availTurnover > target * 2 && passedProtection && !stockoutRisk) {
    sales_status = '慢销'; sales_reason = '有销量但周转超目标2倍';
  } else {
    sales_status = '正常动销'; sales_reason = '销量与周转正常';
  }

  // 风险标签并行判断（缺货/缺货风险时不挂高库存/高库龄，避免销量失真误判）
  const risk_tags = [];
  if (!stockout && !stockoutRisk) {
    if (availTurnover !== null && availTurnover > target * 1.5) risk_tags.push('高库存关注');
    if (availTurnover !== null && availTurnover > target * 2) risk_tags.push('高库存严重');
    if (daysSinceInbound !== null && daysSinceInbound > 180 && available > 0 && availTurnover !== null && availTurnover > target * 2) {
      risk_tags.push('高库龄风险');
    }
  }
  if (!hasInboundDate) risk_tags.push('库龄未知');

  const ACTION_MAP = {
    '清仓': '停止采购，优先消化库存',
    '停采/停产': '停止采购，不参与补货',
    '新品/销售数据不足': '人工复核目标周转，暂缓补货',
    '无有效销售': '检查上架/价格/渠道，暂缓补货',
    '缺货': '优先复核补货，确认现货',
    '缺货风险': '优先复核补货，避免断货',
    '呆滞': '暂停补货，先清库存',
    '慢销': '谨慎补货，先消化库存',
    '正常动销': '按目标周转正常补货'
  };
  const action = ACTION_MAP[sales_status] || '人工复核后决定';
  const ai_business_advice = buildAiAdvice(sales_status, risk_tags, passedProtection);

  return { sales_status, risk_tags, sales_reason, action, ai_business_advice };
}

// 补货建议汇总统计（用于SKU动销与订单预测页面顶部指标卡）
app.get('/api/replenishment-suggestions/summary', requireApiPermission('replenishment_view'), (req, res) => {
  const { country, warehouse, brand } = req.query;
  let where = '';
  const params = [];
  if (country) { where += (where ? ' AND' : ' WHERE') + ' rs.country = ?'; params.push(country); }
  if (warehouse) { where += (where ? ' AND' : ' WHERE') + ' rs.target_warehouse = ?'; params.push(warehouse); }
  if (brand) { where += (where ? ' AND' : ' WHERE') + ' s.brand = ?'; params.push(brand); }
  const rows = query(`SELECT rs.* FROM replenishment_suggestions rs LEFT JOIN skus s ON rs.sku_code = s.sku_code${where}`, params).rows;
  const totalSkus = rows.length;
  const totalPool = rows.reduce((s, r) => s + (r.total_inventory_pool || 0), 0);
  const totalSales4m = rows.reduce((s, r) => s + (r.sales_m1 || 0) + (r.sales_m2 || 0) + (r.sales_m3 || 0) + (r.sales_m4 || 0), 0);
  const avgSales4m = rows.length > 0 ? rows.reduce((s, r) => s + (r.avg_sales_4m || 0), 0) / rows.length : 0;
  // 预计周转月数：只统计月均销量>0的动销SKU，排除无销量SKU避免失真
  const activeSkus = rows.filter(r => (r.avg_sales_4m || 0) > 0);
  const activePool = activeSkus.reduce((s, r) => s + (r.total_inventory_pool || 0), 0);
  const activeAvgSales = activeSkus.reduce((s, r) => s + (r.avg_sales_4m || 0), 0);
  const overallTurnover = activeAvgSales > 0 ? activePool / activeAvgSales : 99;
  const needReplenish = rows.filter(r => (r.suggested_qty || 0) > 0 && (r.lifecycle_status || '') !== 'clearance').length;
  const stockoutRisk = rows.filter(r => (r.risk_level || '') === '严重缺货' || (r.risk_level || '') === '缺货风险').length;
  const highStock = rows.filter(r => (r.risk_level || '') === '库存偏高' || (r.sales_group || '') === '滞销').length;
  res.json({
    totalSkus, totalPool, totalSales4m,
    avgSales4m: Math.round(avgSales4m * 100) / 100,
    overallTurnover: Math.round(overallTurnover * 10) / 10,
    needReplenish, stockoutRisk, highStock
  });
});

// 按天销量明细
app.get('/api/replenishment-suggestions/daily-sales', requireApiPermission('replenishment_view'), (req, res) => {
  const { country, warehouse, brand, keyword } = req.query;
  // 取近30天每天的日期
  const now = new Date();
  const dates = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    dates.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }
  // 取所有补货建议的SKU列表
  let sql = `SELECT rs.*, s.product_name, s.brand, s.category, s.model, s.qty_per_carton FROM replenishment_suggestions rs LEFT JOIN skus s ON rs.sku_code = s.sku_code WHERE 1=1`;
  const params = [];
  if (country) { sql += ' AND rs.country = ?'; params.push(country); }
  if (warehouse) { sql += ' AND rs.target_warehouse = ?'; params.push(warehouse); }
  if (brand) { sql += ' AND s.brand = ?'; params.push(brand); }
  if (keyword) { sql += ' AND (rs.sku_code LIKE ? OR s.product_name LIKE ?)'; params.push(`%${keyword}%`, `%${keyword}%`); }
  sql += ' ORDER BY rs.sku_code';
  const skus = query(sql, params).rows;

  // 查近30天出库记录，按SKU+日期聚合
  const skuCodes = skus.map(s => s.sku_code);
  if (skuCodes.length === 0) { return res.json({ dates, skus: [] }); }
  const placeholders = skuCodes.map(() => '?').join(',');
  const startDate = dates[0];
  const endDate = dates[dates.length - 1];
  const isOnline = req.query.tab === 'online';
  const isOffline = req.query.tab === 'offline';
  let channelFilter = '';
  if (isOnline) { channelFilter = " AND (shop_platform LIKE '%线上%' OR lower(COALESCE(shop_platform, '')) = 'online')"; }
  else if (isOffline) { channelFilter = " AND (shop_platform LIKE '%线下%' OR lower(COALESCE(shop_platform, '')) = 'offline')"; }

  const salesDate = salesOrderDateExpr('order_date');
  const salesRows = query(
    `SELECT sku_code, ${salesDate} as normalized_order_date, SUM(quantity) as qty FROM sales_records WHERE sku_code IN (${placeholders}) AND ${salesDate} >= ? AND ${salesDate} <= ? AND is_valid_order = 1${channelFilter} GROUP BY sku_code, normalized_order_date`,
    [...skuCodes, startDate, endDate]
  ).rows;

  // 构建 SKU+date → qty 映射
  const salesMap = {};
  salesRows.forEach(r => {
    if (!salesMap[r.sku_code]) salesMap[r.sku_code] = {};
    salesMap[r.sku_code][r.normalized_order_date] = r.qty;
  });

  // 组装结果
  const result = skus.map(sku => {
    const dailyMap = salesMap[sku.sku_code] || {};
    const daily = dates.map(d => dailyMap[d] || 0);
    const last7 = daily.slice(-7).reduce((a, b) => a + b, 0);
    const last14 = daily.slice(-14).reduce((a, b) => a + b, 0);
    const last30 = daily.reduce((a, b) => a + b, 0);
    const avgDaily = Math.round((last30 / 30) * 100) / 100;
    // 销量趋势：近7天 vs 前7天
    const recent7 = daily.slice(-7).reduce((a, b) => a + b, 0);
    const prev7 = daily.slice(-14, -7).reduce((a, b) => a + b, 0);
    let trend = 'flat';
    if (recent7 > prev7 * 1.1) trend = 'up';
    else if (recent7 < prev7 * 0.9 && prev7 > 0) trend = 'down';
    else if (recent7 === 0 && prev7 === 0) trend = 'flat';
    return {
      ...sku,
      daily_sales: daily,
      last_7_days: last7,
      last_14_days: last14,
      last_30_days: last30,
      avg_daily_sales: avgDaily,
      trend
    };
  });

  res.json({ dates, skus: result });
});

app.get('/api/replenishment-suggestions', requireApiPermission('replenishment_view'), (req, res) => {
  const { country, warehouse, brand, keyword } = req.query;
  let sql = `SELECT rs.*, s.product_name, s.brand, s.category, s.model, s.standard_purchase_price, s.qty_per_carton, s.purchase_currency, i.last_inbound_date FROM replenishment_suggestions rs LEFT JOIN skus s ON rs.sku_code = s.sku_code LEFT JOIN inventory i ON rs.sku_code = i.sku_code AND rs.country = i.country AND rs.target_warehouse = i.warehouse WHERE 1=1`;
  const params = [];
  if (country) { sql += ' AND rs.country = ?'; params.push(country); }
  if (warehouse) { sql += ' AND rs.target_warehouse = ?'; params.push(warehouse); }
  if (brand) { sql += ' AND s.brand = ?'; params.push(brand); }
  if (keyword) { sql += ' AND (rs.sku_code LIKE ? OR s.product_name LIKE ?)'; params.push(`%${keyword}%`, `%${keyword}%`); }
  sql += ' ORDER BY rs.sku_code';
  const today = new Date();
  const todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
  const rows = query(sql, params).rows.map(r => {
    let daysSince = null;
    if (r.last_inbound_date) {
      const d = new Date(r.last_inbound_date);
      if (!isNaN(d.getTime())) {
        daysSince = Math.floor((today - d) / (1000 * 60 * 60 * 24));
      }
    }
    r.days_since_last_inbound = daysSince;
    return r;
  });
  res.json(rows);
});

// 生成/刷新补货建议
app.post('/api/replenishment-suggestions/generate', requireApiPermission('replenishment_edit'), (req, res) => {
  try {
    const { country, warehouse, brand } = req.body;
    const targetMonths = parseFloat(queryOne("SELECT value FROM system_config WHERE key = 'target_stock_months'")?.value || '4');
    const leadTimeMonths = parseFloat(queryOne("SELECT value FROM system_config WHERE key = 'lead_time_months'")?.value || '2');
    const brandTargetCfg = loadBrandTargetConfig(); // 品牌目标周转配置（Redragon=4,Netac=2,默认3）

    // 获取所有有库存记录的SKU
    let invSql = `SELECT DISTINCT i.sku_code, i.country, i.warehouse, i.available_qty, i.in_transit_qty, i.pi_confirmed_unshipped_qty, i.po_unconfirmed_pi_qty, i.last_inbound_date, i.first_inbound_date, i.target_turnover_months FROM inventory i LEFT JOIN skus s ON i.sku_code = s.sku_code WHERE 1=1`;
    const invParams = [];
    if (country) { invSql += ' AND i.country = ?'; invParams.push(country); }
    if (warehouse) { invSql += ' AND i.warehouse = ?'; invParams.push(warehouse); }
    if (brand) { invSql += ' AND s.brand = ?'; invParams.push(brand); }
    const inventoryItems = query(invSql, invParams).rows;

    const now = new Date();
    const salesDate = salesOrderDateExpr('order_date');

    // 计算近4个月的年月
    const months = [];
    for (let i = 0; i < 4; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        year: d.getFullYear(),
        month: String(d.getMonth() + 1).padStart(2, '0'),
        key: ['m1', 'm2', 'm3', 'm4'][i]
      });
    }

    transaction(() => {
      inventoryItems.forEach(inv => {
        const sku = queryOne('SELECT * FROM skus WHERE sku_code = ?', [inv.sku_code]);
        if (!sku) return;
        if (sku.status === 'stopped') return;

        // 计算近4个月销量（从销售明细表汇总，is_valid_order=1）
        const salesMap = {};
        const onlineSalesMap = {};
        const offlineSalesMap = {};
        months.forEach(m => {
          const startDate = `${m.year}-${m.month}-01`;
          const lastDay = new Date(m.year, parseInt(m.month), 0).getDate();
          const endDate = `${m.year}-${m.month}-${String(lastDay).padStart(2, '0')}`;
          const totalSales = queryOne(
            `SELECT COALESCE(SUM(quantity), 0) as cnt FROM sales_records WHERE sku_code = ? AND ${salesDate} >= ? AND ${salesDate} <= ? AND is_valid_order = 1`,
            [inv.sku_code, startDate, endDate]
          )?.cnt || 0;
          const onlineSales = queryOne(
            `SELECT COALESCE(SUM(quantity), 0) as cnt FROM sales_records WHERE sku_code = ? AND ${salesDate} >= ? AND ${salesDate} <= ? AND is_valid_order = 1 AND (shop_platform LIKE '%线上%' OR lower(COALESCE(shop_platform, '')) = 'online')`,
            [inv.sku_code, startDate, endDate]
          )?.cnt || 0;
          const offlineSales = queryOne(
            `SELECT COALESCE(SUM(quantity), 0) as cnt FROM sales_records WHERE sku_code = ? AND ${salesDate} >= ? AND ${salesDate} <= ? AND is_valid_order = 1 AND (shop_platform LIKE '%线下%' OR lower(COALESCE(shop_platform, '')) = 'offline')`,
            [inv.sku_code, startDate, endDate]
          )?.cnt || 0;
          onlineSalesMap[m.key] = onlineSales;
          offlineSalesMap[m.key] = offlineSales;
          salesMap[m.key] = totalSales;
        });

        const sales_m1 = salesMap.m1 || 0;
        const sales_m2 = salesMap.m2 || 0;
        const sales_m3 = salesMap.m3 || 0;
        const sales_m4 = salesMap.m4 || 0;
        const avg_sales_4m = (sales_m1 + sales_m2 + sales_m3 + sales_m4) / 4;

        // 线上/线下分月销量
        const online_sales_m1 = onlineSalesMap.m1 || 0;
        const online_sales_m2 = onlineSalesMap.m2 || 0;
        const online_sales_m3 = onlineSalesMap.m3 || 0;
        const online_sales_m4 = onlineSalesMap.m4 || 0;
        const online_avg_sales_4m = (online_sales_m1 + online_sales_m2 + online_sales_m3 + online_sales_m4) / 4;
        const offline_sales_m1 = offlineSalesMap.m1 || 0;
        const offline_sales_m2 = offlineSalesMap.m2 || 0;
        const offline_sales_m3 = offlineSalesMap.m3 || 0;
        const offline_sales_m4 = offlineSalesMap.m4 || 0;
        const offline_avg_sales_4m = (offline_sales_m1 + offline_sales_m2 + offline_sales_m3 + offline_sales_m4) / 4;

        const avail = inv.available_qty || 0;
        const transit = inv.in_transit_qty || 0;
        const piUnshipped = inv.pi_confirmed_unshipped_qty || 0;
        const poUnconfirmed = inv.po_unconfirmed_pi_qty || 0;
        // 总库存池 = 可用 + 在途 + PI已确认未发货 + PO未确认PI（用于参考总未来供应，避免重复下单）
        const total_inventory_pool = avail + transit + piUnshipped + poUnconfirmed;

        // 统一判定层所需指标
        const d30 = new Date(now.getTime() - 30 * 86400000).toISOString().split('T')[0];
        const d90 = new Date(now.getTime() - 90 * 86400000).toISOString().split('T')[0];
        const sales_30d = queryOne(`SELECT COALESCE(SUM(quantity), 0) as cnt FROM sales_records WHERE sku_code = ? AND ${salesDate} >= ? AND is_valid_order = 1`, [inv.sku_code, d30])?.cnt || 0;
        const sales_90d = queryOne(`SELECT COALESCE(SUM(quantity), 0) as cnt FROM sales_records WHERE sku_code = ? AND ${salesDate} >= ? AND is_valid_order = 1`, [inv.sku_code, d90])?.cnt || 0;
        const total_sales_ever = queryOne(`SELECT COALESCE(SUM(quantity), 0) as cnt FROM sales_records WHERE sku_code = ? AND is_valid_order = 1`, [inv.sku_code])?.cnt || 0;
        const first_sale_row = queryOne(`SELECT MIN(${salesDate}) as d FROM sales_records WHERE sku_code = ? AND is_valid_order = 1`, [inv.sku_code]);
        const first_sale_date = first_sale_row?.d || '';
        const last_inbound_date = inv.last_inbound_date || '';
        const first_inbound_date = inv.first_inbound_date || '';
        let days_since_last_inbound = null;
        if (last_inbound_date) {
          const ld = new Date(last_inbound_date);
          if (!isNaN(ld.getTime())) days_since_last_inbound = Math.floor((now - ld) / 86400000);
        }
        // 品牌目标周转：SKU手动 > 品牌默认 > 系统默认3
        const brand_target_months = getBrandTargetMonths(sku.brand, inv.target_turnover_months, brandTargetCfg);

        // 生命周期策略系数
        const lifecycle = sku.lifecycle_status || 'stable';
        const LIFECYCLE_COEFF = {
          'new_test': 0, 'new_launch': 0.5, 'growth': 0.8,
          'stable': 1.0, 'slow': 0.5, 'stagnant': 0,
          'clearance': 0, 'stopped': 0
        };
        const lifecycleCoeff = LIFECYCLE_COEFF[lifecycle] !== undefined ? LIFECYCLE_COEFF[lifecycle] : 1.0;

        // 当前周转（总月均=0时显示99，前端会处理为"无销量"）
        const current_turnover_months = avg_sales_4m > 0 ? total_inventory_pool / avg_sales_4m : 99;

        // 线上/线下目标周转月数（默认2，保留用户已设置的值）
        const existing_rs = queryOne('SELECT id, online_target_turnover, offline_target_turnover, other_target_stock, final_order_qty, user_adjusted_qty FROM replenishment_suggestions WHERE sku_code = ? AND country = ? AND target_warehouse = ?', [inv.sku_code, inv.country, inv.warehouse]);
        const online_target_turnover = (existing_rs && existing_rs.online_target_turnover != null && existing_rs.online_target_turnover > 0) ? existing_rs.online_target_turnover : brand_target_months;
        const offline_target_turnover = (existing_rs && existing_rs.offline_target_turnover != null && existing_rs.offline_target_turnover > 0) ? existing_rs.offline_target_turnover : brand_target_months;
        const other_target_stock = (existing_rs && existing_rs.other_target_stock != null) ? existing_rs.other_target_stock : 0;

        // 目标库存计算
        const online_target_stock = Math.round(online_avg_sales_4m * online_target_turnover);
        const offline_target_stock = Math.round(offline_avg_sales_4m * offline_target_turnover);
        const total_target_stock = online_target_stock + offline_target_stock + other_target_stock;

        // 系统建议补货 = MAX(总目标库存 - 总库存池, 0) × 生命周期系数
        const rawSuggested = Math.max(0, total_target_stock - total_inventory_pool);
        const suggested_qty = Math.round(rawSuggested * lifecycleCoeff);

        // MOQ和箱规修正
        const moqQty = (sku.qty_per_carton > 0 && suggested_qty > 0) ? Math.ceil(suggested_qty / sku.qty_per_carton) * sku.qty_per_carton : suggested_qty;

        // 最终下单数量（默认=系统建议补货，保留用户已设置的值）
        const final_order_qty = (existing_rs && existing_rs.final_order_qty != null && existing_rs.final_order_qty >= 0) ? existing_rs.final_order_qty : suggested_qty;

        // 订单后周转 = (总库存池 + 最终下单数量) ÷ 总月均
        const after_order_turnover_months = avg_sales_4m > 0 ? (total_inventory_pool + final_order_qty) / avg_sales_4m : 99;
        const onlineAfterOrder = online_avg_sales_4m > 0 ? (total_inventory_pool + final_order_qty) / online_avg_sales_4m : 99;
        const offlineAfterOrder = offline_avg_sales_4m > 0 ? (total_inventory_pool + final_order_qty) / offline_avg_sales_4m : 99;

        // 风险等级
        let risk_level = '';
        if (sku.status === 'clearance' || lifecycle === 'clearance') {
          risk_level = '清仓';
        } else if (lifecycle === 'stopped') {
          risk_level = '停产';
        } else if (avg_sales_4m === 0) {
          risk_level = '无销量';
        } else if (current_turnover_months < 1) {
          risk_level = '严重缺货';
        } else if (current_turnover_months < 2) {
          risk_level = '缺货风险';
        } else if (current_turnover_months > 6) {
          risk_level = '库存偏高';
        } else {
          risk_level = '正常';
        }

        // 预计到货月份
        const arrDate = new Date(now.getFullYear(), now.getMonth() + Math.ceil(leadTimeMonths), 1);
        const arrival_month = `${arrDate.getFullYear()}-${String(arrDate.getMonth() + 1).padStart(2, '0')}`;

        // 建议动作
        let suggestion = '';
        if (lifecycle === 'new_test') {
          suggestion = '新品导入，不直接生成PO';
        } else if (lifecycle === 'new_launch') {
          suggestion = suggested_qty > 0 ? `新品启动，建议备货 ${suggested_qty}` : '新品启动，库存观察中';
        } else if (lifecycle === 'stagnant') {
          suggestion = '滞销SKU，暂缓补货';
        } else if (lifecycle === 'clearance' || sku.status === 'clearance') {
          suggestion = '清仓中，不建议补货';
        } else if (lifecycle === 'stopped') {
          suggestion = '停采/停产，不参与补货建议';
        } else if (avg_sales_4m === 0) {
          suggestion = '无销量数据';
        } else if (suggested_qty > 0) {
          suggestion = `建议采购 ${suggested_qty}`;
        } else {
          suggestion = '库存充足';
        }

        // 动销分组
        let sales_group = '';
        if (avg_sales_4m === 0) sales_group = '滞销';
        else if (avg_sales_4m < 10) sales_group = '低动销';
        else if (avg_sales_4m < 50) sales_group = '中动销';
        else sales_group = '高动销';

        // 统一判断层：动销状态/风险标签/动销原因/建议动作/AI经营建议（不影响建议采购数量）
        const classifyResult = classifySkuState({
          lifecycle_status: lifecycle,
          is_new_product: sku.is_new_product,
          launch_date: sku.launch_date,
          first_inbound_date,
          first_sale_date,
          new_product_protection_days: sku.new_product_protection_days,
          available: avail,
          avg_sales_4m,
          sales_30d,
          sales_90d,
          total_sales_ever,
          days_since_last_inbound: days_since_last_inbound,
          last_inbound_date,
          target_months: brand_target_months
        });
        const sales_status = classifyResult.sales_status;
        const risk_tags = classifyResult.risk_tags.join(',');
        const sales_reason = classifyResult.sales_reason;
        const action_text = classifyResult.action;
        const ai_business_advice = classifyResult.ai_business_advice;

        if (existing_rs) {
          run(`UPDATE replenishment_suggestions SET
            available_qty=?, in_transit_qty=?, pi_confirmed_unshipped_qty=?, po_unconfirmed_pi_qty=?,
            total_inventory_pool=?, sales_m1=?, sales_m2=?, sales_m3=?, sales_m4=?, avg_sales_4m=?,
            online_sales_m1=?, online_sales_m2=?, online_sales_m3=?, online_sales_m4=?, online_avg_sales_4m=?,
            offline_sales_m1=?, offline_sales_m2=?, offline_sales_m3=?, offline_sales_m4=?, offline_avg_sales_4m=?,
            current_turnover_months=?, suggested_qty=?, moq_qty=?, carton_adjusted_qty=?,
            after_order_turnover_months=?, online_after_order_turnover_months=?, offline_after_order_turnover_months=?,
            target_stock_months=?, risk_level=?, arrival_month=?,
            suggestion=?, is_new_product=?, lifecycle_status=?, sales_group=?,
            online_target_turnover=?, offline_target_turnover=?,
            online_target_stock=?, offline_target_stock=?, other_target_stock=?,
            final_order_qty=?,
            sales_status=?, risk_tags=?, sales_reason=?, action=?, ai_business_advice=?
            WHERE id=?`,
            [avail, transit, piUnshipped, poUnconfirmed,
             total_inventory_pool, sales_m1, sales_m2, sales_m3, sales_m4, Math.round(avg_sales_4m * 100) / 100,
             online_sales_m1, online_sales_m2, online_sales_m3, online_sales_m4, Math.round(online_avg_sales_4m * 100) / 100,
             offline_sales_m1, offline_sales_m2, offline_sales_m3, offline_sales_m4, Math.round(offline_avg_sales_4m * 100) / 100,
             Math.round(current_turnover_months * 10) / 10, suggested_qty, moqQty, moqQty,
             Math.round(after_order_turnover_months * 10) / 10, Math.round(onlineAfterOrder * 10) / 10, Math.round(offlineAfterOrder * 10) / 10,
             targetMonths, risk_level, arrival_month,
             suggestion, sku.is_new_product === 1 ? 1 : 0, sku.lifecycle_status || '', sales_group,
             online_target_turnover, offline_target_turnover,
             online_target_stock, offline_target_stock, other_target_stock,
             final_order_qty,
             sales_status, risk_tags, sales_reason, action_text, ai_business_advice,
             existing_rs.id]);
        } else {
          const insertColumns = [
            'id', 'sku_code', 'country', 'target_warehouse', 'available_qty', 'in_transit_qty',
            'pi_confirmed_unshipped_qty', 'po_unconfirmed_pi_qty', 'total_inventory_pool',
            'sales_m1', 'sales_m2', 'sales_m3', 'sales_m4', 'avg_sales_4m',
            'online_sales_m1', 'online_sales_m2', 'online_sales_m3', 'online_sales_m4', 'online_avg_sales_4m',
            'offline_sales_m1', 'offline_sales_m2', 'offline_sales_m3', 'offline_sales_m4', 'offline_avg_sales_4m',
            'current_turnover_months', 'suggested_qty', 'moq_qty', 'carton_adjusted_qty',
            'after_order_turnover_months', 'online_after_order_turnover_months', 'offline_after_order_turnover_months',
            'target_stock_months', 'risk_level', 'arrival_month', 'suggestion',
            'is_new_product', 'lifecycle_status', 'sales_group', 'user_adjusted_qty', 'generate_po',
            'online_target_turnover', 'offline_target_turnover',
            'online_target_stock', 'offline_target_stock', 'other_target_stock', 'final_order_qty',
            'sales_status', 'risk_tags', 'sales_reason', 'action', 'ai_business_advice'
          ];
          const insertValues = [
            genId('rs'), inv.sku_code, inv.country, inv.warehouse, avail, transit,
            piUnshipped, poUnconfirmed, total_inventory_pool,
            sales_m1, sales_m2, sales_m3, sales_m4, Math.round(avg_sales_4m * 100) / 100,
            online_sales_m1, online_sales_m2, online_sales_m3, online_sales_m4, Math.round(online_avg_sales_4m * 100) / 100,
            offline_sales_m1, offline_sales_m2, offline_sales_m3, offline_sales_m4, Math.round(offline_avg_sales_4m * 100) / 100,
            Math.round(current_turnover_months * 10) / 10, suggested_qty, moqQty, moqQty,
            Math.round(after_order_turnover_months * 10) / 10, Math.round(onlineAfterOrder * 10) / 10, Math.round(offlineAfterOrder * 10) / 10,
            targetMonths, risk_level, arrival_month, suggestion,
            sku.is_new_product === 1 ? 1 : 0, sku.lifecycle_status || '', sales_group, -1, 0,
            online_target_turnover, offline_target_turnover,
            online_target_stock, offline_target_stock, other_target_stock, final_order_qty,
            sales_status, risk_tags, sales_reason, action_text, ai_business_advice
          ];
          run(
            `INSERT INTO replenishment_suggestions (${insertColumns.join(', ')}) VALUES (${insertValues.map(() => '?').join(', ')})`,
            insertValues
          );
        }
      });
    });

    res.json({ success: true, count: inventoryItems.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 更新补货建议（目标周转、最终下单数量、备注等）
app.put('/api/replenishment-suggestions/:id', requireApiPermission('replenishment_edit'), (req, res) => {
  try {
    const d = req.body;
    const fields = [];
    const values = [];

    // generate_po
    if (d.generate_po !== undefined) { fields.push('generate_po = ?'); values.push(parseInt(d.generate_po) || 0); }

    // 线上目标周转 → 重算线上目标库存 + 总目标库存 + 系统建议补货 + 订单后周转
    if (d.online_target_turnover !== undefined) {
      const rs = queryOne('SELECT online_avg_sales_4m, offline_avg_sales_4m, offline_target_stock, other_target_stock, total_inventory_pool, avg_sales_4m, lifecycle_status, final_order_qty FROM replenishment_suggestions WHERE id = ?', [req.params.id]);
      const onlineTurn = parseFloat(d.online_target_turnover) || 0;
      const onlineStock = Math.round((rs.online_avg_sales_4m || 0) * onlineTurn);
      const totalTarget = onlineStock + (rs.offline_target_stock || 0) + (rs.other_target_stock || 0);
      const pool = rs.total_inventory_pool || 0;
      const lifecycle = rs.lifecycle_status || 'stable';
      const LIFECYCLE_COEFF = {'new_test':0,'new_launch':0.5,'growth':0.8,'stable':1.0,'slow':0.5,'stagnant':0,'clearance':0,'stopped':0};
      const coeff = LIFECYCLE_COEFF[lifecycle] !== undefined ? LIFECYCLE_COEFF[lifecycle] : 1.0;
      const rawSuggested = Math.max(0, totalTarget - pool);
      const suggestedQty = Math.round(rawSuggested * coeff);
      const foq = (rs.final_order_qty != null && rs.final_order_qty >= 0) ? rs.final_order_qty : suggestedQty;
      const afterOrder = (rs.avg_sales_4m || 0) > 0 ? (pool + foq) / rs.avg_sales_4m : 99;
      fields.push('online_target_turnover = ?', 'online_target_stock = ?', 'suggested_qty = ?', 'after_order_turnover_months = ?');
      values.push(onlineTurn, onlineStock, suggestedQty, Math.round(afterOrder * 10) / 10);
    }

    // 线下目标周转 → 重算线下目标库存 + 总目标库存 + 系统建议补货 + 订单后周转
    if (d.offline_target_turnover !== undefined) {
      const rs = queryOne('SELECT offline_avg_sales_4m, online_avg_sales_4m, online_target_stock, other_target_stock, total_inventory_pool, avg_sales_4m, lifecycle_status, final_order_qty FROM replenishment_suggestions WHERE id = ?', [req.params.id]);
      const offlineTurn = parseFloat(d.offline_target_turnover) || 0;
      const offlineStock = Math.round((rs.offline_avg_sales_4m || 0) * offlineTurn);
      const totalTarget = (rs.online_target_stock || 0) + offlineStock + (rs.other_target_stock || 0);
      const pool = rs.total_inventory_pool || 0;
      const lifecycle = rs.lifecycle_status || 'stable';
      const LIFECYCLE_COEFF = {'new_test':0,'new_launch':0.5,'growth':0.8,'stable':1.0,'slow':0.5,'stagnant':0,'clearance':0,'stopped':0};
      const coeff = LIFECYCLE_COEFF[lifecycle] !== undefined ? LIFECYCLE_COEFF[lifecycle] : 1.0;
      const rawSuggested = Math.max(0, totalTarget - pool);
      const suggestedQty = Math.round(rawSuggested * coeff);
      const foq = (rs.final_order_qty != null && rs.final_order_qty >= 0) ? rs.final_order_qty : suggestedQty;
      const afterOrder = (rs.avg_sales_4m || 0) > 0 ? (pool + foq) / rs.avg_sales_4m : 99;
      fields.push('offline_target_turnover = ?', 'offline_target_stock = ?', 'suggested_qty = ?', 'after_order_turnover_months = ?');
      values.push(offlineTurn, offlineStock, suggestedQty, Math.round(afterOrder * 10) / 10);
    }

    // 最终下单数量 → 重算订单后周转
    if (d.final_order_qty !== undefined) {
      const rs = queryOne('SELECT total_inventory_pool, avg_sales_4m, online_avg_sales_4m, offline_avg_sales_4m FROM replenishment_suggestions WHERE id = ?', [req.params.id]);
      const foq = parseInt(d.final_order_qty) || 0;
      const pool = rs.total_inventory_pool || 0;
      const afterOrder = (rs.avg_sales_4m || 0) > 0 ? (pool + foq) / rs.avg_sales_4m : 99;
      const onlineAfter = (rs.online_avg_sales_4m || 0) > 0 ? (pool + foq) / rs.online_avg_sales_4m : 99;
      const offlineAfter = (rs.offline_avg_sales_4m || 0) > 0 ? (pool + foq) / rs.offline_avg_sales_4m : 99;
      fields.push('final_order_qty = ?', 'after_order_turnover_months = ?', 'online_after_order_turnover_months = ?', 'offline_after_order_turnover_months = ?');
      values.push(foq, Math.round(afterOrder * 10) / 10, Math.round(onlineAfter * 10) / 10, Math.round(offlineAfter * 10) / 10);
    }

    // 调整原因
    if (d.adjustment_reason !== undefined) {
      fields.push('adjustment_reason = ?');
      values.push(d.adjustment_reason);
    }

    // 备注
    if (d.online_remark !== undefined) { fields.push('online_remark = ?'); values.push(d.online_remark); }
    if (d.offline_remark !== undefined) { fields.push('offline_remark = ?'); values.push(d.offline_remark); }

    if (fields.length === 0) return res.json({ success: true });
    values.push(req.params.id);
    run(`UPDATE replenishment_suggestions SET ${fields.join(', ')} WHERE id = ?`, values);
    const updated = queryOne('SELECT * FROM replenishment_suggestions WHERE id = ?', [req.params.id]);
    res.json({ success: true, data: updated });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== PO 管理 ====================
app.get('/api/purchase-orders', requireApiPermission('po_view'), (req, res) => {
  const { status, keyword, supplier_id } = req.query;
  let sql = `SELECT po.*, (SELECT COUNT(*) FROM purchase_order_items WHERE po_id = po.id) as item_count FROM purchase_orders po WHERE 1=1`;
  const params = [];
  if (status) { sql += ' AND po.po_status = ?'; params.push(status); }
  if (supplier_id) { sql += ' AND po.supplier_id = ?'; params.push(supplier_id); }
  if (keyword) { sql += ' AND (po.po_no LIKE ? OR po.supplier_name LIKE ? OR po.brand LIKE ?)'; params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`); }
  sql += ' ORDER BY po.created_at DESC';
  res.json(query(sql, params).rows);
});

app.get('/api/purchase-orders/:id', requireApiPermission('po_view'), (req, res) => {
  const po = queryOne('SELECT * FROM purchase_orders WHERE id = ?', [req.params.id]);
  if (!po) return res.status(404).json({ error: 'PO不存在' });
  const items = query('SELECT * FROM purchase_order_items WHERE po_id = ? ORDER BY created_at', [req.params.id]).rows;
  res.json({ ...po, items });
});

app.post('/api/purchase-orders', requireApiPermission('po_create'), (req, res) => {
  try {
    const d = req.body;
    if (!d.supplier_name) return res.status(400).json({ error: '供应商不能为空' });
    const poId = genId('po');
    const poNo = d.po_no || `PO-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
    let totalAmount = 0;

    transaction(() => {
      run(`INSERT INTO purchase_orders (id, po_no, supplier_id, supplier_name, brand, country, target_warehouse, po_date, expected_delivery, currency, total_amount, created_by, created_by_name, po_status, approval_status, from_suggestion, remark) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [poId, poNo, d.supplier_id || '', d.supplier_name, d.brand || '', d.country || '', d.target_warehouse || '', d.po_date || new Date().toISOString().split('T')[0], d.expected_delivery || '', d.currency || 'USD', 0, d.created_by || '', d.created_by_name || '', 'draft', 'pending', d.from_suggestion || 0, d.remark || '']);

      if (d.items && d.items.length > 0) {
        d.items.forEach(item => {
          const amount = 0;
          run(`INSERT INTO purchase_order_items (id, po_id, po_no, sku_code, po_qty, unit_price, po_amount, transferred_pi_qty, untransferred_pi_qty, forecast_turnover_months, remark) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [genId('poi'), poId, poNo, item.sku_code, item.po_qty || 0, 0, amount, 0, item.po_qty || 0, item.forecast_turnover_months || 0, item.remark || '']);
        });
        run('UPDATE purchase_orders SET total_amount = ? WHERE id = ?', [totalAmount, poId]);
      }
    });
    res.json({ id: poId, po_no: poNo, ...d, total_amount: totalAmount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/purchase-orders/:id', requireApiPermission('po_create'), (req, res) => {
  try {
    const d = req.body;
    const { id } = req.params;
    const fields = [];
    const values = [];
    ['supplier_id', 'supplier_name', 'brand', 'country', 'target_warehouse', 'expected_delivery', 'currency', 'remark'].forEach(f => {
      if (d[f] !== undefined) { fields.push(`${f} = ?`); values.push(d[f]); }
    });
    fields.push(`updated_at = datetime('now')`);
    values.push(id);
    run(`UPDATE purchase_orders SET ${fields.join(', ')} WHERE id = ?`, values);

    if (d.items) {
      run('DELETE FROM purchase_order_items WHERE po_id = ?', [id]);
      let totalAmount = 0;
      d.items.forEach(item => {
        const amount = 0;
        run(`INSERT INTO purchase_order_items (id, po_id, po_no, sku_code, po_qty, unit_price, po_amount, transferred_pi_qty, untransferred_pi_qty, forecast_turnover_months, remark) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [genId('poi'), id, d.po_no || '', item.sku_code, item.po_qty || 0, 0, amount, item.transferred_pi_qty || 0, (item.po_qty || 0) - (item.transferred_pi_qty || 0), item.forecast_turnover_months || 0, item.remark || '']);
      });
      run('UPDATE purchase_orders SET total_amount = ? WHERE id = ?', [totalAmount, id]);
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/purchase-orders/:id', requireApiPermission('po_create'), (req, res) => {
  transaction(() => {
    run('DELETE FROM purchase_order_items WHERE po_id = ?', [req.params.id]);
    run('DELETE FROM purchase_orders WHERE id = ?', [req.params.id]);
  });
  res.json({ success: true });
});

// PO 提交审批
app.post('/api/purchase-orders/:id/submit-approval', requireApiPermission('po_create'), (req, res) => {
  try {
    const po = queryOne('SELECT * FROM purchase_orders WHERE id = ?', [req.params.id]);
    if (!po) return res.status(404).json({ error: 'PO不存在' });
    if (po.po_status !== 'draft') return res.status(400).json({ error: '只有草稿状态才能提交审批' });

    const approverId = req.body.approver_id || req.currentUserId;
    const approverName = req.body.approver_name || '';
    const user = queryOne('SELECT name FROM users WHERE id = ?', [approverId]);
    const finalApproverName = approverName || (user ? user.name : '');

    const approvalId = genId('appr');
    run(`INSERT INTO approval_records (id, business_type, business_id, business_code, submitter_id, submitter_name, current_level, max_level, approvers, approval_history, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [approvalId, 'po', req.params.id, po.po_no, req.currentUserId, req.body.submitter_name || '', 1, 2, JSON.stringify([{ level: 1, approver_id: approverId, approver_name: finalApproverName }]), JSON.stringify([{ level: 0, action: 'submit', user_id: req.currentUserId, user_name: req.body.submitter_name || '', time: new Date().toISOString(), remark: '提交审批' }]), 'pending']);

    run(`UPDATE purchase_orders SET po_status = ?, approval_status = ? WHERE id = ?`, ['pending_approval', 'pending', req.params.id]);
    res.json({ success: true, approval_id: approvalId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PO 审批操作
app.post('/api/purchase-orders/:id/approve', requireApiPermission('po_approve'), (req, res) => {
  try {
    const { action, remark } = req.body; // action: approve / reject / withdraw
    const po = queryOne('SELECT * FROM purchase_orders WHERE id = ?', [req.params.id]);
    if (!po) return res.status(404).json({ error: 'PO不存在' });

    const approval = queryOne('SELECT * FROM approval_records WHERE business_id = ? AND business_type = ? ORDER BY created_at DESC LIMIT 1', [req.params.id, 'po']);
    if (!approval) return res.status(400).json({ error: '未找到审批记录' });

    const history = JSON.parse(approval.approval_history || '[]');
    const user = queryOne('SELECT name FROM users WHERE id = ?', [req.currentUserId]);
    const userName = user ? user.name : '';

    if (action === 'approve') {
      const nextLevel = (approval.current_level || 1) + 1;
      if (nextLevel > approval.max_level) {
        // 最终审批通过
        history.push({ level: approval.current_level, action: 'approve', user_id: req.currentUserId, user_name: userName, time: new Date().toISOString(), remark: remark || '' });
        run('UPDATE approval_records SET status = ?, approval_history = ?, updated_at = datetime(\'now\') WHERE id = ?', ['approved', JSON.stringify(history), approval.id]);
        run('UPDATE purchase_orders SET po_status = ?, approval_status = ? WHERE id = ?', ['approved', 'approved', req.params.id]);
      } else {
        history.push({ level: approval.current_level, action: 'approve', user_id: req.currentUserId, user_name: userName, time: new Date().toISOString(), remark: remark || '' });
        run('UPDATE approval_records SET current_level = ?, approval_history = ?, updated_at = datetime(\'now\') WHERE id = ?', [nextLevel, JSON.stringify(history), approval.id]);
      }
    } else if (action === 'reject') {
      history.push({ level: approval.current_level, action: 'reject', user_id: req.currentUserId, user_name: userName, time: new Date().toISOString(), remark: remark || '' });
      run('UPDATE approval_records SET status = ?, approval_history = ?, updated_at = datetime(\'now\') WHERE id = ?', ['rejected', JSON.stringify(history), approval.id]);
      run('UPDATE purchase_orders SET po_status = ?, approval_status = ? WHERE id = ?', ['draft', 'rejected', req.params.id]);
    } else if (action === 'withdraw') {
      history.push({ level: 0, action: 'withdraw', user_id: req.currentUserId, user_name: userName, time: new Date().toISOString(), remark: remark || '' });
      run('UPDATE approval_records SET status = ?, approval_history = ?, updated_at = datetime(\'now\') WHERE id = ?', ['withdrawn', JSON.stringify(history), approval.id]);
      run('UPDATE purchase_orders SET po_status = ?, approval_status = ? WHERE id = ?', ['draft', 'pending', req.params.id]);
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PO 标记为已发工厂
app.post('/api/purchase-orders/:id/send-to-factory', requireApiPermission('po_create'), (req, res) => {
  run('UPDATE purchase_orders SET po_status = ? WHERE id = ? AND po_status = ?', ['sent_factory', req.params.id, 'approved']);
  res.json({ success: true });
});

function n(v, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function s(v) {
  return String(v === undefined || v === null ? '' : v).trim();
}

function pick(row, names) {
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== null && String(row[name]).trim() !== '') return row[name];
  }
  return '';
}

function skuExists(sku) {
  return !!queryOne('SELECT id FROM skus WHERE sku_code = ?', [sku]);
}

function parseAttachment(value) {
  if (!value) return '';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

// ==================== PI 管理 ====================
app.get('/api/proforma-invoices', requireApiPermission('pi_view'), (req, res) => {
  const { status, keyword, related_po } = req.query;
  let sql = 'SELECT * FROM proforma_invoices WHERE 1=1';
  const params = [];
  if (status) { sql += ' AND pi_status = ?'; params.push(status); }
  if (related_po) { sql += ' AND related_po_no = ?'; params.push(related_po); }
  if (keyword) { sql += ' AND (pi_no LIKE ? OR supplier_name LIKE ?)'; params.push(`%${keyword}%`, `%${keyword}%`); }
  sql += ' ORDER BY created_at DESC';
  res.json(query(sql, params).rows);
});

app.get('/api/proforma-invoices/:id', requireApiPermission('pi_view'), (req, res) => {
  const pi = queryOne('SELECT * FROM proforma_invoices WHERE id = ?', [req.params.id]);
  if (!pi) return res.status(404).json({ error: 'PI不存在' });
  const items = query('SELECT * FROM proforma_invoice_items WHERE pi_id = ? ORDER BY created_at', [req.params.id]).rows;
  res.json({ ...pi, items });
});

app.post('/api/proforma-invoices', requireApiPermission('pi_create'), (req, res) => {
  try {
    const d = req.body;
    if (!d.supplier_name) return res.status(400).json({ error: '供应商不能为空' });
    const piId = genId('pi');
    const piNo = d.pi_no || `PI-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
    let totalAmount = 0;
    const needDeposit = d.need_deposit === false || d.need_deposit === 0 || d.need_deposit === '0' ? 0 : 1;
    const depositRatio = needDeposit ? n(d.deposit_ratio, 0) : 0;

    transaction(() => {
      run(`INSERT INTO proforma_invoices (id, pi_no, related_po_id, related_po_no, supplier_id, supplier_name, brand, country, target_warehouse, pi_date, currency, total_amount, payment_terms, need_deposit, deposit_ratio, balance_ratio, payable_deposit, pi_status, expected_delivery, attachment, remark) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [piId, piNo, d.related_po_id || '', d.related_po_no || '', d.supplier_id || '', d.supplier_name, d.brand || '', d.country || '', d.target_warehouse || '', d.pi_date || new Date().toISOString().split('T')[0], d.currency || 'USD', 0, d.payment_terms || '', needDeposit, depositRatio, 100 - depositRatio, 0, d.pi_status || 'pending', d.expected_delivery || '', parseAttachment(d.attachment), d.remark || '']);

      if (d.items && d.items.length > 0) {
        d.items.forEach(item => {
          const amount = (item.pi_confirmed_qty || 0) * (item.unit_price || 0);
          totalAmount += amount;
          run(`INSERT INTO proforma_invoice_items (id, pi_id, pi_no, po_no, sku_code, po_qty, pi_confirmed_qty, unit_price, pi_amount, shipped_qty, unshipped_qty) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [genId('pii'), piId, piNo, item.po_no || d.related_po_no || '', item.sku_code, item.po_qty || 0, item.pi_confirmed_qty || 0, item.unit_price || 0, amount, 0, item.pi_confirmed_qty || 0]);

          // 更新PO明细的已转PI数量
          if (d.related_po_id) {
            const poItem = queryOne('SELECT id, po_qty, transferred_pi_qty FROM purchase_order_items WHERE po_id = ? AND sku_code = ?', [d.related_po_id, item.sku_code]);
            if (poItem) {
              const newTransferred = (poItem.transferred_pi_qty || 0) + (item.pi_confirmed_qty || 0);
              run('UPDATE purchase_order_items SET transferred_pi_qty = ?, untransferred_pi_qty = ? WHERE id = ?',
                [newTransferred, (poItem.po_qty || 0) - newTransferred, poItem.id]);
            }
          }
        });
        const payableDeposit = needDeposit ? totalAmount * depositRatio / 100 : 0;
        run('UPDATE proforma_invoices SET total_amount = ?, payable_deposit = ?, available_deduct_deposit = ? WHERE id = ?', [totalAmount, payableDeposit, payableDeposit, piId]);

        // 更新PO状态
        if (d.related_po_id) {
          const poItems = query('SELECT po_qty, transferred_pi_qty FROM purchase_order_items WHERE po_id = ?', [d.related_po_id]).rows;
          const allTransferred = poItems.every(i => i.transferred_pi_qty >= i.po_qty);
          const anyTransferred = poItems.some(i => i.transferred_pi_qty > 0);
          if (allTransferred) {
            run('UPDATE purchase_orders SET po_status = ? WHERE id = ?', ['transferred_pi', d.related_po_id]);
          } else if (anyTransferred) {
            run('UPDATE purchase_orders SET po_status = ? WHERE id = ?', ['partial_pi', d.related_po_id]);
          }
        }

        // 更新库存的PI未发货数量
        updateInventoryTransitData();
      }
    });
    const payableDeposit = (d.items && d.items.length > 0) ? (needDeposit ? totalAmount * depositRatio / 100 : 0) : 0;
    res.json({ id: piId, pi_no: piNo, ...d, total_amount: totalAmount, need_deposit: needDeposit, deposit_ratio: depositRatio, payable_deposit: payableDeposit });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/proforma-invoices/:id', requireApiPermission('pi_edit'), (req, res) => {
  try {
    const d = req.body;
    const { id } = req.params;
    const fields = [];
    const values = [];
    ['payment_terms', 'need_deposit', 'deposit_ratio', 'balance_ratio', 'pi_status', 'expected_delivery', 'attachment', 'remark'].forEach(f => {
      if (d[f] !== undefined) { fields.push(`${f} = ?`); values.push(d[f]); }
    });

    // 重新计算应付定金
    if (d.deposit_ratio !== undefined || d.need_deposit !== undefined) {
      const pi = queryOne('SELECT total_amount FROM proforma_invoices WHERE id = ?', [id]);
      if (pi) {
        const needDeposit = d.need_deposit === false || d.need_deposit === 0 || d.need_deposit === '0' ? 0 : 1;
        const ratio = needDeposit ? n(d.deposit_ratio, 0) : 0;
        const payableDeposit = needDeposit ? pi.total_amount * ratio / 100 : 0;
        fields.push('payable_deposit = ?', 'available_deduct_deposit = ?');
        values.push(payableDeposit, payableDeposit);
      }
    }
    fields.push(`updated_at = datetime('now')`);
    values.push(id);
    run(`UPDATE proforma_invoices SET ${fields.join(', ')} WHERE id = ?`, values);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/proforma-invoices/:id/attachment', requireApiPermission('pi_edit'), (req, res) => {
  try {
    run('UPDATE proforma_invoices SET attachment = ?, pi_status = ?, updated_at = datetime(\'now\') WHERE id = ?', [parseAttachment(req.body.attachment), req.body.attachment ? 'uploaded' : 'pending', req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== CI/PL 管理 ====================
app.get('/api/commercial-invoices', requireApiPermission('ci_view'), (req, res) => {
  const { status, keyword, related_pi } = req.query;
  let sql = 'SELECT * FROM commercial_invoices WHERE 1=1';
  const params = [];
  if (status) { sql += ' AND ci_status = ?'; params.push(status); }
  if (related_pi) { sql += ' AND related_pi_no = ?'; params.push(related_pi); }
  if (keyword) { sql += ' AND (ci_no LIKE ? OR supplier_name LIKE ?)'; params.push(`%${keyword}%`, `%${keyword}%`); }
  sql += ' ORDER BY created_at DESC';
  res.json(query(sql, params).rows);
});

app.get('/api/commercial-invoices/:id', requireApiPermission('ci_view'), (req, res) => {
  const ci = queryOne('SELECT * FROM commercial_invoices WHERE id = ?', [req.params.id]);
  if (!ci) return res.status(404).json({ error: 'CI不存在' });
  const items = query('SELECT * FROM commercial_invoice_items WHERE ci_id = ? ORDER BY created_at', [req.params.id]).rows;
  const pl = queryOne('SELECT * FROM packing_lists WHERE related_ci_id = ?', [req.params.id]);
  const plItems = pl ? query('SELECT * FROM packing_list_items WHERE pl_id = ? ORDER BY created_at', [pl.id]).rows : [];
  const ciQtyBySku = {};
  items.forEach(i => { ciQtyBySku[i.sku_code] = (ciQtyBySku[i.sku_code] || 0) + (i.shipped_qty || 0); });
  const plQtyBySku = {};
  plItems.forEach(i => { plQtyBySku[i.sku_code] = (plQtyBySku[i.sku_code] || 0) + (i.total_qty || 0); });
  const checkSkus = [...new Set(Object.keys(ciQtyBySku).concat(Object.keys(plQtyBySku)))];
  const pl_check = checkSkus.map(sku => ({ sku_code: sku, ci_qty: ciQtyBySku[sku] || 0, pl_qty: plQtyBySku[sku] || 0, diff_qty: (plQtyBySku[sku] || 0) - (ciQtyBySku[sku] || 0) }));
  res.json({ ...ci, items, packing_list: pl ? { ...pl, items: plItems } : null, pl_check });
});

app.post('/api/commercial-invoices', requireApiPermission('ci_create'), (req, res) => {
  try {
    const d = req.body;
    if (!d.supplier_name) return res.status(400).json({ error: '供应商不能为空' });
    const ciId = genId('ci');
    const ciNo = d.ci_no || `CI-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
    let goodsAmount = 0;
    const pi = d.related_pi_id ? queryOne('SELECT * FROM proforma_invoices WHERE id = ?', [d.related_pi_id]) : null;
    const relatedPoId = d.related_po_id || (pi ? pi.related_po_id : '');
    const relatedPoNo = d.related_po_no || (pi ? pi.related_po_no : '');
    const piTotalAmount = pi ? (pi.total_amount || 0) : 0;

    transaction(() => {
      run(`INSERT INTO commercial_invoices (id, ci_no, related_po_id, related_po_no, related_pi_id, related_pi_no, supplier_id, supplier_name, brand, country, target_warehouse, ci_date, shipment_batch, currency, goods_amount, pi_total_amount, amount_difference, difference_reason, ci_status, attachment, pl_attachment, remark) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [ciId, ciNo, relatedPoId || '', relatedPoNo || '', d.related_pi_id || '', d.related_pi_no || '', d.supplier_id || '', d.supplier_name, d.brand || (pi ? pi.brand : ''), d.country || (pi ? pi.country : ''), d.target_warehouse || (pi ? pi.target_warehouse : ''), d.ci_date || new Date().toISOString().split('T')[0], d.shipment_batch || 1, d.currency || 'USD', 0, piTotalAmount, 0, d.difference_reason || '', d.ci_status || 'uploaded', parseAttachment(d.attachment), parseAttachment(d.pl_attachment), d.remark || '']);

      if (d.items && d.items.length > 0) {
        d.items.forEach(item => {
          const amount = (item.shipped_qty || 0) * (item.unit_price || 0);
          goodsAmount += amount;
          run(`INSERT INTO commercial_invoice_items (id, ci_id, ci_no, pi_no, sku_code, shipped_qty, unit_price, ci_amount, inbound_qty, uninbound_qty) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [genId('cii'), ciId, ciNo, item.pi_no || d.related_pi_no || '', item.sku_code, item.shipped_qty || 0, item.unit_price || 0, amount, 0, item.shipped_qty || 0]);

          // 更新PI明细的已发货数量
          if (d.related_pi_id) {
            const piItem = queryOne('SELECT id, pi_confirmed_qty, shipped_qty FROM proforma_invoice_items WHERE pi_id = ? AND sku_code = ?', [d.related_pi_id, item.sku_code]);
            if (piItem) {
              const newShipped = (piItem.shipped_qty || 0) + (item.shipped_qty || 0);
              run('UPDATE proforma_invoice_items SET shipped_qty = ?, unshipped_qty = ? WHERE id = ?',
                [newShipped, (piItem.pi_confirmed_qty || 0) - newShipped, piItem.id]);
            }
          }
        });
        const amountDifference = goodsAmount - piTotalAmount;
        run('UPDATE commercial_invoices SET goods_amount = ?, amount_difference = ? WHERE id = ?', [goodsAmount, amountDifference, ciId]);

        // 尾款以CI金额为准；如果PI不需要定金，尾款=CI总金额。
        if (pi) {
          const shouldDeduct = pi.need_deposit ? Math.min(pi.payable_deposit || 0, pi.available_deduct_deposit || 0, goodsAmount) : 0;
          const payableBalance = goodsAmount - shouldDeduct;
          run('UPDATE commercial_invoices SET should_deduct_deposit = ?, actual_deducted_deposit = ?, payable_balance = ?, unpaid_balance = ? WHERE id = ?',
            [shouldDeduct, shouldDeduct, payableBalance, payableBalance, ciId]);

          // 更新PI的已抵扣定金和已发货金额
          const newDeducted = (pi.deducted_deposit || 0) + shouldDeduct;
          const newAvailable = Math.max(0, (pi.payable_deposit || 0) - newDeducted);
          const newShippedAmount = (pi.shipped_amount || 0) + goodsAmount;
          const newUnshippedAmount = (pi.total_amount || 0) - newShippedAmount;
          run('UPDATE proforma_invoices SET deducted_deposit = ?, available_deduct_deposit = ?, shipped_amount = ?, unshipped_amount = ? WHERE id = ?',
            [newDeducted, newAvailable, newShippedAmount, newUnshippedAmount, d.related_pi_id]);
        } else {
          run('UPDATE commercial_invoices SET payable_balance = ?, unpaid_balance = ? WHERE id = ?', [goodsAmount, goodsAmount, ciId]);
        }

        // 更新PI状态
        if (d.related_pi_id) {
          const piItems = query('SELECT pi_confirmed_qty, shipped_qty FROM proforma_invoice_items WHERE pi_id = ?', [d.related_pi_id]).rows;
          const allShipped = piItems.every(i => i.shipped_qty >= i.pi_confirmed_qty);
          const anyShipped = piItems.some(i => i.shipped_qty > 0);
          if (allShipped) {
            run('UPDATE proforma_invoices SET pi_status = ? WHERE id = ?', ['shipped_complete', d.related_pi_id]);
          } else if (anyShipped) {
            run('UPDATE proforma_invoices SET pi_status = ? WHERE id = ?', ['partial_shipped', d.related_pi_id]);
          }
        }

        // 更新库存的在途数据
        updateInventoryTransitData();
      }
    });
    const shouldDeductResp = pi ? (pi.need_deposit ? Math.min(pi.payable_deposit || 0, pi.available_deduct_deposit || 0, goodsAmount) : 0) : 0;
    const payableBalanceResp = goodsAmount - shouldDeductResp;
    const piTotalResp = piTotalAmount;
    const amountDiffResp = goodsAmount - piTotalResp;
    res.json({ id: ciId, ci_no: ciNo, ...d, goods_amount: goodsAmount, pi_total_amount: piTotalResp, amount_difference: amountDiffResp, should_deduct_deposit: shouldDeductResp, payable_balance: payableBalanceResp });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/commercial-invoices/:id/attachment', requireApiPermission('ci_edit'), (req, res) => {
  try {
    const field = req.body.field === 'pl_attachment' ? 'pl_attachment' : 'attachment';
    run(`UPDATE commercial_invoices SET ${field} = ?, ci_status = ?, updated_at = datetime('now') WHERE id = ?`, [parseAttachment(req.body.attachment), req.body.attachment ? 'uploaded' : 'draft', req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== PL 管理 ====================
app.post('/api/packing-lists', requireApiPermission('ci_create'), (req, res) => {
  try {
    const d = req.body;
    const plId = genId('pl');
    const plNo = d.pl_no || `PL-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
    let totalCartons = 0, totalQtyAll = 0, totalGross = 0, totalNet = 0, totalCbm = 0;
    const ci = d.related_ci_id ? queryOne('SELECT * FROM commercial_invoices WHERE id = ?', [d.related_ci_id]) : null;

    transaction(() => {
      run(`INSERT INTO packing_lists (id, pl_no, related_po_id, related_po_no, related_pi_id, related_pi_no, related_ci_id, related_ci_no, supplier_id, supplier_name, brand, country, target_warehouse, pl_date, total_qty, total_cartons, total_gross_weight, total_net_weight, total_cbm, attachment, remark) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [plId, plNo, d.related_po_id || (ci ? ci.related_po_id : ''), d.related_po_no || (ci ? ci.related_po_no : ''), d.related_pi_id || (ci ? ci.related_pi_id : ''), d.related_pi_no || (ci ? ci.related_pi_no : ''), d.related_ci_id || '', d.related_ci_no || '', d.supplier_id || (ci ? ci.supplier_id : ''), d.supplier_name || (ci ? ci.supplier_name : ''), d.brand || (ci ? ci.brand : ''), d.country || (ci ? ci.country : ''), d.target_warehouse || (ci ? ci.target_warehouse : ''), d.pl_date || new Date().toISOString().split('T')[0], 0, 0, 0, 0, 0, parseAttachment(d.attachment), d.remark || '']);

      if (d.items && d.items.length > 0) {
        d.items.forEach(item => {
          const cartons = item.cartons || 0;
          const qtyPerCarton = item.qty_per_carton || 0;
          const totalQty = cartons * qtyPerCarton;
          const grossW = item.gross_weight || 0;
          const netW = item.net_weight || 0;
          const cbm = item.cbm || 0;
          totalCartons += cartons;
          totalQtyAll += totalQty;
          totalGross += grossW;
          totalNet += netW;
          totalCbm += cbm;
          run(`INSERT INTO packing_list_items (id, pl_id, pl_no, ci_no, sku_code, cartons, qty_per_carton, total_qty, gross_weight, net_weight, cbm, remark) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [genId('pli'), plId, plNo, d.related_ci_no || '', item.sku_code, cartons, qtyPerCarton, totalQty, grossW, netW, cbm, item.remark || '']);
        });
        run('UPDATE packing_lists SET total_qty = ?, total_cartons = ?, total_gross_weight = ?, total_net_weight = ?, total_cbm = ? WHERE id = ?',
          [totalQtyAll, totalCartons, totalGross, totalNet, totalCbm, plId]);
        if (d.related_ci_id) run('UPDATE commercial_invoices SET ci_status = ? WHERE id = ?', ['ci_pl_uploaded', d.related_ci_id]);
      }
    });
    res.json({ id: plId, pl_no: plNo, ...d, total_qty: totalQtyAll, total_cartons: totalCartons, total_gross_weight: totalGross, total_net_weight: totalNet, total_cbm: totalCbm });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

function importResultWithMessages(result) {
  result.messages = [];
  if (result.errors.some(e => String(e.reason || '').includes('SKU不存在'))) result.messages.push('部分 SKU 不存在，请先维护 SKU 或检查导入文件。');
  if (result.errors.some(e => String(e.reason || '').includes('无法匹配PO'))) result.messages.push('部分数据无法匹配 PO，请检查 PO 编号。');
  if (result.errors.some(e => String(e.reason || '').includes('无法匹配CI'))) result.messages.push('部分数据无法匹配 CI，请检查 CI 编号。');
  return result;
}

app.post('/api/proforma-invoices/batch-import', requireApiPermission('pi_create'), (req, res) => {
  try {
    const rows = Array.isArray(req.body.items) ? req.body.items : [];
    const result = { success: 0, failed: 0, total: rows.length, errors: [] };
    transaction(() => {
      rows.forEach((row, idx) => {
        try {
          const rowNo = idx + 2;
          const poNo = s(pick(row, ['关联PO编号', 'PO编号', 'related_po_no', 'po_no']));
          const sku = s(pick(row, ['SKU', 'sku_code']));
          if (!poNo) throw new Error('无法匹配PO：PO编号为空');
          const po = queryOne('SELECT * FROM purchase_orders WHERE po_no = ?', [poNo]);
          if (!po) throw new Error('无法匹配PO：' + poNo);
          if (!skuExists(sku)) throw new Error('SKU不存在：' + sku);
          const piNo = s(pick(row, ['PI编号', 'pi_no'])) || `PI-${new Date().getFullYear()}-${String(Date.now() + idx).slice(-6)}`;
          const qty = n(pick(row, ['数量', 'PI数量', 'pi_confirmed_qty', 'qty']), 0);
          const price = n(pick(row, ['单价', 'unit_price']), 0);
          const amount = qty * price;
          const needDepositVal = s(pick(row, ['是否需要定金', 'need_deposit']));
          const needDeposit = needDepositVal === '否' || needDepositVal === '0' || needDepositVal.toLowerCase() === 'false' ? 0 : 1;
          const depositRatio = needDeposit ? n(pick(row, ['定金比例', 'deposit_ratio']), 0) : 0;
          const exist = queryOne('SELECT * FROM proforma_invoices WHERE pi_no = ?', [piNo]);
          let piId = exist ? exist.id : genId('pi');
          if (!exist) {
            run(`INSERT INTO proforma_invoices (id, pi_no, related_po_id, related_po_no, supplier_id, supplier_name, brand, country, target_warehouse, pi_date, currency, total_amount, need_deposit, deposit_ratio, balance_ratio, payment_terms, expected_delivery, attachment, remark, pi_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [piId, piNo, po.id, po.po_no, po.supplier_id || '', po.supplier_name || '', po.brand || '', po.country || '', po.target_warehouse || '', s(pick(row, ['PI日期', 'pi_date'])) || new Date().toISOString().split('T')[0], s(pick(row, ['币种', 'currency'])) || po.currency || 'USD', 0, needDeposit, depositRatio, 100 - depositRatio, s(pick(row, ['付款条件', 'payment_terms'])), s(pick(row, ['预计交期', 'expected_delivery'])), parseAttachment(row.attachment || ''), s(pick(row, ['备注', 'remark'])), 'uploaded']);
          }
          run(`INSERT INTO proforma_invoice_items (id, pi_id, pi_no, po_no, sku_code, po_qty, pi_confirmed_qty, unit_price, pi_amount, shipped_qty, unshipped_qty) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [genId('pii'), piId, piNo, po.po_no, sku, n(pick(row, ['PO数量', 'po_qty']), qty), qty, price, amount, 0, qty]);
          const totals = queryOne('SELECT COALESCE(SUM(pi_amount),0) as total FROM proforma_invoice_items WHERE pi_id = ?', [piId]);
          const totalAmount = totals.total || 0;
          const payableDeposit = needDeposit ? totalAmount * depositRatio / 100 : 0;
          run('UPDATE proforma_invoices SET total_amount=?, payable_deposit=?, available_deduct_deposit=? WHERE id=?', [totalAmount, payableDeposit, payableDeposit, piId]);
          run('UPDATE purchase_orders SET po_status=? WHERE id=?', ['transferred_pi', po.id]);
          result.success++;
        } catch (e) {
          result.failed++;
          result.errors.push({ row: idx + 2, reason: e.message });
        }
      });
    });
    res.json(importResultWithMessages(result));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/commercial-invoices/batch-import', requireApiPermission('ci_create'), (req, res) => {
  try {
    const rows = Array.isArray(req.body.items) ? req.body.items : [];
    const result = { success: 0, failed: 0, total: rows.length, errors: [] };
    transaction(() => {
      rows.forEach((row, idx) => {
        try {
          const poNo = s(pick(row, ['关联PO编号', 'PO编号', 'related_po_no', 'po_no']));
          const piNo = s(pick(row, ['关联PI编号', 'PI编号', 'related_pi_no', 'pi_no']));
          const sku = s(pick(row, ['SKU', 'sku_code']));
          if (!skuExists(sku)) throw new Error('SKU不存在：' + sku);
          let po = poNo ? queryOne('SELECT * FROM purchase_orders WHERE po_no = ?', [poNo]) : null;
          if (poNo && !po) throw new Error('无法匹配PO：' + poNo);
          const pi = piNo ? queryOne('SELECT * FROM proforma_invoices WHERE pi_no = ?', [piNo]) : null;
          if (!po && pi?.related_po_no) po = queryOne('SELECT * FROM purchase_orders WHERE po_no = ?', [pi.related_po_no]);
          if (!po) throw new Error('无法匹配PO：PO编号为空或PI未关联PO');
          const ciNo = s(pick(row, ['CI编号', 'ci_no'])) || `CI-${new Date().getFullYear()}-${String(Date.now() + idx).slice(-6)}`;
          const qty = n(pick(row, ['数量', 'CI数量', 'shipped_qty', 'qty']), 0);
          const price = n(pick(row, ['单价', 'unit_price']), 0);
          const amount = qty * price;
          const exist = queryOne('SELECT * FROM commercial_invoices WHERE ci_no = ?', [ciNo]);
          let ciId = exist ? exist.id : genId('ci');
          if (!exist) {
            run(`INSERT INTO commercial_invoices (id, ci_no, related_po_id, related_po_no, related_pi_id, related_pi_no, supplier_id, supplier_name, brand, country, target_warehouse, ci_date, currency, goods_amount, pi_total_amount, amount_difference, difference_reason, ci_status, attachment, pl_attachment, remark) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [ciId, ciNo, po.id, po.po_no, pi ? pi.id : '', pi ? pi.pi_no : '', po.supplier_id || '', po.supplier_name || '', po.brand || '', po.country || '', po.target_warehouse || '', s(pick(row, ['CI日期', 'ci_date'])) || new Date().toISOString().split('T')[0], s(pick(row, ['币种', 'currency'])) || po.currency || 'USD', 0, pi ? (pi.total_amount || 0) : 0, 0, s(pick(row, ['差异原因', 'difference_reason'])), 'uploaded', parseAttachment(row.attachment || ''), parseAttachment(row.pl_attachment || ''), s(pick(row, ['备注', 'remark']))]);
          }
          run(`INSERT INTO commercial_invoice_items (id, ci_id, ci_no, pi_no, sku_code, shipped_qty, unit_price, ci_amount, inbound_qty, uninbound_qty) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [genId('cii'), ciId, ciNo, pi ? pi.pi_no : '', sku, qty, price, amount, 0, qty]);
          const totals = queryOne('SELECT COALESCE(SUM(ci_amount),0) as total FROM commercial_invoice_items WHERE ci_id = ?', [ciId]);
          const goodsAmount = totals.total || 0;
          const piTotal = pi ? (pi.total_amount || 0) : 0;
          const deduct = pi && pi.need_deposit ? Math.min(pi.payable_deposit || 0, pi.available_deduct_deposit || 0, goodsAmount) : 0;
          run('UPDATE commercial_invoices SET goods_amount=?, amount_difference=?, should_deduct_deposit=?, actual_deducted_deposit=?, payable_balance=?, unpaid_balance=? WHERE id=?', [goodsAmount, goodsAmount - piTotal, deduct, deduct, goodsAmount - deduct, goodsAmount - deduct, ciId]);
          result.success++;
        } catch (e) {
          result.failed++;
          result.errors.push({ row: idx + 2, reason: e.message });
        }
      });
    });
    res.json(importResultWithMessages(result));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/packing-lists/batch-import', requireApiPermission('ci_create'), (req, res) => {
  try {
    const rows = Array.isArray(req.body.items) ? req.body.items : [];
    const result = { success: 0, failed: 0, total: rows.length, errors: [] };
    transaction(() => {
      rows.forEach((row, idx) => {
        try {
          const ciNo = s(pick(row, ['关联CI编号', 'CI编号', 'related_ci_no', 'ci_no']));
          const poNo = s(pick(row, ['关联PO编号', 'PO编号', 'related_po_no', 'po_no']));
          const sku = s(pick(row, ['SKU', 'sku_code']));
          if (!skuExists(sku)) throw new Error('SKU不存在：' + sku);
          const ci = ciNo ? queryOne('SELECT * FROM commercial_invoices WHERE ci_no = ?', [ciNo]) : null;
          const po = poNo ? queryOne('SELECT * FROM purchase_orders WHERE po_no = ?', [poNo]) : null;
          if (poNo && !po) throw new Error('无法匹配PO：' + poNo);
          if (!ci) throw new Error('无法匹配CI：' + ciNo);
          const plNo = s(pick(row, ['PL编号', 'pl_no'])) || `PL-${new Date().getFullYear()}-${String(Date.now() + idx).slice(-6)}`;
          let pl = queryOne('SELECT * FROM packing_lists WHERE pl_no = ?', [plNo]);
          const plId = pl ? pl.id : genId('pl');
          if (!pl) {
            run(`INSERT INTO packing_lists (id, pl_no, related_po_id, related_po_no, related_pi_id, related_pi_no, related_ci_id, related_ci_no, supplier_id, supplier_name, brand, country, target_warehouse, pl_date, attachment, remark) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [plId, plNo, ci.related_po_id || (po ? po.id : ''), ci.related_po_no || poNo, ci.related_pi_id || '', ci.related_pi_no || '', ci.id, ci.ci_no, ci.supplier_id || '', ci.supplier_name || '', ci.brand || '', ci.country || '', ci.target_warehouse || '', s(pick(row, ['PL日期', 'pl_date'])) || new Date().toISOString().split('T')[0], parseAttachment(row.attachment || ''), s(pick(row, ['备注', 'remark']))]);
          }
          const cartons = n(pick(row, ['箱数', 'cartons']), 0);
          const qtyPerCarton = n(pick(row, ['每箱数量', 'qty_per_carton']), 0);
          const totalQty = n(pick(row, ['总数量', 'total_qty']), cartons * qtyPerCarton);
          const gross = n(pick(row, ['单箱毛重', 'gross_weight']), 0) * (cartons || 1);
          const net = n(pick(row, ['单箱净重', 'net_weight']), 0) * (cartons || 1);
          const cbm = n(pick(row, ['单箱体积', 'cbm']), 0) * (cartons || 1);
          run(`INSERT INTO packing_list_items (id, pl_id, pl_no, ci_no, sku_code, cartons, qty_per_carton, total_qty, gross_weight, net_weight, cbm, remark) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [genId('pli'), plId, plNo, ci.ci_no, sku, cartons, qtyPerCarton, totalQty, gross, net, cbm, s(pick(row, ['备注', 'remark']))]);
          const totals = queryOne('SELECT COALESCE(SUM(total_qty),0) qty, COALESCE(SUM(cartons),0) cartons, COALESCE(SUM(gross_weight),0) gross, COALESCE(SUM(net_weight),0) net, COALESCE(SUM(cbm),0) cbm FROM packing_list_items WHERE pl_id=?', [plId]);
          run('UPDATE packing_lists SET total_qty=?, total_cartons=?, total_gross_weight=?, total_net_weight=?, total_cbm=? WHERE id=?', [totals.qty || 0, totals.cartons || 0, totals.gross || 0, totals.net || 0, totals.cbm || 0, plId]);
          run('UPDATE commercial_invoices SET ci_status=? WHERE id=?', ['ci_pl_uploaded', ci.id]);
          result.success++;
        } catch (e) {
          result.failed++;
          result.errors.push({ row: idx + 2, reason: e.message });
        }
      });
    });
    res.json(importResultWithMessages(result));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== 物流批次 ====================
app.get('/api/logistics-batches', requireApiPermission('logistics_view'), (req, res) => {
  const { status, keyword, forwarder_id } = req.query;
  let sql = 'SELECT * FROM logistics_batches WHERE 1=1';
  const params = [];
  if (status) { sql += ' AND logistics_status = ?'; params.push(status); }
  if (forwarder_id) { sql += ' AND forwarder_id = ?'; params.push(forwarder_id); }
  if (keyword) { sql += ' AND (batch_no LIKE ? OR forwarder_name LIKE ? OR related_ci_no LIKE ?)'; params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`); }
  sql += ' ORDER BY created_at DESC';
  res.json(query(sql, params).rows);
});

app.get('/api/logistics-batches/:id', requireApiPermission('logistics_view'), (req, res) => {
  const batch = queryOne('SELECT * FROM logistics_batches WHERE id = ?', [req.params.id]);
  if (!batch) return res.status(404).json({ error: '物流批次不存在' });
  res.json(batch);
});

app.post('/api/logistics-batches', requireApiPermission('logistics_create'), (req, res) => {
  try {
    const d = req.body;
    const bId = genId('log');
    const bNo = d.batch_no || `LOG-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
    const totalFreight = (d.international_freight || 0) + (d.local_charges || 0) + (d.customs_service_fee || 0) + (d.delivery_fee || 0);
    run(`INSERT INTO logistics_batches (id, batch_no, related_ci_id, related_ci_no, forwarder_id, forwarder_name, transport_mode, origin_port, dest_port, target_country, target_warehouse, pickup_date, depart_date, eta_date, actual_arrival_date, customs_start_date, customs_end_date, delivery_date, inbound_complete_date, logistics_status, total_cartons, total_weight, total_cbm, freight_currency, international_freight, local_charges, customs_service_fee, delivery_fee, total_freight, customs_duty, vat_gst, other_fees, fee_status, remark) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [bId, bNo, d.related_ci_id || '', d.related_ci_no || '', d.forwarder_id || '', d.forwarder_name || '', d.transport_mode || 'sea', d.origin_port || '', d.dest_port || '', d.target_country || '', d.target_warehouse || '', d.pickup_date || '', d.depart_date || '', d.eta_date || '', d.actual_arrival_date || '', d.customs_start_date || '', d.customs_end_date || '', d.delivery_date || '', d.inbound_complete_date || '', d.logistics_status || 'pending', d.total_cartons || 0, d.total_weight || 0, d.total_cbm || 0, d.freight_currency || 'USD', d.international_freight || 0, d.local_charges || 0, d.customs_service_fee || 0, d.delivery_fee || 0, totalFreight, d.customs_duty || 0, d.vat_gst || 0, d.other_fees || 0, d.fee_status || 'unpaid', d.remark || '']);
    res.json({ id: bId, batch_no: bNo, ...d, total_freight: totalFreight });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/logistics-batches/:id', requireApiPermission('logistics_edit'), (req, res) => {
  try {
    const d = req.body;
    const { id } = req.params;
    const fields = [];
    const values = [];
    const allowed = ['forwarder_id', 'forwarder_name', 'transport_mode', 'origin_port', 'dest_port', 'target_country', 'target_warehouse', 'pickup_date', 'depart_date', 'eta_date', 'actual_arrival_date', 'customs_start_date', 'customs_end_date', 'delivery_date', 'inbound_complete_date', 'logistics_status', 'total_cartons', 'total_weight', 'total_cbm', 'freight_currency', 'international_freight', 'local_charges', 'customs_service_fee', 'delivery_fee', 'customs_duty', 'vat_gst', 'other_fees', 'fee_status', 'remark'];
    allowed.forEach(f => {
      if (d[f] !== undefined) { fields.push(`${f} = ?`); values.push(d[f]); }
    });
    // 重新计算综合运费
    if (d.international_freight !== undefined || d.local_charges !== undefined || d.customs_service_fee !== undefined || d.delivery_fee !== undefined) {
      const batch = queryOne('SELECT * FROM logistics_batches WHERE id = ?', [id]);
      if (batch) {
        const intl = d.international_freight !== undefined ? d.international_freight : batch.international_freight;
        const local = d.local_charges !== undefined ? d.local_charges : batch.local_charges;
        const customs = d.customs_service_fee !== undefined ? d.customs_service_fee : batch.customs_service_fee;
        const delivery = d.delivery_fee !== undefined ? d.delivery_fee : batch.delivery_fee;
        const total = (intl || 0) + (local || 0) + (customs || 0) + (delivery || 0);
        fields.push('total_freight = ?');
        values.push(total);
      }
    }
    fields.push(`updated_at = datetime('now')`);
    values.push(id);
    run(`UPDATE logistics_batches SET ${fields.join(', ')} WHERE id = ?`, values);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== 入库管理 ====================
app.get('/api/inbound-records', requireApiPermission('inbound_view'), (req, res) => {
  const { status, keyword, source_ci } = req.query;
  let sql = `SELECT ir.*, s.product_name, s.brand FROM inbound_records ir LEFT JOIN skus s ON ir.sku_code = s.sku_code WHERE 1=1`;
  const params = [];
  if (status) { sql += ' AND ir.inbound_status = ?'; params.push(status); }
  if (source_ci) { sql += ' AND ir.source_ci_no = ?'; params.push(source_ci); }
  if (keyword) { sql += ' AND (ir.inbound_no LIKE ? OR ir.sku_code LIKE ? OR s.product_name LIKE ?)'; params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`); }
  sql += ' ORDER BY ir.inbound_date DESC, ir.created_at DESC';
  res.json(query(sql, params).rows);
});

app.post('/api/inbound-records', requireApiPermission('inbound_create'), (req, res) => {
  try {
    const d = req.body;
    if (!d.sku_code || !d.inbound_date) return res.status(400).json({ error: 'SKU和入库日期不能为空' });
    const iId = genId('inbound');
    const iNo = d.inbound_no || `IN-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;

    transaction(() => {
      // 获取CI明细的累计入库信息
      let ciItemId = null;
      if (d.source_ci_id) {
        const ciItem = queryOne('SELECT id, shipped_qty, inbound_qty FROM commercial_invoice_items WHERE ci_id = ? AND sku_code = ?', [d.source_ci_id, d.sku_code]);
        if (ciItem) {
          ciItemId = ciItem.id;
          const accumulated = (ciItem.inbound_qty || 0) + (d.actual_qty || 0);
          const uninbound = (ciItem.shipped_qty || 0) - accumulated;
          run('UPDATE commercial_invoice_items SET inbound_qty = ?, uninbound_qty = ? WHERE id = ?', [accumulated, uninbound, ciItem.id]);
        }
      }

      run(`INSERT INTO inbound_records (id, inbound_no, source_ci_id, source_ci_no, source_pi_no, source_logistics_batch_no, delivery_batch_no, country, warehouse, inbound_date, sku_code, ci_shipped_qty, expected_qty, actual_qty, accumulated_qty, uninbound_qty, abnormal_qty, abnormal_reason, inbound_status, remark) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [iId, iNo, d.source_ci_id || '', d.source_ci_no || '', d.source_pi_no || '', d.source_logistics_batch_no || '', d.delivery_batch_no || '', d.country || '', d.warehouse || '', d.inbound_date, d.sku_code, d.ci_shipped_qty || 0, d.expected_qty || 0, d.actual_qty || 0, d.actual_qty || 0, (d.ci_shipped_qty || 0) - (d.actual_qty || 0), d.abnormal_qty || 0, d.abnormal_reason || '', d.abnormal_qty > 0 ? 'abnormal' : 'completed', d.remark || '']);

      // 成本分摊和加权平均成本更新已改为手动触发（CI费用确认 → 费用分摊 → 原库存导入 → 更新加权平均成本）

      // 入库记录只做单据跟踪，不自动更新库存总表数量
      // updateInventoryAfterInbound 已禁用（采购链不自动改库存总表数量）

      // 更新CI状态
      if (d.source_ci_id) {
        const ciItems = query('SELECT shipped_qty, inbound_qty FROM commercial_invoice_items WHERE ci_id = ?', [d.source_ci_id]).rows;
        const allInbound = ciItems.every(i => i.inbound_qty >= i.shipped_qty);
        const anyInbound = ciItems.some(i => i.inbound_qty > 0);
        if (allInbound) {
          run('UPDATE commercial_invoices SET ci_status = ? WHERE id = ?', ['completed', d.source_ci_id]);
        } else if (anyInbound) {
          run('UPDATE commercial_invoices SET ci_status = ? WHERE id = ?', ['partial_inbound', d.source_ci_id]);
        }
      }

      // 更新在途数据
      updateInventoryTransitData();
    });

    res.json({ id: iId, inbound_no: iNo, ...d });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 批量导入入库记录
app.post('/api/inbound-records/batch-import', requireApiPermission('inbound_create'), (req, res) => {
  try {
    const records = Array.isArray(req.body?.records) ? req.body.records : [];
    if (records.length === 0) return res.status(400).json({ error: '没有可导入的数据' });
    if (records.length > 2000) return res.status(400).json({ error: '单次最多导入 2000 条' });

    const errors = [];
    let success = 0;
    let failed = 0;
    const ciCache = new Map(); // 缓存 ci_id -> 状态信息，避免重复查询

    transaction(() => {
      records.forEach((rec, idx) => {
        const rowNum = idx + 1;
        try {
          const sku = String(rec.sku_code || '').trim();
          const date = String(rec.inbound_date || '').trim().slice(0, 10);
          const actualQty = parseInt(rec.actual_qty);
          if (!sku) throw new Error('SKU编码不能为空');
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('入库日期格式错误（应为 YYYY-MM-DD）');
          if (isNaN(actualQty) || actualQty < 0) throw new Error('实际入库数量必须为非负整数');

          // 解析 source_ci_id
          let sourceCiId = '';
          let sourceCiNo = String(rec.source_ci_no || '').trim();
          let sourcePiNo = '';
          if (sourceCiNo) {
            if (ciCache.has(sourceCiNo)) {
              sourceCiId = ciCache.get(sourceCiNo).id;
            } else {
              const ci = queryOne('SELECT id, ci_status FROM commercial_invoices WHERE ci_no = ?', [sourceCiNo]);
              if (ci) {
                sourceCiId = ci.id;
                ciCache.set(sourceCiNo, { id: ci.id, status: ci.ci_status });
              } else {
                sourceCiNo = ''; // 找不到的CI号清空，不阻断导入
              }
            }
          }

          const ciShippedQty = parseInt(rec.ci_shipped_qty) || 0;
          const expectedQty = parseInt(rec.expected_qty) || 0;
          const abnormalQty = parseInt(rec.abnormal_qty) || 0;
          const abnormalReason = String(rec.abnormal_reason || '').trim();
          const country = String(rec.country || '').trim();
          const warehouse = String(rec.warehouse || '').trim();
          const sourceLogisticsBatchNo = String(rec.source_logistics_batch_no || '').trim();
          const deliveryBatchNo = String(rec.delivery_batch_no || '').trim();
          const remark = String(rec.remark || '').trim();

          const iId = genId('inbound');
          const iNo = `IN-${new Date().getFullYear()}-${String(Date.now() + rowNum).slice(-6)}`;

          // 更新 CI 明细累计入库
          if (sourceCiId) {
            const ciItem = queryOne('SELECT id, shipped_qty, inbound_qty FROM commercial_invoice_items WHERE ci_id = ? AND sku_code = ?', [sourceCiId, sku]);
            if (ciItem) {
              const accumulated = (ciItem.inbound_qty || 0) + actualQty;
              const uninbound = (ciItem.shipped_qty || 0) - accumulated;
              run('UPDATE commercial_invoice_items SET inbound_qty = ?, uninbound_qty = ? WHERE id = ?', [accumulated, uninbound, ciItem.id]);
            }
          }

          run(`INSERT INTO inbound_records (id, inbound_no, source_ci_id, source_ci_no, source_pi_no, source_logistics_batch_no, delivery_batch_no, country, warehouse, inbound_date, sku_code, ci_shipped_qty, expected_qty, actual_qty, accumulated_qty, uninbound_qty, abnormal_qty, abnormal_reason, inbound_status, remark) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [iId, iNo, sourceCiId, sourceCiNo, sourcePiNo, sourceLogisticsBatchNo, deliveryBatchNo, country, warehouse, date, sku, ciShippedQty, expectedQty, actualQty, actualQty, ciShippedQty - actualQty, abnormalQty, abnormalReason, abnormalQty > 0 ? 'abnormal' : 'completed', remark]);

          // 成本分摊和加权平均成本更新已改为手动触发（CI费用确认 → 费用分摊 → 原库存导入 → 更新加权平均成本）
          // 入库记录只做单据跟踪，不自动触发成本计算

          // 更新库存
          if (actualQty > 0) {
            try { updateInventoryAfterInbound(sku, country, warehouse, actualQty, date); } catch (e) { /* 库存更新失败不影响入库 */ }
          }

          // 更新CI状态
          if (sourceCiId) {
            const ciItems = query('SELECT shipped_qty, inbound_qty FROM commercial_invoice_items WHERE ci_id = ?', [sourceCiId]).rows;
            const allInbound = ciItems.every(i => i.inbound_qty >= i.shipped_qty);
            const anyInbound = ciItems.some(i => i.inbound_qty > 0);
            if (allInbound) {
              run('UPDATE commercial_invoices SET ci_status = ? WHERE id = ?', ['completed', sourceCiId]);
            } else if (anyInbound) {
              run('UPDATE commercial_invoices SET ci_status = ? WHERE id = ?', ['partial_inbound', sourceCiId]);
            }
          }

          success++;
        } catch (e) {
          failed++;
          errors.push({ row: rowNum, sku: rec.sku_code || '', error: e.message });
        }
      });

      // 最后更新一次在途数据
      try { updateInventoryTransitData(); } catch (e) { /* ignore */ }
    });

    res.json({ success, failed, total: records.length, errors: errors.slice(0, 50) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 成本分摊核心逻辑
function allocateCosts(ciId, inboundId, inboundNo, skuCode, inboundQty) {
  const ci = queryOne('SELECT * FROM commercial_invoices WHERE id = ?', [ciId]);
  if (!ci) return;

  const ciItem = queryOne('SELECT * FROM commercial_invoice_items WHERE ci_id = ? AND sku_code = ?', [ciId, skuCode]);
  if (!ciItem) return;

  // 获取物流批次
  const logistics = queryOne('SELECT * FROM logistics_batches WHERE related_ci_id = ?', [ciId]);

  // 商品成本
  const productCost = ciItem.ci_amount || 0; // 该SKU的全部商品成本

  let allocatedFreight = 0;
  let allocatedDuty = 0;
  let allocatedOther = 0;
  let allocationBasis = 'cbm';

  if (logistics) {
    // 获取该CI所有SKU的PL数据
    const plItems = query(`
      SELECT pli.* FROM packing_list_items pli
      JOIN packing_lists pl ON pli.pl_id = pl.id
      WHERE pl.related_ci_id = ?
    `, [ciId]).rows;

    const totalCbm = plItems.reduce((sum, p) => sum + (p.cbm || 0), 0);
    const totalWeight = plItems.reduce((sum, p) => sum + (p.gross_weight || 0), 0);
    const totalGoodsAmount = ci.goods_amount || 0;

    const skuPl = plItems.find(p => p.sku_code === skuCode);
    const skuCbm = skuPl ? (skuPl.cbm || 0) : 0;
    const skuWeight = skuPl ? (skuPl.gross_weight || 0) : 0;
    const skuGoodsAmount = ciItem.ci_amount || 0;

    const totalFreight = logistics.total_freight || 0;
    const totalDuty = logistics.customs_duty || 0;
    const totalOther = (logistics.vat_gst || 0) + (logistics.other_fees || 0);

    // 运费分摊
    if (logistics.transport_mode === 'sea' && totalCbm > 0) {
      allocationBasis = 'cbm';
      allocatedFreight = totalFreight * (skuCbm / totalCbm);
    } else if ((logistics.transport_mode === 'air' || logistics.transport_mode === 'express') && totalWeight > 0) {
      allocationBasis = 'weight';
      allocatedFreight = totalFreight * (skuWeight / totalWeight);
    } else if (totalCbm > 0) {
      allocationBasis = 'cbm';
      allocatedFreight = totalFreight * (skuCbm / totalCbm);
    }

    // 关税分摊（按商品金额）
    if (totalDuty > 0 && totalGoodsAmount > 0) {
      allocatedDuty = totalDuty * (skuGoodsAmount / totalGoodsAmount);
    }

    // 其他费用分摊（按商品金额）
    if (totalOther > 0 && totalGoodsAmount > 0) {
      allocatedOther = totalOther * (skuGoodsAmount / totalGoodsAmount);
    }
  }

  const totalLandingCost = productCost + allocatedFreight + allocatedDuty + allocatedOther;
  const unitLandingCost = inboundQty > 0 ? totalLandingCost / inboundQty : 0;

  run(`INSERT INTO cost_allocations (id, inbound_id, inbound_no, logistics_batch_no, ci_no, sku_code, allocation_basis, product_cost, allocated_freight, allocated_duty, allocated_other, total_landing_cost, inbound_qty, unit_landing_cost, currency) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [genId('cost'), inboundId, inboundNo, logistics ? logistics.batch_no : '', ci.ci_no, skuCode, allocationBasis, productCost, allocatedFreight, allocatedDuty, allocatedOther, totalLandingCost, inboundQty, unitLandingCost, ci.currency || 'USD']);

  // 更新加权平均成本
  updateWeightedAvgCost(skuCode, inboundQty, unitLandingCost);
}

// 更新加权平均成本（采购链入库后同步成本，但不改库存数量）
function updateWeightedAvgCost(skuCode, inboundQty, unitLandingCost) {
  const sku = queryOne('SELECT weighted_avg_cost FROM skus WHERE sku_code = ?', [skuCode]);
  if (!sku) return;
  if (!inboundQty || inboundQty <= 0) return;

  // 获取当前库存（不改数量，只用现有数量计算加权平均）
  const invRecords = query('SELECT id, available_qty, weighted_avg_cost, country, warehouse FROM inventory WHERE sku_code = ?', [skuCode]).rows;
  const currentQty = invRecords.reduce((sum, i) => sum + (i.available_qty || 0), 0);
  const currentAvgCost = invRecords.length > 0 ? (invRecords[0].weighted_avg_cost || 0) : 0;

  const newAvgCost = currentQty > 0
    ? (currentQty * currentAvgCost + inboundQty * unitLandingCost) / (currentQty + inboundQty)
    : unitLandingCost;
  const roundedAvgCost = Math.round(newAvgCost * 10000) / 10000;

  // 更新 SKU 表的加权平均成本
  run('UPDATE skus SET weighted_avg_cost = ? WHERE sku_code = ?', [roundedAvgCost, skuCode]);

  // 更新库存总表的加权平均成本和库存价值（不改 available_qty）
  if (invRecords.length > 0) {
    invRecords.forEach(inv => {
      run('UPDATE inventory SET weighted_avg_cost = ?, inventory_value = available_qty * ?, updated_at = datetime(\'now\') WHERE id = ?',
        [roundedAvgCost, roundedAvgCost, inv.id]);
    });
  } else {
    // 库存总表没有该 SKU 记录时，创建一条仅含成本的记录（数量为 0）
    run(`INSERT OR IGNORE INTO inventory (id, sku_code, country, warehouse, available_qty, weighted_avg_cost, inventory_value, last_inbound_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [genId('inv'), skuCode, '', '', 0, roundedAvgCost, 0, new Date().toISOString().split('T')[0]]);
  }
}

// 入库后更新库存
function updateInventoryAfterInbound(skuCode, country, warehouse, qty, inboundDate) {
  // 入库记录只做单据跟踪，不自动增加库存总表数量。
  return;
  const inv = queryOne('SELECT id, available_qty FROM inventory WHERE sku_code = ? AND country = ? AND warehouse = ?', [skuCode, country, warehouse]);
  if (inv) {
    run('UPDATE inventory SET available_qty = available_qty + ?, last_inbound_date = ?, updated_at = datetime(\'now\') WHERE id = ?',
      [qty, inboundDate, inv.id]);
  } else {
    // 新记录：从SKU表获取刚更新的加权平均成本
    const sku = queryOne('SELECT weighted_avg_cost FROM skus WHERE sku_code = ?', [skuCode]);
    const avgCost = sku ? (sku.weighted_avg_cost || 0) : 0;
    run(`INSERT INTO inventory (id, sku_code, country, warehouse, available_qty, weighted_avg_cost, inventory_value, last_inbound_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [genId('inv'), skuCode, country, warehouse, qty, avgCost, qty * avgCost, inboundDate]);
  }
  // 更新库存价值
  const updated = queryOne('SELECT available_qty, weighted_avg_cost FROM inventory WHERE sku_code = ? AND country = ? AND warehouse = ?', [skuCode, country, warehouse]);
  if (updated) {
    run('UPDATE inventory SET inventory_value = ? WHERE sku_code = ? AND country = ? AND warehouse = ?',
      [(updated.available_qty || 0) * (updated.weighted_avg_cost || 0), skuCode, country, warehouse]);
  }
}

// ==================== 成本管理 ====================
app.get('/api/cost-allocations', requireApiPermission('cost_view'), (req, res) => {
  const { ci_no, sku_code, inbound_no } = req.query;
  let sql = `SELECT ca.*, s.product_name, s.brand FROM cost_allocations ca LEFT JOIN skus s ON ca.sku_code = s.sku_code WHERE 1=1`;
  const params = [];
  if (ci_no) { sql += ' AND ca.ci_no = ?'; params.push(ci_no); }
  if (sku_code) { sql += ' AND ca.sku_code = ?'; params.push(sku_code); }
  if (inbound_no) { sql += ' AND ca.inbound_no = ?'; params.push(inbound_no); }
  sql += ' ORDER BY ca.created_at DESC';
  res.json(query(sql, params).rows);
});

// ==================== 付款管理 ====================
app.get('/api/payment-requests', requireApiPermission('payment_view'), (req, res) => {
  const { status, category, keyword } = req.query;
  let sql = 'SELECT * FROM payment_requests WHERE 1=1';
  const params = [];
  if (status) { sql += ' AND payment_status = ?'; params.push(status); }
  if (category) { sql += ' AND payment_category = ?'; params.push(category); }
  if (keyword) { sql += ' AND (request_no LIKE ? OR supplier_name LIKE ? OR source_no LIKE ?)'; params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`); }
  sql += ' ORDER BY payable_date ASC, created_at DESC';
  res.json(query(sql, params).rows);
});

// 生成付款申请（从PI定金）— 货款/定金
app.post('/api/payment-requests/from-pi-deposit', requireApiPermission('payment_create'), (req, res) => {
  try {
    const { pi_id, has_deduction, deduction_amount, deduction_source_type, deduction_source_desc, deduction_ref_no } = req.body;
    const pi = queryOne('SELECT * FROM proforma_invoices WHERE id = ?', [pi_id]);
    if (!pi) return res.status(400).json({ error: 'PI不存在' });
    if (!pi.need_deposit || (pi.payable_deposit || 0) <= 0) {
      return res.status(400).json({ error: '该PI不需要定金，无需发起定金付款审批' });
    }

    const payableAmount = pi.payable_deposit || 0;
    const dedAmount = parseFloat(deduction_amount) || 0;
    if (has_deduction && dedAmount > 0) {
      if (dedAmount > payableAmount) return res.status(400).json({ error: '抵扣金额不能大于应付金额' });
      if (!deduction_source_type || !deduction_source_desc) return res.status(400).json({ error: '抵扣金额大于0时必须填写抵扣来源类型和说明' });
    }
    const actualPay = payableAmount - (has_deduction ? dedAmount : 0);

    const prId = genId('pay');
    const prNo = `PAY-DEP-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
    run(`INSERT INTO payment_requests (id, request_no, payment_category, payment_subcategory, source_type, source_id, source_no, payee_type, supplier_name, payable_amount, paid_amount, unpaid_amount, currency, payment_terms, payment_status, approval_status, remark, has_deduction, deduction_amount, deduction_source_type, deduction_source_desc, deduction_ref_no, actual_pay_amount, related_po_no) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [prId, prNo, 'goods', 'deposit', 'pi', pi_id, pi.pi_no, 'factory', pi.supplier_name, payableAmount, 0, payableAmount, pi.currency || 'USD', pi.payment_terms || '', 'pending_approval', 'pending', `PI定金 ${pi.pi_no}`, has_deduction ? 1 : 0, has_deduction ? dedAmount : 0, deduction_source_type || '', deduction_source_desc || '', deduction_ref_no || '', actualPay, pi.related_po_no || '']);

    run('UPDATE proforma_invoices SET deposit_payment_status = ? WHERE id = ?', ['pending_approval', pi_id]);
    res.json({ id: prId, request_no: prNo, payable_amount: payableAmount, actual_pay_amount: actualPay });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 生成付款申请（从CI尾款）— 货款/尾款
app.post('/api/payment-requests/from-ci-balance', requireApiPermission('payment_create'), (req, res) => {
  try {
    const { ci_id, has_deduction, deduction_amount, deduction_source_type, deduction_source_desc, deduction_ref_no } = req.body;
    const ci = queryOne('SELECT * FROM commercial_invoices WHERE id = ?', [ci_id]);
    if (!ci) return res.status(400).json({ error: 'CI不存在' });

    const payableAmount = ci.payable_balance || 0;
    const dedAmount = parseFloat(deduction_amount) || 0;
    if (has_deduction && dedAmount > 0) {
      if (dedAmount > payableAmount) return res.status(400).json({ error: '抵扣金额不能大于应付金额' });
      if (!deduction_source_type || !deduction_source_desc) return res.status(400).json({ error: '抵扣金额大于0时必须填写抵扣来源类型和说明' });
    }
    const actualPay = payableAmount - (has_deduction ? dedAmount : 0);

    const prId = genId('pay');
    const prNo = `PAY-BAL-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
    run(`INSERT INTO payment_requests (id, request_no, payment_category, payment_subcategory, source_type, source_id, source_no, payee_type, supplier_name, payable_amount, paid_amount, unpaid_amount, currency, payment_terms, payment_status, approval_status, remark, has_deduction, deduction_amount, deduction_source_type, deduction_source_desc, deduction_ref_no, actual_pay_amount, related_ci_id, related_ci_no, related_po_no) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [prId, prNo, 'goods', 'balance', 'ci', ci_id, ci.ci_no, 'factory', ci.supplier_name, payableAmount, 0, payableAmount, ci.currency || 'USD', '', 'pending_approval', 'pending', `CI尾款 ${ci.ci_no}`, has_deduction ? 1 : 0, has_deduction ? dedAmount : 0, deduction_source_type || '', deduction_source_desc || '', deduction_ref_no || '', actualPay, ci_id, ci.ci_no, ci.related_po_no || '']);

    run('UPDATE commercial_invoices SET balance_payment_status = ? WHERE id = ?', ['pending_approval', ci_id]);
    res.json({ id: prId, request_no: prNo, payable_amount: payableAmount, actual_pay_amount: actualPay });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 生成付款申请（到仓费用）— 可关联CI
app.post('/api/payment-requests/warehouse-arrival', requireApiPermission('payment_create'), (req, res) => {
  try {
    const { ci_id, subcategory, payee_name, payable_amount, currency, remark, has_deduction, deduction_amount, deduction_source_type, deduction_source_desc, deduction_ref_no, include_in_landing_cost } = req.body;
    if (!payable_amount || payable_amount <= 0) return res.status(400).json({ error: '应付金额必须大于0' });
    const validSubs = ['freight', 'customs_clearance', 'port_charges', 'delivery', 'warehouse', 'other_local'];
    if (!validSubs.includes(subcategory)) return res.status(400).json({ error: '无效的到仓费用小类' });

    const dedAmount = parseFloat(deduction_amount) || 0;
    if (has_deduction && dedAmount > 0) {
      if (dedAmount > payable_amount) return res.status(400).json({ error: '抵扣金额不能大于应付金额' });
      if (!deduction_source_type || !deduction_source_desc) return res.status(400).json({ error: '抵扣金额大于0时必须填写抵扣来源类型和说明' });
    }
    const actualPay = payable_amount - (has_deduction ? dedAmount : 0);

    let ci = null, ciNo = '', poNo = '';
    if (ci_id) { ci = queryOne('SELECT * FROM commercial_invoices WHERE id = ?', [ci_id]); if (ci) { ciNo = ci.ci_no; poNo = ci.related_po_no || ''; } }

    const prId = genId('pay');
    const prNo = `PAY-WAR-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
    run(`INSERT INTO payment_requests (id, request_no, payment_category, payment_subcategory, source_type, source_id, source_no, payee_type, supplier_name, payable_amount, paid_amount, unpaid_amount, currency, payment_status, approval_status, remark, has_deduction, deduction_amount, deduction_source_type, deduction_source_desc, deduction_ref_no, actual_pay_amount, related_ci_id, related_ci_no, related_po_no, include_in_landing_cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [prId, prNo, 'warehouse_arrival', subcategory, ci_id ? 'ci' : 'manual', ci_id || '', ciNo, 'service_provider', payee_name || '', payable_amount, 0, payable_amount, currency || 'USD', 'pending_approval', 'pending', remark || '', has_deduction ? 1 : 0, has_deduction ? dedAmount : 0, deduction_source_type || '', deduction_source_desc || '', deduction_ref_no || '', actualPay, ci_id || '', ciNo, poNo, include_in_landing_cost === false ? 0 : 1]);

    // 如果关联了CI，同时创建 ci_cost_items 记录
    if (ci) {
      run(`INSERT INTO ci_cost_items (id, ci_id, ci_no, payment_request_id, request_no, cost_category, cost_subcategory, payable_amount, paid_amount, include_in_landing_cost, payee_name, currency, remark) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [genId('cci'), ci_id, ciNo, prId, prNo, 'warehouse_arrival', subcategory, payable_amount, 0, include_in_landing_cost === false ? 0 : 1, payee_name || '', currency || 'USD', remark || '']);
    }

    res.json({ id: prId, request_no: prNo, actual_pay_amount: actualPay });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 生成付款申请（关税）— 只有CI选择"有关税"时才允许
app.post('/api/payment-requests/customs-duty', requireApiPermission('payment_create'), (req, res) => {
  try {
    const { ci_id, payee_name, payable_amount, currency, remark, has_deduction, deduction_amount, deduction_source_type, deduction_source_desc, deduction_ref_no } = req.body;
    if (!ci_id) return res.status(400).json({ error: '关税付款必须关联CI' });
    const ci = queryOne('SELECT * FROM commercial_invoices WHERE id = ?', [ci_id]);
    if (!ci) return res.status(400).json({ error: 'CI不存在' });
    if (!ci.has_customs_duty) return res.status(400).json({ error: '该CI未标记为有关税，无法创建关税付款申请' });
    if (!payable_amount || payable_amount <= 0) return res.status(400).json({ error: '应付金额必须大于0' });

    const dedAmount = parseFloat(deduction_amount) || 0;
    if (has_deduction && dedAmount > 0) {
      if (dedAmount > payable_amount) return res.status(400).json({ error: '抵扣金额不能大于应付金额' });
      if (!deduction_source_type || !deduction_source_desc) return res.status(400).json({ error: '抵扣金额大于0时必须填写抵扣来源类型和说明' });
    }
    const actualPay = payable_amount - (has_deduction ? dedAmount : 0);

    const prId = genId('pay');
    const prNo = `PAY-DUT-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
    run(`INSERT INTO payment_requests (id, request_no, payment_category, payment_subcategory, source_type, source_id, source_no, payee_type, supplier_name, payable_amount, paid_amount, unpaid_amount, currency, payment_status, approval_status, remark, has_deduction, deduction_amount, deduction_source_type, deduction_source_desc, deduction_ref_no, actual_pay_amount, related_ci_id, related_ci_no, related_po_no, include_in_landing_cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [prId, prNo, 'customs_duty', 'duty', 'ci', ci_id, ci.ci_no, 'customs', payee_name || '', payable_amount, 0, payable_amount, currency || ci.currency || 'USD', 'pending_approval', 'pending', remark || `关税 ${ci.ci_no}`, has_deduction ? 1 : 0, has_deduction ? dedAmount : 0, deduction_source_type || '', deduction_source_desc || '', deduction_ref_no || '', actualPay, ci_id, ci.ci_no, ci.related_po_no || '', 1]);

    run(`INSERT INTO ci_cost_items (id, ci_id, ci_no, payment_request_id, request_no, cost_category, cost_subcategory, payable_amount, paid_amount, include_in_landing_cost, payee_name, currency, remark) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [genId('cci'), ci_id, ci.ci_no, prId, prNo, 'customs_duty', 'duty', payable_amount, 0, 1, payee_name || '', currency || ci.currency || 'USD', remark || '']);

    res.json({ id: prId, request_no: prNo, actual_pay_amount: actualPay });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 生成付款申请（商检费用）— 只有CI选择"有商检费用"时才允许
app.post('/api/payment-requests/inspection-fee', requireApiPermission('payment_create'), (req, res) => {
  try {
    const { ci_id, payee_name, payable_amount, currency, remark, has_deduction, deduction_amount, deduction_source_type, deduction_source_desc, deduction_ref_no } = req.body;
    if (!ci_id) return res.status(400).json({ error: '商检费用付款必须关联CI' });
    const ci = queryOne('SELECT * FROM commercial_invoices WHERE id = ?', [ci_id]);
    if (!ci) return res.status(400).json({ error: 'CI不存在' });
    if (!ci.has_inspection_fee) return res.status(400).json({ error: '该CI未标记为有商检费用，无法创建商检费用付款申请' });
    if (!payable_amount || payable_amount <= 0) return res.status(400).json({ error: '应付金额必须大于0' });

    const dedAmount = parseFloat(deduction_amount) || 0;
    if (has_deduction && dedAmount > 0) {
      if (dedAmount > payable_amount) return res.status(400).json({ error: '抵扣金额不能大于应付金额' });
      if (!deduction_source_type || !deduction_source_desc) return res.status(400).json({ error: '抵扣金额大于0时必须填写抵扣来源类型和说明' });
    }
    const actualPay = payable_amount - (has_deduction ? dedAmount : 0);

    const prId = genId('pay');
    const prNo = `PAY-INS-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
    run(`INSERT INTO payment_requests (id, request_no, payment_category, payment_subcategory, source_type, source_id, source_no, payee_type, supplier_name, payable_amount, paid_amount, unpaid_amount, currency, payment_status, approval_status, remark, has_deduction, deduction_amount, deduction_source_type, deduction_source_desc, deduction_ref_no, actual_pay_amount, related_ci_id, related_ci_no, related_po_no, include_in_landing_cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [prId, prNo, 'inspection_fee', 'inspection', 'ci', ci_id, ci.ci_no, 'inspection_org', payee_name || '', payable_amount, 0, payable_amount, currency || ci.currency || 'USD', 'pending_approval', 'pending', remark || `商检费用 ${ci.ci_no}`, has_deduction ? 1 : 0, has_deduction ? dedAmount : 0, deduction_source_type || '', deduction_source_desc || '', deduction_ref_no || '', actualPay, ci_id, ci.ci_no, ci.related_po_no || '', 1]);

    run(`INSERT INTO ci_cost_items (id, ci_id, ci_no, payment_request_id, request_no, cost_category, cost_subcategory, payable_amount, paid_amount, include_in_landing_cost, payee_name, currency, remark) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [genId('cci'), ci_id, ci.ci_no, prId, prNo, 'inspection_fee', 'inspection', payable_amount, 0, 1, payee_name || '', currency || ci.currency || 'USD', remark || '']);

    res.json({ id: prId, request_no: prNo, actual_pay_amount: actualPay });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 更新付款申请抵扣信息
app.put('/api/payment-requests/:id/deduction', requireApiPermission('payment_create'), (req, res) => {
  try {
    const { has_deduction, deduction_amount, deduction_source_type, deduction_source_desc, deduction_ref_no, deduction_attachment } = req.body;
    const payment = queryOne('SELECT * FROM payment_requests WHERE id = ?', [req.params.id]);
    if (!payment) return res.status(404).json({ error: '付款申请不存在' });

    const dedAmount = parseFloat(deduction_amount) || 0;
    if (has_deduction && dedAmount > 0) {
      if (dedAmount > payment.payable_amount) return res.status(400).json({ error: '抵扣金额不能大于应付金额' });
      if (!deduction_source_type || !deduction_source_desc) return res.status(400).json({ error: '抵扣金额大于0时必须填写抵扣来源类型和说明' });
    }
    if (dedAmount < 0) return res.status(400).json({ error: '抵扣金额不能小于0' });

    const actualPay = payment.payable_amount - (has_deduction ? dedAmount : 0);
    let newStatus = payment.payment_status;
    if (has_deduction && dedAmount >= payment.payable_amount) {
      newStatus = 'deduction_settled';
    }

    run(`UPDATE payment_requests SET has_deduction = ?, deduction_amount = ?, deduction_source_type = ?, deduction_source_desc = ?, deduction_ref_no = ?, deduction_attachment = ?, actual_pay_amount = ?, unpaid_amount = ?, payment_status = ?, updated_at = datetime('now') WHERE id = ?`,
      [has_deduction ? 1 : 0, has_deduction ? dedAmount : 0, deduction_source_type || '', deduction_source_desc || '', deduction_ref_no || '', deduction_attachment || '', actualPay, actualPay, newStatus, req.params.id]);

    res.json({ success: true, actual_pay_amount: actualPay, payment_status: newStatus });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 付款审批
app.post('/api/payment-requests/:id/approve', requireApiPermission('payment_approve'), (req, res) => {
  try {
    const { action, remark, actual_rate } = req.body;
    const payment = queryOne('SELECT * FROM payment_requests WHERE id = ?', [req.params.id]);
    if (!payment) return res.status(404).json({ error: '付款申请不存在' });

    const user = queryOne('SELECT name FROM users WHERE id = ?', [req.currentUserId]);
    const userName = user ? user.name : '';

    if (action === 'approve') {
      const updateFields = ['payment_status = ?', 'approval_status = ?', 'updated_at = datetime(\'now\')'];
      const updateValues = ['approved', 'approved'];
      if (actual_rate) { updateFields.push('actual_rate = ?'); updateValues.push(parseFloat(actual_rate)); }
      updateValues.push(req.params.id);
      run(`UPDATE payment_requests SET ${updateFields.join(', ')} WHERE id = ?`, updateValues);
    } else if (action === 'reject') {
      run('UPDATE payment_requests SET payment_status = ?, approval_status = ?, updated_at = datetime(\'now\') WHERE id = ?', ['rejected', 'rejected', req.params.id]);
    } else if (action === 'confirm-paid') {
      const paidAmount = req.body.paid_amount || payment.actual_pay_amount || payment.payable_amount;
      const dedAmount = payment.deduction_amount || 0;
      let payStatus = 'paid';
      if (dedAmount > 0 && paidAmount < (payment.payable_amount - dedAmount)) {
        payStatus = 'partial_payment_partial_deduction';
      } else if (dedAmount > 0 && paidAmount >= (payment.payable_amount - dedAmount)) {
        payStatus = 'partial_deduction';
      }
      run('UPDATE payment_requests SET payment_status = ?, paid_amount = ?, unpaid_amount = ?, updated_at = datetime(\'now\') WHERE id = ?',
        [payStatus, paidAmount, Math.max(0, (payment.actual_pay_amount || payment.payable_amount) - paidAmount), req.params.id]);
      // 更新来源单据状态
      if (payment.source_type === 'pi') {
        run('UPDATE proforma_invoices SET deposit_payment_status = ?, pi_status = ? WHERE id = ?', ['paid', 'deposit_paid', payment.source_id]);
      } else if (payment.source_type === 'ci') {
        run('UPDATE commercial_invoices SET balance_payment_status = ?, paid_balance = ?, unpaid_balance = ? WHERE id = ?',
          ['paid', paidAmount, 0, payment.source_id]);
      }
      // 同步 ci_cost_items 的 paid_amount
      run('UPDATE ci_cost_items SET paid_amount = ? WHERE payment_request_id = ?', [paidAmount, req.params.id]);
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 导入付款结果
app.post('/api/payment-requests/bulk-import-result', requireApiPermission('payment_import'), (req, res) => {
  try {
    const items = req.body.items || [];
    const result = { updated: 0, failed: 0, errors: [] };
    transaction(() => {
      items.forEach((item, i) => {
        try {
          if (!item.request_no) { result.failed++; result.errors.push({ row: i + 2, reason: '付款申请号为空' }); return; }
          const payment = queryOne('SELECT * FROM payment_requests WHERE request_no = ?', [item.request_no]);
          if (!payment) { result.failed++; result.errors.push({ row: i + 2, reason: `付款申请号 ${item.request_no} 不存在` }); return; }
          const paidAmount = parseFloat(item.paid_amount) || payment.payable_amount;
          run('UPDATE payment_requests SET payment_status = ?, paid_amount = ?, unpaid_amount = ?, actual_rate = ?, payment_voucher = ?, updated_at = datetime(\'now\') WHERE id = ?',
            ['paid', paidAmount, payment.payable_amount - paidAmount, parseFloat(item.actual_rate) || 0, item.payment_voucher || '', payment.id]);

          if (payment.source_type === 'pi') {
            run('UPDATE proforma_invoices SET deposit_payment_status = ?, paid_deposit = ? WHERE id = ?', ['paid', paidAmount, payment.source_id]);
          } else if (payment.source_type === 'ci') {
            run('UPDATE commercial_invoices SET balance_payment_status = ?, paid_balance = ? WHERE id = ?', ['paid', paidAmount, payment.source_id]);
          } else if (payment.source_type === 'logistics') {
            run('UPDATE logistics_batches SET fee_status = ? WHERE id = ?', ['paid', payment.source_id]);
          }
          result.updated++;
        } catch (e) { result.failed++; result.errors.push({ row: i + 2, reason: e.message }); }
      });
    });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== CI 费用归集 ====================

// 获取CI费用归集汇总
app.get('/api/commercial-invoices/:id/cost-summary', requireApiPermission('ci_view'), (req, res) => {
  try {
    const ci = queryOne('SELECT * FROM commercial_invoices WHERE id = ?', [req.params.id]);
    if (!ci) return res.status(404).json({ error: 'CI不存在' });

    // 获取该CI的所有费用项
    const costItems = query('SELECT * FROM ci_cost_items WHERE ci_id = ? ORDER BY created_at', [req.params.id]).rows;

    // 按类别汇总
    const summary = {
      goods_amount: ci.goods_amount || 0,
      paid_deposit: ci.actual_deducted_deposit || 0,
      payable_balance: ci.payable_balance || 0,
      goods_paid: ci.paid_balance || 0,
      goods_unpaid: (ci.payable_balance || 0) - (ci.paid_balance || 0),
      warehouse_arrival_total: 0,
      customs_duty_total: 0,
      inspection_fee_total: 0,
      landing_cost_total: 0,
      has_customs_duty: ci.has_customs_duty || 0,
      has_inspection_fee: ci.has_inspection_fee || 0,
      cost_confirmed: ci.cost_confirmed || 0,
      cost_allocated: ci.cost_allocated || 0,
      original_inventory_imported: ci.original_inventory_imported || 0
    };

    costItems.forEach(item => {
      if (!item.include_in_landing_cost) return;
      const amt = item.payable_amount || 0;
      if (item.cost_category === 'warehouse_arrival') summary.warehouse_arrival_total += amt;
      else if (item.cost_category === 'customs_duty') summary.customs_duty_total += amt;
      else if (item.cost_category === 'inspection_fee') summary.inspection_fee_total += amt;
    });

    summary.landing_cost_total = summary.goods_amount + summary.warehouse_arrival_total + summary.customs_duty_total + summary.inspection_fee_total;
    summary.cost_items = costItems;

    res.json(summary);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 设置CI是否有关税/商检费用
app.put('/api/commercial-invoices/:id/cost-flags', requireApiPermission('ci_edit'), (req, res) => {
  try {
    const { has_customs_duty, has_inspection_fee } = req.body;
    const ci = queryOne('SELECT * FROM commercial_invoices WHERE id = ?', [req.params.id]);
    if (!ci) return res.status(404).json({ error: 'CI不存在' });

    const updates = [];
    const params = [];
    if (has_customs_duty !== undefined) { updates.push('has_customs_duty = ?'); params.push(has_customs_duty ? 1 : 0); }
    if (has_inspection_fee !== undefined) { updates.push('has_inspection_fee = ?'); params.push(has_inspection_fee ? 1 : 0); }
    if (updates.length === 0) return res.json({ success: true });

    updates.push("updated_at = datetime('now')");
    params.push(req.params.id);
    run(`UPDATE commercial_invoices SET ${updates.join(', ')} WHERE id = ?`, params);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 确认CI费用完整
app.post('/api/commercial-invoices/:id/confirm-costs', requireApiPermission('ci_edit'), (req, res) => {
  try {
    const ci = queryOne('SELECT * FROM commercial_invoices WHERE id = ?', [req.params.id]);
    if (!ci) return res.status(404).json({ error: 'CI不存在' });
    run('UPDATE commercial_invoices SET cost_confirmed = 1, updated_at = datetime(\'now\') WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== 原库存数量导入 ====================

// 原库存数量导入
app.post('/api/original-inventory/import', requireApiPermission('cost_view'), (req, res) => {
  try {
    const { ci_id, items } = req.body;
    if (!ci_id) return res.status(400).json({ error: '必须关联CI' });
    const ci = queryOne('SELECT * FROM commercial_invoices WHERE id = ?', [ci_id]);
    if (!ci) return res.status(400).json({ error: 'CI不存在' });

    const result = { success: 0, failed: 0, total: items.length, errors: [] };
    transaction(() => {
      // 先清除该CI之前的导入记录
      run('DELETE FROM original_inventory_imports WHERE ci_id = ?', [ci_id]);

      items.forEach((item, i) => {
        try {
          const skuCode = item.sku_code || item['SKU'];
          const origQty = parseFloat(item.original_qty || item['原库存数量'] || 0);
          const country = item.country || item['国家'] || ci.country || '';
          const warehouse = item.warehouse || item['仓库'] || ci.target_warehouse || '';
          const remark = item.remark || item['备注'] || '';

          if (!skuCode) { result.failed++; result.errors.push({ row: i + 2, reason: 'SKU编码为空' }); return; }

          // 校验SKU存在
          const sku = queryOne('SELECT sku_code FROM skus WHERE sku_code = ?', [skuCode]);
          if (!sku) { result.failed++; result.errors.push({ row: i + 2, reason: `SKU ${skuCode} 不存在` }); return; }

          // 校验SKU属于CI明细
          const ciItem = queryOne('SELECT id FROM commercial_invoice_items WHERE ci_id = ? AND sku_code = ?', [ci_id, skuCode]);
          if (!ciItem) { result.failed++; result.errors.push({ row: i + 2, reason: `SKU ${skuCode} 不属于该CI明细` }); return; }

          // 校验非负数
          if (origQty < 0) { result.failed++; result.errors.push({ row: i + 2, reason: `SKU ${skuCode} 原库存数量不能为负数` }); return; }

          run(`INSERT INTO original_inventory_imports (id, ci_id, ci_no, po_no, sku_code, country, warehouse, original_qty, remark) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [genId('ori'), ci_id, ci.ci_no, ci.related_po_no || '', skuCode, country, warehouse, origQty, remark]);
          result.success++;
        } catch (e) { result.failed++; result.errors.push({ row: i + 2, reason: e.message }); }
      });

      // 检查CI明细中所有SKU是否都已导入
      const ciItems = query('SELECT sku_code FROM commercial_invoice_items WHERE ci_id = ?', [ci_id]).rows;
      const importedSkus = query('SELECT sku_code FROM original_inventory_imports WHERE ci_id = ?', [ci_id]).rows.map(r => r.sku_code);
      const missingSkus = ciItems.filter(ci => !importedSkus.includes(ci.sku_code)).map(ci => ci.sku_code);

      const allImported = missingSkus.length === 0 && result.success > 0;
      run('UPDATE commercial_invoices SET original_inventory_imported = ? WHERE id = ?', [allImported ? 1 : 0, ci_id]);

      if (missingSkus.length > 0) {
        result.warnings = [`部分 SKU 缺少原库存数量，请补充后再更新加权平均成本: ${missingSkus.join(', ')}`];
      }
    });

    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 原库存数量导入模板下载（必须在 /:ci_id 路由之前）
app.get('/api/original-inventory/template', requireApiPermission('cost_view'), (req, res) => {
  res.json({
    columns: ['SKU', '原库存数量', '备注'],
    sample: [
      { 'SKU': 'SKU-001', '原库存数量': 500, '备注': '' },
      { 'SKU': 'SKU-002', '原库存数量': 300, '备注': '' }
    ],
    note: '如果当前采购单已绑定国家和仓库，模板只需 SKU、原库存数量、备注三列。'
  });
});

// 获取CI的原库存数量导入记录
app.get('/api/original-inventory/:ci_id', requireApiPermission('cost_view'), (req, res) => {
  try {
    const rows = query('SELECT * FROM original_inventory_imports WHERE ci_id = ? ORDER BY sku_code', [req.params.ci_id]).rows;
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 检查CI是否所有SKU都已导入原库存数量
app.get('/api/original-inventory/:ci_id/check', requireApiPermission('cost_view'), (req, res) => {
  try {
    const ci = queryOne('SELECT * FROM commercial_invoices WHERE id = ?', [req.params.ci_id]);
    if (!ci) return res.status(404).json({ error: 'CI不存在' });

    const ciItems = query('SELECT sku_code FROM commercial_invoice_items WHERE ci_id = ?', [req.params.ci_id]).rows;
    const importedSkus = query('SELECT sku_code, original_qty FROM original_inventory_imports WHERE ci_id = ?', [req.params.ci_id]).rows;
    const importedSkuCodes = importedSkus.map(r => r.sku_code);

    const missing = ciItems.filter(ci => !importedSkuCodes.includes(ci.sku_code)).map(ci => ci.sku_code);
    res.json({
      all_imported: missing.length === 0 && ciItems.length > 0,
      total_skus: ciItems.length,
      imported_skus: importedSkus.length,
      missing_skus: missing
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== 费用分摊 & 加权平均成本 ====================

// 费用分摊（按商品金额分摊到SKU）
app.post('/api/cost-allocation/allocate/:ci_id', requireApiPermission('cost_view'), (req, res) => {
  try {
    const ci = queryOne('SELECT * FROM commercial_invoices WHERE id = ?', [req.params.ci_id]);
    if (!ci) return res.status(400).json({ error: 'CI不存在' });

    // 检查费用是否已确认
    if (!ci.cost_confirmed) {
      return res.status(400).json({ error: '请先确认该 CI 的到仓费用、关税、商检费用是否已录入完整。未录入的费用将不会计入落地成本。' });
    }

    const ciItems = query('SELECT * FROM commercial_invoice_items WHERE ci_id = ?', [req.params.ci_id]).rows;
    if (ciItems.length === 0) return res.status(400).json({ error: 'CI明细为空' });

    // 获取CI费用归集
    const costItems = query('SELECT * FROM ci_cost_items WHERE ci_id = ? AND include_in_landing_cost = 1', [req.params.ci_id]).rows;
    const totalWarehouseArrival = costItems.filter(c => c.cost_category === 'warehouse_arrival').reduce((s, c) => s + (c.payable_amount || 0), 0);
    const totalCustomsDuty = costItems.filter(c => c.cost_category === 'customs_duty').reduce((s, c) => s + (c.payable_amount || 0), 0);
    const totalInspectionFee = costItems.filter(c => c.cost_category === 'inspection_fee').reduce((s, c) => s + (c.payable_amount || 0), 0);

    const totalGoodsAmount = ci.goods_amount || 0;
    if (totalGoodsAmount <= 0) return res.status(400).json({ error: 'CI商品金额为0，无法分摊' });

    // 清除旧分摊记录
    run('DELETE FROM cost_allocations WHERE ci_id = ?', [req.params.ci_id]);

    const allocations = [];
    transaction(() => {
      ciItems.forEach(item => {
        const skuGoodsAmount = item.ci_amount || 0;
        const ratio = skuGoodsAmount / totalGoodsAmount;

        // 按商品金额分摊
        const allocatedWarehouse = totalWarehouseArrival * ratio;
        const allocatedDuty = totalCustomsDuty * ratio;
        const allocatedInspection = totalInspectionFee * ratio;
        const allocatedOther = 0;

        const productCost = skuGoodsAmount;
        const totalLandingCost = productCost + allocatedWarehouse + allocatedDuty + allocatedInspection + allocatedOther;
        const inboundQty = item.shipped_qty || 0;
        const unitProductCost = inboundQty > 0 ? productCost / inboundQty : 0;
        const unitAllocatedCost = inboundQty > 0 ? (allocatedWarehouse + allocatedDuty + allocatedInspection + allocatedOther) / inboundQty : 0;
        const unitLandingCost = inboundQty > 0 ? totalLandingCost / inboundQty : 0;

        const allocId = genId('cost');
        run(`INSERT INTO cost_allocations (id, inbound_id, inbound_no, logistics_batch_no, ci_no, ci_id, related_po_no, related_pi_no, sku_code, allocation_basis, product_cost, allocated_freight, allocated_duty, allocated_other, total_landing_cost, inbound_qty, unit_landing_cost, currency, unit_product_cost, unit_allocated_cost, unit_landing_cost_with_fees, original_qty, original_avg_cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [allocId, '', '', '', ci.ci_no, req.params.ci_id, ci.related_po_no || '', ci.related_pi_no || '', item.sku_code, 'amount', productCost, allocatedWarehouse, allocatedDuty, allocatedInspection + allocatedOther, totalLandingCost, inboundQty, unitLandingCost, ci.currency || 'USD', unitProductCost, unitAllocatedCost, unitLandingCost, 0, 0]);

        allocations.push({ sku_code: item.sku_code, product_cost: productCost, allocated_warehouse: allocatedWarehouse, allocated_duty: allocatedDuty, allocated_inspection: allocatedInspection, total_landing_cost: totalLandingCost, inbound_qty: inboundQty, unit_landing_cost: unitLandingCost });
      });

      // 更新CI的落地总成本和分摊状态
      const landingTotal = totalGoodsAmount + totalWarehouseArrival + totalCustomsDuty + totalInspectionFee;
      run('UPDATE commercial_invoices SET cost_allocated = 1, landing_total_cost = ?, updated_at = datetime(\'now\') WHERE id = ?', [landingTotal, req.params.ci_id]);
    });

    res.json({ success: true, allocations, landing_total_cost: ci.goods_amount + totalWarehouseArrival + totalCustomsDuty + totalInspectionFee });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 更新加权平均成本（需要原库存数量已导入 + 费用已分摊）
app.post('/api/cost-allocation/update-weighted-avg/:ci_id', requireApiPermission('cost_view'), (req, res) => {
  try {
    const ci = queryOne('SELECT * FROM commercial_invoices WHERE id = ?', [req.params.ci_id]);
    if (!ci) return res.status(400).json({ error: 'CI不存在' });

    // 检查费用是否已确认
    if (!ci.cost_confirmed) {
      return res.status(400).json({ error: '请先确认该 CI 的到仓费用、关税、商检费用是否已录入完整。未录入的费用将不会计入落地成本。' });
    }

    // 检查费用是否已分摊
    if (!ci.cost_allocated) {
      return res.status(400).json({ error: '请先完成费用分摊' });
    }

    // 检查原库存数量是否已导入
    const ciItems = query('SELECT sku_code FROM commercial_invoice_items WHERE ci_id = ?', [req.params.ci_id]).rows;
    const importedSkus = query('SELECT sku_code, original_qty, country, warehouse FROM original_inventory_imports WHERE ci_id = ?', [req.params.ci_id]).rows;
    const importedSkuCodes = importedSkus.map(r => r.sku_code);
    const missingSkus = ciItems.filter(ci => !importedSkuCodes.includes(ci.sku_code)).map(ci => ci.sku_code);

    if (missingSkus.length > 0 || ciItems.length === 0) {
      return res.status(400).json({ error: '请先导入原库存数量，用于计算本次采购入库后的加权平均成本。', missing_skus: missingSkus });
    }

    // 获取分摊记录
    const allocations = query('SELECT * FROM cost_allocations WHERE ci_id = ?', [req.params.ci_id]).rows;
    if (allocations.length === 0) {
      return res.status(400).json({ error: '未找到费用分摊记录，请先执行费用分摊' });
    }

    const user = queryOne('SELECT name FROM users WHERE id = ?', [req.currentUserId]);
    const userName = user ? user.name : '';
    const logs = [];

    transaction(() => {
      allocations.forEach(alloc => {
        const origInv = importedSkus.find(s => s.sku_code === alloc.sku_code);
        if (!origInv) return;

        const originalQty = origInv.original_qty || 0;
        const inboundQty = alloc.inbound_qty || 0;
        const unitLandingCost = alloc.unit_landing_cost_with_fees || alloc.unit_landing_cost || 0;

        // 获取旧加权平均成本
        const invRecord = queryOne('SELECT id, available_qty, weighted_avg_cost FROM inventory WHERE sku_code = ? AND country = ? AND warehouse = ?',
          [alloc.sku_code, origInv.country, origInv.warehouse]);
        const oldAvgCost = invRecord ? (invRecord.weighted_avg_cost || 0) : 0;

        // 计算新加权平均成本
        const newQty = originalQty + inboundQty;
        const newAvgCost = newQty > 0
          ? (originalQty * oldAvgCost + inboundQty * unitLandingCost) / newQty
          : unitLandingCost;
        const roundedAvgCost = Math.round(newAvgCost * 10000) / 10000;

        // 更新库存总表：数量 + 加权平均成本
        if (invRecord) {
          run('UPDATE inventory SET available_qty = ?, weighted_avg_cost = ?, inventory_value = available_qty * ?, last_inbound_date = ?, updated_at = datetime(\'now\') WHERE id = ?',
            [newQty, roundedAvgCost, roundedAvgCost, new Date().toISOString().split('T')[0], invRecord.id]);
        } else {
          run(`INSERT OR IGNORE INTO inventory (id, sku_code, country, warehouse, available_qty, weighted_avg_cost, inventory_value, last_inbound_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [genId('inv'), alloc.sku_code, origInv.country, origInv.warehouse, newQty, roundedAvgCost, Math.round(newQty * roundedAvgCost * 100) / 100, new Date().toISOString().split('T')[0]]);
        }

        // 更新SKU表
        run('UPDATE skus SET weighted_avg_cost = ? WHERE sku_code = ?', [roundedAvgCost, alloc.sku_code]);

        // 更新分摊记录的原库存信息
        run('UPDATE cost_allocations SET original_qty = ?, original_avg_cost = ? WHERE id = ?', [originalQty, oldAvgCost, alloc.id]);

        // 记录成本更新日志
        const logId = genId('cul');
        run(`INSERT INTO cost_update_logs (id, sku_code, country, warehouse, related_po_no, related_pi_no, related_ci_no, original_qty, old_avg_cost, inbound_qty, ci_unit_cost, unit_landing_cost, new_qty, new_avg_cost, operator_id, operator_name, import_file, remark) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [logId, alloc.sku_code, origInv.country, origInv.warehouse, ci.related_po_no || '', ci.related_pi_no || '', ci.ci_no, originalQty, oldAvgCost, inboundQty, alloc.unit_product_cost || 0, unitLandingCost, newQty, roundedAvgCost, req.currentUserId, userName, '', req.body.remark || '']);

        logs.push({ sku_code: alloc.sku_code, original_qty: originalQty, old_avg_cost: oldAvgCost, inbound_qty: inboundQty, unit_landing_cost: unitLandingCost, new_qty: newQty, new_avg_cost: roundedAvgCost });
      });
    });

    res.json({ success: true, updated_count: logs.length, logs });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 成本更新日志查询
app.get('/api/cost-update-logs', requireApiPermission('cost_view'), (req, res) => {
  try {
    const { ci_no, sku_code, keyword } = req.query;
    let sql = 'SELECT * FROM cost_update_logs WHERE 1=1';
    const params = [];
    if (ci_no) { sql += ' AND related_ci_no = ?'; params.push(ci_no); }
    if (sku_code) { sql += ' AND sku_code = ?'; params.push(sku_code); }
    if (keyword) { sql += ' AND (related_ci_no LIKE ? OR sku_code LIKE ? OR related_po_no LIKE ?)'; params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`); }
    sql += ' ORDER BY created_at DESC';
    res.json(query(sql, params).rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 获取CI的费用分摊明细
app.get('/api/cost-allocation/:ci_id', requireApiPermission('cost_view'), (req, res) => {
  try {
    const rows = query('SELECT * FROM cost_allocations WHERE ci_id = ? ORDER BY sku_code', [req.params.ci_id]).rows;
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== 库存盘点 ====================
app.get('/api/inventory-checks', requireApiPermission('check_view'), (req, res) => {
  const { country, warehouse, status } = req.query;
  let sql = `SELECT ic.*, s.product_name, s.brand FROM inventory_checks ic LEFT JOIN skus s ON ic.sku_code = s.sku_code WHERE 1=1`;
  const params = [];
  if (country) { sql += ' AND ic.country = ?'; params.push(country); }
  if (warehouse) { sql += ' AND ic.warehouse = ?'; params.push(warehouse); }
  if (status) { sql += ' AND ic.approval_status = ?'; params.push(status); }
  sql += ' ORDER BY ic.check_date DESC, ic.created_at DESC';
  res.json(query(sql, params).rows);
});

// 生成盘点模板数据
app.get('/api/inventory-checks/template', requireApiPermission('check_view'), (req, res) => {
  const { country, warehouse } = req.query;
  let sql = `SELECT i.sku_code, s.product_name, s.brand, i.country, i.warehouse, i.available_qty as system_qty FROM inventory i LEFT JOIN skus s ON i.sku_code = s.sku_code WHERE 1=1`;
  const params = [];
  if (country) { sql += ' AND i.country = ?'; params.push(country); }
  if (warehouse) { sql += ' AND i.warehouse = ?'; params.push(warehouse); }
  sql += ' ORDER BY i.sku_code';
  res.json(query(sql, params).rows);
});

// 导入盘点数据
app.post('/api/inventory-checks/bulk-import', requireApiPermission('check_create'), (req, res) => {
  try {
    const items = req.body.items || [];
    const result = { created: 0, failed: 0, errors: [] };
    transaction(() => {
      items.forEach((item, i) => {
        try {
          if (!item.sku_code || !item.check_date) { result.failed++; result.errors.push({ row: i + 2, reason: 'SKU或盘点日期为空' }); return; }
          const systemQty = parseInt(item.system_qty) || 0;
          const actualQty = parseInt(item.actual_qty) || 0;
          const diffQty = actualQty - systemQty;
          const inv = queryOne('SELECT weighted_avg_cost FROM inventory WHERE sku_code = ? AND country = ? AND warehouse = ?', [item.sku_code, item.country, item.warehouse]);
          const avgCost = inv ? inv.weighted_avg_cost : 0;
          run(`INSERT INTO inventory_checks (id, check_no, country, warehouse, check_date, sku_code, system_qty, actual_qty, diff_qty, diff_amount, diff_reason, handle_method, approval_status, remark) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [genId('check'), `CHK-${Date.now()}-${i}`, item.country || '', item.warehouse || '', item.check_date, item.sku_code, systemQty, actualQty, diffQty, diffQty * avgCost, item.diff_reason || '', item.handle_method || 'pending', 'pending', item.remark || '']);
          result.created++;
        } catch (e) { result.failed++; result.errors.push({ row: i + 2, reason: e.message }); }
      });
    });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 盘点审批通过后调整库存
app.post('/api/inventory-checks/:id/approve', requireApiPermission('check_approve'), (req, res) => {
  try {
    const check = queryOne('SELECT * FROM inventory_checks WHERE id = ?', [req.params.id]);
    if (!check) return res.status(404).json({ error: '盘点记录不存在' });
    if (check.approval_status !== 'pending') return res.status(400).json({ error: '只能审批待处理记录' });

    run('UPDATE inventory_checks SET approval_status = ? WHERE id = ?', ['approved', req.params.id]);

    // 如果处理方式是调整库存
    if (check.handle_method === 'adjust' && check.diff_qty !== 0) {
      const inv = queryOne('SELECT id, available_qty FROM inventory WHERE sku_code = ? AND country = ? AND warehouse = ?', [check.sku_code, check.country, check.warehouse]);
      if (inv) {
        run('UPDATE inventory SET available_qty = available_qty + ?, updated_at = datetime(\'now\') WHERE id = ?', [check.diff_qty, inv.id]);
      }
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== 呆滞库存分析 ====================
app.get('/api/stagnant-analysis', requireApiPermission('stagnant_view'), (req, res) => {
  const { country, warehouse, level } = req.query;
  const now = new Date();
  const d30 = new Date(now.getTime() - 30 * 86400000).toISOString().split('T')[0];
  const d60 = new Date(now.getTime() - 60 * 86400000).toISOString().split('T')[0];
  const d90 = new Date(now.getTime() - 90 * 86400000).toISOString().split('T')[0];

  let sql = `SELECT i.sku_code, i.country, i.warehouse, i.available_qty, i.weighted_avg_cost, i.available_qty * i.weighted_avg_cost as inventory_value,
    s.product_name, s.brand, s.category, s.lifecycle_status, s.is_new_product,
    (SELECT MAX(order_date) FROM sales_records WHERE sku_code = i.sku_code AND is_valid_order = 1) as last_sale_date
    FROM inventory i LEFT JOIN skus s ON i.sku_code = s.sku_code WHERE i.available_qty > 0`;
  const params = [];
  if (country) { sql += ' AND i.country = ?'; params.push(country); }
  if (warehouse) { sql += ' AND i.warehouse = ?'; params.push(warehouse); }
  sql += ' ORDER BY i.sku_code';

  const items = query(sql, params).rows;
  const result = items.map(item => {
    const lastSaleDate = item.last_sale_date;
    const daysSinceSale = lastSaleDate ? Math.floor((now - new Date(lastSaleDate)) / 86400000) : 9999;

    const sales30 = queryOne('SELECT COALESCE(SUM(quantity), 0) as cnt FROM sales_records WHERE sku_code = ? AND is_valid_order = 1 AND order_date >= ?',
      [item.sku_code, d30])?.cnt || 0;
    const sales60 = queryOne('SELECT COALESCE(SUM(quantity), 0) as cnt FROM sales_records WHERE sku_code = ? AND is_valid_order = 1 AND order_date >= ?',
      [item.sku_code, d60])?.cnt || 0;
    const sales90 = queryOne('SELECT COALESCE(SUM(quantity), 0) as cnt FROM sales_records WHERE sku_code = ? AND is_valid_order = 1 AND order_date >= ?',
      [item.sku_code, d90])?.cnt || 0;

    const monthlyForecast = Math.ceil(sales90 / 3);
    const turnoverMonths = monthlyForecast > 0 ? item.available_qty / monthlyForecast : 999;

    let stagnantLevel = '';
    let suggestion = '';
    if (item.is_new_product === 1) {
      stagnantLevel = 'new_product';
      suggestion = '新品数据不足，需人工判断';
    } else if (daysSinceSale >= 180) {
      stagnantLevel = 'dead';
      suggestion = '死亡库存，建议报废或清仓';
    } else if (daysSinceSale >= 90) {
      stagnantLevel = 'heavy';
      suggestion = '重度呆滞，建议清仓处理';
    } else if (daysSinceSale >= 60) {
      stagnantLevel = 'medium';
      suggestion = '中度呆滞，建议促销清仓';
    } else if (daysSinceSale >= 30) {
      stagnantLevel = 'light';
      suggestion = '轻度呆滞，关注销售趋势';
    } else if (turnoverMonths > 12) {
      stagnantLevel = 'severe_backlog';
      suggestion = '严重积压，建议清仓';
    } else if (turnoverMonths > 6) {
      stagnantLevel = 'backlog';
      suggestion = '库存偏高，暂缓补货';
    } else {
      stagnantLevel = 'normal';
      suggestion = '正常';
    }

    return {
      ...item,
      days_since_sale: daysSinceSale >= 9999 ? null : daysSinceSale,
      sales_30d: sales30, sales_60d: sales60, sales_90d: sales90,
      monthly_forecast: monthlyForecast,
      turnover_months: Math.round(turnoverMonths * 10) / 10,
      stagnant_level: stagnantLevel,
      suggestion
    };
  });

  // 筛选呆滞等级
  let filtered = result;
  if (level && level !== 'all') {
    filtered = result.filter(r => r.stagnant_level === level);
  } else {
    filtered = result.filter(r => r.stagnant_level !== 'normal');
  }
  res.json(filtered);
});

// ==================== 货代分析 ====================
app.get('/api/freight-forwarder-analysis', requireApiPermission('forwarder_view'), (req, res) => {
  const { country, forwarder_id, transport_mode } = req.query;
  let sql = `SELECT forwarder_id, forwarder_name, target_country, transport_mode,
    COUNT(*) as batch_count,
    SUM(goods_amount) as total_ci_amount,
    SUM(total_cbm) as total_cbm,
    SUM(total_weight) as total_weight,
    SUM(total_freight) as total_freight,
    SUM(customs_duty) as total_duty,
    AVG(CASE WHEN actual_arrival_date != '' AND depart_date != '' THEN (julianday(actual_arrival_date) - julianday(depart_date)) END) as avg_transport_days,
    AVG(CASE WHEN customs_end_date != '' AND customs_start_date != '' THEN (julianday(customs_end_date) - julianday(customs_start_date)) END) as avg_customs_days,
    AVG(CASE WHEN inbound_complete_date != '' AND delivery_date != '' THEN (julianday(inbound_complete_date) - julianday(delivery_date)) END) as avg_delivery_days
    FROM (
      SELECT lb.forwarder_id, lb.forwarder_name, lb.target_country, lb.transport_mode,
        lb.total_cbm, lb.total_weight, lb.total_freight, lb.customs_duty,
        lb.actual_arrival_date, lb.depart_date, lb.customs_start_date, lb.customs_end_date, lb.delivery_date, lb.inbound_complete_date,
        ci.goods_amount
      FROM logistics_batches lb
      LEFT JOIN commercial_invoices ci ON lb.related_ci_id = ci.id
      WHERE lb.logistics_status = 'completed'
    ) WHERE 1=1`;
  const params = [];
  if (country) { sql += ' AND target_country = ?'; params.push(country); }
  if (forwarder_id) { sql += ' AND forwarder_id = ?'; params.push(forwarder_id); }
  if (transport_mode) { sql += ' AND transport_mode = ?'; params.push(transport_mode); }
  sql += ' GROUP BY forwarder_id, forwarder_name, target_country, transport_mode ORDER BY total_freight DESC';

  const items = query(sql, params).rows;
  const result = items.map(item => {
    const freightRatio = item.total_ci_amount > 0 ? item.total_freight / item.total_ci_amount : 0;
    const freightPerCbm = item.total_cbm > 0 ? item.total_freight / item.total_cbm : 0;
    const freightPerKg = item.total_weight > 0 ? item.total_freight / item.total_weight : 0;
    return {
      ...item,
      freight_ratio: Math.round(freightRatio * 10000) / 100,
      freight_per_cbm: Math.round(freightPerCbm * 100) / 100,
      freight_per_kg: Math.round(freightPerKg * 100) / 100,
      avg_transport_days: item.avg_transport_days ? Math.round(item.avg_transport_days * 10) / 10 : null,
      avg_customs_days: item.avg_customs_days ? Math.round(item.avg_customs_days * 10) / 10 : null,
      avg_delivery_days: item.avg_delivery_days ? Math.round(item.avg_delivery_days * 10) / 10 : null,
    };
  });
  res.json(result);
});

// ==================== 首页看板 ====================
app.get('/api/dashboard', requireApiPermission('dashboard_view'), (req, res) => {
  try {
    // 总库存金额
    const totalInv = queryOne('SELECT COALESCE(SUM(available_qty * weighted_avg_cost), 0) as val FROM inventory')?.val || 0;

    // 在途库存金额（用标准采购价估算）
    const transitInv = queryOne(`
      SELECT COALESCE(SUM((cii.shipped_qty - cii.inbound_qty) * cii.unit_price), 0) as val
      FROM commercial_invoice_items cii
      JOIN commercial_invoices ci ON cii.ci_id = ci.id
      WHERE ci.ci_status NOT IN ('cancelled', 'completed')
    `)?.val || 0;

    // 呆滞库存金额
    const stagnantInv = queryOne(`
      SELECT COALESCE(SUM(i.available_qty * i.weighted_avg_cost), 0) as val
      FROM inventory i
      WHERE i.available_qty > 0 AND i.sku_code IN (
        SELECT sku_code FROM skus WHERE lifecycle_status IN ('stagnant', 'clearance')
      )
    `)?.val || 0;

    // 缺货风险SKU数量
    const shortageSkus = queryOne(`
      SELECT COUNT(DISTINCT i.sku_code) as cnt FROM inventory i
      WHERE i.available_qty <= 0 OR (i.weighted_avg_cost > 0 AND i.available_qty > 0
        AND NOT EXISTS (SELECT 1 FROM sales_records WHERE sku_code = i.sku_code AND is_valid_order = 1 AND order_date >= date('now', '-30 days')))
    `)?.cnt || 0;

    // 建议采购金额
    const suggestAmount = queryOne(`
      SELECT COALESCE(SUM(rs.suggested_qty * s.standard_purchase_price), 0) as val
      FROM replenishment_suggestions rs
      LEFT JOIN skus s ON rs.sku_code = s.sku_code
      WHERE rs.suggested_qty > 0
    `)?.val || 0;

    // 7天内待付款金额
    const now = new Date();
    const d7 = new Date(now.getTime() + 7 * 86400000).toISOString().split('T')[0];
    const pay7 = queryOne(`SELECT COALESCE(SUM(unpaid_amount), 0) as val FROM payment_requests WHERE payment_status IN ('approved', 'pending_approval') AND payable_date != '' AND payable_date <= ?`, [d7])?.val || 0;

    // 30天内待付款金额
    const d30 = new Date(now.getTime() + 30 * 86400000).toISOString().split('T')[0];
    const pay30 = queryOne(`SELECT COALESCE(SUM(unpaid_amount), 0) as val FROM payment_requests WHERE payment_status IN ('approved', 'pending_approval') AND payable_date != '' AND payable_date <= ?`, [d30])?.val || 0;

    // 逾期付款金额
    const today = now.toISOString().split('T')[0];
    const overdue = queryOne(`SELECT COALESCE(SUM(unpaid_amount), 0) as val FROM payment_requests WHERE payment_status IN ('approved', 'pending_approval') AND payable_date != '' AND payable_date < ?`, [today])?.val || 0;

    // PO/PI/CI 未完成数量
    const poPending = queryOne("SELECT COUNT(*) as cnt FROM purchase_orders WHERE po_status NOT IN ('cancelled', 'transferred_pi')")?.cnt || 0;
    const piPending = queryOne("SELECT COUNT(*) as cnt FROM proforma_invoices WHERE pi_status NOT IN ('cancelled', 'shipped_complete')")?.cnt || 0;
    const ciPending = queryOne("SELECT COUNT(*) as cnt FROM commercial_invoices WHERE ci_status NOT IN ('cancelled', 'completed')")?.cnt || 0;

    // 运费占比趋势
    const freightTrend = query(`
      SELECT strftime('%Y-%m', lb.depart_date) as month,
        SUM(lb.total_freight) as freight,
        SUM(ci.goods_amount) as goods
      FROM logistics_batches lb
      LEFT JOIN commercial_invoices ci ON lb.related_ci_id = ci.id
      WHERE lb.depart_date != '' AND lb.depart_date >= date('now', '-6 months')
      GROUP BY month ORDER BY month
    `).rows.map(r => ({
      month: r.month,
      freight: r.freight || 0,
      goods: r.goods || 0,
      ratio: r.goods > 0 ? Math.round(r.freight / r.goods * 10000) / 100 : 0
    }));

    res.json({
      total_inventory_value: Math.round(totalInv * 100) / 100,
      available_inventory_value: Math.round(totalInv * 100) / 100,
      in_transit_value: Math.round(transitInv * 100) / 100,
      stagnant_value: Math.round(stagnantInv * 100) / 100,
      shortage_sku_count: shortageSkus,
      suggest_purchase_amount: Math.round(suggestAmount * 100) / 100,
      pay_7d_amount: Math.round(pay7 * 100) / 100,
      pay_30d_amount: Math.round(pay30 * 100) / 100,
      overdue_amount: Math.round(overdue * 100) / 100,
      freight_trend: freightTrend,
      po_pending: poPending,
      pi_pending: piPending,
      ci_pending: ciPending
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== 批量操作辅助函数 ====================

const INVENTORY_STATUS_MAP = {
  '正常':'normal','断货风险':'out_of_stock_risk','高库存':'high_stock',
  '慢销':'slow_moving','清仓':'clearance','异常':'abnormal',
  'normal':'normal','out_of_stock_risk':'out_of_stock_risk','high_stock':'high_stock',
  'slow_moving':'slow_moving','clearance':'clearance','abnormal':'abnormal'
};

const INVENTORY_STATUS_LABELS = {
  'normal':'正常','out_of_stock_risk':'断货风险','high_stock':'高库存',
  'slow_moving':'慢销','clearance':'清仓','abnormal':'异常'
};

const OUTBOUND_STATUS_LABELS = {
  'normal':'正常','voided':'已作废'
};

// 出库类型默认是否参与预测
const OUTBOUND_TYPE_FORECAST_DEFAULT = {
  'sale':1,'online_sale':1,'offline_sale':1,
  'transfer':0,'sample':0,'damage':0,'return_out':0,'manual_adjustment':0,
  'mdf_influencer':0,'mdf_event':0,'scrap':0
};

function logOperation({operator_id, operator_name, page, operation_type, target_ids, affected_count, old_values, new_values, reason, triggered_recalc, is_rollbackable}) {
  try {
    run(`INSERT INTO operation_logs (id, operator_id, operator_name, page, operation_type, target_ids, affected_count, old_values, new_values, reason, triggered_recalc, is_rollbackable) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [genId('oplog'), operator_id||'', operator_name||'', page||'', operation_type||'', JSON.stringify(target_ids||[]), affected_count||0, JSON.stringify(old_values||{}), JSON.stringify(new_values||{}), reason||'', triggered_recalc?1:0, is_rollbackable?1:0]);
  } catch(e) { console.error('[logOperation]', e.message); }
}

function createBatchTask({task_name, operation_type, operator_id, operator_name, page, total_count, is_rollbackable}) {
  const taskId = genId('batch');
  run(`INSERT INTO batch_tasks (id, task_name, operation_type, operator_id, operator_name, page, status, total_count, is_rollbackable) VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?)`,
    [taskId, task_name, operation_type||'', operator_id||'', operator_name||'', page||'', total_count||0, is_rollbackable?1:0]);
  return taskId;
}

function finishBatchTask(taskId, {success, failed, skipped, errors, is_rollbackable}) {
  run(`UPDATE batch_tasks SET status='completed', success_count=?, failed_count=?, skipped_count=?, error_report=?, finished_at=datetime('now'), is_rollbackable=? WHERE id=?`,
    [success||0, failed||0, skipped||0, JSON.stringify(errors||[]), is_rollbackable?1:0, taskId]);
}

// 重新计算指定SKU+国家+仓库的库存相关数据
function recalcInventoryForSku(sku_code, country, warehouse, options = {}) {
  try {
    const skipStatus = options.skipStatus || false; // 手动设置状态时不覆盖
    // 计算最近销售日期（从销售明细表）
    const lastOut = queryOne(`SELECT MAX(order_date) as d FROM sales_records WHERE sku_code=? AND is_valid_order=1`, [sku_code]);
    // 计算最近90天有效销量
    const sales90 = queryOne(`SELECT COALESCE(SUM(quantity),0) as qty FROM sales_records WHERE sku_code=? AND is_valid_order=1 AND order_date >= date('now','-90 days')`, [sku_code]);
    // 月均销量 = 90天/3
    const avgMonthly = Math.round((sales90?.qty || 0) / 3);
    // 可用库存
    const inv = queryOne('SELECT available_qty, safety_stock, target_turnover_months, inventory_status FROM inventory WHERE sku_code=? AND country=? AND warehouse=?', [sku_code, country, warehouse]);
    if (inv) {
      const available = inv.available_qty || 0;
      const turnover = avgMonthly > 0 ? Math.round((available / avgMonthly) * 10) / 10 : 0;
      if (skipStatus) {
        // 只更新周转/出库日期，不覆盖手动设置的库存状态
        run(`UPDATE inventory SET last_outbound_date=?, turnover_months=?, updated_at=datetime('now') WHERE sku_code=? AND country=? AND warehouse=?`,
          [lastOut?.d || '', turnover, sku_code, country, warehouse]);
      } else {
        // 自动判断库存状态
        let autoStatus = 'normal';
        if (available <= 0) autoStatus = 'out_of_stock_risk';
        else if (inv.target_turnover_months > 0 && turnover > inv.target_turnover_months * 1.5) autoStatus = 'high_stock';
        else if (avgMonthly > 0 && turnover > inv.target_turnover_months * 2) autoStatus = 'slow_moving';
        else if (available <= (inv.safety_stock || 0)) autoStatus = 'out_of_stock_risk';
        run(`UPDATE inventory SET last_outbound_date=?, turnover_months=?, inventory_status=?, updated_at=datetime('now') WHERE sku_code=? AND country=? AND warehouse=?`,
          [lastOut?.d || '', turnover, autoStatus, sku_code, country, warehouse]);
      }
    }
  } catch(e) { console.error('[recalcInventoryForSku]', e.message); }
}

// ==================== 库存总表批量操作 ====================

// 批量设置库存状态
app.post('/api/inventory/batch-set-status', requireApiPermission('inventory_import'), (req, res) => {
  try {
    const { ids, status, reason } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: '未选择记录' });
    const statusVal = INVENTORY_STATUS_MAP[status] || status;
    if (!INVENTORY_STATUS_MAP[statusVal]) return res.status(400).json({ error: '无效的库存状态' });

    const taskId = createBatchTask({task_name:'批量设置库存状态', operation_type:'set_status', operator_id:req.currentUserId, operator_name:req.currentUserName, page:'inventory', total_count:ids.length, is_rollbackable:true});
    const errors = [];
    let success = 0, failed = 0, skipped = 0;

    transaction(() => {
      ids.forEach(id => {
        try {
          const inv = queryOne('SELECT * FROM inventory WHERE id=?', [id]);
          if (!inv) { skipped++; errors.push({id, reason:'记录不存在'}); return; }
          const oldVal = inv.inventory_status;
          run('UPDATE inventory SET inventory_status=?, updated_at=datetime(\'now\') WHERE id=?', [statusVal, id]);
          // 触发重算（跳过状态覆盖，保留手动设置的状态）
          recalcInventoryForSku(inv.sku_code, inv.country, inv.warehouse, {skipStatus: true});
          logOperation({operator_id:req.currentUserId, operator_name:req.currentUserName, page:'inventory', operation_type:'set_status', target_ids:[id], affected_count:1, old_values:{inventory_status:oldVal}, new_values:{inventory_status:statusVal}, reason:reason||'', triggered_recalc:1, is_rollbackable:1});
          success++;
        } catch(e) { failed++; errors.push({id, reason:e.message}); }
      });
    });
    finishBatchTask(taskId, {success, failed, skipped, errors, is_rollbackable:true});
    res.json({success, failed, skipped, errors, task_id:taskId});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// 批量设置是否重点关注
app.post('/api/inventory/batch-set-focused', requireApiPermission('inventory_import'), (req, res) => {
  try {
    const { ids, is_focused, reason } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: '未选择记录' });
    const taskId = createBatchTask({task_name:'批量设置重点关注', operation_type:'set_focused', operator_id:req.currentUserId, operator_name:req.currentUserName, page:'inventory', total_count:ids.length, is_rollbackable:true});
    const errors = [];
    let success = 0, failed = 0, skipped = 0;
    transaction(() => {
      ids.forEach(id => {
        try {
          const inv = queryOne('SELECT * FROM inventory WHERE id=?', [id]);
          if (!inv) { skipped++; errors.push({id, reason:'记录不存在'}); return; }
          const oldVal = inv.is_focused;
          run('UPDATE inventory SET is_focused=?, updated_at=datetime(\'now\') WHERE id=?', [is_focused?1:0, id]);
          logOperation({operator_id:req.currentUserId, operator_name:req.currentUserName, page:'inventory', operation_type:'set_focused', target_ids:[id], affected_count:1, old_values:{is_focused:oldVal}, new_values:{is_focused:is_focused?1:0}, reason:reason||'', triggered_recalc:0, is_rollbackable:1});
          success++;
        } catch(e) { failed++; errors.push({id, reason:e.message}); }
      });
    });
    finishBatchTask(taskId, {success, failed, skipped, errors, is_rollbackable:true});
    res.json({success, failed, skipped, errors, task_id:taskId});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// 批量设置安全库存
app.post('/api/inventory/batch-set-safety-stock', requireApiPermission('inventory_import'), (req, res) => {
  try {
    const { ids, safety_stock, reason } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: '未选择记录' });
    const val = parseInt(safety_stock);
    if (isNaN(val) || val < 0) return res.status(400).json({ error: '安全库存必须为非负整数' });
    const taskId = createBatchTask({task_name:'批量设置安全库存', operation_type:'set_safety_stock', operator_id:req.currentUserId, operator_name:req.currentUserName, page:'inventory', total_count:ids.length, is_rollbackable:true});
    const errors = [];
    let success = 0, failed = 0, skipped = 0;
    transaction(() => {
      ids.forEach(id => {
        try {
          const inv = queryOne('SELECT * FROM inventory WHERE id=?', [id]);
          if (!inv) { skipped++; errors.push({id, reason:'记录不存在'}); return; }
          const oldVal = inv.safety_stock;
          run('UPDATE inventory SET safety_stock=?, updated_at=datetime(\'now\') WHERE id=?', [val, id]);
          recalcInventoryForSku(inv.sku_code, inv.country, inv.warehouse);
          logOperation({operator_id:req.currentUserId, operator_name:req.currentUserName, page:'inventory', operation_type:'set_safety_stock', target_ids:[id], affected_count:1, old_values:{safety_stock:oldVal}, new_values:{safety_stock:val}, reason:reason||'', triggered_recalc:1, is_rollbackable:1});
          success++;
        } catch(e) { failed++; errors.push({id, reason:e.message}); }
      });
    });
    finishBatchTask(taskId, {success, failed, skipped, errors, is_rollbackable:true});
    res.json({success, failed, skipped, errors, task_id:taskId});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// 批量设置目标周转月数
app.post('/api/inventory/batch-set-turnover', requireApiPermission('inventory_import'), (req, res) => {
  try {
    const { ids, target_turnover_months, reason } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: '未选择记录' });
    const val = parseFloat(target_turnover_months);
    if (isNaN(val) || val < 0) return res.status(400).json({ error: '目标周转月数必须为非负数' });
    const taskId = createBatchTask({task_name:'批量设置目标周转月数', operation_type:'set_turnover', operator_id:req.currentUserId, operator_name:req.currentUserName, page:'inventory', total_count:ids.length, is_rollbackable:true});
    const errors = [];
    let success = 0, failed = 0, skipped = 0;
    transaction(() => {
      ids.forEach(id => {
        try {
          const inv = queryOne('SELECT * FROM inventory WHERE id=?', [id]);
          if (!inv) { skipped++; errors.push({id, reason:'记录不存在'}); return; }
          const oldVal = inv.target_turnover_months;
          run('UPDATE inventory SET target_turnover_months=?, updated_at=datetime(\'now\') WHERE id=?', [val, id]);
          recalcInventoryForSku(inv.sku_code, inv.country, inv.warehouse);
          logOperation({operator_id:req.currentUserId, operator_name:req.currentUserName, page:'inventory', operation_type:'set_turnover', target_ids:[id], affected_count:1, old_values:{target_turnover_months:oldVal}, new_values:{target_turnover_months:val}, reason:reason||'', triggered_recalc:1, is_rollbackable:1});
          success++;
        } catch(e) { failed++; errors.push({id, reason:e.message}); }
      });
    });
    finishBatchTask(taskId, {success, failed, skipped, errors, is_rollbackable:true});
    res.json({success, failed, skipped, errors, task_id:taskId});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// 批量设置补货规则
app.post('/api/inventory/batch-set-replenish-rule', requireApiPermission('inventory_import'), (req, res) => {
  try {
    const { ids, replenishment_rule, reason } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: '未选择记录' });
    const taskId = createBatchTask({task_name:'批量设置补货规则', operation_type:'set_replenish_rule', operator_id:req.currentUserId, operator_name:req.currentUserName, page:'inventory', total_count:ids.length, is_rollbackable:true});
    const errors = [];
    let success = 0, failed = 0, skipped = 0;
    transaction(() => {
      ids.forEach(id => {
        try {
          const inv = queryOne('SELECT * FROM inventory WHERE id=?', [id]);
          if (!inv) { skipped++; errors.push({id, reason:'记录不存在'}); return; }
          const oldVal = inv.replenishment_rule;
          run('UPDATE inventory SET replenishment_rule=?, updated_at=datetime(\'now\') WHERE id=?', [replenishment_rule||'', id]);
          logOperation({operator_id:req.currentUserId, operator_name:req.currentUserName, page:'inventory', operation_type:'set_replenish_rule', target_ids:[id], affected_count:1, old_values:{replenishment_rule:oldVal}, new_values:{replenishment_rule:replenishment_rule||''}, reason:reason||'', triggered_recalc:0, is_rollbackable:1});
          success++;
        } catch(e) { failed++; errors.push({id, reason:e.message}); }
      });
    });
    finishBatchTask(taskId, {success, failed, skipped, errors, is_rollbackable:true});
    res.json({success, failed, skipped, errors, task_id:taskId});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// 批量设置库存备注
app.post('/api/inventory/batch-set-remark', requireApiPermission('inventory_import'), (req, res) => {
  try {
    const { ids, inventory_remark, reason } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: '未选择记录' });
    const taskId = createBatchTask({task_name:'批量设置库存备注', operation_type:'set_remark', operator_id:req.currentUserId, operator_name:req.currentUserName, page:'inventory', total_count:ids.length, is_rollbackable:true});
    const errors = [];
    let success = 0, failed = 0, skipped = 0;
    transaction(() => {
      ids.forEach(id => {
        try {
          const inv = queryOne('SELECT * FROM inventory WHERE id=?', [id]);
          if (!inv) { skipped++; errors.push({id, reason:'记录不存在'}); return; }
          const oldVal = inv.inventory_remark;
          run('UPDATE inventory SET inventory_remark=?, updated_at=datetime(\'now\') WHERE id=?', [inventory_remark||'', id]);
          logOperation({operator_id:req.currentUserId, operator_name:req.currentUserName, page:'inventory', operation_type:'set_remark', target_ids:[id], affected_count:1, old_values:{inventory_remark:oldVal}, new_values:{inventory_remark:inventory_remark||''}, reason:reason||'', triggered_recalc:0, is_rollbackable:1});
          success++;
        } catch(e) { failed++; errors.push({id, reason:e.message}); }
      });
    });
    finishBatchTask(taskId, {success, failed, skipped, errors, is_rollbackable:true});
    res.json({success, failed, skipped, errors, task_id:taskId});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// 批量发起库存调整单
app.post('/api/inventory/batch-adjust', requireApiPermission('inventory_import'), (req, res) => {
  try {
    const { ids, adjust_type, reason } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: '未选择记录' });
    if (!reason) return res.status(400).json({ error: '调整原因不能为空' });
    const taskId = createBatchTask({task_name:'批量发起库存调整单', operation_type:'inventory_adjust', operator_id:req.currentUserId, operator_name:req.currentUserName, page:'inventory', total_count:ids.length, is_rollbackable:false});
    const errors = [];
    let success = 0, failed = 0, skipped = 0;
    transaction(() => {
      ids.forEach(id => {
        try {
          const inv = queryOne('SELECT * FROM inventory WHERE id=?', [id]);
          if (!inv) { skipped++; errors.push({id, reason:'记录不存在'}); return; }
          // 创建调整单记录（待审批，不直接修改库存）
          const adjNo = `ADJ-${Date.now()}-${Math.random().toString(36).substring(2,6)}`;
          run(`INSERT INTO inventory_adjustments (id, adj_no, inventory_id, sku_code, country, warehouse, before_qty, adjust_qty, after_qty, adjust_type, reason, operator_id, operator_name, approval_status) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, 'pending')`,
            [genId('adj'), adjNo, id, inv.sku_code, inv.country, inv.warehouse, inv.available_qty, inv.available_qty, adjust_type||'manual', reason, req.currentUserId, req.currentUserName]);
          logOperation({operator_id:req.currentUserId, operator_name:req.currentUserName, page:'inventory', operation_type:'inventory_adjust', target_ids:[id], affected_count:1, old_values:{available_qty:inv.available_qty}, new_values:{adjustment_no:adjNo}, reason, triggered_recalc:0, is_rollbackable:0});
          success++;
        } catch(e) { failed++; errors.push({id, reason:e.message}); }
      });
    });
    finishBatchTask(taskId, {success, failed, skipped, errors, is_rollbackable:false});
    res.json({success, failed, skipped, errors, task_id:taskId});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// 库存批量删除（带关联数据检查，强制 reason）
app.post('/api/inventory/batch-delete', requireApiPermission('inventory_import'), (req, res) => {
  try {
    const { ids, reason } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: '未选择记录' });
    if (!reason || !reason.trim()) return res.status(400).json({ error: '删除原因不能为空' });
    // 关联数据检查
    const checks = [
      { table: 'inventory_imports', label: '库存导入' },
      { table: 'outbound_records', label: '出库记录' },
      { table: 'sales_records', label: '销售明细' },
      { table: 'inventory_adjustments', label: '库存调整单' }
    ];
    const result = { deleted: 0, failed: 0, errors: [] };
    transaction(() => {
      ids.forEach(id => {
        try {
          const inv = queryOne('SELECT * FROM inventory WHERE id=?', [id]);
          if (!inv) { result.failed++; result.errors.push({id, reason:'记录不存在'}); return; }
          // 检查关联数据
          for (const c of checks) {
            const keyCol = c.table === 'inventory_imports' || c.table === 'inventory_adjustments' ? 'sku_code' : 'sku_code';
            const r = queryOne(`SELECT COUNT(*) as cnt FROM ${c.table} WHERE sku_code=? AND country=? AND warehouse=?`, [inv.sku_code, inv.country, inv.warehouse]);
            if (r.cnt > 0) {
              result.failed++;
              result.errors.push({id, sku_code:inv.sku_code, country:inv.country, warehouse:inv.warehouse, reason:`已关联${c.label}（${r.cnt}条），不允许删除`});
              return;
            }
          }
          run('DELETE FROM inventory WHERE id=?', [id]);
          logOperation({
            operator_id:req.currentUserId, operator_name:req.currentUserName,
            page:'inventory', operation_type:'delete',
            target_ids:[id], affected_count:1,
            old_values:{sku_code:inv.sku_code, country:inv.country, warehouse:inv.warehouse, available_qty:inv.available_qty},
            new_values:{},
            reason:reason.trim(), triggered_recalc:1, is_rollbackable:0
          });
          result.deleted++;
        } catch(e) { result.failed++; result.errors.push({id, reason:e.message}); }
      });
    });
    res.json(result);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// 库存批量操作预览
app.post('/api/inventory/batch-preview', requireApiPermission('inventory_view'), (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: '未选择记录' });
    const placeholders = ids.map(()=>'?').join(',');
    const rows = query(`SELECT i.*, s.product_name, s.brand FROM inventory i LEFT JOIN skus s ON i.sku_code=s.sku_code WHERE i.id IN (${placeholders})`, ids).rows;
    const skuSet = new Set(rows.map(r=>r.sku_code));
    const totalQty = rows.reduce((s,r)=>s+(r.available_qty||0), 0);
    res.json({
      total_records: rows.length,
      total_records: rows.length,
      sku_count: skuSet.size,
      total_available_qty: totalQty,
      countries: [...new Set(rows.map(r=>r.country))],
      warehouses: [...new Set(rows.map(r=>r.warehouse))]
    });
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ==================== 出库数据批量操作 ====================

// 批量作废
app.post('/api/outbound-records/batch-void', requireApiPermission('outbound_create'), (req, res) => {
  try {
    const { ids, void_reason } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: '未选择记录' });
    if (!void_reason) return res.status(400).json({ error: '作废原因不能为空' });
    const taskId = createBatchTask({task_name:'批量作废出库记录', operation_type:'void', operator_id:req.currentUserId, operator_name:req.currentUserName, page:'outbound', total_count:ids.length, is_rollbackable:false});
    const errors = [];
    let success = 0, failed = 0, skipped = 0;
    const affectedSkus = []; // 需要重算的SKU+国家+仓库

    transaction(() => {
      ids.forEach(id => {
        try {
          const ob = queryOne('SELECT * FROM outbound_records WHERE id=?', [id]);
          if (!ob) { skipped++; errors.push({id, reason:'记录不存在'}); return; }
          if (ob.outbound_status === 'voided') { skipped++; errors.push({id, reason:'已作废记录不能重复作废'}); return; }
          // 作废
          run('UPDATE outbound_records SET outbound_status=?, void_reason=?, voided_at=datetime(\'now\'), voided_by=? WHERE id=?',
            ['voided', void_reason, req.currentUserName, id]);
          // 回滚库存：只有 inventory_effect='deducted'（当初扣减了库存）才回滚
          if (ob.inventory_effect === 'deducted' || (ob.consume_inventory === 1 && !ob.inventory_effect)) {
            const inv = queryOne('SELECT * FROM inventory WHERE sku_code=? AND country=? AND warehouse=?', [ob.sku_code, ob.country, ob.warehouse]);
            if (inv) {
              run('UPDATE inventory SET available_qty=available_qty+?, updated_at=datetime(\'now\') WHERE id=?', [ob.quantity, inv.id]);
              affectedSkus.push({sku_code: ob.sku_code, country: ob.country, warehouse: ob.warehouse});
            }
          }
          logOperation({operator_id:req.currentUserId, operator_name:req.currentUserName, page:'outbound', operation_type:'void', target_ids:[id], affected_count:1, old_values:{outbound_status:'normal', inventory_effect: ob.inventory_effect}, new_values:{outbound_status:'voided', void_reason}, reason:void_reason, triggered_recalc:1, is_rollbackable:0});
          success++;
        } catch(e) { failed++; errors.push({id, reason:e.message}); }
      });
      // 重算受影响的库存
      affectedSkus.forEach(s => recalcInventoryForSku(s.sku_code, s.country, s.warehouse));
    });
    finishBatchTask(taskId, {success, failed, skipped, errors, is_rollbackable:false});
    res.json({success, failed, skipped, errors, task_id:taskId, recalc_count: affectedSkus.length});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// 批量修改出库类型
app.post('/api/outbound-records/batch-set-type', requireApiPermission('outbound_create'), (req, res) => {
  try {
    const { ids, outbound_type, reason } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: '未选择记录' });
    if (!outbound_type) return res.status(400).json({ error: '出库类型不能为空' });
    const taskId = createBatchTask({task_name:'批量修改出库类型', operation_type:'set_type', operator_id:req.currentUserId, operator_name:req.currentUserName, page:'outbound', total_count:ids.length, is_rollbackable:true});
    const errors = [];
    let success = 0, failed = 0, skipped = 0;
    const affectedSkus = [];
    transaction(() => {
      ids.forEach(id => {
        try {
          const ob = queryOne('SELECT * FROM outbound_records WHERE id=?', [id]);
          if (!ob) { skipped++; errors.push({id, reason:'记录不存在'}); return; }
          if (ob.outbound_status === 'voided') { skipped++; errors.push({id, reason:'已作废记录不能修改'}); return; }
          const oldType = ob.outbound_type;
          // 根据新类型自动设置预测参与
          const newForecast = OUTBOUND_TYPE_FORECAST_DEFAULT[outbound_type] !== undefined ? OUTBOUND_TYPE_FORECAST_DEFAULT[outbound_type] : ob.count_for_forecast;
          run('UPDATE outbound_records SET outbound_type=?, count_for_forecast=? WHERE id=?', [outbound_type, newForecast, id]);
          logOperation({operator_id:req.currentUserId, operator_name:req.currentUserName, page:'outbound', operation_type:'set_type', target_ids:[id], affected_count:1, old_values:{outbound_type:oldType, count_for_forecast:ob.count_for_forecast}, new_values:{outbound_type, count_for_forecast:newForecast}, reason:reason||'', triggered_recalc:1, is_rollbackable:1});
          if (ob.count_for_forecast !== newForecast) affectedSkus.push({sku_code: ob.sku_code, country: ob.country, warehouse: ob.warehouse});
          success++;
        } catch(e) { failed++; errors.push({id, reason:e.message}); }
      });
      affectedSkus.forEach(s => recalcInventoryForSku(s.sku_code, s.country, s.warehouse));
    });
    finishBatchTask(taskId, {success, failed, skipped, errors, is_rollbackable:true});
    res.json({success, failed, skipped, errors, task_id:taskId});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// 批量修改渠道
app.post('/api/outbound-records/batch-set-channel', requireApiPermission('outbound_create'), (req, res) => {
  try {
    const { ids, channel, reason } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: '未选择记录' });
    const taskId = createBatchTask({task_name:'批量修改渠道', operation_type:'set_channel', operator_id:req.currentUserId, operator_name:req.currentUserName, page:'outbound', total_count:ids.length, is_rollbackable:true});
    const errors = [];
    let success = 0, failed = 0, skipped = 0;
    transaction(() => {
      ids.forEach(id => {
        try {
          const ob = queryOne('SELECT * FROM outbound_records WHERE id=?', [id]);
          if (!ob) { skipped++; errors.push({id, reason:'记录不存在'}); return; }
          if (ob.outbound_status === 'voided') { skipped++; errors.push({id, reason:'已作废记录不能修改'}); return; }
          const oldVal = ob.channel;
          run('UPDATE outbound_records SET channel=? WHERE id=?', [channel||'', id]);
          logOperation({operator_id:req.currentUserId, operator_name:req.currentUserName, page:'outbound', operation_type:'set_channel', target_ids:[id], affected_count:1, old_values:{channel:oldVal}, new_values:{channel:channel||''}, reason:reason||'', triggered_recalc:0, is_rollbackable:1});
          success++;
        } catch(e) { failed++; errors.push({id, reason:e.message}); }
      });
    });
    finishBatchTask(taskId, {success, failed, skipped, errors, is_rollbackable:true});
    res.json({success, failed, skipped, errors, task_id:taskId});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// 批量修改平台
app.post('/api/outbound-records/batch-set-platform', requireApiPermission('outbound_create'), (req, res) => {
  try {
    const { ids, platform, reason } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: '未选择记录' });
    const taskId = createBatchTask({task_name:'批量修改平台', operation_type:'set_platform', operator_id:req.currentUserId, operator_name:req.currentUserName, page:'outbound', total_count:ids.length, is_rollbackable:true});
    const errors = [];
    let success = 0, failed = 0, skipped = 0;
    transaction(() => {
      ids.forEach(id => {
        try {
          const ob = queryOne('SELECT * FROM outbound_records WHERE id=?', [id]);
          if (!ob) { skipped++; errors.push({id, reason:'记录不存在'}); return; }
          if (ob.outbound_status === 'voided') { skipped++; errors.push({id, reason:'已作废记录不能修改'}); return; }
          const oldVal = ob.platform;
          run('UPDATE outbound_records SET platform=? WHERE id=?', [platform||'', id]);
          logOperation({operator_id:req.currentUserId, operator_name:req.currentUserName, page:'outbound', operation_type:'set_platform', target_ids:[id], affected_count:1, old_values:{platform:oldVal}, new_values:{platform:platform||''}, reason:reason||'', triggered_recalc:0, is_rollbackable:1});
          success++;
        } catch(e) { failed++; errors.push({id, reason:e.message}); }
      });
    });
    finishBatchTask(taskId, {success, failed, skipped, errors, is_rollbackable:true});
    res.json({success, failed, skipped, errors, task_id:taskId});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// 批量设置是否参与预测
app.post('/api/outbound-records/batch-set-forecast', requireApiPermission('outbound_create'), (req, res) => {
  try {
    const { ids, count_for_forecast, reason } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: '未选择记录' });
    const forecastVal = count_for_forecast ? 1 : 0;
    const taskId = createBatchTask({task_name:'批量设置是否参与预测', operation_type:'set_forecast', operator_id:req.currentUserId, operator_name:req.currentUserName, page:'outbound', total_count:ids.length, is_rollbackable:true});
    const errors = [];
    let success = 0, failed = 0, skipped = 0;
    const affectedSkus = [];
    transaction(() => {
      ids.forEach(id => {
        try {
          const ob = queryOne('SELECT * FROM outbound_records WHERE id=?', [id]);
          if (!ob) { skipped++; errors.push({id, reason:'记录不存在'}); return; }
          if (ob.outbound_status === 'voided') { skipped++; errors.push({id, reason:'已作废记录不能修改'}); return; }
          const oldVal = ob.count_for_forecast;
          run('UPDATE outbound_records SET count_for_forecast=? WHERE id=?', [forecastVal, id]);
          logOperation({operator_id:req.currentUserId, operator_name:req.currentUserName, page:'outbound', operation_type:'set_forecast', target_ids:[id], affected_count:1, old_values:{count_for_forecast:oldVal}, new_values:{count_for_forecast:forecastVal}, reason:reason||'', triggered_recalc:1, is_rollbackable:1});
          if (oldVal !== forecastVal) affectedSkus.push({sku_code: ob.sku_code, country: ob.country, warehouse: ob.warehouse});
          success++;
        } catch(e) { failed++; errors.push({id, reason:e.message}); }
      });
      affectedSkus.forEach(s => recalcInventoryForSku(s.sku_code, s.country, s.warehouse));
    });
    finishBatchTask(taskId, {success, failed, skipped, errors, is_rollbackable:true});
    res.json({success, failed, skipped, errors, task_id:taskId});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// 批量修改备注
app.post('/api/outbound-records/batch-set-remark', requireApiPermission('outbound_create'), (req, res) => {
  try {
    const { ids, remark, reason } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: '未选择记录' });
    const taskId = createBatchTask({task_name:'批量修改备注', operation_type:'set_remark', operator_id:req.currentUserId, operator_name:req.currentUserName, page:'outbound', total_count:ids.length, is_rollbackable:true});
    const errors = [];
    let success = 0, failed = 0, skipped = 0;
    transaction(() => {
      ids.forEach(id => {
        try {
          const ob = queryOne('SELECT * FROM outbound_records WHERE id=?', [id]);
          if (!ob) { skipped++; errors.push({id, reason:'记录不存在'}); return; }
          if (ob.outbound_status === 'voided') { skipped++; errors.push({id, reason:'已作废记录不能修改'}); return; }
          const oldVal = ob.remark;
          run('UPDATE outbound_records SET remark=? WHERE id=?', [remark||'', id]);
          logOperation({operator_id:req.currentUserId, operator_name:req.currentUserName, page:'outbound', operation_type:'set_remark', target_ids:[id], affected_count:1, old_values:{remark:oldVal}, new_values:{remark:remark||''}, reason:reason||'', triggered_recalc:0, is_rollbackable:1});
          success++;
        } catch(e) { failed++; errors.push({id, reason:e.message}); }
      });
    });
    finishBatchTask(taskId, {success, failed, skipped, errors, is_rollbackable:true});
    res.json({success, failed, skipped, errors, task_id:taskId});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// 出库批量操作预览
app.post('/api/outbound-records/batch-preview', requireApiPermission('outbound_view'), (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: '未选择记录' });
    const placeholders = ids.map(()=>'?').join(',');
    const rows = query(`SELECT o.*, s.brand FROM outbound_records o LEFT JOIN skus s ON o.sku_code=s.sku_code WHERE o.id IN (${placeholders})`, ids).rows;
    const skuSet = new Set(rows.map(r=>r.sku_code));
    const totalQty = rows.reduce((s,r)=>s+(r.quantity||0), 0);
    const voidedCount = rows.filter(r=>r.outbound_status==='voided').length;
    const forecastCount = rows.filter(r=>r.count_for_forecast===1).length;
    res.json({
      total_records: rows.length,
      sku_count: skuSet.size,
      total_quantity: totalQty,
      voided_count: voidedCount,
      forecast_count: forecastCount
    });
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ==================== 批量任务中心 & 操作日志 ====================

app.get('/api/batch-tasks', requireApiPermission('inventory_view'), (req, res) => {
  try {
    const { page, limit } = req.query;
    let sql = 'SELECT * FROM batch_tasks';
    const params = [];
    if (page) { sql += ' WHERE page = ?'; params.push(page); }
    sql += ' ORDER BY started_at DESC';
    if (limit) { sql += ' LIMIT ?'; params.push(parseInt(limit)); }
    else { sql += ' LIMIT 100'; }
    res.json(query(sql, params).rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.get('/api/batch-tasks/:id', requireApiPermission('inventory_view'), (req, res) => {
  try {
    const task = queryOne('SELECT * FROM batch_tasks WHERE id=?', [req.params.id]);
    if (!task) return res.status(404).json({ error: '任务不存在' });
    res.json(task);
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.get('/api/operation-logs', requireApiPermission('inventory_view'), (req, res) => {
  try {
    const { page, operation_type, limit } = req.query;
    let sql = 'SELECT * FROM operation_logs';
    const params = [];
    const conditions = [];
    if (page) { conditions.push('page = ?'); params.push(page); }
    if (operation_type) { conditions.push('operation_type = ?'); params.push(operation_type); }
    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(parseInt(limit) || 100);
    res.json(query(sql, params).rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.get('/api/inventory-adjustments', requireApiPermission('inventory_view'), (req, res) => {
  try {
    const { approval_status } = req.query;
    let sql = 'SELECT * FROM inventory_adjustments';
    const params = [];
    if (approval_status) { sql += ' WHERE approval_status = ?'; params.push(approval_status); }
    sql += ' ORDER BY created_at DESC LIMIT 100';
    res.json(query(sql, params).rows);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// 库存调整单审批
app.post('/api/inventory-adjustments/:id/approve', requireApiPermission('inventory_import'), (req, res) => {
  try {
    const adj = queryOne('SELECT * FROM inventory_adjustments WHERE id=?', [req.params.id]);
    if (!adj) return res.status(404).json({ error: '调整单不存在' });
    if (adj.approval_status !== 'pending') return res.status(400).json({ error: '调整单状态不允许审批' });
    // 审批通过：执行库存调整
    if (req.body.action === 'approve') {
      const inv = queryOne('SELECT * FROM inventory WHERE sku_code=? AND country=? AND warehouse=?', [adj.sku_code, adj.country, adj.warehouse]);
      if (inv) {
        const afterQty = (inv.available_qty || 0) + (req.body.adjust_qty || 0);
        run('UPDATE inventory SET available_qty=?, updated_at=datetime(\'now\') WHERE id=?', [afterQty, inv.id]);
        run('UPDATE inventory_adjustments SET approval_status=?, after_qty=?, executed_at=datetime(\'now\') WHERE id=?', ['approved', afterQty, adj.id]);
        recalcInventoryForSku(adj.sku_code, adj.country, adj.warehouse);
      }
    } else {
      run('UPDATE inventory_adjustments SET approval_status=? WHERE id=?', ['rejected', adj.id]);
    }
    logOperation({operator_id:req.currentUserId, operator_name:req.currentUserName, page:'inventory', operation_type:'adjust_approve', target_ids:[adj.id], affected_count:1, old_values:{approval_status:'pending'}, new_values:{approval_status:req.body.action==='approve'?'approved':'rejected'}, reason:req.body.reason||'', triggered_recalc:req.body.action==='approve'?1:0, is_rollbackable:0});
    res.json({success:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ==================== 启动服务 ====================
// 顶层异常保护：避免未捕获异常导致进程静默退出（进程退出后前端会 Failed to fetch）
process.on('uncaughtException', (err) => {
  console.error('[FATAL] 未捕获异常，服务即将退出:', err && err.stack || err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] 未处理的 Promise 拒绝:', reason);
});

const server = app.listen(PORT, () => {
  console.log(`\n[Server] 进销存管理系统已启动: http://localhost:${PORT}`);
  console.log(`[Server] 本地账号入口: http://localhost:${PORT}?admin`);
  console.log(`[Server] 默认账号: admin / admin\n`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n[ERROR] 端口 ${PORT} 已被占用，服务无法启动。`);
    console.error(`        请先停止占用该端口的程序，或修改 server.js 中的 PORT 后重试。`);
    console.error(`        否则前端访问时会提示 "Failed to fetch"（连不上后端）。\n`);
  } else {
    console.error('[ERROR] 服务启动失败:', err && err.stack || err);
  }
  process.exit(1);
});
