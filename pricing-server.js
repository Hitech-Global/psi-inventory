'use strict';

const core = require('./pricing-core');

function registerPricingRoutes(app, deps) {
  const query = deps.query;
  const queryOne = deps.queryOne;
  const run = deps.run;
  const genId = deps.genId;
  const requireApiPermission = deps.requireApiPermission;
  const asyncHandler = deps.asyncHandler;
  const buildDashboardScopeFilters = deps.buildDashboardScopeFilters || (() => ({ inventory: { sql: '', params: [] }, ci: { sql: '', params: [] } }));
  const needsDataScopeFilter = deps.needsDataScopeFilter || (() => false);

  const canViewAmounts = req => {
    const perms = req.currentUserPermissions || [];
    return perms.includes('*') || perms.includes('ci_amount_view');
  };
  const canViewInventory = req => {
    const perms = req.currentUserPermissions || [];
    return perms.includes('*') || perms.includes('inventory_view');
  };
  const requirePricingView = requireApiPermission('pricing_view');
  const requirePricingEdit = requireApiPermission('pricing_edit');

  function safeNumber(value, fallback) {
    if (value === '' || value === null || value === undefined) return fallback === undefined ? null : fallback;
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback === undefined ? null : fallback;
  }

  function safeJson(value, fallback) {
    try { return JSON.parse(value); } catch (_) { return fallback; }
  }

  function getScheme(id) {
    return queryOne('SELECT * FROM pricing_schemes WHERE id = ?', [String(id || '')]);
  }

  function schemeAllowed(req, scheme) {
    if (!scheme) return false;
    if (!needsDataScopeFilter(req)) return true;
    const scope = req.currentUserDataScope || {};
    const brands = Array.isArray(scope.brands) ? scope.brands : [];
    if (brands.length && !brands.includes(scheme.brand)) return false;

    const country = queryOne('SELECT id FROM countries WHERE name = ?', [scheme.country]);
    const countryIds = Array.isArray(scope.countries) ? scope.countries : [];
    const warehouseIds = Array.isArray(scope.warehouses) ? scope.warehouses : [];
    if (countryIds.length && country && countryIds.includes(country.id)) return true;
    if (countryIds.length && !warehouseIds.length) return false;
    if (warehouseIds.length) {
      const allowed = query('SELECT id FROM warehouses WHERE id IN (' + warehouseIds.map(() => '?').join(',') + ') AND country_id = ?',
        warehouseIds.concat(country ? [country.id] : [''])).rows;
      return allowed.length > 0;
    }
    return !countryIds.length;
  }

  function requireScheme(req, res) {
    const scheme = getScheme(req.params.id);
    if (!scheme || !schemeAllowed(req, scheme)) {
      res.status(404).json({ error: '价格方案不存在或无权访问' });
      return null;
    }
    return scheme;
  }

  function createVersion(schemeId, summary, actor) {
    const scheme = getScheme(schemeId);
    if (!scheme) return null;
    const versionNo = Number(scheme.current_version || 0) + 1;
    const snapshot = {
      scheme: scheme,
      fields: query('SELECT * FROM pricing_fields WHERE scheme_id = ? ORDER BY display_order, field_name', [schemeId]).rows,
      rules: query('SELECT * FROM pricing_rules WHERE scheme_id = ? ORDER BY created_at, id', [schemeId]).rows,
      sku_values: query('SELECT * FROM pricing_sku_values WHERE scheme_id = ? ORDER BY sku_code, field_key', [schemeId]).rows
    };
    const now = new Date().toISOString();
    run('INSERT INTO pricing_scheme_versions (id, scheme_id, version_no, change_summary, snapshot_json, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [genId('pversion'), schemeId, versionNo, String(summary || '更新价格方案'), JSON.stringify(snapshot), String(actor || ''), now]);
    run('UPDATE pricing_schemes SET current_version = ?, updated_by = ?, updated_at = ? WHERE id = ?',
      [versionNo, String(actor || ''), now, schemeId]);
    return versionNo;
  }

  function updateSchemeTimestamp(schemeId, actor) {
    run('UPDATE pricing_schemes SET updated_by = ?, updated_at = ? WHERE id = ?',
      [String(actor || ''), new Date().toISOString(), schemeId]);
  }

  function getSchemeCategories(scheme) {
    return query("SELECT DISTINCT COALESCE(NULLIF(TRIM(category), ''), '未分类') AS category FROM skus WHERE brand = ? ORDER BY category",
      [scheme.brand]).rows.map(row => row.category);
  }

  function getSchemeSkus(scheme, req) {
    const scope = req.currentUserDataScope || {};
    const scoped = needsDataScopeFilter(req);
    const country = queryOne('SELECT id FROM countries WHERE name = ?', [scheme.country]);
    const countryIds = scoped && Array.isArray(scope.countries) ? scope.countries : [];
    const warehouseIds = scoped && Array.isArray(scope.warehouses) ? scope.warehouses : [];
    let inventoryFilter = 'i.country = ?';
    const inventoryParams = [scheme.country];

    if (scoped && warehouseIds.length && !(country && countryIds.includes(country.id))) {
      const allowedWarehouses = query('SELECT name FROM warehouses WHERE id IN (' + warehouseIds.map(() => '?').join(',') + ') AND country_id = ?',
        warehouseIds.concat(country ? [country.id] : [''])).rows.map(row => row.name).filter(Boolean);
      if (!allowedWarehouses.length) {
        inventoryFilter += ' AND 1 = 0';
      } else {
        inventoryFilter += ' AND i.warehouse IN (' + allowedWarehouses.map(() => '?').join(',') + ')';
        inventoryParams.push(...allowedWarehouses);
      }
    } else if (scoped && countryIds.length && !(country && countryIds.includes(country.id))) {
      inventoryFilter += ' AND 1 = 0';
    }

    const stockRows = query(
      'SELECT i.sku_code, SUM(COALESCE(i.available_qty, 0)) AS stock_qty ' +
      'FROM inventory i WHERE ' + inventoryFilter + ' GROUP BY i.sku_code',
      inventoryParams
    ).rows;
    const stockBySku = new Map(stockRows.map(row => [String(row.sku_code), Number(row.stock_qty || 0)]));
    const skuRows = query(
      'SELECT sku_code, product_name, brand, category, model, status, lifecycle_status, purchase_price_rmb ' +
      'FROM skus WHERE brand = ? ORDER BY COALESCE(NULLIF(TRIM(category), \'\'), \'未分类\'), sku_code',
      [scheme.brand]
    ).rows;
    const valueRows = query('SELECT * FROM pricing_sku_values WHERE scheme_id = ?', [scheme.id]).rows;
    const valuesBySku = new Map();
    valueRows.forEach(row => {
      const key = String(row.sku_code);
      if (!valuesBySku.has(key)) valuesBySku.set(key, {});
      valuesBySku.get(key)[String(row.field_key)] = row;
    });
    const fields = query('SELECT * FROM pricing_fields WHERE scheme_id = ? AND is_active = 1 ORDER BY display_order, field_name', [scheme.id]).rows;
    const rules = query("SELECT * FROM pricing_rules WHERE scheme_id = ? AND status = 'active' ORDER BY priority DESC, updated_at DESC", [scheme.id]).rows;
    const rulesByField = new Map();
    rules.forEach(rule => {
      const key = String(rule.field_id);
      if (!rulesByField.has(key)) rulesByField.set(key, []);
      rulesByField.get(key).push(rule);
    });

    return skuRows.map(sku => {
      const category = String(sku.category || '').trim();
      const skuValues = valuesBySku.get(String(sku.sku_code)) || {};
      const fobOverride = skuValues.FOB_RMB;
      const masterFob = safeNumber(sku.purchase_price_rmb, 0);
      const fob = fobOverride && fobOverride.value !== null && fobOverride.value !== undefined
        ? safeNumber(fobOverride.value, null)
        : (masterFob > 0 ? masterFob : null);
      const stockQty = stockBySku.has(String(sku.sku_code)) ? stockBySku.get(String(sku.sku_code)) : 0;
      const context = {
        FOB_RMB: fob,
        RMB_TO_LOCAL: safeNumber(scheme.exchange_rate, 0),
        EXCHANGE_RATE: safeNumber(scheme.exchange_rate, 0),
        INVENTORY_QTY: stockQty,
        SKU: 0
      };
      const fieldValues = {};
      const sortedFields = fields.slice().sort((a, b) => {
        const order = { cost: 1, fee: 2, other: 3 };
        return (order[a.group_type] || 3) - (order[b.group_type] || 3) ||
          Number(a.display_order || 0) - Number(b.display_order || 0);
      });
      sortedFields.forEach(field => {
        const override = skuValues[String(field.field_key)];
        let value = null;
        if (override && Number(override.is_applicable) === 0) {
          value = null;
        } else if (override && override.value !== null && override.value !== undefined && override.value !== '') {
          value = safeNumber(override.value, null);
        } else if (String(field.calculation_type || 'manual') === 'formula' && field.formula) {
          try { value = core.evaluateFormula(field.formula, context); } catch (_) { value = null; }
        } else {
          const fieldRules = rulesByField.get(String(field.id)) || [];
          const matched = core.resolvePricingRule(fieldRules, { sku_code: sku.sku_code, category: category });
          if (matched) {
            try { value = core.calculateRuleValue(matched, context); } catch (_) { value = null; }
          } else if (field.default_value !== null && field.default_value !== undefined && field.default_value !== '') {
            value = safeNumber(field.default_value, null);
          }
        }
        fieldValues[String(field.field_key)] = value;
        context[String(field.field_key).toUpperCase()] = value;
      });

      let srp = null;
      let formulaError = '';
      if (String(scheme.srp_formula || '').trim()) {
        try {
          srp = core.evaluateFormula(scheme.srp_formula, context);
          context.SRP = srp;
          context.SRP_LOCAL = srp;
        } catch (error) {
          formulaError = error.message;
        }
      } else {
        formulaError = '尚未设置 SRP 计算公式';
      }

      sortedFields.filter(field => field.group_type === 'fee').forEach(field => {
        const override = skuValues[String(field.field_key)];
        let value = fieldValues[String(field.field_key)];
        if (!(override && (override.value !== null && override.value !== undefined || Number(override.is_applicable) === 0)) &&
            !(String(field.calculation_type || 'manual') === 'formula' && field.formula)) {
          const fieldRules = rulesByField.get(String(field.id)) || [];
          const matched = core.resolvePricingRule(fieldRules, { sku_code: sku.sku_code, category: category });
          if (matched) {
            try { value = core.calculateRuleValue(matched, context); } catch (_) { value = null; }
          }
          fieldValues[String(field.field_key)] = value;
          context[String(field.field_key).toUpperCase()] = value;
        }
      });

      let deductions = 0;
      let hasDeduction = false;
      fields.forEach(field => {
        if (Number(field.include_in_profit) !== 1) return;
        const value = fieldValues[String(field.field_key)];
        if (value === null || value === undefined || !Number.isFinite(Number(value))) return;
        deductions += Number(value);
        hasDeduction = true;
      });
      const profit = srp === null ? null : Math.round((Number(srp) - deductions) * 10000) / 10000;
      const profitRate = srp && Number(srp) !== 0 ? Math.round((profit / Number(srp)) * 10000) / 100 : null;
      return {
        sku_code: sku.sku_code,
        product_name: sku.product_name || '',
        category: category || '未分类',
        brand: sku.brand,
        status: sku.status || '',
        lifecycle_status: sku.lifecycle_status || '',
        stock_qty: stockQty,
        fob_rmb: fob,
        fields: fieldValues,
        srp: srp === null ? null : Math.round(Number(srp) * 100) / 100,
        profit: profit,
        profit_rate: profitRate,
        formula_error: formulaError,
        has_deduction: hasDeduction
      };
    });
  }

  function snapshotResponse(scheme, req) {
    const fields = query('SELECT * FROM pricing_fields WHERE scheme_id = ? ORDER BY display_order, field_name', [scheme.id]).rows;
    const rules = canViewAmounts(req)
      ? query('SELECT * FROM pricing_rules WHERE scheme_id = ? ORDER BY priority DESC, created_at DESC', [scheme.id]).rows
      : [];
    return {
      scheme: scheme,
      fields: fields,
      rules: rules,
      categories: getSchemeCategories(scheme),
      can_edit: (req.currentUserPermissions || []).includes('*') || (req.currentUserPermissions || []).includes('pricing_edit'),
      amount_view_allowed: canViewAmounts(req),
      inventory_view_allowed: canViewInventory(req)
    };
  }

  app.get('/api/pricing/meta', requirePricingView, asyncHandler((req, res) => {
    const countries = query("SELECT id, name, code, default_currency FROM countries WHERE status = 'active' ORDER BY sort_order, name").rows;
    const brands = query("SELECT DISTINCT brand FROM skus WHERE brand IS NOT NULL AND TRIM(brand) <> '' ORDER BY brand").rows.map(row => row.brand);
    const currencies = query("SELECT code, name, symbol FROM currencies WHERE status = 'active' ORDER BY sort_order, code").rows;
    res.json({ countries: countries, brands: brands, currencies: currencies });
  }));

  app.get('/api/pricing/schemes', requirePricingView, asyncHandler((req, res) => {
    const filters = [];
    const params = [];
    if (req.query.country) { filters.push('country = ?'); params.push(String(req.query.country)); }
    if (req.query.brand) { filters.push('brand = ?'); params.push(String(req.query.brand)); }
    if (req.query.platform) { filters.push('platform = ?'); params.push(String(req.query.platform)); }
    if (req.query.status) { filters.push('status = ?'); params.push(String(req.query.status)); }
    if (needsDataScopeFilter(req)) {
      const scope = buildDashboardScopeFilters(req);
      const scoped = scope && scope.ci ? scope.ci : { sql: '', params: [] };
      if (scoped.sql) {
        const sql = 'SELECT id FROM pricing_schemes WHERE 1=1' + scoped.sql;
        const allowed = query(sql, scoped.params).rows.map(row => row.id);
        if (!allowed.length) return res.json([]);
        filters.push('id IN (' + allowed.map(() => '?').join(',') + ')');
        params.push(...allowed);
      }
    }
    const where = filters.length ? ' WHERE ' + filters.join(' AND ') : '';
    const rows = query('SELECT * FROM pricing_schemes' + where + ' ORDER BY updated_at DESC, created_at DESC', params).rows;
    res.json(rows);
  }));

  app.post('/api/pricing/schemes', requirePricingEdit, asyncHandler((req, res) => {
    const body = req.body || {};
    const country = String(body.country || '').trim();
    const brand = String(body.brand || '').trim();
    const platform = String(body.platform || '').trim();
    if (!country || !brand || !platform) return res.status(400).json({ error: '国家、品牌和电商平台不能为空' });
    if (!queryOne('SELECT id FROM countries WHERE name = ?', [country])) return res.status(400).json({ error: '国家不存在' });
    if (!queryOne('SELECT sku_code FROM skus WHERE brand = ? LIMIT 1', [brand])) return res.status(400).json({ error: '品牌不存在或没有 SKU 主数据' });
    const currency = String(body.currency || (queryOne('SELECT default_currency FROM countries WHERE name = ?', [country]) || {}).default_currency || '').toUpperCase();
    const id = genId('price');
    const now = new Date().toISOString();
    run('INSERT INTO pricing_schemes (id, country, brand, platform, store, currency, exchange_rate, status, description, effective_date, srp_formula, current_version, created_by, updated_by, created_at, updated_at) ' +
      "VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, '', 0, ?, ?, ?, ?)",
      [id, country, brand, platform, String(body.store || '').trim(), currency, safeNumber(body.exchange_rate, 0), String(body.description || ''), String(body.effective_date || ''), String(req.currentUserId || ''), String(req.currentUserId || ''), now, now]);
    const version = createVersion(id, '创建价格方案', req.currentUserId);
    res.status(201).json({ success: true, id: id, version: version });
  }));

  app.get('/api/pricing/schemes/:id', requirePricingView, asyncHandler((req, res) => {
    const scheme = requireScheme(req, res);
    if (!scheme) return;
    res.json(snapshotResponse(scheme, req));
  }));

  app.put('/api/pricing/schemes/:id', requirePricingEdit, asyncHandler((req, res) => {
    const scheme = requireScheme(req, res);
    if (!scheme) return;
    const body = req.body || {};
    const country = body.country === undefined ? scheme.country : String(body.country || '').trim();
    const brand = body.brand === undefined ? scheme.brand : String(body.brand || '').trim();
    const platform = body.platform === undefined ? scheme.platform : String(body.platform || '').trim();
    if (!country || !brand || !platform) return res.status(400).json({ error: '国家、品牌和电商平台不能为空' });
    if (!queryOne('SELECT id FROM countries WHERE name = ?', [country])) return res.status(400).json({ error: '国家不存在' });
    if (!queryOne('SELECT sku_code FROM skus WHERE brand = ? LIMIT 1', [brand])) return res.status(400).json({ error: '品牌不存在或没有 SKU 主数据' });
    const currency = String(body.currency === undefined ? scheme.currency : body.currency || '').toUpperCase();
    run('UPDATE pricing_schemes SET country = ?, brand = ?, platform = ?, store = ?, currency = ?, exchange_rate = ?, status = ?, description = ?, effective_date = ?, updated_by = ?, updated_at = ? WHERE id = ?',
      [country, brand, platform, String(body.store === undefined ? scheme.store : body.store || '').trim(), currency,
        safeNumber(body.exchange_rate === undefined ? scheme.exchange_rate : body.exchange_rate, 0),
        String(body.status === undefined ? scheme.status : body.status || 'draft'),
        String(body.description === undefined ? scheme.description : body.description || ''),
        String(body.effective_date === undefined ? scheme.effective_date : body.effective_date || ''),
        String(req.currentUserId || ''), new Date().toISOString(), scheme.id]);
    const version = createVersion(scheme.id, '修改价格方案设置', req.currentUserId);
    res.json({ success: true, version: version });
  }));

  app.get('/api/pricing/schemes/:id/rows', requirePricingView, asyncHandler((req, res) => {
    const scheme = requireScheme(req, res);
    if (!scheme) return;
    const rows = getSchemeSkus(scheme, req);
    const amountAllowed = canViewAmounts(req);
    const stockAllowed = canViewInventory(req);
    const safeRows = rows.map(row => {
      if (!stockAllowed) row.stock_qty = null;
      if (!amountAllowed) {
        row.fob_rmb = null;
        row.fields = {};
        row.srp = null;
        row.profit = null;
        row.profit_rate = null;
        row.formula_error = '没有查看金额的权限';
      }
      return row;
    });
    res.json({ rows: safeRows, amount_view_allowed: amountAllowed, inventory_view_allowed: stockAllowed });
  }));

  app.post('/api/pricing/schemes/:id/fields', requirePricingEdit, asyncHandler((req, res) => {
    const scheme = requireScheme(req, res);
    if (!scheme) return;
    const body = req.body || {};
    const fieldName = String(body.field_name || '').trim();
    if (!fieldName) return res.status(400).json({ error: '费用字段名称不能为空' });
    let fieldKey;
    try { fieldKey = core.normalizeFieldKey(body.field_key || fieldName); } catch (error) { return res.status(400).json({ error: error.message }); }
    if (queryOne('SELECT id FROM pricing_fields WHERE scheme_id = ? AND field_key = ?', [scheme.id, fieldKey])) {
      return res.status(409).json({ error: '字段编码已存在，请更换字段名称或编码' });
    }
    const groupType = ['cost', 'fee', 'other'].includes(String(body.group_type)) ? String(body.group_type) : 'fee';
    const valueType = ['currency', 'percent', 'number'].includes(String(body.value_type)) ? String(body.value_type) : 'currency';
    const calculationType = ['manual', 'formula'].includes(String(body.calculation_type)) ? String(body.calculation_type) : 'manual';
    const order = Number(queryOne('SELECT COALESCE(MAX(display_order),0) AS n FROM pricing_fields WHERE scheme_id = ?', [scheme.id]).n || 0) + 1;
    const id = genId('pfield');
    const now = new Date().toISOString();
    run('INSERT INTO pricing_fields (id, scheme_id, field_key, field_name, group_type, value_type, calculation_type, formula, currency, include_in_profit, is_active, display_order, created_at, updated_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)',
      [id, scheme.id, fieldKey, fieldName, groupType, valueType, calculationType, String(body.formula || ''), String(body.currency || scheme.currency || ''), body.include_in_profit === false ? 0 : 1, order, now, now]);
    const version = createVersion(scheme.id, '新增字段：' + fieldName, req.currentUserId);
    res.status(201).json({ success: true, id: id, version: version });
  }));

  app.put('/api/pricing/schemes/:id/fields/:fieldId', requirePricingEdit, asyncHandler((req, res) => {
    const scheme = requireScheme(req, res);
    if (!scheme) return;
    const field = queryOne('SELECT * FROM pricing_fields WHERE id = ? AND scheme_id = ?', [req.params.fieldId, scheme.id]);
    if (!field) return res.status(404).json({ error: '费用字段不存在' });
    const body = req.body || {};
    const fieldName = String(body.field_name === undefined ? field.field_name : body.field_name || '').trim();
    if (!fieldName) return res.status(400).json({ error: '字段名称不能为空' });
    const groupType = ['cost', 'fee', 'other'].includes(String(body.group_type)) ? String(body.group_type) : field.group_type;
    const valueType = ['currency', 'percent', 'number'].includes(String(body.value_type)) ? String(body.value_type) : field.value_type;
    const calculationType = ['manual', 'formula'].includes(String(body.calculation_type)) ? String(body.calculation_type) : field.calculation_type;
    run('UPDATE pricing_fields SET field_name = ?, group_type = ?, value_type = ?, calculation_type = ?, formula = ?, currency = ?, include_in_profit = ?, display_order = ?, updated_at = ? WHERE id = ? AND scheme_id = ?',
      [fieldName, groupType, valueType, calculationType, String(body.formula === undefined ? field.formula : body.formula || ''),
        String(body.currency === undefined ? field.currency : body.currency || ''), body.include_in_profit === undefined ? Number(field.include_in_profit) : (body.include_in_profit ? 1 : 0),
        safeNumber(body.display_order, Number(field.display_order || 0)), new Date().toISOString(), field.id, scheme.id]);
    const version = createVersion(scheme.id, '修改字段：' + fieldName, req.currentUserId);
    res.json({ success: true, version: version });
  }));

  app.delete('/api/pricing/schemes/:id/fields/:fieldId', requirePricingEdit, asyncHandler((req, res) => {
    const scheme = requireScheme(req, res);
    if (!scheme) return;
    const field = queryOne('SELECT * FROM pricing_fields WHERE id = ? AND scheme_id = ?', [req.params.fieldId, scheme.id]);
    if (!field) return res.status(404).json({ error: '费用字段不存在' });
    run('UPDATE pricing_fields SET is_active = 0, updated_at = ? WHERE id = ?', [new Date().toISOString(), field.id]);
    const version = createVersion(scheme.id, '停用字段：' + field.field_name, req.currentUserId);
    res.json({ success: true, version: version });
  }));

  app.post('/api/pricing/schemes/:id/rules', requirePricingEdit, asyncHandler((req, res) => {
    const scheme = requireScheme(req, res);
    if (!scheme) return;
    const body = req.body || {};
    const field = queryOne('SELECT * FROM pricing_fields WHERE id = ? AND scheme_id = ? AND is_active = 1', [body.field_id, scheme.id]);
    if (!field) return res.status(400).json({ error: '请选择有效费用字段' });
    const scopeType = ['global', 'category', 'sku'].includes(String(body.scope_type)) ? String(body.scope_type) : 'global';
    const scopeValue = String(body.scope_value || '').trim();
    if (scopeType !== 'global' && !scopeValue) return res.status(400).json({ error: '请选择适用类目或 SKU' });
    if (scopeType === 'category') {
      const category = scopeValue === '__UNCATEGORIZED__' ? '' : scopeValue;
      if (category && !queryOne('SELECT sku_code FROM skus WHERE brand = ? AND category = ? LIMIT 1', [scheme.brand, category])) {
        return res.status(400).json({ error: '该产品类目不属于当前方案的 SKU 主数据' });
      }
    }
    if (scopeType === 'sku' && !queryOne('SELECT sku_code FROM skus WHERE brand = ? AND sku_code = ?', [scheme.brand, scopeValue])) {
      return res.status(400).json({ error: '该 SKU 不属于当前方案品牌' });
    }
    const calculationType = ['manual', 'fixed', 'rate', 'percentage', 'capped', 'formula'].includes(String(body.calculation_type)) ? String(body.calculation_type) : 'manual';
    if (calculationType === 'formula' && !String(body.formula || '').trim()) return res.status(400).json({ error: '公式不能为空' });
    const id = genId('prule');
    const now = new Date().toISOString();
    run('INSERT INTO pricing_rules (id, scheme_id, field_id, scope_type, scope_value, calculation_type, basis, rate, fixed_amount, cap_amount, floor_amount, formula, currency, per_order, items_per_order, priority, status, effective_from, effective_to, created_by, updated_by, created_at, updated_at) ' +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)",
      [id, scheme.id, field.id, scopeType, scopeValue, calculationType, String(body.basis || 'SRP').toUpperCase(),
        safeNumber(body.rate, 0), safeNumber(body.fixed_amount, null), safeNumber(body.cap_amount, null), safeNumber(body.floor_amount, null),
        String(body.formula || ''), String(body.currency || scheme.currency || ''), body.per_order ? 1 : 0,
        safeNumber(body.items_per_order, 1), safeNumber(body.priority, 0), String(body.effective_from || ''), String(body.effective_to || ''),
        String(req.currentUserId || ''), String(req.currentUserId || ''), now, now]);
    const version = createVersion(scheme.id, '新增费用规则：' + field.field_name, req.currentUserId);
    res.status(201).json({ success: true, id: id, version: version });
  }));

  app.put('/api/pricing/schemes/:id/rules/:ruleId', requirePricingEdit, asyncHandler((req, res) => {
    const scheme = requireScheme(req, res);
    if (!scheme) return;
    const rule = queryOne('SELECT * FROM pricing_rules WHERE id = ? AND scheme_id = ?', [req.params.ruleId, scheme.id]);
    if (!rule) return res.status(404).json({ error: '费用规则不存在' });
    const body = req.body || {};
    const scopeType = ['global', 'category', 'sku'].includes(String(body.scope_type)) ? String(body.scope_type) : rule.scope_type;
    const scopeValue = String(body.scope_value === undefined ? rule.scope_value : body.scope_value || '').trim();
    if (scopeType !== 'global' && !scopeValue) return res.status(400).json({ error: '请选择适用类目或 SKU' });
    const calculationType = ['manual', 'fixed', 'rate', 'percentage', 'capped', 'formula'].includes(String(body.calculation_type)) ? String(body.calculation_type) : rule.calculation_type;
    if (calculationType === 'formula' && !String(body.formula === undefined ? rule.formula : body.formula || '').trim()) return res.status(400).json({ error: '公式不能为空' });
    run('UPDATE pricing_rules SET scope_type = ?, scope_value = ?, calculation_type = ?, basis = ?, rate = ?, fixed_amount = ?, cap_amount = ?, floor_amount = ?, formula = ?, currency = ?, per_order = ?, items_per_order = ?, priority = ?, status = ?, effective_from = ?, effective_to = ?, updated_by = ?, updated_at = ? WHERE id = ? AND scheme_id = ?',
      [scopeType, scopeValue, calculationType, String(body.basis === undefined ? rule.basis : body.basis || 'SRP').toUpperCase(),
        safeNumber(body.rate === undefined ? rule.rate : body.rate, 0), safeNumber(body.fixed_amount === undefined ? rule.fixed_amount : body.fixed_amount, null),
        safeNumber(body.cap_amount === undefined ? rule.cap_amount : body.cap_amount, null), safeNumber(body.floor_amount === undefined ? rule.floor_amount : body.floor_amount, null),
        String(body.formula === undefined ? rule.formula : body.formula || ''), String(body.currency === undefined ? rule.currency : body.currency || ''),
        body.per_order === undefined ? Number(rule.per_order || 0) : (body.per_order ? 1 : 0),
        safeNumber(body.items_per_order === undefined ? rule.items_per_order : body.items_per_order, 1),
        safeNumber(body.priority === undefined ? rule.priority : body.priority, 0),
        String(body.status === undefined ? rule.status : body.status || 'active'),
        String(body.effective_from === undefined ? rule.effective_from : body.effective_from || ''),
        String(body.effective_to === undefined ? rule.effective_to : body.effective_to || ''),
        String(req.currentUserId || ''), new Date().toISOString(), rule.id, scheme.id]);
    const version = createVersion(scheme.id, '修改费用规则', req.currentUserId);
    res.json({ success: true, version: version });
  }));

  app.delete('/api/pricing/schemes/:id/rules/:ruleId', requirePricingEdit, asyncHandler((req, res) => {
    const scheme = requireScheme(req, res);
    if (!scheme) return;
    const rule = queryOne('SELECT * FROM pricing_rules WHERE id = ? AND scheme_id = ?', [req.params.ruleId, scheme.id]);
    if (!rule) return res.status(404).json({ error: '费用规则不存在' });
    run("UPDATE pricing_rules SET status = 'disabled', updated_at = ? WHERE id = ?", [new Date().toISOString(), rule.id]);
    const version = createVersion(scheme.id, '停用费用规则', req.currentUserId);
    res.json({ success: true, version: version });
  }));

  app.put('/api/pricing/schemes/:id/values/:skuCode/:fieldKey', requirePricingEdit, asyncHandler((req, res) => {
    const scheme = requireScheme(req, res);
    if (!scheme) return;
    const skuCode = String(req.params.skuCode || '').trim();
    const fieldKey = String(req.params.fieldKey || '').trim().toUpperCase();
    if (!queryOne('SELECT sku_code FROM skus WHERE brand = ? AND sku_code = ?', [scheme.brand, skuCode])) {
      return res.status(404).json({ error: 'SKU 不属于当前价格方案品牌' });
    }
    if (fieldKey !== 'FOB_RMB' && !queryOne('SELECT id FROM pricing_fields WHERE scheme_id = ? AND field_key = ?', [scheme.id, fieldKey])) {
      return res.status(404).json({ error: '价格字段不存在' });
    }
    const body = req.body || {};
    const applicable = body.is_applicable === false ? 0 : 1;
    const value = applicable ? safeNumber(body.value, null) : null;
    if (applicable && value === null) return res.status(400).json({ error: '请输入有效数字，或选择不适用' });
    const existing = queryOne('SELECT id FROM pricing_sku_values WHERE scheme_id = ? AND sku_code = ? AND field_key = ?', [scheme.id, skuCode, fieldKey]);
    const now = new Date().toISOString();
    if (existing) {
      run('UPDATE pricing_sku_values SET value = ?, is_applicable = ?, updated_by = ?, updated_at = ? WHERE id = ?',
        [value, applicable, String(req.currentUserId || ''), now, existing.id]);
    } else {
      run('INSERT INTO pricing_sku_values (id, scheme_id, sku_code, field_key, value, is_applicable, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [genId('pvalue'), scheme.id, skuCode, fieldKey, value, applicable, String(req.currentUserId || ''), now, now]);
    }
    const version = createVersion(scheme.id, '修改 SKU 价格：' + skuCode + ' / ' + fieldKey, req.currentUserId);
    res.json({ success: true, version: version });
  }));

  app.post('/api/pricing/schemes/:id/import', requirePricingEdit, asyncHandler((req, res) => {
    const scheme = requireScheme(req, res);
    if (!scheme) return;
    const rows = Array.isArray(req.body && req.body.rows) ? req.body.rows : [];
    if (!rows.length) return res.status(400).json({ error: '没有可导入的数据' });
    if (rows.length > 5000) return res.status(400).json({ error: '单次最多导入 5000 行' });
    const fields = query('SELECT field_key FROM pricing_fields WHERE scheme_id = ? AND is_active = 1', [scheme.id]).rows;
    const allowed = new Set(['FOB_RMB'].concat(fields.map(field => String(field.field_key).toUpperCase())));
    const unknown = new Set();
    const skuSet = new Set(query('SELECT sku_code FROM skus WHERE brand = ?', [scheme.brand]).rows.map(row => String(row.sku_code)));
    let imported = 0, skipped = 0;
    const now = new Date().toISOString();
    rows.forEach(row => {
      const skuCode = String(row.sku_code || '').trim();
      if (!skuCode || !skuSet.has(skuCode)) { skipped++; return; }
      const values = row.values && typeof row.values === 'object' ? row.values : {};
      Object.keys(values).forEach(key => {
        const fieldKey = String(key).toUpperCase();
        if (!allowed.has(fieldKey)) { unknown.add(key); return; }
        const value = safeNumber(values[key], null);
        if (value === null) return;
        const existing = queryOne('SELECT id FROM pricing_sku_values WHERE scheme_id = ? AND sku_code = ? AND field_key = ?', [scheme.id, skuCode, fieldKey]);
        if (existing) {
          run('UPDATE pricing_sku_values SET value = ?, is_applicable = 1, updated_by = ?, updated_at = ? WHERE id = ?',
            [value, String(req.currentUserId || ''), now, existing.id]);
        } else {
          run('INSERT INTO pricing_sku_values (id, scheme_id, sku_code, field_key, value, is_applicable, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)',
            [genId('pvalue'), scheme.id, skuCode, fieldKey, value, String(req.currentUserId || ''), now, now]);
        }
      });
      imported++;
    });
    const version = createVersion(scheme.id, 'Excel 导入 ' + imported + ' 个 SKU', req.currentUserId);
    res.json({ success: true, imported: imported, skipped: skipped, unknown_fields: Array.from(unknown), version: version });
  }));

  app.put('/api/pricing/schemes/:id/formula', requirePricingEdit, asyncHandler((req, res) => {
    const scheme = requireScheme(req, res);
    if (!scheme) return;
    const formula = String(req.body && req.body.formula || '').trim();
    if (formula) {
      try {
        const sample = queryOne('SELECT purchase_price_rmb FROM skus WHERE brand = ? ORDER BY sku_code LIMIT 1', [scheme.brand]);
        core.evaluateFormula(formula, {
          FOB_RMB: safeNumber(sample && sample.purchase_price_rmb, 0),
          RMB_TO_LOCAL: safeNumber(req.body.exchange_rate === undefined ? scheme.exchange_rate : req.body.exchange_rate, 0),
          EXCHANGE_RATE: safeNumber(req.body.exchange_rate === undefined ? scheme.exchange_rate : req.body.exchange_rate, 0),
          SRP: 0,
          LANDING_COST_CNY: 0,
          LANDING_COST_LOCAL: 0
        });
      } catch (error) {
        return res.status(400).json({ error: 'SRP 公式校验失败：' + error.message });
      }
    }
    run('UPDATE pricing_schemes SET srp_formula = ?, exchange_rate = ?, updated_by = ?, updated_at = ? WHERE id = ?',
      [formula, safeNumber(req.body && req.body.exchange_rate === undefined ? scheme.exchange_rate : req.body.exchange_rate, 0),
        String(req.currentUserId || ''), new Date().toISOString(), scheme.id]);
    const version = createVersion(scheme.id, '修改 SRP 计算公式', req.currentUserId);
    res.json({ success: true, version: version });
  }));

  app.get('/api/pricing/schemes/:id/versions', requirePricingView, asyncHandler((req, res) => {
    const scheme = requireScheme(req, res);
    if (!scheme) return;
    const versions = query('SELECT id, scheme_id, version_no, change_summary, created_by, created_at FROM pricing_scheme_versions WHERE scheme_id = ? ORDER BY version_no DESC LIMIT 100',
      [scheme.id]).rows;
    res.json(versions);
  }));

  app.post('/api/pricing/schemes/:id/versions/:versionNo/restore', requirePricingEdit, asyncHandler((req, res) => {
    const scheme = requireScheme(req, res);
    if (!scheme) return;
    const versionNo = Number(req.params.versionNo);
    const version = queryOne('SELECT * FROM pricing_scheme_versions WHERE scheme_id = ? AND version_no = ?', [scheme.id, versionNo]);
    if (!version) return res.status(404).json({ error: '历史版本不存在' });
    const snapshot = safeJson(version.snapshot_json, null);
    if (!snapshot || !snapshot.scheme) return res.status(400).json({ error: '历史版本快照损坏，无法恢复' });
    const savedScheme = snapshot.scheme;
    run('UPDATE pricing_schemes SET country = ?, brand = ?, platform = ?, store = ?, currency = ?, exchange_rate = ?, status = ?, description = ?, effective_date = ?, srp_formula = ?, updated_by = ?, updated_at = ? WHERE id = ?',
      [savedScheme.country, savedScheme.brand, savedScheme.platform, savedScheme.store || '', savedScheme.currency || '',
        safeNumber(savedScheme.exchange_rate, 0), savedScheme.status || 'draft', savedScheme.description || '',
        savedScheme.effective_date || '', savedScheme.srp_formula || '', String(req.currentUserId || ''), new Date().toISOString(), scheme.id]);
    run('DELETE FROM pricing_fields WHERE scheme_id = ?', [scheme.id]);
    run('DELETE FROM pricing_rules WHERE scheme_id = ?', [scheme.id]);
    run('DELETE FROM pricing_sku_values WHERE scheme_id = ?', [scheme.id]);
    (snapshot.fields || []).forEach(field => {
      run('INSERT INTO pricing_fields (id, scheme_id, field_key, field_name, group_type, value_type, calculation_type, formula, default_value, currency, include_in_profit, is_active, display_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [field.id, scheme.id, field.field_key, field.field_name, field.group_type || 'fee', field.value_type || 'currency',
          field.calculation_type || 'manual', field.formula || '', safeNumber(field.default_value, null), field.currency || '',
          Number(field.include_in_profit || 0), Number(field.is_active === undefined ? 1 : field.is_active),
          Number(field.display_order || 0), field.created_at || new Date().toISOString(), new Date().toISOString()]);
    });
    (snapshot.rules || []).forEach(rule => {
      run('INSERT INTO pricing_rules (id, scheme_id, field_id, scope_type, scope_value, calculation_type, basis, rate, fixed_amount, cap_amount, floor_amount, formula, currency, per_order, items_per_order, priority, status, effective_from, effective_to, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [rule.id, scheme.id, rule.field_id, rule.scope_type || 'global', rule.scope_value || '', rule.calculation_type || 'manual',
          rule.basis || 'SRP', safeNumber(rule.rate, 0), safeNumber(rule.fixed_amount, null), safeNumber(rule.cap_amount, null),
          safeNumber(rule.floor_amount, null), rule.formula || '', rule.currency || '', Number(rule.per_order || 0),
          safeNumber(rule.items_per_order, 1), Number(rule.priority || 0), rule.status || 'active', rule.effective_from || '',
          rule.effective_to || '', rule.created_by || '', String(req.currentUserId || ''), rule.created_at || new Date().toISOString(), new Date().toISOString()]);
    });
    (snapshot.sku_values || []).forEach(value => {
      run('INSERT INTO pricing_sku_values (id, scheme_id, sku_code, field_key, value, is_applicable, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [value.id, scheme.id, value.sku_code, value.field_key, safeNumber(value.value, null), Number(value.is_applicable === undefined ? 1 : value.is_applicable),
          String(req.currentUserId || ''), value.created_at || new Date().toISOString(), new Date().toISOString()]);
    });
    const newVersion = createVersion(scheme.id, '从历史版本 v' + versionNo + ' 恢复', req.currentUserId);
    res.json({ success: true, restored_from: versionNo, version: newVersion });
  }));

  app.post('/api/pricing/schemes/:id/archive', requirePricingEdit, asyncHandler((req, res) => {
    const scheme = requireScheme(req, res);
    if (!scheme) return;
    run("UPDATE pricing_schemes SET status = 'disabled', updated_by = ?, updated_at = ? WHERE id = ?",
      [String(req.currentUserId || ''), new Date().toISOString(), scheme.id]);
    const version = createVersion(scheme.id, '停用价格方案', req.currentUserId);
    res.json({ success: true, version: version });
  }));
}

module.exports = { registerPricingRoutes };
