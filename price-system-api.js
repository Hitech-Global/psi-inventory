'use strict';

const { createPriceSystemQuotationSync } = require('./price-system-quotation-sync');

const {
  BUILTIN_PRICE_VARIABLES,
  evaluateFormula,
  getFormulaVariables,
  validateFormula
} = require('./price-system-formula');

function parseCategories(value) {
  if (Array.isArray(value)) return value.map(v => String(v || '').trim()).filter(Boolean);
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.map(v => String(v || '').trim()).filter(Boolean) : [];
  } catch (e) { return []; }
}

function parseFormulaRules(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  try { const parsed = JSON.parse(value || '{}'); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}; }
  catch (e) { return {}; }
}

function remapFieldCategorySettings(field, targetCategories) {
  const hasTargetCategories = Array.isArray(targetCategories);
  const destinationCategories = hasTargetCategories
    ? Array.from(new Set(targetCategories.map(category => String(category || '').trim()).filter(Boolean)))
    : [];
  const destinationCategorySet = new Set(destinationCategories);
  const sourceApplicableCategories = parseCategories(field && field.applicable_categories);
  const matchedApplicableCategories = hasTargetCategories
    ? sourceApplicableCategories.filter(category => destinationCategorySet.has(category))
    : sourceApplicableCategories;
  // Empty scope means "all categories" in the price system. If none of the source
  // categories exist in the destination brand, apply the field to destination categories
  // rather than retaining invalid category names from the source scheme.
  const applicableCategories = sourceApplicableCategories.length && hasTargetCategories && !matchedApplicableCategories.length
    ? destinationCategories
    : matchedApplicableCategories;
  const sourceFormulaRules = parseFormulaRules(field && field.formula_rules);
  const formulaRules = hasTargetCategories
    ? Object.fromEntries(Object.entries(sourceFormulaRules).filter(([category, expression]) =>
      destinationCategorySet.has(String(category || '').trim()) && String(expression || '').trim()
    ))
    : sourceFormulaRules;
  return { applicable_categories: applicableCategories, formula_rules: formulaRules };
}

function buildPriceSystemReferenceLookup(sourceRows, sourceFieldKey, fallbackCurrency, includeCurrencies) {
  const valuesBySku = new Map();
  const currenciesBySku = new Map();
  const fieldKey = String(sourceFieldKey || '').trim();
  (Array.isArray(sourceRows) ? sourceRows : []).forEach(sourceRow => {
    const skuCode = String(sourceRow && sourceRow.sku_code || '').trim();
    if (!skuCode || !fieldKey) return;
    const raw = sourceRow && sourceRow.values ? sourceRow.values[fieldKey] : null;
    valuesBySku.set(skuCode, raw == null || raw === '' ? null : Number(raw));
    if (includeCurrencies) {
      const currencyCode = sourceRow && sourceRow.value_currencies && sourceRow.value_currencies[fieldKey] || fallbackCurrency || '';
      currenciesBySku.set(skuCode, String(currencyCode).trim().toUpperCase());
    }
  });
  return { valuesBySku, currenciesBySku };
}

function buildCopiedFieldRows(sourceFields, targetSchemeId, genId, targetCategories) {
  return (Array.isArray(sourceFields) ? sourceFields : []).map(field => {
    const decimalPlaces = Number(field.decimal_places == null ? 2 : field.decimal_places);
    const sortOrder = Number(field.sort_order == null ? 0 : field.sort_order);
    const categorySettings = remapFieldCategorySettings(field, targetCategories);
    return {
      id: genId('psf'),
      scheme_id: targetSchemeId,
      field_key: String(field.field_key || '').trim(),
      field_name: String(field.field_name || '').trim(),
      field_type: String(field.field_type || 'amount'),
      unit: String(field.unit || ''),
      applicable_categories: JSON.stringify(categorySettings.applicable_categories),
      formula: String(field.formula || ''),
      formula_rules: JSON.stringify(categorySettings.formula_rules),
      display_format: String(field.display_format || 'auto'),
      decimal_places: Number.isFinite(decimalPlaces) ? decimalPlaces : 2,
      sync_wac: Number(field.sync_wac || 0) === 1 ? 1 : 0,
      sync_quotation: Number(field.sync_quotation || 0) === 1 ? 1 : 0,
      source_scheme_id: String(field.source_scheme_id || ''),
      source_field_key: String(field.source_field_key || ''),
      sort_order: Number.isFinite(sortOrder) ? sortOrder : 0,
      is_active: Number(field.is_active == null ? 1 : field.is_active) === 1 ? 1 : 0
    };
  });
}
function deletePriceSystemSchemeRecords(schemeId, run) {
  const id = String(schemeId || '').trim();
  if (!id) throw new Error('价格方案 ID 不能为空');
  const tables = [
    ['price_system_fields', 'scheme_id'],
    ['price_system_values', 'scheme_id'],
    ['price_system_landing_costs', 'scheme_id'],
    ['price_system_srp_values', 'scheme_id'],
    ['price_system_versions', 'scheme_id'],
    ['price_system_schemes', 'id']
  ];
  tables.forEach(([table, key]) => run('DELETE FROM ' + table + ' WHERE ' + key + ' = ?', [id]));
  return true;
}

function buildForecastMetricMap(rows) {
  const metrics = new Map();
  (Array.isArray(rows) ? rows : []).forEach(row => {
    const skuCode = String(row && row.sku_code || '').trim();
    if (!skuCode) return;
    let metric = metrics.get(skuCode);
    if (!metric) { metric = { avg_sales_period: 0, available_qty: 0 }; metrics.set(skuCode, metric); }
    const average = Number(row.avg_sales_period);
    if (Number.isFinite(average)) metric.avg_sales_period = Math.max(metric.avg_sales_period, average);
    const available = Number(row.available_qty);
    if (Number.isFinite(available)) metric.available_qty += available;
  });
  metrics.forEach(metric => {
    metric.available_turnover = metric.avg_sales_period > 0
      ? Math.round(metric.available_qty / metric.avg_sales_period * 10) / 10
      : null;
  });
  return metrics;
}

function formulaForCategory(field, category) {
  const rules = parseFormulaRules(field && field.formula_rules);
  if (Object.keys(rules).length) {
    const key = String(category || '').trim();
    const expression = Object.prototype.hasOwnProperty.call(rules, key) ? String(rules[key] || '').trim() : '';
    return expression || null;
  }
  return String(field && field.formula || '').trim() || null;
}

const BUILTIN_FORMULA_LABELS = Object.freeze({
  purchase_price_rmb: ['采购价 RMB', 'Purchase Price RMB', 'Harga Beli RMB'],
  purchase_price_usd: ['采购价 USD', 'Purchase Price USD', 'Harga Beli USD'],
  standard_purchase_price: ['标准采购价', 'Standard Purchase Price', 'Harga Beli Standar'],
  weighted_avg_cost: ['SKU 加权平均成本', 'SKU Weighted Average Cost', 'Biaya Rata-rata Tertimbang SKU'],
  inventory_wac: ['库存 WAC', 'Inventory WAC', 'WAC Persediaan'],
  reference_customs_rate: ['参考关税税率', 'Reference Customs Rate', 'Tarif Bea Cukai Referensi'],
  landing_cost: ['系统 Landing Cost', 'System Landing Cost', 'Landing Cost Sistem'],
  stock_qty: ['库存数量', 'Stock Qty', 'Jumlah Stok'],
  srp: ['SRP']
});

function normalizeFormulaExpression(expression, fields) {
  let result = String(expression == null ? '' : expression);
  const aliases = [];
  Object.keys(BUILTIN_FORMULA_LABELS).forEach(key => BUILTIN_FORMULA_LABELS[key].forEach(label => aliases.push([label, key])));
  (fields || []).forEach(field => { if (field && field.field_key && field.field_name) aliases.push([String(field.field_name), String(field.field_key)]); });
  aliases.sort((a, b) => b[0].length - a[0].length);
  aliases.forEach(([label, key]) => { if (label && label !== key) result = result.split(label).join(key); });
  return result;
}
function isCategoryApplicable(field, category) {
  if (field && field.field_type === 'formula' && Object.keys(parseFormulaRules(field.formula_rules)).length) return !!formulaForCategory(field, category);
  const categories = parseCategories(field.applicable_categories);
  return categories.length === 0 || categories.includes(String(category || '').trim());
}

function stableVersionValue(value) {
  if (Array.isArray(value)) return value.map(stableVersionValue);
  if (value && typeof value === 'object') {
    const result = {};
    Object.keys(value).sort().forEach(key => { result[key] = stableVersionValue(value[key]); });
    return result;
  }
  return value;
}

function sameVersionValue(left, right) {
  return JSON.stringify(stableVersionValue(left)) === JSON.stringify(stableVersionValue(right));
}

function normalizeVersionFieldValue(field, key) {
  if (!field) return null;
  const value = field[key];
  if (key === 'applicable_categories') return parseCategories(value);
  if (key === 'formula_rules') return parseFormulaRules(value);
  if (key === 'sync_wac' || key === 'sync_quotation' || key === 'is_active') return Number(value || 0) === 1;
  if (key === 'sort_order' || key === 'decimal_places') return value == null || value === '' ? null : Number(value);
  return String(value == null ? '' : value);
}

function buildPriceSystemVersionDiff(currentSnapshot, previousSnapshot, options) {
  const opts = options || {};
  const hasPrevious = opts.hasPrevious !== false;
  const canViewQuotation = opts.canViewQuotation !== false;
  const current = currentSnapshot && typeof currentSnapshot === 'object' ? currentSnapshot : {};
  const previous = hasPrevious && previousSnapshot && typeof previousSnapshot === 'object' ? previousSnapshot : {};
  const currentScheme = current.scheme || {};
  const previousScheme = previous.scheme || {};
  const currentFields = Array.isArray(current.fields) ? current.fields : [];
  const previousFields = Array.isArray(previous.fields) ? previous.fields : [];
  const hiddenQuotationKeys = new Set();
  if (!canViewQuotation) {
    previousFields.concat(currentFields).forEach(field => {
      if (Number(field && field.sync_quotation || 0) === 1) hiddenQuotationKeys.add(String(field.field_key || ''));
    });
  }
  const schemeProperties = [
    ['currency', 'currency'],
    ['srp_formula', 'srp_formula'],
    ['srp_sort_order', 'srp_sort_order'],
    ['status', 'status'],
    ['shop_name', 'shop_name'],
    ['platform', 'platform']
  ];
  const schemeChanges = [];
  schemeProperties.forEach(([key, label]) => {
    const before = previousScheme[key] == null ? null : previousScheme[key];
    const after = currentScheme[key] == null ? null : currentScheme[key];
    if (!sameVersionValue(before, after)) {
      schemeChanges.push({
        scope: 'scheme',
        property_key: key,
        property_label: label,
        old_value: before,
        new_value: after,
        action: before == null ? 'added' : (after == null ? 'removed' : 'updated')
      });
    }
  });

  const fieldProperties = [
    ['field_name', 'field_name'],
    ['field_type', 'field_type'],
    ['unit', 'unit'],
    ['applicable_categories', 'applicable_categories'],
    ['formula', 'formula'],
    ['formula_rules', 'formula_rules'],
    ['display_format', 'display_format'],
    ['decimal_places', 'decimal_places'],
    ['sync_wac', 'sync_wac'],
    ['sync_quotation', 'sync_quotation'],
    ['source_scheme_id', 'source_scheme_id'],
    ['source_field_key', 'source_field_key'],
    ['sort_order', 'sort_order'],
    ['is_active', 'is_active']
  ];
  const oldFieldMap = new Map(previousFields.map(field => [String(field.field_key || ''), field]));
  const newFieldMap = new Map(currentFields.map(field => [String(field.field_key || ''), field]));
  const fieldKeys = Array.from(new Set(Array.from(oldFieldMap.keys()).concat(Array.from(newFieldMap.keys())))).sort();
  const fieldChanges = [];
  fieldKeys.forEach(fieldKey => {
    if (!fieldKey || hiddenQuotationKeys.has(fieldKey)) return;
    const beforeField = oldFieldMap.get(fieldKey) || null;
    const afterField = newFieldMap.get(fieldKey) || null;
    if (!beforeField && !afterField) return;
    const action = !beforeField ? 'added' : (!afterField ? 'removed' : 'updated');
    fieldProperties.forEach(([key, label]) => {
      const before = normalizeVersionFieldValue(beforeField, key);
      const after = normalizeVersionFieldValue(afterField, key);
      if (!sameVersionValue(before, after)) {
        fieldChanges.push({
          scope: 'field',
          field_key: fieldKey,
          field_name: String(afterField && afterField.field_name || beforeField && beforeField.field_name || fieldKey),
          property_key: key,
          property_label: label,
          old_value: before,
          new_value: after,
          action
        });
      }
    });
  });

  function mapRows(rows, keyFn) {
    const result = new Map();
    (Array.isArray(rows) ? rows : []).forEach(row => {
      const key = keyFn(row);
      if (key) result.set(key, row);
    });
    return result;
  }
  function amountValue(row, fallbackCurrency) {
    if (!row) return null;
    const numeric = Number(row.value);
    return {
      value: Number.isFinite(numeric) ? numeric : row.value,
      currency: String(row.currency || fallbackCurrency || '').trim().toUpperCase()
    };
  }
  function sameAmountValue(left, right) {
    if (!left || !right) return left === right;
    return Number(left.value) === Number(right.value) && left.currency === right.currency;
  }
  const skuChanges = [];
  const oldValues = mapRows(previous.values, row => String(row.sku_code || '') + '|' + String(row.field_key || ''));
  const newValues = mapRows(current.values, row => String(row.sku_code || '') + '|' + String(row.field_key || ''));
  const valueKeys = Array.from(new Set(Array.from(oldValues.keys()).concat(Array.from(newValues.keys())))).sort();
  valueKeys.forEach(key => {
    const beforeRow = oldValues.get(key) || null;
    const afterRow = newValues.get(key) || null;
    const row = afterRow || beforeRow;
    const fieldKey = String(row.field_key || '');
    if (hiddenQuotationKeys.has(fieldKey)) return;
    const before = amountValue(beforeRow, previousScheme.currency);
    const after = amountValue(afterRow, currentScheme.currency);
    if (sameAmountValue(before, after)) return;
    const field = newFieldMap.get(fieldKey) || oldFieldMap.get(fieldKey) || null;
    skuChanges.push({
      change_type: 'manual_value',
      action: !beforeRow ? 'added' : (!afterRow ? 'removed' : 'updated'),
      sku_code: String(row.sku_code || ''),
      field_key: fieldKey,
      field_name: String(field && field.field_name || fieldKey),
      old_value: before,
      new_value: after
    });
  });

  const oldSrp = mapRows(previous.srpValues, row => String(row.sku_code || ''));
  const newSrp = mapRows(current.srpValues, row => String(row.sku_code || ''));
  Array.from(new Set(Array.from(oldSrp.keys()).concat(Array.from(newSrp.keys())))).sort().forEach(skuCode => {
    const beforeRow = oldSrp.get(skuCode) || null;
    const afterRow = newSrp.get(skuCode) || null;
    const before = amountValue(beforeRow, previousScheme.currency);
    const after = amountValue(afterRow, currentScheme.currency);
    if (sameAmountValue(before, after)) return;
    skuChanges.push({
      change_type: 'srp_value',
      action: !beforeRow ? 'added' : (!afterRow ? 'removed' : 'updated'),
      sku_code: skuCode,
      field_key: 'srp',
      field_name: 'SRP',
      old_value: before,
      new_value: after
    });
  });

  function landingCostValue(row, fallbackCurrency) {
    if (!row) return null;
    const amount = amountValue(row, fallbackCurrency);
    return Object.assign(amount, {
      ci_no: String(row.ci_no || ''),
      warehouse: String(row.warehouse || ''),
      version_no: Number(row.version_no || 0),
      last_inbound_date: String(row.last_inbound_date || '')
    });
  }
  function sameLandingCost(left, right) {
    if (!left || !right) return left === right;
    return sameAmountValue(left, right) &&
      left.ci_no === right.ci_no &&
      left.warehouse === right.warehouse &&
      left.version_no === right.version_no &&
      left.last_inbound_date === right.last_inbound_date;
  }
  const oldLanding = mapRows(previous.landingCosts, row => String(row.sku_code || ''));
  const newLanding = mapRows(current.landingCosts, row => String(row.sku_code || ''));
  Array.from(new Set(Array.from(oldLanding.keys()).concat(Array.from(newLanding.keys())))).sort().forEach(skuCode => {
    const beforeRow = oldLanding.get(skuCode) || null;
    const afterRow = newLanding.get(skuCode) || null;
    const before = beforeRow ? landingCostValue(beforeRow, previousScheme.currency) : null;
    const after = afterRow ? landingCostValue(afterRow, currentScheme.currency) : null;
    if (sameLandingCost(before, after)) return;
    skuChanges.push({
      change_type: 'landing_cost',
      action: !beforeRow ? 'added' : (!afterRow ? 'removed' : 'updated'),
      sku_code: skuCode,
      field_key: 'landing_cost',
      field_name: 'Landing Cost',
      old_value: before,
      new_value: after
    });
  });

  const actionCounts = { added: 0, removed: 0, updated: 0 };
  schemeChanges.concat(fieldChanges, skuChanges).forEach(change => {
    if (actionCounts[change.action] != null) actionCounts[change.action] += 1;
  });
  skuChanges.sort((left, right) =>
    String(left.sku_code || '').localeCompare(String(right.sku_code || '')) ||
    String(left.change_type || '').localeCompare(String(right.change_type || '')) ||
    String(left.field_key || '').localeCompare(String(right.field_key || ''))
  );
  return {
    scheme_changes: schemeChanges,
    field_changes: fieldChanges,
    sku_changes: skuChanges,
    summary: {
      scheme_changes: schemeChanges.length,
      field_changes: fieldChanges.length,
      sku_changes: skuChanges.length,
      added: actionCounts.added,
      removed: actionCounts.removed,
      updated: actionCounts.updated
    },
    has_previous: hasPrevious
  };
}

function primaryCategoryMapForSkus(skuRows) {
  const categories = new Map();
  (skuRows || []).forEach(sku => {
    const code = String(sku.sku_code || '').trim();
    if (!code) return;
    categories.set(code, String(sku.category || '').trim() || '未分类');
  });
  return categories;
}

function createPriceSystemWacSync(deps) {
  const { query, queryOne, run, genId } = deps;
  const aliasCache = new Map();
  const schemeCache = new Map();
  function countryAliases(country) {
    const name = String(country || '').trim();
    const cacheKey = name.toLowerCase();
    if (aliasCache.has(cacheKey)) return aliasCache.get(cacheKey);
    const row = queryOne('SELECT code FROM countries WHERE name = ?', [name]);
    const code = String(row && row.code || '').trim().toUpperCase();
    const aliases = ({
      ID: ['ID', 'IND', 'INDONESIA', 'Indonesia', '\u5370\u5c3c', '\u5370\u5ea6\u5c3c\u897f\u4e9a', '\u5370\u5ea6\u5c3c\u897f\u4e9a\u5171\u548c\u56fd'],
      MY: ['MY', 'MALAYSIA', 'Malaysia', '\u9a6c\u6765', '\u9a6c\u6765\u897f\u4e9a'],
      TH: ['TH', 'THAILAND', 'Thailand', '\u6cf0\u56fd'],
      SG: ['SG', 'SINGAPORE', 'Singapore', '\u65b0\u52a0\u5761']
    })[code] || [name];
    const result = Array.from(new Set([name].concat(aliases).map(value => String(value || '').trim().toLowerCase()).filter(Boolean)));
    aliasCache.set(cacheKey, result);
    return result;
  }
  function activeSchemesForBrand(brand) {
    const cacheKey = String(brand || '').trim().toLowerCase();
    if (!schemeCache.has(cacheKey)) schemeCache.set(cacheKey, query("SELECT ps.* FROM price_system_schemes ps WHERE ps.status = 'active' AND LOWER(ps.brand) = LOWER(?) AND EXISTS (SELECT 1 FROM price_system_fields pf WHERE pf.scheme_id = ps.id AND pf.is_active = 1 AND COALESCE(pf.sync_wac, 0) = 1) ORDER BY ps.country, ps.platform, ps.shop_name", [brand]).rows);
    return schemeCache.get(cacheKey);
  }
  function createSnapshotVersion(schemeId, actor, note) {
    const scheme = queryOne('SELECT * FROM price_system_schemes WHERE id = ?', [schemeId]);
    if (!scheme) return null;
    const fields = query('SELECT * FROM price_system_fields WHERE scheme_id = ? ORDER BY sort_order, field_name', [schemeId]).rows;
    const values = query('SELECT sku_code, field_key, value, currency FROM price_system_values WHERE scheme_id = ? ORDER BY sku_code, field_key', [schemeId]).rows;
    const landingCosts = query('SELECT * FROM price_system_landing_costs WHERE scheme_id = ? ORDER BY sku_code', [schemeId]).rows;
    const srpValues = query('SELECT * FROM price_system_srp_values WHERE scheme_id = ? ORDER BY sku_code', [schemeId]).rows;
    const previous = queryOne('SELECT MAX(version_no) AS max_version FROM price_system_versions WHERE scheme_id = ?', [schemeId]);
    const versionNo = Number(previous && previous.max_version || 0) + 1;
    run('INSERT INTO price_system_versions (id, scheme_id, version_no, snapshot_json, note, created_by, created_by_name) VALUES (?, ?, ?, ?, ?, ?, ?)', [genId('psv'), schemeId, versionNo, JSON.stringify({ scheme, fields, values, landingCosts, srpValues }), String(note || ''), String(actor && actor.id || ''), String(actor && actor.name || '')]);
    return versionNo;
  }
  return function syncPriceSystemLandingCostsForWacKeys(wacKeys, actor, reason) {
    aliasCache.clear();
    schemeCache.clear();
    const uniqueKeys = new Map();
    (Array.isArray(wacKeys) ? wacKeys : []).forEach(raw => {
      const skuCode = String(raw && raw.sku_code || '').trim();
      const country = String(raw && raw.country || '').trim();
      if (!skuCode || !country) return;
      const key = skuCode + '\u0000' + country.toLowerCase();
      const previous = uniqueKeys.get(key) || {};
      uniqueKeys.set(key, { sku_code: skuCode, country, brand: String(raw && raw.brand || previous.brand || '').trim() });
    });
    const keys = Array.from(uniqueKeys.values());
    if (!keys.length) return { schemes_updated: 0, sku_updated: 0, sku_cleared: 0, versions: [] };
    const brandBySku = new Map();
    const skuCodes = Array.from(new Set(keys.map(key => key.sku_code)));
    for (let i = 0; i < skuCodes.length; i += 400) {
      const part = skuCodes.slice(i, i + 400);
      query('SELECT sku_code, brand FROM skus WHERE sku_code IN (' + part.map(() => '?').join(',') + ')', part).rows.forEach(row => brandBySku.set(String(row.sku_code || '').trim(), String(row.brand || '').trim()));
    }
    const keysByScheme = new Map();
    keys.forEach(key => {
      const brand = brandBySku.get(key.sku_code) || key.brand;
      if (!brand) return;
      activeSchemesForBrand(brand).forEach(scheme => {
        if (!countryAliases(scheme.country).includes(key.country.toLowerCase())) return;
        if (!keysByScheme.has(scheme.id)) keysByScheme.set(scheme.id, { scheme, skuCodes: new Set() });
        keysByScheme.get(scheme.id).skuCodes.add(key.sku_code);
      });
    });
    const summary = { schemes_updated: 0, sku_updated: 0, sku_cleared: 0, versions: [] };
    keysByScheme.forEach(({ scheme, skuCodes: schemeSkuSet }) => {
      const schemeSkuCodes = Array.from(schemeSkuSet);
      const aliases = countryAliases(scheme.country);
      const latestBySku = new Map();
      const existingBySku = new Map();
      for (let i = 0; i < schemeSkuCodes.length; i += 400) {
        const part = schemeSkuCodes.slice(i, i + 400);
        const placeholders = part.map(() => '?').join(',');
        const latestRows = query(
          "SELECT wh.id, wh.sku_code, wh.brand, wh.country, wh.warehouse, wh.new_avg_cost, wh.local_currency, wh.ci_no, wh.version_no, wh.confirmed_at, wh.last_inbound_date FROM wac_history wh WHERE wh.sku_code IN (" + placeholders + ") AND LOWER(wh.country) IN (" + aliases.map(() => '?').join(',') + ") AND (COALESCE(wh.brand, '') = '' OR LOWER(wh.brand) = LOWER(?)) AND COALESCE(wh.is_locked, 0) = 1 AND LOWER(COALESCE(wh.confirmation_status, 'confirmed')) NOT IN ('reversed', 'void', 'cancelled') AND wh.confirmed_at IS NOT NULL AND wh.confirmed_at <> '' ORDER BY COALESCE(NULLIF(wh.confirmed_at, ''), NULLIF(wh.last_inbound_date, ''), wh.created_at) DESC, wh.version_no DESC, wh.created_at DESC",
          part.concat(aliases, [scheme.brand])
        ).rows;
        latestRows.forEach(row => {
          const skuCode = String(row.sku_code || '').trim();
          if (skuCode && !latestBySku.has(skuCode) && row.new_avg_cost != null && String(row.new_avg_cost).trim() !== '') latestBySku.set(skuCode, row);
        });
        query('SELECT * FROM price_system_landing_costs WHERE scheme_id = ? AND sku_code IN (' + placeholders + ')', [scheme.id].concat(part)).rows.forEach(row => existingBySku.set(String(row.sku_code || '').trim(), row));
      }
      let updated = 0;
      let cleared = 0;
      schemeSkuCodes.forEach(skuCode => {
        const wac = latestBySku.get(skuCode);
        const existing = existingBySku.get(skuCode);
        if (!wac) {
          if (existing) { run('DELETE FROM price_system_landing_costs WHERE scheme_id = ? AND sku_code = ?', [scheme.id, skuCode]); cleared++; }
          return;
        }
        const value = Number(wac.new_avg_cost);
        if (!Number.isFinite(value) || value < 0) return;
        const rawCurrency = String(wac.local_currency || scheme.currency || '').trim().toUpperCase();
        const landingCost = { wac_history_id: wac.id, value, currency: rawCurrency === 'CNY' ? 'RMB' : rawCurrency, warehouse: wac.warehouse || '', ci_no: wac.ci_no || '', version_no: Number(wac.version_no || 0), confirmed_at: wac.confirmed_at || '', last_inbound_date: String(wac.last_inbound_date || '').slice(0, 10) };
        const unchanged = existing && String(existing.wac_history_id || '') === String(landingCost.wac_history_id || '') && Number(existing.value) === landingCost.value && String(existing.currency || '') === landingCost.currency && String(existing.warehouse || '') === landingCost.warehouse && String(existing.ci_no || '') === landingCost.ci_no && Number(existing.version_no || 0) === landingCost.version_no && String(existing.confirmed_at || '') === landingCost.confirmed_at && String(existing.last_inbound_date || '') === landingCost.last_inbound_date;
        if (unchanged) return;
        run("INSERT INTO price_system_landing_costs (id, scheme_id, sku_code, wac_history_id, value, currency, warehouse, ci_no, version_no, confirmed_at, last_inbound_date, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now')) ON CONFLICT(scheme_id, sku_code) DO UPDATE SET wac_history_id = excluded.wac_history_id, value = excluded.value, currency = excluded.currency, warehouse = excluded.warehouse, ci_no = excluded.ci_no, version_no = excluded.version_no, confirmed_at = excluded.confirmed_at, last_inbound_date = excluded.last_inbound_date, updated_by = excluded.updated_by, updated_at = datetime('now')", [genId('pslc'), scheme.id, skuCode, landingCost.wac_history_id, landingCost.value, landingCost.currency, landingCost.warehouse, landingCost.ci_no, landingCost.version_no, landingCost.confirmed_at, landingCost.last_inbound_date, actor && actor.id || 'system']);
        updated++;
      });
      if (updated || cleared) {
        const note = String(reason || 'WAC auto sync') + ': updated ' + updated + ' SKU(s), cleared ' + cleared + ' invalid cost(s)';
        const versionNo = createSnapshotVersion(scheme.id, actor || { id: 'system', name: 'System' }, note);
        summary.schemes_updated++;
        summary.sku_updated += updated;
        summary.sku_cleared += cleared;
        summary.versions.push({ scheme_id: scheme.id, version_no: versionNo, updated, cleared });
      }
    });
    return summary;
  };
}

function registerPriceSystemRoutes(app, deps) {
  const {
    query, queryOne, run, transaction, genId,
    requireApiPermission, asyncHandler, needsDataScopeFilter
  } = deps;
  function requirePricePermissions(write) {
    return (req, res, next) => {
      const permissions = req.currentUserPermissions || [];
      const wildcard = permissions.includes('*');
      if (!wildcard && (!permissions.includes('sku_view') || !permissions.includes('inventory_view') || !permissions.includes('ci_amount_view') || (write && !permissions.includes('sku_edit')))) {
        return res.status(403).json({ error: '价格体系需要 SKU 查看、库存查看、金额查看' + (write ? '及 SKU 编辑' : '') + '权限' });
      }
      next();
    };
  }
  const canRead = requirePricePermissions(false);
  const canWrite = requirePricePermissions(true);
  const canViewWac = requireApiPermission('inbound_view');
  const syncPriceSystemLandingCostsForWacKeys = createPriceSystemWacSync(deps);
  const syncPriceSystemQuotationForKeys = createPriceSystemQuotationSync(deps);
  function schemeAccess(req, res, scheme) {
    if (!scheme) {
      res.status(404).json({ error: '价格方案不存在' });
      return false;
    }
    if (typeof needsDataScopeFilter === 'function' && needsDataScopeFilter(req)) {
      const scope = req.currentUserDataScope || {};
      if (isCountryRestricted(req)) {
        const country = queryOne('SELECT id FROM countries WHERE name = ?', [scheme.country]);
        const allowedCountryIds = scopedCountryIds(req);
        if (!country || !allowedCountryIds.includes(country.id)) {
          res.status(403).json({ error: '没有查看该国家价格数据的权限' });
          return false;
        }
      }
      if (Array.isArray(scope.brands) && scope.brands.length && !scope.brands.includes(scheme.brand)) {
        res.status(403).json({ error: '没有查看该品牌价格数据的权限' });
        return false;
      }
    }
    return true;
  }

  function listSchemesForUser(req) {
    let sql = "SELECT * FROM price_system_schemes WHERE status = 'active'";
    const params = [];
    if (typeof needsDataScopeFilter === 'function' && needsDataScopeFilter(req)) {
      const scope = req.currentUserDataScope || {};
      if (isCountryRestricted(req)) {
        const allowedCountryIds = scopedCountryIds(req);
        if (!allowedCountryIds.length) return [];
        const names = query(
          'SELECT name FROM countries WHERE id IN (' + allowedCountryIds.map(() => '?').join(',') + ')',
          allowedCountryIds
        ).rows.map(r => r.name).filter(Boolean);
        if (!names.length) return [];
        sql += ' AND country IN (' + names.map(() => '?').join(',') + ')';
        params.push(...names);
      }
      if (Array.isArray(scope.brands) && scope.brands.length) {
        sql += ' AND brand IN (' + scope.brands.map(() => '?').join(',') + ')';
        params.push(...scope.brands);
      }
    }
    sql += ' ORDER BY country, brand, platform, shop_name';
    return query(sql, params).rows.map(row => Object.assign({}, row, { sales_channel: String(row.platform || '') }));
  }

  function referenceChainReachesScheme(startSchemeId, targetSchemeId, visited) {
    const start = String(startSchemeId || '');
    const target = String(targetSchemeId || '');
    if (!start || !target) return false;
    if (start === target) return true;
    const seen = visited || new Set();
    if (seen.has(start)) return false;
    seen.add(start);
    const dependencies = query("SELECT DISTINCT source_scheme_id FROM price_system_fields WHERE scheme_id = ? AND field_type = 'reference' AND is_active = 1 AND COALESCE(source_scheme_id, '') <> ''", [start]).rows;
    return dependencies.some(row => referenceChainReachesScheme(row.source_scheme_id, target, seen));
  }

  function getSchemeOrNull(id) {
    const row = queryOne('SELECT * FROM price_system_schemes WHERE id = ?', [id]);
    return row ? Object.assign({}, row, { sales_channel: String(row.platform || '') }) : null;
  }

  function scopedCountryIds(req) {
    const scope = req.currentUserDataScope || {};
    const ids = Array.isArray(scope.countries) ? scope.countries.slice() : [];
    if (Array.isArray(scope.warehouses) && scope.warehouses.length) {
      const rows = query(
        "SELECT DISTINCT country_id FROM warehouses WHERE id IN (" + scope.warehouses.map(() => '?').join(',') + ") AND country_id != ''",
        scope.warehouses
      ).rows;
      rows.forEach(row => { if (row.country_id && !ids.includes(row.country_id)) ids.push(row.country_id); });
    }
    return ids;
  }

  function isCountryRestricted(req) {
    if (typeof needsDataScopeFilter !== 'function' || !needsDataScopeFilter(req)) return false;
    const scope = req.currentUserDataScope || {};
    return !!((scope.countries && scope.countries.length) || (scope.warehouses && scope.warehouses.length));
  }

  function scopedWarehouseNames(req) {
    if (typeof needsDataScopeFilter !== 'function' || !needsDataScopeFilter(req)) return null;
    const scope = req.currentUserDataScope || {};
    if (!Array.isArray(scope.warehouses) || !scope.warehouses.length) return null;
    return query('SELECT name FROM warehouses WHERE id IN (' + scope.warehouses.map(() => '?').join(',') + ')', scope.warehouses).rows.map(row => row.name).filter(Boolean);
  }

  function wacCountryAliases(scheme) {
    const row = queryOne('SELECT code FROM countries WHERE name = ?', [scheme.country]);
    const code = String(row && row.code || '').trim().toUpperCase();
    const aliases = {
      ID: ['ID', 'IND', 'INDONESIA', 'Indonesia', '\u5370\u5c3c', '\u5370\u5ea6\u5c3c\u897f\u4e9a', '\u5370\u5ea6\u5c3c\u897f\u4e9a\u5171\u548c\u56fd'],
      MY: ['MY', 'MALAYSIA', 'Malaysia', '\u9a6c\u6765', '\u9a6c\u6765\u897f\u4e9a'],
      TH: ['TH', 'THAILAND', 'Thailand', '\u6cf0\u56fd'],
      SG: ['SG', 'SINGAPORE', 'Singapore', '\u65b0\u52a0\u5761']
    }[code] || [scheme.country];
    return Array.from(new Set([scheme.country].concat(aliases).map(value => String(value || '').toLowerCase())));
  }

  function latestWacRowsForSkus(req, scheme, skuCodes) {
    const latest = new Map();
    const countryAliases = wacCountryAliases(scheme);
    const warehouses = scopedWarehouseNames(req);
    for (let i = 0; i < skuCodes.length; i += 400) {
      const part = skuCodes.slice(i, i + 400);
      let sql = "SELECT wh.id, wh.sku_code, wh.brand, wh.country, wh.warehouse, wh.new_avg_cost, wh.local_currency, wh.ci_no, wh.version_no, wh.confirmed_at, wh.last_inbound_date FROM wac_history wh WHERE wh.sku_code IN (" + part.map(() => '?').join(',') + ") AND LOWER(wh.country) IN (" + countryAliases.map(() => '?').join(',') + ") AND (COALESCE(wh.brand, '') = '' OR LOWER(wh.brand) = LOWER(?)) AND COALESCE(wh.is_locked, 0) = 1 AND LOWER(COALESCE(wh.confirmation_status, 'confirmed')) NOT IN ('reversed', 'void', 'cancelled') AND wh.confirmed_at IS NOT NULL AND wh.confirmed_at <> ''";
      const params = part.concat(countryAliases, [scheme.brand]);
      if (warehouses) {
        if (!warehouses.length) sql += ' AND 1 = 0';
        else { sql += ' AND wh.warehouse IN (' + warehouses.map(() => '?').join(',') + ')'; params.push(...warehouses); }
      }
      sql += " ORDER BY COALESCE(NULLIF(wh.confirmed_at, ''), NULLIF(wh.last_inbound_date, ''), wh.created_at) DESC, wh.version_no DESC, wh.created_at DESC";
      query(sql, params).rows.forEach(row => {
        const skuCode = String(row.sku_code || '').trim();
        if (!skuCode || latest.has(skuCode) || row.new_avg_cost == null || String(row.new_avg_cost).trim() === '') return;
        const value = Number(row.new_avg_cost);
        if (!Number.isFinite(value) || value < 0) return;
        const rawCurrency = String(row.local_currency || scheme.currency || '').trim().toUpperCase();
        latest.set(skuCode, {
          wac_history_id: row.id, value, currency: rawCurrency === 'CNY' ? 'RMB' : rawCurrency,
          warehouse: row.warehouse || '', ci_no: row.ci_no || '', version_no: Number(row.version_no || 0),
          confirmed_at: row.confirmed_at || '', last_inbound_date: String(row.last_inbound_date || '').slice(0, 10)
        });
      });
    }
    return latest;
  }

  function createVersion(schemeId, user, note) {
    const scheme = getSchemeOrNull(schemeId);
    if (!scheme) return null;
    const fields = query('SELECT * FROM price_system_fields WHERE scheme_id = ? ORDER BY sort_order, field_name', [schemeId]).rows;
    const values = query('SELECT sku_code, field_key, value, currency FROM price_system_values WHERE scheme_id = ? ORDER BY sku_code, field_key', [schemeId]).rows;
    const landingCosts = query('SELECT * FROM price_system_landing_costs WHERE scheme_id = ? ORDER BY sku_code', [schemeId]).rows;
    const srpValues = query('SELECT * FROM price_system_srp_values WHERE scheme_id = ? ORDER BY sku_code', [schemeId]).rows;
    const previous = queryOne('SELECT MAX(version_no) AS max_version FROM price_system_versions WHERE scheme_id = ?', [schemeId]);
    const versionNo = Number(previous && previous.max_version || 0) + 1;
    const snapshot = { scheme, fields, values, landingCosts, srpValues };
    run(
      'INSERT INTO price_system_versions (id, scheme_id, version_no, snapshot_json, note, created_by, created_by_name) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [genId('psv'), schemeId, versionNo, JSON.stringify(snapshot), String(note || ''), String(user && user.id || ''), String(user && user.name || '')]
    );
    return versionNo;
  }

  function userStamp(req) {
    return { id: req.currentUserId || '', name: req.currentUserName || '' };
  }

  function allowedFormulaVariables(fields, excludeKey) {
    const allowed = new Set(BUILTIN_PRICE_VARIABLES.filter(key => key !== excludeKey));
    (fields || []).forEach(field => {
      if (field && field.field_key && field.field_key !== excludeKey && Number(field.sync_quotation || 0) !== 1) allowed.add(field.field_key);
    });
    return Array.from(allowed);
  }

  function getSchemeData(req, res, scheme) {
    if (!schemeAccess(req, res, scheme)) return;
    const cache = new Map();
    const data = buildSchemeData(req, res, scheme, [], cache);
    if (data) res.json(data);
  }

  function buildSchemeData(req, res, scheme, referenceStack, cache) {
    if (!scheme) throw new Error('引用的来源价格方案不存在');
    if (referenceStack.includes(String(scheme.id))) throw new Error('价格方案之间存在循环引用，请检查引用关系');
    if (cache.has(String(scheme.id))) return cache.get(String(scheme.id));
    const rawFields = query(
      'SELECT * FROM price_system_fields WHERE scheme_id = ? AND is_active = 1 ORDER BY sort_order, field_name',
      [scheme.id]
    ).rows;
    const params = [scheme.country];
    let warehouseFilter = '';
    let scopeWarehouseNames = null;
    if (typeof needsDataScopeFilter === 'function' && needsDataScopeFilter(req)) {
      const scope = req.currentUserDataScope || {};
      if (Array.isArray(scope.warehouses) && scope.warehouses.length) {
        const names = query(
          'SELECT name FROM warehouses WHERE id IN (' + scope.warehouses.map(() => '?').join(',') + ')',
          scope.warehouses
        ).rows.map(r => r.name).filter(Boolean);
        if (!names.length) {
          warehouseFilter = ' AND 1 = 0';
          scopeWarehouseNames = [];
        } else {
          scopeWarehouseNames = names;
          warehouseFilter = ' AND warehouse IN (' + names.map(() => '?').join(',') + ')';
          params.push(...names);
        }
      }
    }
    const skuRows = query(
      'SELECT s.sku_code, s.brand, s.category, s.model, s.purchase_currency, ' +
      's.standard_purchase_price, s.purchase_price_rmb, s.purchase_price_usd, s.weighted_avg_cost, s.reference_customs_rate, ' +
      'COALESCE(i.stock_qty, 0) AS stock_qty, COALESCE(i.inventory_wac, 0) AS inventory_wac, i.last_inbound_date AS last_inbound_date ' +
      'FROM skus s LEFT JOIN (' +
      'SELECT sku_code, SUM(COALESCE(available_qty, 0)) AS stock_qty, MAX(last_inbound_date) AS last_inbound_date, ' +
      'CASE WHEN SUM(COALESCE(available_qty, 0)) > 0 ' +
      'THEN SUM(COALESCE(weighted_avg_cost, 0) * COALESCE(available_qty, 0)) / SUM(COALESCE(available_qty, 0)) ELSE 0 END AS inventory_wac ' +
      'FROM inventory WHERE country = ?' + warehouseFilter + ' GROUP BY sku_code' +
      ') i ON i.sku_code = s.sku_code WHERE s.brand = ? ' +
      'ORDER BY CASE WHEN COALESCE(s.category, \'\') = \'\' THEN 1 ELSE 0 END, s.category, s.sku_code',
      params.concat([scheme.brand])
    ).rows;
    const forecastMetricRows = [];
    const skuCodes = skuRows.map(row => String(row.sku_code || '').trim()).filter(Boolean);
    for (let offset = 0; offset < skuCodes.length; offset += 400) {
      const chunk = skuCodes.slice(offset, offset + 400);
      let forecastWarehouseFilter = '';
      const forecastParams = [scheme.country, ...chunk];
      if (scopeWarehouseNames !== null) {
        if (!scopeWarehouseNames.length) forecastWarehouseFilter += ' AND 1 = 0';
        else {
          forecastWarehouseFilter += ' AND rs.target_warehouse IN (' + scopeWarehouseNames.map(() => '?').join(',') + ')';
          forecastParams.push(...scopeWarehouseNames);
        }
      }
      const forecastRows = query(
        'SELECT rs.sku_code, rs.avg_sales_period, COALESCE(i.available_qty, 0) AS available_qty ' +
        'FROM replenishment_suggestions rs LEFT JOIN inventory i ON rs.sku_code = i.sku_code AND rs.country = i.country AND rs.target_warehouse = i.warehouse ' +
        'WHERE rs.country = ? AND rs.sku_code IN (' + chunk.map(() => '?').join(',') + ')' +
        forecastWarehouseFilter +
        ' AND rs.target_warehouse NOT IN (SELECT warehouse_name FROM consignment_inventory_lots WHERE warehouse_name IS NOT NULL AND warehouse_name != \'\')' +
        ' AND rs.target_warehouse NOT IN (SELECT name FROM warehouses WHERE LOWER(name) LIKE \'%consign%\' AND status = \'active\')',
        forecastParams
      ).rows;
      forecastMetricRows.push(...forecastRows);
    }
    const forecastMetricBySku = buildForecastMetricMap(forecastMetricRows);
    const salesStatsDaysRow = queryOne("SELECT value FROM system_config WHERE key = 'sales_stats_days'");
    const forecastStatsDays = Math.max(1, parseInt(salesStatsDaysRow && salesStatsDaysRow.value || '90', 10) || 90);
    const currentCategories = Array.from(new Set(primaryCategoryMapForSkus(skuRows, scheme.brand).values()));
    const canViewQuotation = (req.currentUserPermissions || []).includes('*') || (req.currentUserPermissions || []).includes('quotation_view');
    const fields = rawFields.filter(field => canViewQuotation || Number(field.sync_quotation || 0) !== 1).map(field => {
      const categorySettings = remapFieldCategorySettings(field, currentCategories);
      return Object.assign({}, field, {
        applicable_categories: categorySettings.applicable_categories,
        formula_rules: categorySettings.formula_rules,
        sync_wac: Number(field.sync_wac || 0) === 1,
        sync_quotation: Number(field.sync_quotation || 0) === 1
      });
    });
    if (!fields.some(field => field.field_key === 'srp')) fields.push({ id: 'builtin-srp', scheme_id: scheme.id, field_key: 'srp', field_name: 'SRP', field_type: 'formula', unit: '', applicable_categories: [], formula: String(scheme.srp_formula || ''), sync_wac: false, is_builtin_srp: true, sort_order: Number.isFinite(Number(scheme.srp_sort_order)) ? Number(scheme.srp_sort_order) : 999999 });
    fields.sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || String(a.field_name || '').localeCompare(String(b.field_name || '')));
    const categoryBySku = primaryCategoryMapForSkus(skuRows, scheme.brand);
    const storedRows = query(
      'SELECT sku_code, field_key, value, currency FROM price_system_values WHERE scheme_id = ?',
      [scheme.id]
    ).rows;
    const landingCostRows = query('SELECT * FROM price_system_landing_costs WHERE scheme_id = ?', [scheme.id]).rows;
    const landingCostBySku = new Map(landingCostRows.map(row => [row.sku_code, row]));
    const srpRows = query('SELECT sku_code, value FROM price_system_srp_values WHERE scheme_id = ?', [scheme.id]).rows;
    const manualSrpBySku = new Map(srpRows.map(row => [row.sku_code, Number(row.value)]));
    const storedBySku = new Map();
    const storedCurrencyBySku = new Map();
    storedRows.forEach(v => {
      if (!storedBySku.has(v.sku_code)) storedBySku.set(v.sku_code, {});
      if (!storedCurrencyBySku.has(v.sku_code)) storedCurrencyBySku.set(v.sku_code, {});
      storedBySku.get(v.sku_code)[v.field_key] = v.value == null ? null : Number(v.value);
      storedCurrencyBySku.get(v.sku_code)[v.field_key] = String(v.currency || '').trim().toUpperCase();
    });
    const fieldMap = new Map(fields.map(f => [f.field_key, f]));
    const referenceValuesByField = new Map();
    const referenceCurrenciesByField = new Map();
    fields.filter(field => field.field_type === 'reference').forEach(field => {
      const sourceScheme = getSchemeOrNull(field.source_scheme_id);
      if (!sourceScheme) { referenceValuesByField.set(field.field_key, new Map()); return; }
      if (String(sourceScheme.country || '') !== String(scheme.country || '') || String(sourceScheme.brand || '') !== String(scheme.brand || '')) throw new Error('引用来源必须与当前方案属于同一国家和品牌：' + field.field_name);
      if (!schemeAccess(req, res, sourceScheme)) throw new Error('没有权限读取引用来源价格方案：' + sourceScheme.id);
      const sourceData = buildSchemeData(req, res, sourceScheme, referenceStack.concat(String(scheme.id)), cache);
      const sourceFieldKey = String(field.source_field_key || '').trim();
      const sourceField = sourceData.fields.find(item => item.field_key === sourceFieldKey);
      if (!sourceField) { referenceValuesByField.set(field.field_key, new Map()); return; }
      const sourceValueType = sourceField.reference_value_type || sourceField.field_type;
      field.reference_value_type = sourceValueType;
      field.reference_sync_quotation = Number(sourceField.sync_quotation || 0) === 1 || sourceField.reference_sync_quotation === true;
      field.display_format = sourceField.display_format || 'auto';
      field.unit = String(sourceField.unit || ((sourceValueType === 'amount' || sourceField.display_format === 'amount') ? (sourceScheme.currency || '') : ''));
      field.decimal_places = sourceField.decimal_places == null ? 2 : sourceField.decimal_places;
      const referenceLookup = buildPriceSystemReferenceLookup(sourceData.rows, sourceFieldKey, sourceScheme.currency, field.reference_sync_quotation);
      referenceValuesByField.set(field.field_key, referenceLookup.valuesBySku);
      referenceCurrenciesByField.set(field.field_key, referenceLookup.currenciesBySku);
    });

    const today = new Date();
    const rows = skuRows.map(sku => {
      const skuCategory = categoryBySku.get(String(sku.sku_code || '').trim()) || '未分类';
      const forecastMetric = forecastMetricBySku.get(sku.sku_code) || null;
      const inboundDate = String(sku.last_inbound_date || '').trim();
      let daysSinceLastInbound = null;
      if (inboundDate) {
        const parsedInboundDate = new Date(inboundDate);
        if (!Number.isNaN(parsedInboundDate.getTime())) daysSinceLastInbound = Math.floor((today - parsedInboundDate) / 86400000);
      }
      const stored = storedBySku.get(sku.sku_code) || {};
      const landingCost = landingCostBySku.get(sku.sku_code) || null;
      const base = {
        purchase_price_rmb: Number(sku.purchase_price_rmb || 0),
        purchase_price_usd: Number(sku.purchase_price_usd || 0),
        standard_purchase_price: Number(sku.standard_purchase_price || 0),
        weighted_avg_cost: Number(sku.weighted_avg_cost || 0),
        inventory_wac: Number(sku.inventory_wac || 0),
        reference_customs_rate: Number(sku.reference_customs_rate || 0),
        landing_cost: Number(landingCost && landingCost.value || 0),
        stock_qty: Number(sku.stock_qty || 0),
        inventory_qty: Number(sku.stock_qty || 0)
      };
      const resolved = {};
      const resolving = new Set();
      const errors = {};

      function resolveField(key) {
        if (Object.prototype.hasOwnProperty.call(resolved, key)) return resolved[key];
        const field = fieldMap.get(key);
        if (!field) return Object.prototype.hasOwnProperty.call(base, key) ? base[key] : 0;
        const categoryFormula = field.field_type === 'formula' ? formulaForCategory(field, skuCategory) : null;
        if (field.field_type === 'formula' && Object.keys(parseFormulaRules(field.formula_rules)).length && !categoryFormula) { resolved[key] = null; return null; }
        if (!isCategoryApplicable(field, skuCategory)) { resolved[key] = 0; return 0; }
        if (field.field_type === 'reference') {
          const sourceValues = referenceValuesByField.get(field.field_key);
          const raw = sourceValues && sourceValues.has(String(sku.sku_code || '').trim()) ? sourceValues.get(String(sku.sku_code || '').trim()) : null;
          resolved[key] = raw == null || !Number.isFinite(Number(raw)) ? null : Number(raw);
          if (resolved[key] == null) errors[key] = '来源方案中未找到该 SKU 的对应字段值';
          return resolved[key];
        }
        if (field.field_key === 'srp' && manualSrpBySku.has(sku.sku_code)) { resolved[key] = manualSrpBySku.get(sku.sku_code); return resolved[key]; }
        if (Number(field.sync_wac || 0) === 1) { resolved[key] = landingCost && landingCost.value != null ? Number(landingCost.value) : 0; return resolved[key]; }
        if (field.field_type !== 'formula') {
          const raw = stored[key];
          resolved[key] = raw == null ? 0 : Number(raw);
          return resolved[key];
        }
        if (resolving.has(key)) {
          errors[key] = '公式存在循环引用';
          return 0;
        }
        resolving.add(key);
        try {
          const vars = Object.assign({}, base, resolved);
          const expression = normalizeFormulaExpression(categoryFormula || field.formula, fields);
          let hasMissingReference = false;
          getFormulaVariables(expression).forEach(dep => {
            if (fieldMap.has(dep)) {
              vars[dep] = resolveField(dep);
              if (vars[dep] == null) hasMissingReference = true;
            }
          });
          resolved[key] = hasMissingReference ? null : (expression ? evaluateFormula(expression, vars) : 0);
          if (hasMissingReference) errors[key] = '公式依赖的引用字段缺少对应 SKU 数值';
        } catch (e) {
          errors[key] = e.message;
          resolved[key] = 0;
        }
        resolving.delete(key);
        return resolved[key];
      }

      const values = {};
      fields.forEach(field => {
        if (!isCategoryApplicable(field, skuCategory)) values[field.field_key] = null;
        else if (Number(field.sync_wac || 0) === 1) values[field.field_key] = landingCost && landingCost.value != null ? Number(landingCost.value) : null;
        else if (field.field_type === 'formula' || field.field_type === 'reference') values[field.field_key] = resolveField(field.field_key);
        else values[field.field_key] = stored[field.field_key] == null ? null : Number(stored[field.field_key]);
      });

      let srp = null;
      let srpSource = '';
      if (manualSrpBySku.has(sku.sku_code)) { srp = manualSrpBySku.get(sku.sku_code); srpSource = 'manual'; }
      else if (fieldMap.has('srp') && String(fieldMap.get('srp').formula || '').trim()) {
        srp = resolveField('srp'); srpSource = 'formula';
      }
      values.srp = srp;
      return {
        sku_code: sku.sku_code, brand: sku.brand || '', category: skuCategory, model: sku.model || '',
        stock_qty: Number(sku.stock_qty || 0),
        forecast_avg_sales: forecastMetric ? Number(forecastMetric.avg_sales_period || 0) : null,
        available_turnover: forecastMetric ? forecastMetric.available_turnover : null,
        days_since_last_inbound: daysSinceLastInbound,
        last_inbound_date: inboundDate,
        purchase_currency: sku.purchase_currency || '',
        landing_cost: landingCost ? { wac_history_id:landingCost.wac_history_id, value:Number(landingCost.value), currency:landingCost.currency||scheme.currency||'', warehouse:landingCost.warehouse||'', ci_no:landingCost.ci_no||'', version_no:Number(landingCost.version_no||0), confirmed_at:landingCost.confirmed_at||'', last_inbound_date:landingCost.last_inbound_date||'' } : null,
        values, value_currencies: Object.fromEntries(fields.filter(field => Number(field.sync_quotation || 0) === 1 || field.reference_sync_quotation === true).map(field => [field.field_key, field.reference_sync_quotation === true ? ((referenceCurrenciesByField.get(field.field_key) || new Map()).get(String(sku.sku_code || '').trim()) || '') : ((storedCurrencyBySku.get(sku.sku_code) || {})[field.field_key] || '')])), formula_context: Object.assign({}, base, values), srp, srp_source:srpSource, formula_errors:errors
      };
    });

    const result = { scheme, fields, rows, forecast_stats_days: forecastStatsDays };
    cache.set(String(scheme.id), result);
    return result;
  }

  app.get('/api/price-system/schemes', canRead, asyncHandler((req, res) => {
    res.json(listSchemesForUser(req));
  }));

  app.post('/api/price-system/schemes', canWrite, asyncHandler((req, res) => {
    try {
      const country = String(req.body.country || '').trim();
      const brand = String(req.body.brand || '').trim();
      const platform = String(req.body.sales_channel || req.body.platform || '').trim();
      const shopName = String(req.body.shop_name || '').trim();
      if (!country || !brand || !platform) return res.status(400).json({ error: '国家、品牌和销售渠道不能为空' });
      const countryRow = queryOne('SELECT id, default_currency FROM countries WHERE name = ? AND status = ?', [country, 'active']);
      if (!countryRow) return res.status(400).json({ error: '请选择有效国家' });
      if (typeof needsDataScopeFilter === 'function' && needsDataScopeFilter(req)) {
        const scope = req.currentUserDataScope || {};
        if (isCountryRestricted(req) && !scopedCountryIds(req).includes(countryRow.id)) {
          return res.status(403).json({ error: '没有在该国家创建价格方案的权限' });
        }
        if (Array.isArray(scope.brands) && scope.brands.length && !scope.brands.includes(brand)) {
          return res.status(403).json({ error: '没有在该品牌创建价格方案的权限' });
        }
      }
      const brandRow = queryOne('SELECT COUNT(*) AS count FROM skus WHERE brand = ?', [brand]);
      if (!brandRow || Number(brandRow.count || 0) === 0) return res.status(400).json({ error: '品牌下没有 SKU 主数据' });
      const duplicate = queryOne(
        'SELECT id FROM price_system_schemes WHERE country = ? AND brand = ? AND platform = ? AND shop_name = ?',
        [country, brand, platform, shopName]
      );
      if (duplicate) return res.status(409).json({ error: '该国家、品牌、销售渠道和店铺已存在价格方案' });
      const id = genId('ps');
      run(
        'INSERT INTO price_system_schemes (id, country, brand, platform, shop_name, currency, status, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, country, brand, platform, shopName, String(req.body.currency || countryRow.default_currency || '').trim().toUpperCase(), 'active', String(req.body.notes || ''), req.currentUserId || '']
      );
      createVersion(id, userStamp(req), '创建价格方案');
      const schemeSkuKeys = query('SELECT sku_code, brand FROM skus WHERE brand = ?', [brand]).rows.map(row => ({ sku_code: row.sku_code, brand: row.brand || brand, country }));
      syncPriceSystemLandingCostsForWacKeys(schemeSkuKeys, userStamp(req), 'New price scheme initial WAC sync');
      res.json(getSchemeOrNull(id));
    } catch (e) {
      res.status(500).json({ error: e.message || '创建价格方案失败' });
    }
  }));

  app.post('/api/price-system/schemes/:id/copy', canWrite, asyncHandler((req, res) => {
    try {
      const source = getSchemeOrNull(req.params.id);
      if (!schemeAccess(req, res, source)) return;
      if (String(source.status || '').toLowerCase() !== 'active') return res.status(400).json({ error: '只能复制启用中的价格方案' });

      const country = String(req.body.country || '').trim();
      const brand = String(req.body.brand || '').trim();
      const platform = String(req.body.sales_channel || req.body.platform || '').trim();
      const shopName = String(req.body.shop_name || '').trim();
      if (!country || !brand || !platform) return res.status(400).json({ error: '国家、品牌和销售渠道不能为空' });

      const countryRow = queryOne('SELECT id, default_currency FROM countries WHERE name = ? AND status = ?', [country, 'active']);
      if (!countryRow) return res.status(400).json({ error: '请选择有效国家' });
      if (typeof needsDataScopeFilter === 'function' && needsDataScopeFilter(req)) {
        const scope = req.currentUserDataScope || {};
        if (isCountryRestricted(req) && !scopedCountryIds(req).includes(countryRow.id)) {
          return res.status(403).json({ error: '没有在该国家创建价格方案的权限' });
        }
        if (Array.isArray(scope.brands) && scope.brands.length && !scope.brands.includes(brand)) {
          return res.status(403).json({ error: '没有在该品牌创建价格方案的权限' });
        }
      }
      const targetSkuRows = query('SELECT sku_code, brand, category FROM skus WHERE brand = ?', [brand]).rows;
      if (!targetSkuRows.length) return res.status(400).json({ error: '品牌下没有 SKU 主数据' });
      const targetCategories = Array.from(new Set(primaryCategoryMapForSkus(targetSkuRows).values())).sort((a, b) => a.localeCompare(b));
      const duplicate = queryOne(
        'SELECT id FROM price_system_schemes WHERE country = ? AND brand = ? AND platform = ? AND shop_name = ?',
        [country, brand, platform, shopName]
      );
      if (duplicate) return res.status(409).json({ error: '该国家、品牌、销售渠道和店铺已存在价格方案' });

      const id = genId('ps');
      const sourceFields = query(
        'SELECT * FROM price_system_fields WHERE scheme_id = ? ORDER BY sort_order, field_name, id',
        [source.id]
      ).rows;
      if (sourceFields.some(field => Number(field.sync_quotation || 0) === 1) && !(req.currentUserPermissions || []).includes('*') && !(req.currentUserPermissions || []).includes('quotation_view')) return res.status(403).json({ error: '复制包含自动同步报价字段的方案需要报价管理查看权限' });
      const copiedFields = buildCopiedFieldRows(sourceFields, id, genId, targetCategories);
      transaction(() => {
        run(
          'INSERT INTO price_system_schemes (id, country, brand, platform, shop_name, currency, status, srp_formula, srp_sort_order, freeze_field_key, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [id, country, brand, platform, shopName, String(req.body.currency || countryRow.default_currency || '').trim().toUpperCase(), 'active', String(source.srp_formula || ''), Number(source.srp_sort_order == null ? 999999 : source.srp_sort_order), String(source.freeze_field_key || '__sku'), String(req.body.notes || ''), req.currentUserId || '']
        );
        copiedFields.forEach(field => {
          run(
            'INSERT INTO price_system_fields (id, scheme_id, field_key, field_name, field_type, unit, applicable_categories, formula, formula_rules, display_format, decimal_places, sync_wac, sync_quotation, source_scheme_id, source_field_key, sort_order, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [field.id, field.scheme_id, field.field_key, field.field_name, field.field_type, field.unit, field.applicable_categories, field.formula, field.formula_rules, field.display_format, field.decimal_places, field.sync_wac, field.sync_quotation, field.source_scheme_id, field.source_field_key, field.sort_order, field.is_active]
          );
        });
        createVersion(id, userStamp(req), '从价格方案复制配置：' + String(source.country || '') + ' / ' + String(source.brand || '') + ' / ' + String(source.platform || ''));
      });

      // Copy only reusable configuration. SKU-specific fees, manual SRP overrides and old WAC links
      // remain independent; the new scheme gets a fresh WAC sync for its destination country.
      const schemeSkuKeys = targetSkuRows
        .map(row => ({ sku_code: row.sku_code, brand: row.brand || brand, country }));
      syncPriceSystemLandingCostsForWacKeys(schemeSkuKeys, userStamp(req), 'Copied price scheme initial WAC sync');
      syncPriceSystemQuotationForKeys(schemeSkuKeys, userStamp(req), 'Copied price scheme initial quotation sync');
      res.status(201).json(getSchemeOrNull(id));
    } catch (e) {
      res.status(500).json({ error: e.message || '复制价格方案失败' });
    }
  }));

  app.get('/api/price-system/schemes/:id/fields', canRead, asyncHandler((req, res) => {
    const scheme = getSchemeOrNull(req.params.id);
    if (!schemeAccess(req, res, scheme)) return;
    const canViewQuotation = (req.currentUserPermissions || []).includes('*') || (req.currentUserPermissions || []).includes('quotation_view');
    const fields = query('SELECT id, scheme_id, field_key, field_name, field_type, unit, display_format, decimal_places, sync_wac, sync_quotation, source_scheme_id, source_field_key FROM price_system_fields WHERE scheme_id = ? AND is_active = 1 ORDER BY sort_order, field_name', [scheme.id]).rows
      .filter(field => canViewQuotation || Number(field.sync_quotation || 0) !== 1)
      .map(field => Object.assign({}, field, { sync_wac: Number(field.sync_wac || 0) === 1, sync_quotation: Number(field.sync_quotation || 0) === 1 }));
    if (!fields.some(field => field.field_key === 'srp')) fields.push({ id: 'builtin-srp', scheme_id: scheme.id, field_key: 'srp', field_name: 'SRP', field_type: 'formula', unit: '', display_format: 'amount', decimal_places: 2, sync_wac: false, sync_quotation: false, is_builtin_srp: true });
    res.json({ scheme, fields });
  }));

  app.get('/api/price-system/schemes/:id/data', canRead, asyncHandler((req, res) => {
    try { getSchemeData(req, res, getSchemeOrNull(req.params.id)); }
    catch (e) { res.status(500).json({ error: e.message || '读取价格数据失败' }); }
  }));

  app.post('/api/price-system/schemes/:id/landing-cost/sync-wac', canWrite, canViewWac, asyncHandler((req, res) => {
    const scheme = getSchemeOrNull(req.params.id);
    if (!schemeAccess(req, res, scheme)) return;
    const skuCodes = query('SELECT sku_code FROM skus WHERE brand = ? ORDER BY sku_code', [scheme.brand]).rows
      .map(row => String(row.sku_code || '').trim()).filter(Boolean);
    if (!skuCodes.length) return res.json({ success: true, matched_count: 0, unmatched_count: 0, changed_count: 0, unchanged_count: 0, unmatched_skus: [], version_no: null });
    const latest = latestWacRowsForSkus(req, scheme, skuCodes);
    const existingRows = query('SELECT sku_code, wac_history_id FROM price_system_landing_costs WHERE scheme_id = ?', [scheme.id]).rows;
    const existingBySku = new Map(existingRows.map(row => [row.sku_code, row.wac_history_id]));
    const matched = skuCodes.filter(code => latest.has(code));
    const unmatched = skuCodes.filter(code => !latest.has(code));
    const changed = matched.filter(code => existingBySku.get(code) !== latest.get(code).wac_history_id);
    const summary = { matched_count: matched.length, unmatched_count: unmatched.length, changed_count: changed.length, unchanged_count: matched.length - changed.length, unmatched_skus: unmatched.slice(0, 20) };
    if (req.body && req.body.preview) return res.json(Object.assign({ success: true, preview: true }, summary));
    if (changed.length) {
      transaction(() => changed.forEach(skuCode => {
        const wac = latest.get(skuCode);
        run("INSERT INTO price_system_landing_costs (id, scheme_id, sku_code, wac_history_id, value, currency, warehouse, ci_no, version_no, confirmed_at, last_inbound_date, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now')) ON CONFLICT(scheme_id, sku_code) DO UPDATE SET wac_history_id = excluded.wac_history_id, value = excluded.value, currency = excluded.currency, warehouse = excluded.warehouse, ci_no = excluded.ci_no, version_no = excluded.version_no, confirmed_at = excluded.confirmed_at, last_inbound_date = excluded.last_inbound_date, updated_by = excluded.updated_by, updated_at = datetime('now')", [genId('pslc'), scheme.id, skuCode, wac.wac_history_id, wac.value, wac.currency, wac.warehouse, wac.ci_no, wac.version_no, wac.confirmed_at, wac.last_inbound_date, req.currentUserId || '']);
      }));
    }
    const versionNo = changed.length ? createVersion(scheme.id, userStamp(req), 'Batch sync Landing Cost from latest WAC') : null;
    res.json(Object.assign({ success: true, preview: false, version_no: versionNo }, summary));
  }));

  app.get('/api/price-system/schemes/:id/skus/:skuCode/wac-history', canRead, canViewWac, asyncHandler((req, res) => {
    const scheme = getSchemeOrNull(req.params.id);
    if (!schemeAccess(req, res, scheme)) return;
    const skuCode = String(req.params.skuCode || '').trim();
    if (!queryOne('SELECT sku_code FROM skus WHERE sku_code = ? AND brand = ?', [skuCode, scheme.brand])) return res.status(404).json({ error: 'SKU \u4e0d\u5b58\u5728\u6216\u4e0d\u5c5e\u4e8e\u5f53\u524d\u54c1\u724c' });
    const countryAliases = wacCountryAliases(scheme);
    let sql = "SELECT wh.id, wh.sku_code, wh.brand, wh.country, wh.warehouse, wh.new_avg_cost, wh.local_currency, wh.ci_no, wh.version_no, wh.confirmed_at, wh.last_inbound_date FROM wac_history wh WHERE wh.sku_code = ? AND LOWER(wh.country) IN (" + countryAliases.map(() => '?').join(',') + ") AND (COALESCE(wh.brand, '') = '' OR LOWER(wh.brand) = LOWER(?)) AND COALESCE(wh.is_locked, 0) = 1 AND LOWER(COALESCE(wh.confirmation_status, 'confirmed')) NOT IN ('reversed', 'void', 'cancelled') AND wh.confirmed_at IS NOT NULL AND wh.confirmed_at <> ''";
    const params = [skuCode].concat(countryAliases, [scheme.brand]);
    const warehouses = scopedWarehouseNames(req);
    if (warehouses) { if (!warehouses.length) sql += ' AND 1 = 0'; else { sql += ' AND wh.warehouse IN (' + warehouses.map(() => '?').join(',') + ')'; params.push(...warehouses); } }
    sql += " ORDER BY COALESCE(NULLIF(wh.confirmed_at, ''), NULLIF(wh.last_inbound_date, ''), wh.created_at) DESC, wh.version_no DESC, wh.created_at DESC LIMIT 200";
    const rows = query(sql, params).rows.filter(row => row.new_avg_cost != null && String(row.new_avg_cost).trim() !== '').map(row => { const raw=String(row.local_currency || scheme.currency || '').trim().toUpperCase(); return Object.assign({}, row, { new_avg_cost:Number(row.new_avg_cost), local_currency:raw==='CNY'?'RMB':raw, last_inbound_date:String(row.last_inbound_date || '').slice(0,10) }); });
    res.json({ rows });
  }));

  app.post('/api/price-system/schemes/:id/landing-cost', canWrite, canViewWac, asyncHandler((req, res) => {
    const scheme = getSchemeOrNull(req.params.id);
    if (!schemeAccess(req, res, scheme)) return;
    const skuCode = String(req.body && req.body.sku_code || '').trim();
    const historyId = String(req.body && req.body.wac_history_id || '').trim();
    if (!skuCode) return res.status(400).json({ error: '\u8bf7\u586b\u5199 SKU \u7f16\u7801' });
    if (!queryOne('SELECT sku_code FROM skus WHERE sku_code = ? AND brand = ?', [skuCode, scheme.brand])) return res.status(404).json({ error: 'SKU \u4e0d\u5b58\u5728\u6216\u4e0d\u5c5e\u4e8e\u5f53\u524d\u54c1\u724c' });
    if (!historyId) {
      run('DELETE FROM price_system_landing_costs WHERE scheme_id = ? AND sku_code = ?', [scheme.id, skuCode]);
      const versionNo = createVersion(scheme.id, userStamp(req), 'Clear Landing Cost: ' + skuCode);
      return res.json({ success: true, landing_cost: null, version_no: versionNo });
    }
    const countryAliases = wacCountryAliases(scheme);
    let sql = "SELECT wh.id, wh.sku_code, wh.brand, wh.country, wh.warehouse, wh.new_avg_cost, wh.local_currency, wh.ci_no, wh.version_no, wh.confirmed_at, wh.last_inbound_date FROM wac_history wh WHERE wh.id = ? AND wh.sku_code = ? AND LOWER(wh.country) IN (" + countryAliases.map(() => '?').join(',') + ") AND (COALESCE(wh.brand, '') = '' OR LOWER(wh.brand) = LOWER(?)) AND COALESCE(wh.is_locked, 0) = 1 AND LOWER(COALESCE(wh.confirmation_status, 'confirmed')) NOT IN ('reversed', 'void', 'cancelled') AND wh.confirmed_at IS NOT NULL AND wh.confirmed_at <> ''"
    const params = [historyId, skuCode].concat(countryAliases, [scheme.brand]);
    const warehouses = scopedWarehouseNames(req);
    if (warehouses) { if (!warehouses.length) sql += ' AND 1 = 0'; else { sql += ' AND wh.warehouse IN (' + warehouses.map(() => '?').join(',') + ')'; params.push(...warehouses); } }
    const wac = queryOne(sql, params);
    if (!wac) return res.status(400).json({ error: '\u6240\u9009 WAC \u5386\u53f2\u8bb0\u5f55\u65e0\u6548\u3001\u5df2\u51b2\u9500\u6216\u4e0e\u5f53\u524d SKU \u4e0d\u5339\u914d' });
    if (wac.new_avg_cost == null || String(wac.new_avg_cost).trim() === '') return res.status(400).json({ error: 'WAC cost is missing' });
    const value = Number(wac.new_avg_cost);
    if (!Number.isFinite(value) || value < 0) return res.status(400).json({ error: 'WAC \u6210\u672c\u4e0d\u662f\u6709\u6548\u7684\u975e\u8d1f\u6570' });
    const rawCurrency = String(wac.local_currency || scheme.currency || '').trim().toUpperCase();
    const landingCost = { wac_history_id:wac.id, value, currency:rawCurrency==='CNY'?'RMB':rawCurrency, warehouse:wac.warehouse||'', ci_no:wac.ci_no||'', version_no:Number(wac.version_no||0), confirmed_at:wac.confirmed_at||'', last_inbound_date:String(wac.last_inbound_date||'').slice(0,10) };
    run("INSERT INTO price_system_landing_costs (id, scheme_id, sku_code, wac_history_id, value, currency, warehouse, ci_no, version_no, confirmed_at, last_inbound_date, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now')) ON CONFLICT(scheme_id, sku_code) DO UPDATE SET wac_history_id = excluded.wac_history_id, value = excluded.value, currency = excluded.currency, warehouse = excluded.warehouse, ci_no = excluded.ci_no, version_no = excluded.version_no, confirmed_at = excluded.confirmed_at, last_inbound_date = excluded.last_inbound_date, updated_by = excluded.updated_by, updated_at = datetime('now')", [genId('pslc'), scheme.id, skuCode, landingCost.wac_history_id, landingCost.value, landingCost.currency, landingCost.warehouse, landingCost.ci_no, landingCost.version_no, landingCost.confirmed_at, landingCost.last_inbound_date, req.currentUserId || '']);
    const versionNo = createVersion(scheme.id, userStamp(req), 'Update Landing Cost: ' + skuCode);
    res.json({ success: true, landing_cost: landingCost, version_no: versionNo });
  }));

  app.put('/api/price-system/schemes/:id', canWrite, asyncHandler((req, res) => {
    const scheme = getSchemeOrNull(req.params.id);
    if (!schemeAccess(req, res, scheme)) return;
    const body = req.body || {};
    const currency = String(body.currency || scheme.currency || '').trim().toUpperCase();
    const notes = body.notes == null ? scheme.notes : String(body.notes);
    const schemeDetailsChanged = currency !== String(scheme.currency || '').trim().toUpperCase() || notes !== String(scheme.notes || '');
    let freezeFieldKey = String(scheme.freeze_field_key || '__sku').trim() || '__sku';
    if (Object.prototype.hasOwnProperty.call(body, 'freeze_field_key')) {
      freezeFieldKey = String(body.freeze_field_key == null ? '' : body.freeze_field_key).trim();
      const builtInKeys = new Set(['none', '__category', '__sku', '__forecast_avg_sales', '__stock_qty', '__available_turnover']);
      if (!builtInKeys.has(freezeFieldKey)) {
        const field = queryOne('SELECT id FROM price_system_fields WHERE scheme_id = ? AND field_key = ? AND is_active = 1', [scheme.id, freezeFieldKey]);
        if (!field) return res.status(400).json({ error: '冻结列字段不存在或已停用' });
      }
    }
    run('UPDATE price_system_schemes SET currency = ?, notes = ?, freeze_field_key = ?, updated_at = datetime(\'now\') WHERE id = ?', [currency, notes, freezeFieldKey, scheme.id]);
    if (schemeDetailsChanged) createVersion(scheme.id, userStamp(req), '更新价格方案信息');
    res.json(getSchemeOrNull(scheme.id));
  }));

  app.post('/api/price-system/schemes/:id/formula/preview', canRead, asyncHandler((req, res) => {
    const scheme = getSchemeOrNull(req.params.id);
    if (!schemeAccess(req, res, scheme)) return;
    const body = req.body || {};
    const formula = String(body.formula || '').trim();
    const excludeKey = String(body.exclude_key || '').trim();
    const fields = query('SELECT * FROM price_system_fields WHERE scheme_id = ? AND is_active = 1', [scheme.id]).rows;
    const normalizedFormula = normalizeFormulaExpression(formula, fields);
    try {
      const validation = validateFormula(normalizedFormula, allowedFormulaVariables(fields, excludeKey));
      const supplied = body.variables && typeof body.variables === 'object' && !Array.isArray(body.variables) ? body.variables : {};
      const variables = {};
      const previewFieldMap = new Map(fields.map(field => [field.field_key, field]));
      validation.variables.forEach(key => {
        const raw = Object.prototype.hasOwnProperty.call(supplied, key) ? supplied[key] : 0;
        const sourceField = previewFieldMap.get(key);
        if ((sourceField && (sourceField.field_type === 'reference' || sourceField.field_type === 'formula')) && (raw == null || raw === '')) throw new Error('当前 SKU 缺少引用字段数值：' + key);
        const value = raw == null || raw === '' ? 0 : Number(raw);
        if (!Number.isFinite(value)) throw new Error('字段不是有效数字：' + key);
        variables[key] = value;
      });
      const result = evaluateFormula(normalizedFormula, variables);
      res.json({ valid: true, variables: validation.variables, result });
    } catch (e) {
      res.status(400).json({ valid: false, error: e.message });
    }
  }));

  app.post('/api/price-system/schemes/:id/formula/recalculate-preview', canRead, asyncHandler((req, res) => {
    const scheme = getSchemeOrNull(req.params.id);
    if (!schemeAccess(req, res, scheme)) return;
    const body = req.body || {};
    const skuCode = String(body.sku_code || '').trim();
    if (!skuCode) return res.status(400).json({ error: 'SKU 编码不能为空' });
    const sku = queryOne(
      'SELECT sku_code, brand, category FROM skus WHERE brand = ? AND sku_code = ?',
      [scheme.brand, skuCode]
    );
    if (!sku) return res.status(404).json({ error: 'SKU 不存在或不属于当前品牌' });
    const category = primaryCategoryMapForSkus([sku]).get(skuCode) || '未分类';
    const canViewQuotation = (req.currentUserPermissions || []).includes('*') || (req.currentUserPermissions || []).includes('quotation_view');
    const fields = query(
      'SELECT * FROM price_system_fields WHERE scheme_id = ? AND is_active = 1',
      [scheme.id]
    ).rows.filter(field => canViewQuotation || Number(field.sync_quotation || 0) !== 1).slice();
    if (!fields.some(field => field.field_key === 'srp')) {
      fields.push({
        id: 'builtin-srp', scheme_id: scheme.id, field_key: 'srp', field_name: 'SRP',
        field_type: 'formula', unit: '', applicable_categories: [],
        formula: String(scheme.srp_formula || ''), formula_rules: '{}',
        sync_wac: 0, sync_quotation: 0, is_builtin_srp: true
      });
    }
    const fieldMap = new Map(fields.map(field => [field.field_key, field]));
    const supplied = body.context && typeof body.context === 'object' && !Array.isArray(body.context)
      ? body.context
      : {};
    const context = {};
    try {
      allowedFormulaVariables(fields).forEach(key => {
        const raw = Object.prototype.hasOwnProperty.call(supplied, key) ? supplied[key] : null;
        const sourceField = fieldMap.get(key);
        const missingComputedValue = raw == null || raw === '';
        const value = missingComputedValue ? (sourceField && (sourceField.field_type === 'reference' || sourceField.field_type === 'formula') ? null : 0) : Number(raw);
        if (value !== null && !Number.isFinite(value)) throw new Error('字段不是有效数字：' + key);
        context[key] = value;
      });
      let manualSrp = null;
      if (body.manual_srp !== null && body.manual_srp !== undefined && body.manual_srp !== '') {
        manualSrp = Number(body.manual_srp);
        if (!Number.isFinite(manualSrp) || manualSrp < 0) throw new Error('SRP 必须为有效的非负数');
      }
      const resolved = {};
      const resolving = new Set();
      const errors = {};
      function resolveField(key) {
        if (key === 'srp' && manualSrp !== null) {
          resolved[key] = manualSrp;
          return manualSrp;
        }
        if (Object.prototype.hasOwnProperty.call(resolved, key)) return resolved[key];
        const field = fieldMap.get(key);
        if (!field) return Object.prototype.hasOwnProperty.call(context, key) ? context[key] : 0;
        if (!isCategoryApplicable(field, category)) {
          resolved[key] = 0;
          return 0;
        }
        if (field.field_type !== 'formula' || Number(field.sync_wac || 0) === 1) {
          resolved[key] = Object.prototype.hasOwnProperty.call(context, key) ? context[key] : 0;
          return resolved[key];
        }
        const categoryFormula = formulaForCategory(field, category);
        if (!categoryFormula) {
          resolved[key] = null;
          return null;
        }
        if (resolving.has(key)) {
          errors[key] = '公式存在循环引用';
          resolved[key] = 0;
          return 0;
        }
        resolving.add(key);
        try {
          const expression = normalizeFormulaExpression(categoryFormula, fields);
          const variables = Object.assign({}, context, resolved);
          let hasMissingComputedValue = false;
          getFormulaVariables(expression).forEach(dependency => {
            if (fieldMap.has(dependency)) {
              variables[dependency] = resolveField(dependency);
              const dependencyField = fieldMap.get(dependency);
              if (variables[dependency] == null && dependencyField && (dependencyField.field_type === 'reference' || dependencyField.field_type === 'formula')) hasMissingComputedValue = true;
            }
          });
          resolved[key] = hasMissingComputedValue ? null : evaluateFormula(expression, variables);
          if (hasMissingComputedValue) errors[key] = '公式依赖的引用字段缺少对应 SKU 数值';
        } catch (error) {
          errors[key] = error.message;
          resolved[key] = 0;
        }
        resolving.delete(key);
        return resolved[key];
      }
      const values = {};
      fields.forEach(field => {
        if (field.field_type === 'reference') { values[field.field_key] = context[field.field_key] == null ? null : Number(context[field.field_key]); return; }
        if (field.field_type !== 'formula') return;
        values[field.field_key] = isCategoryApplicable(field, category) && formulaForCategory(field, category)
          ? resolveField(field.field_key)
          : null;
      });
      const srp = manualSrp !== null
        ? manualSrp
        : (fieldMap.has('srp') ? resolveField('srp') : null);
      values.srp = srp;
      const formulaContext = Object.assign({}, context, resolved, { srp });
      res.json({
        sku_code: skuCode,
        category,
        values,
        srp,
        srp_source: manualSrp !== null ? 'manual' : (formulaForCategory(fieldMap.get('srp'), category) ? 'formula' : ''),
        formula_context: formulaContext,
        formula_errors: errors
      });
    } catch (error) {
      res.status(400).json({ error: error.message || '公式重算失败' });
    }
  }));

  app.put('/api/price-system/schemes/:id/formula', canWrite, asyncHandler((req, res) => {
    const scheme = getSchemeOrNull(req.params.id);
    if (!schemeAccess(req, res, scheme)) return;
    const formula = String(req.body.srp_formula || '').trim();
    const fields = query('SELECT * FROM price_system_fields WHERE scheme_id = ? AND is_active = 1', [scheme.id]).rows;
    const normalizedFormula = normalizeFormulaExpression(formula, fields);
    try { if (formula) validateFormula(normalizedFormula, allowedFormulaVariables(fields, 'srp')); }
    catch (e) { return res.status(400).json({ error: e.message }); }
    run('UPDATE price_system_schemes SET srp_formula = ?, updated_at = datetime(\'now\') WHERE id = ?', [formula, scheme.id]);
    createVersion(scheme.id, userStamp(req), '更新 SRP 公式');
    res.json({ success: true, srp_formula: formula });
  }));

  app.put('/api/price-system/schemes/:id/fields/order', canWrite, asyncHandler((req, res) => {
    const scheme = getSchemeOrNull(req.params.id);
    if (!schemeAccess(req, res, scheme)) return;
    const requested = Array.isArray(req.body && req.body.field_ids)
      ? req.body.field_ids.map(value => String(value || '').trim()).filter(Boolean)
      : [];
    const feeFields = query('SELECT id FROM price_system_fields WHERE scheme_id = ? AND is_active = 1', [scheme.id]).rows;
    const expected = feeFields.map(field => String(field.id)).concat(['builtin-srp']);
    if (requested.length !== expected.length || new Set(requested).size !== requested.length || expected.some(id => !requested.includes(id))) {
      return res.status(400).json({ error: '字段顺序数据不完整或包含无效字段，请刷新后重试' });
    }
    transaction(() => {
      requested.forEach((id, index) => {
        const sortOrder = (index + 1) * 10;
        if (id === 'builtin-srp') {
          run('UPDATE price_system_schemes SET srp_sort_order = ?, updated_at = datetime(\'now\') WHERE id = ?', [sortOrder, scheme.id]);
        } else {
          run('UPDATE price_system_fields SET sort_order = ?, updated_at = datetime(\'now\') WHERE id = ? AND scheme_id = ?', [sortOrder, id, scheme.id]);
        }
      });
    });
    const versionNo = createVersion(scheme.id, userStamp(req), '调整费用字段顺序');
    res.json({ success: true, field_ids: requested, version_no: versionNo });
  }));

  app.post('/api/price-system/schemes/:id/fields', canWrite, asyncHandler((req, res) => {
    const scheme = getSchemeOrNull(req.params.id);
    if (!schemeAccess(req, res, scheme)) return;
    const d = req.body || {};
    const fieldName = String(d.field_name || '').trim();
    const fieldKey = String(d.field_key || '').trim().toLowerCase();
    const fieldType = String(d.field_type || 'amount');
    const unit = String(d.unit || '').trim();
    const displayFormat = ['auto', 'amount', 'number', 'percent'].includes(String(d.display_format || 'auto')) ? String(d.display_format || 'auto') : 'auto';
    const decimalPlacesRaw = Number(d.decimal_places == null ? 2 : d.decimal_places);
    const decimalPlaces = Number.isFinite(decimalPlacesRaw) ? Math.max(0, Math.min(6, Math.round(decimalPlacesRaw))) : 2;
    const categories = Array.isArray(d.applicable_categories) ? d.applicable_categories.map(v => String(v || '').trim()).filter(Boolean) : [];
    const formula = String(d.formula || '').trim();
    const formulaRules = parseFormulaRules(d.formula_rules);
    const hasFormulaRules = Object.keys(formulaRules).length > 0;
    const syncWac = d.sync_wac === true || Number(d.sync_wac || 0) === 1;
    const syncQuotation = d.sync_quotation === true || Number(d.sync_quotation || 0) === 1;
    const sourceSchemeId = String(d.source_scheme_id || '').trim();
    const sourceFieldKey = String(d.source_field_key || '').trim();
    const allowedTypes = ['amount', 'percent', 'number', 'formula', 'reference'];
    if (syncWac && syncQuotation) return res.status(400).json({ error: '同一个字段不能同时自动同步 WAC 和报价' });
    if (fieldType === 'reference' && (syncWac || syncQuotation)) return res.status(400).json({ error: '引用字段不能同时开启 WAC 或报价自动同步' });
    if (syncQuotation && fieldType !== 'amount') return res.status(400).json({ error: '报价自动同步只能用于金额字段' });
    if (fieldType === 'reference') {
      if (!sourceSchemeId || !sourceFieldKey) return res.status(400).json({ error: '请选择引用来源方案和字段' });
      if (sourceSchemeId === String(scheme.id)) return res.status(400).json({ error: '不能引用当前价格方案自身' });
      const sourceScheme = getSchemeOrNull(sourceSchemeId);
      if (!sourceScheme || String(sourceScheme.status || '').toLowerCase() !== 'active') return res.status(400).json({ error: '引用来源方案不存在或已停用' });
      if (String(sourceScheme.country || '') !== String(scheme.country || '') || String(sourceScheme.brand || '') !== String(scheme.brand || '')) return res.status(400).json({ error: '只能引用同一国家、同一品牌下其他销售渠道方案的字段' });
      if (!schemeAccess(req, res, sourceScheme)) return;
      const sourceField = sourceFieldKey === 'srp'
        ? { field_key: 'srp', field_name: 'SRP', field_type: 'formula', sync_quotation: 0 }
        : queryOne('SELECT field_key, field_name, field_type, sync_quotation FROM price_system_fields WHERE scheme_id = ? AND field_key = ? AND is_active = 1', [sourceScheme.id, sourceFieldKey]);
      if (!sourceField) return res.status(400).json({ error: '引用来源字段不存在或已停用' });
      if (Number(sourceField.sync_quotation || 0) === 1 && !(req.currentUserPermissions || []).includes('*') && !(req.currentUserPermissions || []).includes('quotation_view')) return res.status(403).json({ error: '引用自动同步报价字段需要报价管理查看权限' });
      if (referenceChainReachesScheme(sourceScheme.id, scheme.id)) return res.status(400).json({ error: '引用会形成循环依赖，请选择其他来源方案' });
    }

    if (!fieldName) return res.status(400).json({ error: '\u8d39\u7528\u5b57\u6bb5\u540d\u79f0\u4e0d\u80fd\u4e3a\u7a7a' });
    if (!/^[a-z][a-z0-9_]{1,39}$/.test(fieldKey)) return res.status(400).json({ error: '\u5b57\u6bb5\u7f16\u7801\u65e0\u6548' });
    if (!allowedTypes.includes(fieldType)) return res.status(400).json({ error: '\u5b57\u6bb5\u7c7b\u578b\u65e0\u6548' });
    if (fieldType === 'formula' && !formula && !hasFormulaRules) return res.status(400).json({ error: '\u81f3\u5c11\u914d\u7f6e\u4e00\u4e2a\u7c7b\u76ee\u516c\u5f0f\u89c4\u5219' });
    if (syncWac && fieldType !== 'amount') return res.status(400).json({ error: 'WAC \u81ea\u52a8\u540c\u6b65\u53ea\u80fd\u7528\u4e8e\u91d1\u989d\u5b57\u6bb5' });
    if (syncWac && !(req.currentUserPermissions || []).includes('*') && !(req.currentUserPermissions || []).includes('inbound_view')) return res.status(403).json({ error: 'WAC \u81ea\u52a8\u540c\u6b65\u9700\u8981\u5165\u5e93\u67e5\u770b\u6743\u9650' });

    // SRP is presented as a formula field in the same field manager, while retaining
    // the existing scheme-level storage for backward compatibility with old versions.
    if (fieldKey === 'srp' || d.id === 'builtin-srp') {
      if (fieldKey !== 'srp' || fieldType !== 'formula' || !formula) return res.status(400).json({ error: 'SRP \u5fc5\u987b\u914d\u7f6e\u4e3a\u516c\u5f0f\u5b57\u6bb5' });
      const existingFieldsForSrp = query('SELECT * FROM price_system_fields WHERE scheme_id = ? AND is_active = 1', [scheme.id]).rows;
      try { validateFormula(normalizeFormulaExpression(formula, existingFieldsForSrp), allowedFormulaVariables(existingFieldsForSrp, 'srp')); }
      catch (e) { return res.status(400).json({ error: e.message }); }
      run('UPDATE price_system_schemes SET srp_formula = ?, updated_at = datetime(\'now\') WHERE id = ?', [formula, scheme.id]);
      createVersion(scheme.id, userStamp(req), '\u66f4\u65b0 SRP \u516c\u5f0f\u5b57\u6bb5');
      return res.json({ id: 'builtin-srp', scheme_id: scheme.id, field_key: 'srp', field_name: 'SRP', field_type: 'formula', unit: '', applicable_categories: [], formula, sync_wac: false, is_builtin_srp: true, sort_order: Number.isFinite(Number(scheme.srp_sort_order)) ? Number(scheme.srp_sort_order) : 999999 });
    }

    const existingFields = query('SELECT * FROM price_system_fields WHERE scheme_id = ? AND is_active = 1', [scheme.id]).rows;
    const existing = d.id ? queryOne('SELECT * FROM price_system_fields WHERE id = ? AND scheme_id = ?', [d.id, scheme.id]) : null;
    if (d.id && !existing) return res.status(404).json({ error: '\u8d39\u7528\u5b57\u6bb5\u4e0d\u5b58\u5728' });
    if ((syncQuotation || (existing && Number(existing.sync_quotation || 0) === 1)) && !(req.currentUserPermissions || []).includes('*') && !(req.currentUserPermissions || []).includes('quotation_view')) return res.status(403).json({ error: '报价自动同步需要报价管理查看权限' });
    if (existing && existing.field_key !== fieldKey) return res.status(400).json({ error: '\u5b57\u6bb5\u7f16\u7801\u521b\u5efa\u540e\u4e0d\u53ef\u4fee\u6539\uff0c\u907f\u514d\u5f71\u54cd\u5386\u53f2\u6570\u636e\u548c\u516c\u5f0f' });
    if (fieldKey === 'srp') return res.status(400).json({ error: 'srp \u662f\u7cfb\u7edf\u4fdd\u7559\u5b57\u6bb5\u7f16\u7801' });
    if (syncWac) {
      const otherWacField = queryOne('SELECT id FROM price_system_fields WHERE scheme_id = ? AND is_active = 1 AND sync_wac = 1 AND id <> ?', [scheme.id, existing ? existing.id : '']);
      if (otherWacField) return res.status(400).json({ error: '\u6bcf\u4e2a\u4ef7\u683c\u65b9\u6848\u53ea\u80fd\u8bbe\u7f6e\u4e00\u4e2a\u81ea\u52a8\u540c\u6b65 WAC \u7684\u5b57\u6bb5' });
    }
    if (syncQuotation) {
      const otherQuoteField = queryOne('SELECT id FROM price_system_fields WHERE scheme_id = ? AND is_active = 1 AND COALESCE(sync_quotation, 0) = 1 AND id <> ?', [scheme.id, existing ? existing.id : '']);
      if (otherQuoteField) return res.status(400).json({ error: '每个价格方案只能设置一个自动同步报价字段' });
    }
    const duplicate = queryOne('SELECT id FROM price_system_fields WHERE scheme_id = ? AND field_key = ? AND id <> ?', [scheme.id, fieldKey, existing ? existing.id : '']);
    if (duplicate) return res.status(409).json({ error: '\u5b57\u6bb5\u7f16\u7801\u5df2\u5b58\u5728' });
    if (fieldType === 'formula') {
      try {
        const allowedVariables = allowedFormulaVariables(existingFields, fieldKey);
        if (hasFormulaRules) {
          const categoryRows = query('SELECT sku_code, category FROM skus WHERE brand = ?', [scheme.brand]).rows;
          const validCategories = new Set(Array.from(primaryCategoryMapForSkus(categoryRows, scheme.brand).values()).filter(Boolean));
          Object.keys(formulaRules).forEach(category => {
            const expression = String(formulaRules[category] || '').trim();
            if (!category || !validCategories.has(category)) throw new Error('公式规则包含无效类目：' + category);
            if (!expression) throw new Error(category + ' 的计算公式不能为空');
            validateFormula(normalizeFormulaExpression(expression, existingFields), allowedVariables);
          });
        } else validateFormula(normalizeFormulaExpression(formula, existingFields), allowedVariables);
      } catch (e) { return res.status(400).json({ error: e.message }); }
    }

    const id = existing ? existing.id : genId('psf');
    const maxFieldOrder = existingFields.reduce((max, field) => Math.max(max, Number(field.sort_order || 0)), Number(scheme.srp_sort_order == null ? 999999 : scheme.srp_sort_order));
    const sortOrder = Number.isFinite(Number(d.sort_order)) ? Number(d.sort_order) : (existing ? existing.sort_order : maxFieldOrder + 10);
    if (existing && Number(existing.sync_wac || 0) === 1 && !syncWac) {
      if (fieldType === 'amount') query('SELECT sku_code, value, currency FROM price_system_landing_costs WHERE scheme_id = ?', [scheme.id]).rows.forEach(row => {
        run("INSERT INTO price_system_values (id, scheme_id, sku_code, field_key, value, currency, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now')) ON CONFLICT(scheme_id, sku_code, field_key) DO UPDATE SET value = excluded.value, currency = excluded.currency, updated_by = excluded.updated_by, updated_at = datetime('now')", [genId('psv'), scheme.id, row.sku_code, fieldKey, Number(row.value), String(row.currency || ''), req.currentUserId || '']);
      });
      run('DELETE FROM price_system_landing_costs WHERE scheme_id = ?', [scheme.id]);
    }
    if (syncWac) run('DELETE FROM price_system_values WHERE scheme_id = ? AND field_key = ?', [scheme.id, fieldKey]);
    if (existing) {
      run(
        'UPDATE price_system_fields SET field_name = ?, field_type = ?, unit = ?, applicable_categories = ?, formula = ?, formula_rules = ?, display_format = ?, decimal_places = ?, sync_wac = ?, sync_quotation = ?, source_scheme_id = ?, source_field_key = ?, sort_order = ?, updated_at = datetime(\'now\') WHERE id = ? AND scheme_id = ?',
        [fieldName, fieldType, unit, JSON.stringify(hasFormulaRules ? [] : categories), formula, JSON.stringify(formulaRules), displayFormat, decimalPlaces, syncWac ? 1 : 0, syncQuotation ? 1 : 0, fieldType === 'reference' ? sourceSchemeId : '', fieldType === 'reference' ? sourceFieldKey : '', sortOrder, id, scheme.id]
      );
    } else {
      run(
        'INSERT INTO price_system_fields (id, scheme_id, field_key, field_name, field_type, unit, applicable_categories, formula, formula_rules, display_format, decimal_places, sync_wac, sync_quotation, source_scheme_id, source_field_key, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, scheme.id, fieldKey, fieldName, fieldType, unit, JSON.stringify(hasFormulaRules ? [] : categories), formula, JSON.stringify(formulaRules), displayFormat, decimalPlaces, syncWac ? 1 : 0, syncQuotation ? 1 : 0, fieldType === 'reference' ? sourceSchemeId : '', fieldType === 'reference' ? sourceFieldKey : '', sortOrder]
      );
    }
    if (syncWac) {
      const skuKeys = query('SELECT sku_code, brand FROM skus WHERE brand = ?', [scheme.brand]).rows.map(row => ({ sku_code: row.sku_code, brand: row.brand || scheme.brand, country: scheme.country }));
      const sync = syncPriceSystemLandingCostsForWacKeys(skuKeys, userStamp(req), 'Enable field WAC auto sync');
      const currentSchemeVersioned = sync && Array.isArray(sync.versions) && sync.versions.some(item => item.scheme_id === scheme.id);
      if (!currentSchemeVersioned) createVersion(scheme.id, userStamp(req), existing ? '\u4fee\u6539\u8d39\u7528\u5b57\u6bb5\uff1a' + fieldName : '\u65b0\u589e\u8d39\u7528\u5b57\u6bb5\uff1a' + fieldName);
    } else if (syncQuotation) {
      const skuKeys = query('SELECT sku_code, brand FROM skus WHERE brand = ?', [scheme.brand]).rows.map(row => ({ sku_code: row.sku_code, brand: row.brand || scheme.brand }));
      const sync = syncPriceSystemQuotationForKeys(skuKeys, userStamp(req), 'Enable field quotation auto sync');
      const currentSchemeVersioned = sync && Array.isArray(sync.versions) && sync.versions.some(item => item.scheme_id === scheme.id);
      if (!currentSchemeVersioned) createVersion(scheme.id, userStamp(req), existing ? '\u4fee\u6539\u8d39\u7528\u5b57\u6bb5\uff1a' + fieldName : '\u65b0\u589e\u8d39\u7528\u5b57\u6bb5\uff1a' + fieldName);
    } else createVersion(scheme.id, userStamp(req), existing ? '修改费用字段：' + fieldName : '新增费用字段：' + fieldName);
    res.json(queryOne('SELECT * FROM price_system_fields WHERE id = ?', [id]));
  }));

  app.delete('/api/price-system/schemes/:id/fields/:fieldId', canWrite, asyncHandler((req, res) => {
    const scheme = getSchemeOrNull(req.params.id);
    if (!schemeAccess(req, res, scheme)) return;
    const field = queryOne('SELECT * FROM price_system_fields WHERE id = ? AND scheme_id = ?', [req.params.fieldId, scheme.id]);
    if (!field) return res.status(404).json({ error: '费用字段不存在' });
    const externalReference = queryOne("SELECT id FROM price_system_fields WHERE source_scheme_id = ? AND source_field_key = ? AND field_type = 'reference' AND is_active = 1 LIMIT 1", [scheme.id, field.field_key]);
    if (externalReference) return res.status(409).json({ error: '该字段正被其他销售渠道方案引用，请先解除引用再删除' });
    if (Number(field.sync_quotation || 0) === 1 && !(req.currentUserPermissions || []).includes('*') && !(req.currentUserPermissions || []).includes('quotation_view')) return res.status(403).json({ error: '删除自动同步报价字段需要报价管理查看权限' });
    transaction(() => {
      run('DELETE FROM price_system_values WHERE scheme_id = ? AND field_key = ?', [scheme.id, field.field_key]);
      if (Number(field.sync_wac || 0) === 1) run('DELETE FROM price_system_landing_costs WHERE scheme_id = ?', [scheme.id]);
      run('DELETE FROM price_system_fields WHERE id = ? AND scheme_id = ?', [field.id, scheme.id]);
    });
    createVersion(scheme.id, userStamp(req), '删除费用字段：' + field.field_name);
    res.json({ success: true });
  }));

  app.post('/api/price-system/schemes/:id/values', canWrite, asyncHandler((req, res) => {
    const scheme = getSchemeOrNull(req.params.id);
    if (!schemeAccess(req, res, scheme)) return;
    const rows = Array.isArray(req.body && req.body.rows) ? req.body.rows : [];
    if (!rows.length) return res.status(400).json({ error: '没有需要保存的数据' });
    if (rows.length > 2000) return res.status(400).json({ error: '单次最多保存 2000 个 SKU，请分批导入' });
    const fields = query('SELECT * FROM price_system_fields WHERE scheme_id = ? AND is_active = 1', [scheme.id]).rows;
    const fieldMap = new Map(fields.map(f => [f.field_key, f]));
    const skuCodes = Array.from(new Set(rows.map(r => String(r && r.sku_code || '').trim()).filter(Boolean)));
    if (!skuCodes.length) return res.status(400).json({ error: '没有有效 SKU 编码' });
    const skuMap = new Map();
    for (let i = 0; i < skuCodes.length; i += 400) {
      const part = skuCodes.slice(i, i + 400);
      query('SELECT sku_code, brand, category FROM skus WHERE brand = ? AND sku_code IN (' + part.map(() => '?').join(',') + ')', [scheme.brand].concat(part))
        .rows.forEach(s => skuMap.set(s.sku_code, s));
    }
    const categoryBySku = primaryCategoryMapForSkus(Array.from(skuMap.values()), scheme.brand);
    skuMap.forEach(sku => { sku.category = categoryBySku.get(String(sku.sku_code || '').trim()) || '未分类'; });
    const errors = [];
    const normalized = [];
    const normalizedSrp = [];
    rows.forEach(row => {
      const skuCode = String(row && row.sku_code || '').trim();
      const sku = skuMap.get(skuCode);
      if (!sku) {
        errors.push({ sku_code: skuCode, reason: 'SKU 不存在或不属于当前品牌' });
        return;
      }
      const values = row && row.values && typeof row.values === 'object' ? row.values : {};
      if (Object.prototype.hasOwnProperty.call(row || {}, 'srp')) {
        const rawSrp = row.srp;
        if (rawSrp === null || rawSrp === '') normalizedSrp.push({ sku_code: skuCode, value: null });
        else { const srpValue = Number(rawSrp); if (!Number.isFinite(srpValue) || srpValue < 0) errors.push({ sku_code: skuCode, reason: 'SRP \u5fc5\u987b\u4e3a\u6709\u6548\u7684\u975e\u8d1f\u6570' }); else normalizedSrp.push({ sku_code: skuCode, value: srpValue }); }
      }
      Object.keys(values).forEach(key => {
        const field = fieldMap.get(key);
        if (!field) { errors.push({ sku_code: skuCode, reason: '费用字段不存在：' + key }); return; }
        if (field.field_type === 'formula' || field.field_type === 'reference') { errors.push({ sku_code: skuCode, reason: '公式或引用字段不能手动录入：' + field.field_name }); return; }
        if (Number(field.sync_wac || 0) === 1 || Number(field.sync_quotation || 0) === 1) { errors.push({ sku_code: skuCode, reason: '自动同步字段不能手动录入：' + field.field_name }); return; }
        if (!isCategoryApplicable(field, sku.category)) { errors.push({ sku_code: skuCode, reason: '该费用字段不适用于当前 SKU 类目：' + field.field_name }); return; }
        const raw = values[key];
        if (raw === null || raw === '') {
          normalized.push({ sku_code: skuCode, field_key: key, value: null });
          return;
        }
        const value = Number(raw);
        if (!Number.isFinite(value)) { errors.push({ sku_code: skuCode, reason: '金额必须为有效数字：' + field.field_name }); return; }
        normalized.push({ sku_code: skuCode, field_key: key, value });
      });
    });
    if (errors.length) return res.status(400).json({ error: '部分数据未通过校验，请修正后重试', errors: errors.slice(0, 100), error_count: errors.length });
    if (!normalized.length && !normalizedSrp.length) return res.status(400).json({ error: '\u6ca1\u6709\u53ef\u4fdd\u5b58\u7684\u8d39\u7528\u5b57\u6bb5\u6216 SRP \u6570\u636e' });
    transaction(() => {
      normalized.forEach(item => {
        if (item.value === null) {
          run('DELETE FROM price_system_values WHERE scheme_id = ? AND sku_code = ? AND field_key = ?', [scheme.id, item.sku_code, item.field_key]);
        } else {
          run(
            'INSERT INTO price_system_values (id, scheme_id, sku_code, field_key, value, currency, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime(\'now\')) ' +
            'ON CONFLICT(scheme_id, sku_code, field_key) DO UPDATE SET value = excluded.value, currency = excluded.currency, updated_by = excluded.updated_by, updated_at = datetime(\'now\')',
            [genId('psv'), scheme.id, item.sku_code, item.field_key, item.value, '', req.currentUserId || '']
          );
        }
      });
      normalizedSrp.forEach(item => {
        if (item.value === null) run('DELETE FROM price_system_srp_values WHERE scheme_id = ? AND sku_code = ?', [scheme.id, item.sku_code]);
        else run("INSERT INTO price_system_srp_values (id, scheme_id, sku_code, value, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now')) ON CONFLICT(scheme_id, sku_code) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = datetime('now')", [genId('pssrp'), scheme.id, item.sku_code, item.value, req.currentUserId || '']);
      });
    });
    const versionNo = createVersion(scheme.id, userStamp(req), '保存 SKU 价格数据');
    res.json({ success: true, saved_cells: normalized.length + normalizedSrp.length, saved_srp: normalizedSrp.length, version_no: versionNo });
  }));

  app.get('/api/price-system/schemes/:id/versions', canRead, asyncHandler((req, res) => {
    const scheme = getSchemeOrNull(req.params.id);
    if (!schemeAccess(req, res, scheme)) return;
    res.json(query(
      'SELECT id, version_no, note, created_by_name, created_at FROM price_system_versions WHERE scheme_id = ? ORDER BY version_no DESC LIMIT 100',
      [scheme.id]
    ).rows);
  }));

  app.get('/api/price-system/schemes/:id/versions/:versionId', canRead, asyncHandler((req, res) => {
    const scheme = getSchemeOrNull(req.params.id);
    if (!schemeAccess(req, res, scheme)) return;
    const version = queryOne('SELECT * FROM price_system_versions WHERE id = ? AND scheme_id = ?', [req.params.versionId, scheme.id]);
    if (!version) return res.status(404).json({ error: '历史版本不存在' });
    try { res.json({ version_no: version.version_no, note: version.note, created_at: version.created_at, snapshot: JSON.parse(version.snapshot_json || '{}') }); }
    catch (e) { res.status(500).json({ error: '历史版本数据损坏' }); }
  }));

  app.get('/api/price-system/schemes/:id/versions/:versionId/diff', canRead, asyncHandler((req, res) => {
    const scheme = getSchemeOrNull(req.params.id);
    if (!schemeAccess(req, res, scheme)) return;
    const version = queryOne('SELECT * FROM price_system_versions WHERE id = ? AND scheme_id = ?', [req.params.versionId, scheme.id]);
    if (!version) return res.status(404).json({ error: '历史版本不存在' });
    const previousVersion = queryOne(
      'SELECT id, version_no, snapshot_json, created_at FROM price_system_versions WHERE scheme_id = ? AND version_no < ? ORDER BY version_no DESC LIMIT 1',
      [scheme.id, Number(version.version_no)]
    );
    let currentSnapshot;
    let previousSnapshot = {};
    try {
      currentSnapshot = JSON.parse(version.snapshot_json || '{}');
      if (previousVersion) previousSnapshot = JSON.parse(previousVersion.snapshot_json || '{}');
    } catch (error) {
      return res.status(500).json({ error: '历史版本数据损坏，无法比较' });
    }
    const permissions = req.currentUserPermissions || [];
    const diff = buildPriceSystemVersionDiff(currentSnapshot, previousSnapshot, {
      hasPrevious: !!previousVersion,
      canViewQuotation: permissions.includes('*') || permissions.includes('quotation_view')
    });
    const requestedPage = parseInt(req.query && req.query.page || '1', 10);
    const requestedPageSize = parseInt(req.query && req.query.page_size || '100', 10);
    const pageSize = Math.min(200, Math.max(1, Number.isFinite(requestedPageSize) ? requestedPageSize : 100));
    const total = diff.sku_changes.length;
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(pageCount, Math.max(1, Number.isFinite(requestedPage) ? requestedPage : 1));
    const offset = (page - 1) * pageSize;
    res.json({
      version_no: Number(version.version_no),
      note: version.note || '',
      created_at: version.created_at || '',
      previous_version_no: previousVersion ? Number(previousVersion.version_no) : null,
      previous_created_at: previousVersion ? previousVersion.created_at || '' : '',
      scheme_changes: diff.scheme_changes,
      field_changes: diff.field_changes,
      sku_changes: diff.sku_changes.slice(offset, offset + pageSize),
      summary: diff.summary,
      has_previous: diff.has_previous,
      pagination: { page, page_size: pageSize, total, page_count: pageCount }
    });
  }));

  app.post('/api/price-system/schemes/:id/versions/:versionId/restore', canWrite, asyncHandler((req, res) => {
    const scheme = getSchemeOrNull(req.params.id);
    if (!schemeAccess(req, res, scheme)) return;
    const version = queryOne('SELECT * FROM price_system_versions WHERE id = ? AND scheme_id = ?', [req.params.versionId, scheme.id]);
    if (!version) return res.status(404).json({ error: '历史版本不存在' });
    let snapshot;
    try { snapshot = JSON.parse(version.snapshot_json || '{}'); }
    catch (e) { return res.status(500).json({ error: '历史版本数据损坏' }); }
    const snapshotFields = Array.isArray(snapshot.fields) ? snapshot.fields : [];
    if (snapshotFields.some(field => Number(field.sync_quotation || 0) === 1) && !(req.currentUserPermissions || []).includes('*') && !(req.currentUserPermissions || []).includes('quotation_view')) return res.status(403).json({ error: '恢复包含自动同步报价字段的版本需要报价管理查看权限' });
    const snapshotValues = Array.isArray(snapshot.values) ? snapshot.values : [];
    const snapshotLandingCosts = Array.isArray(snapshot.landingCosts) ? snapshot.landingCosts : [];
    const snapshotSrpValues = Array.isArray(snapshot.srpValues) ? snapshot.srpValues : [];
    transaction(() => {
      run('UPDATE price_system_schemes SET srp_formula = ?, currency = ?, srp_sort_order = ?, updated_at = datetime(\'now\') WHERE id = ?', [
        snapshot.scheme && snapshot.scheme.srp_formula || '',
        snapshot.scheme && snapshot.scheme.currency || scheme.currency,
        Number(snapshot.scheme && snapshot.scheme.srp_sort_order != null ? snapshot.scheme.srp_sort_order : 999999),
        scheme.id
      ]);
      run('DELETE FROM price_system_values WHERE scheme_id = ?', [scheme.id]);
      run('DELETE FROM price_system_landing_costs WHERE scheme_id = ?', [scheme.id]);
      run('DELETE FROM price_system_srp_values WHERE scheme_id = ?', [scheme.id]);
      run('DELETE FROM price_system_fields WHERE scheme_id = ?', [scheme.id]);
      snapshotFields.forEach(field => {
        run(
          'INSERT INTO price_system_fields (id, scheme_id, field_key, field_name, field_type, unit, applicable_categories, formula, formula_rules, display_format, decimal_places, sync_wac, sync_quotation, source_scheme_id, source_field_key, sort_order, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [field.id || genId('psf'), scheme.id, field.field_key, field.field_name, field.field_type || 'amount', field.unit || '', typeof field.applicable_categories === 'string' ? field.applicable_categories : JSON.stringify(parseCategories(field.applicable_categories)), field.formula || '', JSON.stringify(parseFormulaRules(field.formula_rules)), field.display_format || 'auto', Number(field.decimal_places == null ? 2 : field.decimal_places), Number(field.sync_wac || 0), Number(field.sync_quotation || 0), String(field.source_scheme_id || ''), String(field.source_field_key || ''), Number(field.sort_order || 0), Number(field.is_active == null ? 1 : field.is_active)]
        );
      });
      snapshotValues.forEach(value => {
        if (value.value == null) return;
        run(
          'INSERT INTO price_system_values (id, scheme_id, sku_code, field_key, value, currency, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [genId('psv'), scheme.id, value.sku_code, value.field_key, Number(value.value), String(value.currency || ''), req.currentUserId || '']
        );
      });
      snapshotLandingCosts.forEach(value => run('INSERT INTO price_system_landing_costs (id, scheme_id, sku_code, wac_history_id, value, currency, warehouse, ci_no, version_no, confirmed_at, last_inbound_date, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [genId('pslc'), scheme.id, value.sku_code, value.wac_history_id, Number(value.value), value.currency || '', value.warehouse || '', value.ci_no || '', Number(value.version_no || 0), value.confirmed_at || '', value.last_inbound_date || '', req.currentUserId || '']));
      snapshotSrpValues.forEach(value => run('INSERT INTO price_system_srp_values (id, scheme_id, sku_code, value, updated_by) VALUES (?, ?, ?, ?, ?)', [genId('pssrp'), scheme.id, value.sku_code, Number(value.value), req.currentUserId || '']));
    });
    let nextVersion = createVersion(scheme.id, userStamp(req), '恢复历史版本 #' + version.version_no);
    const skuKeys = query('SELECT sku_code, brand FROM skus WHERE brand = ?', [scheme.brand]).rows.map(row => ({ sku_code: row.sku_code, brand: row.brand || scheme.brand, country: scheme.country }));
    if (snapshotFields.some(field => Number(field.sync_wac || 0) === 1)) {
      const sync = syncPriceSystemLandingCostsForWacKeys(skuKeys, userStamp(req), 'Reconcile WAC after version restore');
      const restoredWacVersion = sync && Array.isArray(sync.versions) ? sync.versions.find(item => item.scheme_id === scheme.id) : null;
      if (restoredWacVersion) nextVersion = restoredWacVersion.version_no;
    }
    if (snapshotFields.some(field => Number(field.sync_quotation || 0) === 1)) {
      const sync = syncPriceSystemQuotationForKeys(skuKeys, userStamp(req), 'Reconcile quotation after version restore');
      const restoredQuoteVersion = sync && Array.isArray(sync.versions) ? sync.versions.find(item => item.scheme_id === scheme.id) : null;
      if (restoredQuoteVersion) nextVersion = restoredQuoteVersion.version_no;
    }
    res.json({ success: true, restored_version: version.version_no, version_no: nextVersion });
  }));

  app.delete('/api/price-system/schemes/:id/permanent', canWrite, asyncHandler((req, res) => {
    const scheme = getSchemeOrNull(req.params.id);
    if (!schemeAccess(req, res, scheme)) return;
    const externalReference = queryOne("SELECT id FROM price_system_fields WHERE source_scheme_id = ? AND field_type = 'reference' AND is_active = 1 LIMIT 1", [scheme.id]);
    if (externalReference) return res.status(409).json({ error: '该价格方案正被其他销售渠道方案引用，请先解除引用再删除' });
    try {
      transaction(() => deletePriceSystemSchemeRecords(scheme.id, run));
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message || '删除价格方案失败' });
    }
  }));

  app.delete('/api/price-system/schemes/:id', canWrite, asyncHandler((req, res) => {
    const scheme = getSchemeOrNull(req.params.id);
    if (!schemeAccess(req, res, scheme)) return;
    const externalReference = queryOne("SELECT id FROM price_system_fields WHERE source_scheme_id = ? AND field_type = 'reference' AND is_active = 1 LIMIT 1", [scheme.id]);
    if (externalReference) return res.status(409).json({ error: '该价格方案正被其他销售渠道方案引用，请先解除引用再停用' });
    const hasQuotationSync = queryOne('SELECT id FROM price_system_fields WHERE scheme_id = ? AND is_active = 1 AND COALESCE(sync_quotation, 0) = 1', [scheme.id]);
    if (hasQuotationSync && !(req.currentUserPermissions || []).includes('*') && !(req.currentUserPermissions || []).includes('quotation_view')) return res.status(403).json({ error: '停用包含自动同步报价字段的方案需要报价管理查看权限' });
    run("UPDATE price_system_schemes SET status = 'disabled', updated_at = datetime('now') WHERE id = ?", [scheme.id]);
    createVersion(scheme.id, userStamp(req), '停用价格方案');
    res.json({ success: true });
  }));
}

module.exports = { registerPriceSystemRoutes, createPriceSystemWacSync, parseCategories, isCategoryApplicable, primaryCategoryMapForSkus, remapFieldCategorySettings, buildCopiedFieldRows, buildPriceSystemReferenceLookup, deletePriceSystemSchemeRecords, buildForecastMetricMap, buildPriceSystemVersionDiff };
