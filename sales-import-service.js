/**
 * Sales import rule layer.
 *
 * The shared validation/identity/classification rules are the formal import
 * baseline.  Checkpoint 2 adds database-specific staging and set-based write
 * adapters while keeping that rule layer database-independent.
 */

const SALES_MUTABLE_FIELDS = [
  'is_valid_order',
  'quantity',
  'shop_platform',
  'original_order_status',
  'brand',
  'remark',
  'country'
];

function normalizeOrderDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(value).trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) {
    const num = parseInt(s, 10);
    if (num >= 20000 && num <= 80000) {
      const epochMs = (num - 25569) * 86400000;
      const dt = new Date(epochMs);
      if (!isNaN(dt.getTime())) {
        const y = dt.getUTCFullYear();
        const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
        const d = String(dt.getUTCDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
      }
    }
    return null;
  }
  const isoMatch = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) return buildValidDate(isoMatch[1], isoMatch[2], isoMatch[3]);
  const ymMatch = s.match(/^(\d{4})-(\d{1,2})$/);
  if (ymMatch) return buildValidDate(ymMatch[1], ymMatch[2], '01');
  if (s.indexOf('/') >= 0) {
    const parts = s.split('/').map(p => p.trim());
    if (parts.length !== 3) return null;
    const [a, b, c] = parts;
    if (/^\d{4}$/.test(a)) return buildValidDate(a, b, c);
    if (/^\d{1,2}$/.test(a) && /^\d{1,2}$/.test(b)) {
      let year;
      if (/^\d{4}$/.test(c)) year = c;
      else if (/^\d{2}$/.test(c)) {
        const yy = parseInt(c, 10);
        year = String(yy <= 69 ? 2000 + yy : 1900 + yy);
      } else return null;
      return buildValidDate(year, a, b);
    }
  }
  return null;
}

function buildValidDate(yStr, mStr, dStr) {
  const y = parseInt(yStr, 10);
  const m = parseInt(mStr, 10);
  const d = parseInt(dStr, 10);
  if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function parseIsValidOrder(value) {
  if (value === undefined || value === '') return 1;
  const v = String(value).toLowerCase().trim();
  return (v === 'true' || v === '1' || v === '是' || v === '有效') ? 1 : 0;
}

/** Preserve the server's current validation semantics: no new quantity rule. */
function normalizeSalesRows(items) {
  return (Array.isArray(items) ? items : []).map((item, index) => {
    const sourceRowNo = index + 2;
    const rawDate = item && item.order_date;
    const normalizedDate = rawDate || rawDate === 0 ? normalizeOrderDate(rawDate) : null;
    // Match the old formal route's first-error/early-return order exactly:
    // SKU -> source_system -> order_no -> normalized date.  The old preview
    // had a different multi-error behavior; the new preview intentionally
    // predicts this formal apply behavior instead.
    let firstError = '';
    if (!item || !item.sku_code) firstError = 'SKU不能为空';
    else if (!item.source_system) firstError = '来源系统不能为空';
    else if (!item.order_no) firstError = '订单号不能为空';
    else if (!item.country || !String(item.country).trim()) firstError = '国家不能为空';
    else if (!normalizedDate) firstError = '下单日期格式无法识别：' + rawDate;
    const errors = firstError ? [firstError] : [];

    const row = {
      source_row_no: sourceRowNo,
      input_order: index,
      raw: item || {},
      source_system: item && item.source_system || '',
      order_no: item && item.order_no || '',
      order_detail_id: item && item.order_detail_id || '',
      order_date: normalizedDate,
      raw_order_date: rawDate || '',
      shop_platform: item && item.shop_platform || '',
      brand: item && item.brand || '',
      sku_code: item && item.sku_code || '',
      quantity: parseInt(item && item.quantity) || 0,
      is_valid_order: parseIsValidOrder(item && item.is_valid_order),
      original_order_status: item && item.original_order_status || '',
      remark: item && item.remark || '',
      country: (item && item.country != null ? String(item.country) : '').trim(),
      errors
    };
    return row;
  });
}

function detailIdentity(row) {
  return row && row.order_detail_id
    ? JSON.stringify([row.source_system, row.order_detail_id])
    : null;
}

function businessIdentity(row) {
  return JSON.stringify([
    row && row.source_system || '',
    row && row.order_no || '',
    row && row.sku_code || '',
    row && row.shop_platform || ''
  ]);
}

function normalizedExisting(existing) {
  return {
    ...existing,
    source_system: existing && existing.source_system || '',
    order_no: existing && existing.order_no || '',
    order_detail_id: existing && existing.order_detail_id || '',
    shop_platform: existing && existing.shop_platform || '',
    brand: existing && existing.brand || '',
    sku_code: existing && existing.sku_code || '',
    original_order_status: existing && existing.original_order_status || '',
    remark: existing && existing.remark || '',
    country: existing && existing.country || '',
    is_valid_order: existing && existing.is_valid_order === undefined ? 1 : existing && existing.is_valid_order,
    quantity: existing && existing.quantity === undefined ? 0 : existing && existing.quantity
  };
}

/**
 * Keep the legacy changed predicate exactly. In particular, order_date is
 * intentionally not part of the predicate; it only changes when another
 * mutable field also causes an UPDATE.
 */
function hasSalesChanges(existing, row) {
  const old = normalizedExisting(existing);
  return old.is_valid_order !== row.is_valid_order ||
    old.quantity !== row.quantity ||
    old.shop_platform !== row.shop_platform ||
    old.original_order_status !== row.original_order_status ||
    old.brand !== row.brand ||
    old.remark !== row.remark ||
    old.country !== row.country;
}

function mutableValues(row, importBatchId) {
  return {
    order_date: row.order_date,
    shop_platform: row.shop_platform,
    brand: row.brand,
    quantity: row.quantity,
    is_valid_order: row.is_valid_order,
    original_order_status: row.original_order_status,
    remark: row.remark,
    country: row.country || '',
    import_batch_id: importBatchId || ''
  };
}

function applyMutableValues(existing, row, importBatchId) {
  Object.assign(existing, mutableValues(row, importBatchId));
  return existing;
}

function fullInsertedRecord(row, idFactory, importBatchId) {
  return {
    id: idFactory(row),
    source_system: row.source_system,
    order_no: row.order_no,
    order_detail_id: row.order_detail_id,
    order_date: row.order_date,
    shop_platform: row.shop_platform,
    brand: row.brand,
    sku_code: row.sku_code,
    quantity: row.quantity,
    is_valid_order: row.is_valid_order,
    original_order_status: row.original_order_status,
    remark: row.remark,
    country: row.country || '',
    import_batch_id: importBatchId || ''
  };
}

function createRecordIndexes(records) {
  const detail = new Map();
  const business = new Map();
  const add = record => {
    const normalized = normalizedExisting(record);
    const detailKey = detailIdentity(normalized);
    if (detailKey) {
      if (!detail.has(detailKey)) detail.set(detailKey, []);
      detail.get(detailKey).push(record);
    }
    const businessKey = businessIdentity(normalized);
    if (!business.has(businessKey)) business.set(businessKey, []);
    business.get(businessKey).push(record);
  };
  records.forEach(add);
  return { detail, business, add };
}

function findExisting(records, row, indexes = null) {
  if (indexes) {
    if (row.order_detail_id) {
      const detailRows = indexes.detail.get(detailIdentity(row));
      if (detailRows && detailRows.length) return detailRows[0];
    }
    const businessRows = indexes.business.get(businessIdentity(row));
    return businessRows && businessRows.length ? businessRows[0] : null;
  }
  if (row.order_detail_id) {
    const byDetail = records.find(record =>
      (record.source_system || '') === row.source_system &&
      (record.order_detail_id || '') === row.order_detail_id
    );
    if (byDetail) return byDetail;
  }
  return records.find(record => businessIdentity(normalizedExisting(record)) === businessIdentity(row)) || null;
}

function hasBusinessConflict(records, existing, row, indexes = null) {
  const next = { ...normalizedExisting(existing), ...mutableValues(row, existing.import_batch_id) };
  if (indexes) {
    const businessRows = indexes.business.get(businessIdentity(next)) || [];
    return businessRows.some(record => record.id !== existing.id);
  }
  return records.some(record => record.id !== existing.id && businessIdentity(normalizedExisting(record)) === businessIdentity(next));
}

/**
 * Simulate the current formal import in input order. This is intentionally
 * database-independent and is the sole business classification baseline for
 * both preview and apply.
 */
function classifySalesRows(rows, initialRecords = [], options = {}) {
  const records = initialRecords.map(record => ({ ...record }));
  const indexes = createRecordIndexes(records);
  const importBatchId = options.importBatchId || '';
  const idFactory = options.idFactory || (row => `sale_input_${row.input_order + 1}`);
  const result = {
    total: rows.length,
    inserted: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: []
  };
  const classified = [];

  for (const row of rows) {
    if (row.errors.length > 0) {
      result.failed++;
      row.errors.forEach(reason => result.errors.push({ row: row.source_row_no, reason }));
      classified.push({ row, action: 'failed', errors: row.errors.slice() });
      continue;
    }

    const existing = findExisting(records, row, indexes);
    if (existing) {
      if (!hasSalesChanges(existing, row)) {
        result.skipped++;
        classified.push({ row, action: 'skip', errors: [], existing_id: existing.id });
        continue;
      }
      if (hasBusinessConflict(records, existing, row, indexes)) {
        result.skipped++;
        const reason = '重复记录（唯一约束）';
        result.errors.push({ row: row.source_row_no, reason });
        classified.push({ row, action: 'skip', errors: [reason], existing_id: existing.id });
        continue;
      }
      applyMutableValues(existing, row, importBatchId);
      result.updated++;
      classified.push({ row, action: 'update', errors: [], existing_id: existing.id });
      continue;
    }

    const next = fullInsertedRecord(row, idFactory, importBatchId);
    // The formal route would normally discover this through its fallback
    // query. Keep a final guard for deterministic in-file conflict handling.
    const businessMatches = indexes.business.get(businessIdentity(next)) || [];
    if (businessMatches.length > 0) {
      result.skipped++;
      const reason = '重复记录（唯一约束）';
      result.errors.push({ row: row.source_row_no, reason });
      classified.push({ row, action: 'skip', errors: [reason] });
      continue;
    }
    records.push(next);
    indexes.add(next);
    result.inserted++;
    classified.push({ row, action: 'insert', errors: [], record_id: next.id });
  }

  return { result, classified, records };
}

function buildSalesPreview(rows, classification) {
  const byInput = new Map(classification.classified.map(item => [item.row.input_order, item]));
  return rows.map(row => {
    const item = byInput.get(row.input_order);
    return {
      row: row.source_row_no,
      source_system: row.source_system,
      order_no: row.order_no,
      order_date: row.raw_order_date,
      shop_platform: row.shop_platform,
      brand: row.brand,
      sku_code: row.sku_code,
      quantity: row.quantity,
      is_valid_order: row.is_valid_order,
      original_order_status: row.original_order_status,
      country: row.country || '',
      action: item ? item.action : 'insert',
      errors: item ? item.errors.slice() : row.errors.slice()
    };
  });
}

function clockNow() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function makeMetrics() {
  return { query: 0, queryOne: 0, run: 0, roundTrips: 0 };
}

function makeTimedResult() {
  return {
    validation_ms: 0,
    staging_ms: 0,
    matching_ms: 0,
    writing_ms: 0,
    committing_ms: 0,
    inventory_recalc_ms: null,
    total_ms: 0
  };
}

function chunkRows(rows, size) {
  const chunks = [];
  for (let i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size));
  return chunks;
}

function quoteIdentifier(identifier) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) throw new Error('非法临时表名');
  return identifier;
}

function getCandidateFieldsSql() {
  return `id, source_system, order_no, order_detail_id, order_date, shop_platform,
          brand, sku_code, quantity, is_valid_order, original_order_status, remark,
          import_batch_id, country`;
}

function candidateRowsFromRows(rows) {
  return rows.filter(row => row.errors.length === 0);
}

function buildPlanRows(classification) {
  // Classification is deliberately input-order based, so one record may have
  // several UPDATE actions (or an INSERT followed by UPDATE) in one file.
  // The database plan must contain only the final state for each touched id;
  // otherwise a scalar subquery could pick an earlier row and lose the last
  // valid change.  This preserves the legacy "later row wins" rule while
  // keeping the write itself set based.
  const actionById = new Map();
  for (const item of classification.classified) {
    if (item.action === 'insert' && item.record_id) {
      actionById.set(String(item.record_id), { action: 'insert', id: String(item.record_id) });
    } else if (item.action === 'update' && item.existing_id) {
      const id = String(item.existing_id);
      const previous = actionById.get(id);
      actionById.set(id, { action: previous && previous.action === 'insert' ? 'insert' : 'update', id });
    }
  }
  const recordById = new Map(classification.records.map(record => [String(record.id), record]));
  return Array.from(actionById.values()).map(entry => {
    const record = recordById.get(entry.id);
    if (!record) return null;
    return {
      action: entry.action,
      existing_id: entry.action === 'update' ? entry.id : '',
      id: entry.id,
      source_system: record.source_system || '',
      order_no: record.order_no || '',
      order_detail_id: record.order_detail_id || '',
      order_date: record.order_date || null,
      shop_platform: record.shop_platform || '',
      brand: record.brand || '',
      sku_code: record.sku_code || '',
      quantity: record.quantity || 0,
      is_valid_order: record.is_valid_order === undefined ? 1 : record.is_valid_order,
      original_order_status: record.original_order_status || '',
      remark: record.remark || '',
      country: record.country || ''
    };
  }).filter(Boolean);
}

function createSqliteSalesImportAdapter(db, options = {}) {
  const batchSize = options.batchSize || 80;
  const metrics = makeMetrics();
  let stageName = '';
  let planName = '';

  const callQuery = (sql, params = []) => {
    metrics.query++;
    metrics.roundTrips++;
    return db.query(sql, params);
  };
  const callRun = (sql, params = []) => {
    metrics.run++;
    metrics.roundTrips++;
    return db.run(sql, params);
  };

  async function transaction(fn) {
    const raw = db.getDB();
    raw.exec('BEGIN');
    try {
      const value = await fn();
      raw.exec('COMMIT');
      return value;
    } catch (error) {
      try { raw.exec('ROLLBACK'); } catch (_) {}
      throw error;
    }
  }

  async function stageRows(rows) {
    stageName = quoteIdentifier(`sales_import_stage_${Date.now()}_${Math.floor(Math.random() * 100000)}`);
    planName = quoteIdentifier(`${stageName}_plan`);
    callRun(`CREATE TEMP TABLE ${stageName} (
      source_row_no INTEGER NOT NULL,
      input_order INTEGER NOT NULL,
      source_system TEXT NOT NULL,
      order_no TEXT NOT NULL,
      order_detail_id TEXT DEFAULT '',
      order_date TEXT,
      shop_platform TEXT DEFAULT '',
      brand TEXT DEFAULT '',
      sku_code TEXT NOT NULL,
      quantity INTEGER DEFAULT 0,
      is_valid_order INTEGER DEFAULT 1,
      original_order_status TEXT DEFAULT '',
      remark TEXT DEFAULT '',
      error_json TEXT DEFAULT '[]'
    )`);
    const columns = ['source_row_no', 'input_order', 'source_system', 'order_no', 'order_detail_id', 'order_date', 'shop_platform', 'brand', 'sku_code', 'quantity', 'is_valid_order', 'original_order_status', 'remark', 'error_json'];
    for (const chunk of chunkRows(rows, batchSize)) {
      const values = [];
      const placeholders = chunk.map(row => {
        values.push(row.source_row_no, row.input_order, row.source_system, row.order_no, row.order_detail_id, row.order_date, row.shop_platform, row.brand, row.sku_code, row.quantity, row.is_valid_order, row.original_order_status, row.remark, JSON.stringify(row.errors));
        const base = values.length - columns.length;
        return '(' + columns.map((_, index) => '@p' + (base + index)).join(',') + ')';
      }).join(',');
      // node:sqlite and better-sqlite3 both accept positional parameters more
      // consistently than generated named placeholders.
      const positional = chunk.map(() => '(' + columns.map(() => '?').join(',') + ')').join(',');
      callRun(`INSERT INTO ${stageName} (${columns.join(',')}) VALUES ${positional}`, values);
    }
  }

  async function loadCandidates(rows) {
    const valid = candidateRowsFromRows(rows);
    const ids = new Set();
    const keyRows = [];
    for (const row of valid) {
      if (row.order_detail_id) keyRows.push({ kind: 'detail', row });
      keyRows.push({ kind: 'business', row });
    }
    for (const group of chunkRows(keyRows, Math.max(1, Math.floor(999 / 5)))) {
      const clauses = [];
      const params = [];
      for (const entry of group) {
        if (entry.kind === 'detail') {
          clauses.push('(source_system = ? AND order_detail_id = ?)');
          params.push(entry.row.source_system, entry.row.order_detail_id);
        } else {
          clauses.push('(source_system = ? AND order_no = ? AND sku_code = ? AND COALESCE(shop_platform,\'\') = ?)');
          params.push(entry.row.source_system, entry.row.order_no, entry.row.sku_code, entry.row.shop_platform);
        }
      }
      if (!clauses.length) continue;
      const result = callQuery(`SELECT ${getCandidateFieldsSql()} FROM sales_records WHERE ${clauses.join(' OR ')}`, params);
      for (const record of result.rows) ids.add(JSON.stringify(record));
    }
    return Array.from(ids).map(value => JSON.parse(value));
  }

  async function writePlan(classification) {
    const planRows = buildPlanRows(classification);
    callRun(`CREATE TEMP TABLE ${planName} (
      action TEXT NOT NULL,
      existing_id TEXT DEFAULT '',
      id TEXT DEFAULT '',
      source_system TEXT DEFAULT '',
      order_no TEXT DEFAULT '',
      order_detail_id TEXT DEFAULT '',
      order_date TEXT,
      shop_platform TEXT DEFAULT '',
      brand TEXT DEFAULT '',
      sku_code TEXT DEFAULT '',
      quantity INTEGER DEFAULT 0,
      is_valid_order INTEGER DEFAULT 1,
      original_order_status TEXT DEFAULT '',
      remark TEXT DEFAULT '',
      country TEXT DEFAULT ''
    )`);
    const columns = ['action', 'existing_id', 'id', 'source_system', 'order_no', 'order_detail_id', 'order_date', 'shop_platform', 'brand', 'sku_code', 'quantity', 'is_valid_order', 'original_order_status', 'remark', 'country'];
    for (const chunk of chunkRows(planRows, batchSize)) {
      const params = [];
      const placeholders = chunk.map(row => {
        params.push(...columns.map(column => row[column]));
        return '(' + columns.map(() => '?').join(',') + ')';
      }).join(',');
      if (chunk.length) callRun(`INSERT INTO ${planName} (${columns.join(',')}) VALUES ${placeholders}`, params);
    }
    callRun(`UPDATE sales_records SET
      order_date = (SELECT p.order_date FROM ${planName} p WHERE p.action='update' AND p.existing_id=sales_records.id),
      shop_platform = (SELECT p.shop_platform FROM ${planName} p WHERE p.action='update' AND p.existing_id=sales_records.id),
      brand = (SELECT p.brand FROM ${planName} p WHERE p.action='update' AND p.existing_id=sales_records.id),
      quantity = (SELECT p.quantity FROM ${planName} p WHERE p.action='update' AND p.existing_id=sales_records.id),
      is_valid_order = (SELECT p.is_valid_order FROM ${planName} p WHERE p.action='update' AND p.existing_id=sales_records.id),
      original_order_status = (SELECT p.original_order_status FROM ${planName} p WHERE p.action='update' AND p.existing_id=sales_records.id),
      remark = (SELECT p.remark FROM ${planName} p WHERE p.action='update' AND p.existing_id=sales_records.id),
      country = (SELECT p.country FROM ${planName} p WHERE p.action='update' AND p.existing_id=sales_records.id),
      import_batch_id = (SELECT ? FROM ${planName} p WHERE p.action='update' AND p.existing_id=sales_records.id),
      updated_at = datetime('now')
      WHERE id IN (SELECT existing_id FROM ${planName} WHERE action='update')`, [classification.importBatchId || '']);
    callRun(`INSERT INTO sales_records (id, source_system, order_no, order_detail_id, order_date, shop_platform, brand, sku_code, quantity, is_valid_order, original_order_status, remark, import_batch_id, country)
      SELECT id, source_system, order_no, order_detail_id, order_date, shop_platform, brand, sku_code, quantity, is_valid_order, original_order_status, remark, ?, country
      FROM ${planName} WHERE action='insert'`, [classification.importBatchId || '']);
    callRun(`DROP TABLE IF EXISTS ${planName}`);
    callRun(`DROP TABLE IF EXISTS ${stageName}`);
  }

  return { kind: 'sqlite', metrics, transaction, stageRows, loadCandidates, writePlan };
}

function createPostgresSalesImportAdapter(db, options = {}) {
  const batchSize = options.batchSize || 1000;
  const metrics = makeMetrics();
  let stageName = '';
  let planName = '';
  const callQuery = async (sql, params = []) => { metrics.query++; metrics.roundTrips++; return db.query(sql, params); };
  const callRun = async (sql, params = []) => { metrics.run++; metrics.roundTrips++; return db.run(sql, params); };
  async function transaction(fn) { return db.transaction(fn); }

  async function stageRows(rows) {
    stageName = quoteIdentifier(`sales_import_stage_${Date.now()}_${Math.floor(Math.random() * 100000)}`);
    planName = quoteIdentifier(`${stageName}_plan`);
    await callRun(`CREATE TEMP TABLE ${stageName} (
      source_row_no INTEGER NOT NULL, input_order INTEGER NOT NULL,
      source_system TEXT NOT NULL, order_no TEXT NOT NULL, order_detail_id TEXT DEFAULT '',
      order_date TEXT, shop_platform TEXT DEFAULT '', brand TEXT DEFAULT '', sku_code TEXT NOT NULL,
      quantity INTEGER DEFAULT 0, is_valid_order INTEGER DEFAULT 1,
      original_order_status TEXT DEFAULT '', remark TEXT DEFAULT '', country TEXT DEFAULT '', error_json JSONB DEFAULT '[]'::jsonb
    ) ON COMMIT DROP`);
    for (const chunk of chunkRows(rows, batchSize)) {
      const json = JSON.stringify(chunk.map(row => ({
        source_row_no: row.source_row_no, input_order: row.input_order,
        source_system: row.source_system, order_no: row.order_no, order_detail_id: row.order_detail_id,
        order_date: row.order_date, shop_platform: row.shop_platform, brand: row.brand,
        sku_code: row.sku_code, quantity: row.quantity, is_valid_order: row.is_valid_order,
        original_order_status: row.original_order_status, remark: row.remark, country: row.country, error_json: row.errors
      })));
      await callRun(`INSERT INTO ${stageName} SELECT * FROM jsonb_to_recordset(?::jsonb) AS x(
        source_row_no INTEGER, input_order INTEGER, source_system TEXT, order_no TEXT,
        order_detail_id TEXT, order_date TEXT, shop_platform TEXT, brand TEXT, sku_code TEXT,
        quantity INTEGER, is_valid_order INTEGER, original_order_status TEXT, remark TEXT, country TEXT, error_json JSONB
      )`, [json]);
    }
  }

  async function loadCandidates() {
    const result = await callQuery(`SELECT ${getCandidateFieldsSql()} FROM sales_records sr
      WHERE EXISTS (SELECT 1 FROM ${stageName} s WHERE s.source_system=sr.source_system
        AND s.order_detail_id <> '' AND s.order_detail_id=sr.order_detail_id)
      OR EXISTS (SELECT 1 FROM ${stageName} s WHERE s.source_system=sr.source_system
        AND s.order_no=sr.order_no AND s.sku_code=sr.sku_code
        AND COALESCE(s.shop_platform,'')=COALESCE(sr.shop_platform,''))`);
    return result.rows || [];
  }

  async function writePlan(classification) {
    const planRows = buildPlanRows(classification);
    await callRun(`CREATE TEMP TABLE ${planName} (
      action TEXT NOT NULL, existing_id TEXT DEFAULT '', id TEXT DEFAULT '',
      source_system TEXT DEFAULT '', order_no TEXT DEFAULT '', order_detail_id TEXT DEFAULT '',
      order_date TEXT, shop_platform TEXT DEFAULT '', brand TEXT DEFAULT '', sku_code TEXT DEFAULT '',
      quantity INTEGER DEFAULT 0, is_valid_order INTEGER DEFAULT 1,
      original_order_status TEXT DEFAULT '', remark TEXT DEFAULT '', country TEXT DEFAULT ''
    ) ON COMMIT DROP`);
    for (const chunk of chunkRows(planRows, batchSize)) {
      if (!chunk.length) continue;
      const json = JSON.stringify(chunk);
      await callRun(`INSERT INTO ${planName} SELECT * FROM jsonb_to_recordset(?::jsonb) AS x(
        action TEXT, existing_id TEXT, id TEXT, source_system TEXT, order_no TEXT,
        order_detail_id TEXT, order_date TEXT, shop_platform TEXT, brand TEXT, sku_code TEXT,
        quantity INTEGER, is_valid_order INTEGER, original_order_status TEXT, remark TEXT, country TEXT
      )`, [json]);
    }
    await callRun(`UPDATE sales_records sr SET
      order_date=p.order_date, shop_platform=p.shop_platform, brand=p.brand, quantity=p.quantity,
      is_valid_order=p.is_valid_order, original_order_status=p.original_order_status,
      remark=p.remark, country=p.country, import_batch_id=?, updated_at=NOW()
      FROM ${planName} p WHERE p.action='update' AND p.existing_id=sr.id`, [classification.importBatchId || '']);
    await callRun(`INSERT INTO sales_records
      (id, source_system, order_no, order_detail_id, order_date, shop_platform, brand, sku_code,
       quantity, is_valid_order, original_order_status, remark, import_batch_id, country)
      SELECT id, source_system, order_no, order_detail_id, order_date, shop_platform, brand, sku_code,
       quantity, is_valid_order, original_order_status, remark, ?, country
      FROM ${planName} WHERE action='insert'`, [classification.importBatchId || '']);
  }

  return { kind: 'postgres', metrics, transaction, stageRows, loadCandidates, writePlan };
}

function parseRunJson(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

function normalizeSalesImportRun(row) {
  if (!row) return null;
  return {
    import_id: row.import_id,
    status: row.status,
    phase: row.phase || row.status || '',
    percent: row.percent === null || row.percent === undefined ? null : Number(row.percent),
    processed_count: Number(row.processed_count || 0),
    total_count: Number(row.total_count || 0),
    inserted: Number(row.inserted || 0),
    updated: Number(row.updated || 0),
    skipped: Number(row.skipped || 0),
    failed: Number(row.failed || 0),
    errors: parseRunJson(row.errors_json, []),
    timings: parseRunJson(row.timings_json, {}),
    metrics: parseRunJson(row.metrics_json, {}),
    result: parseRunJson(row.result_json, {}),
    commit_state: row.commit_state || 'uncommitted',
    recalc_status: row.recalc_status || 'pending',
    request_fingerprint: row.request_fingerprint || '',
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

/**
 * Small database-neutral control-table store.  The table is created by the
 * normal database bootstrap; this store deliberately performs no business
 * writes and only records import progress/idempotency/result metadata.
 */
function createSalesImportRunStore(db) {
  let ensured = false;
  async function ensure() {
    if (ensured) return;
    await db.run(`CREATE TABLE IF NOT EXISTS sales_import_runs (
      import_id TEXT PRIMARY KEY, status TEXT NOT NULL, phase TEXT NOT NULL DEFAULT '', percent INTEGER,
      processed_count INTEGER NOT NULL DEFAULT 0, total_count INTEGER NOT NULL DEFAULT 0,
      inserted INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL DEFAULT 0, skipped INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0, errors_json TEXT NOT NULL DEFAULT '[]', timings_json TEXT NOT NULL DEFAULT '{}',
      metrics_json TEXT NOT NULL DEFAULT '{}', result_json TEXT NOT NULL DEFAULT '{}',
      commit_state TEXT NOT NULL DEFAULT 'uncommitted', recalc_status TEXT NOT NULL DEFAULT 'pending',
      request_fingerprint TEXT NOT NULL DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    await db.run(`CREATE INDEX IF NOT EXISTS idx_sales_import_runs_status ON sales_import_runs(status)`);
    await db.run(`CREATE INDEX IF NOT EXISTS idx_sales_import_runs_updated ON sales_import_runs(updated_at)`);
    ensured = true;
  }
  async function get(importId) {
    await ensure();
    const row = await db.queryOne(`SELECT * FROM sales_import_runs WHERE import_id = ?`, [importId]);
    return normalizeSalesImportRun(row);
  }

  async function create(run) {
    await ensure();
    await db.run(`INSERT INTO sales_import_runs
      (import_id, status, phase, percent, processed_count, total_count,
       inserted, updated, skipped, failed, errors_json, timings_json,
       metrics_json, result_json, commit_state, recalc_status, request_fingerprint)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      run.import_id, run.status || 'validating', run.phase || run.status || 'validating',
      run.percent === undefined ? null : run.percent,
      run.processed_count || 0, run.total_count || 0,
      run.inserted || 0, run.updated || 0, run.skipped || 0, run.failed || 0,
      JSON.stringify(run.errors || []), JSON.stringify(run.timings || {}),
      JSON.stringify(run.metrics || {}), JSON.stringify(run.result || {}),
      run.commit_state || 'uncommitted', run.recalc_status || 'pending',
      run.request_fingerprint || ''
    ]);
    return get(run.import_id);
  }

  async function update(importId, patch) {
    await ensure();
    const current = await get(importId);
    if (!current) return null;
    const next = { ...current, ...patch };
    const result = next.result && Object.keys(next.result).length ? next.result : {
      total: next.total_count,
      inserted: next.inserted,
      updated: next.updated,
      skipped: next.skipped,
      failed: next.failed,
      errors: next.errors || []
    };
    await db.run(`UPDATE sales_import_runs SET
      status=?, phase=?, percent=?, processed_count=?, total_count=?,
      inserted=?, updated=?, skipped=?, failed=?, errors_json=?,
      timings_json=?, metrics_json=?, result_json=?, commit_state=?,
      recalc_status=?, request_fingerprint=?, updated_at=CURRENT_TIMESTAMP
      WHERE import_id=?`, [
      next.status, next.phase || next.status || '',
      next.percent === undefined ? null : next.percent,
      next.processed_count || 0, next.total_count || 0,
      next.inserted || 0, next.updated || 0, next.skipped || 0, next.failed || 0,
      JSON.stringify(next.errors || []), JSON.stringify(next.timings || {}),
      JSON.stringify(next.metrics || {}), JSON.stringify(result),
      next.commit_state || 'uncommitted', next.recalc_status || 'pending',
      next.request_fingerprint || '', importId
    ]);
    return normalizeSalesImportRun({
      ...next,
      result_json: JSON.stringify(result),
      errors_json: JSON.stringify(next.errors || []),
      timings_json: JSON.stringify(next.timings || {}),
      metrics_json: JSON.stringify(next.metrics || {})
    });
  }

  return { get, create, update };
}

async function reportImportProgress(options, state) {
  if (typeof options.progress !== 'function') return;
  // Progress persistence is observability only.  A status-table/network
  // hiccup must never roll back an otherwise valid sales transaction.
  try { await options.progress(state); } catch (_) {}
}

async function executeSalesImport(adapter, items, options = {}) {
  const started = clockNow();
  const timings = makeTimedResult();
  const validationStart = clockNow();
  const rows = normalizeSalesRows(items);
  timings.validation_ms = clockNow() - validationStart;
  await reportImportProgress(options, {
    status: 'validating', phase: 'validating', percent: 10,
    processed_count: rows.length, total_count: rows.length,
    timings, metrics: adapter.metrics
  });
  let classification;

  const transactionStart = clockNow();
  await adapter.transaction(async () => {
    await reportImportProgress(options, {
      status: 'staging', phase: 'staging', percent: 20,
      processed_count: 0, total_count: rows.length,
      timings, metrics: adapter.metrics
    });
    const stagingStart = clockNow();
    await adapter.stageRows(rows);
    timings.staging_ms = clockNow() - stagingStart;
    await reportImportProgress(options, {
      status: 'staging', phase: 'staging', percent: 30,
      processed_count: rows.length, total_count: rows.length,
      timings, metrics: adapter.metrics
    });

    const matchingStart = clockNow();
    await reportImportProgress(options, {
      status: 'matching', phase: 'matching', percent: 35,
      processed_count: 0, total_count: rows.length,
      timings, metrics: adapter.metrics
    });
    const candidates = await adapter.loadCandidates(rows);
    classification = classifySalesRows(rows, candidates, {
      importBatchId: options.importBatchId || '',
      idFactory: options.idFactory
    });
    timings.matching_ms = clockNow() - matchingStart;
    await reportImportProgress(options, {
      status: 'matching', phase: 'matching', percent: 50,
      processed_count: rows.length, total_count: rows.length,
      inserted: classification.result.inserted, updated: classification.result.updated,
      skipped: classification.result.skipped, failed: classification.result.failed,
      errors: classification.result.errors, timings, metrics: adapter.metrics
    });

    const writingStart = clockNow();
    await reportImportProgress(options, {
      status: 'writing', phase: 'writing', percent: 60,
      processed_count: 0, total_count: rows.length,
      inserted: classification.result.inserted, updated: classification.result.updated,
      skipped: classification.result.skipped, failed: classification.result.failed,
      errors: classification.result.errors, timings, metrics: adapter.metrics
    });
    classification.importBatchId = options.importBatchId || '';
    await adapter.writePlan(classification);
    timings.writing_ms = clockNow() - writingStart;
    await reportImportProgress(options, {
      status: 'writing', phase: 'writing', percent: 75,
      processed_count: rows.length, total_count: rows.length,
      inserted: classification.result.inserted, updated: classification.result.updated,
      skipped: classification.result.skipped, failed: classification.result.failed,
      errors: classification.result.errors, timings, metrics: adapter.metrics
    });
  });
  timings.committing_ms = Math.max(0, clockNow() - transactionStart - timings.staging_ms - timings.matching_ms - timings.writing_ms);
  await reportImportProgress(options, {
    status: 'committing', phase: 'committing', percent: 90,
    processed_count: rows.length, total_count: rows.length,
    inserted: classification.result.inserted, updated: classification.result.updated,
    skipped: classification.result.skipped, failed: classification.result.failed,
    errors: classification.result.errors, timings, metrics: adapter.metrics,
    commit_state: 'committed'
  });
  // The current Phase 1 boundary intentionally leaves inventory recalculation
  // to the existing route. A callback is accepted for the later route wiring,
  // but this service does not move or redesign that logic.
  if (typeof options.recalculate === 'function') {
    const recalcStart = clockNow();
    await options.recalculate(classification);
    timings.inventory_recalc_ms = clockNow() - recalcStart;
  }
  timings.total_ms = clockNow() - started;
  return {
    result: classification.result,
    rows,
    classification,
    preview: buildSalesPreview(rows, classification),
    timings,
    metrics: adapter.metrics
  };
}

async function previewSalesImport(adapter, items, options = {}) {
  const started = clockNow();
  const timings = makeTimedResult();
  const validationStart = clockNow();
  const rows = normalizeSalesRows(items);
  timings.validation_ms = clockNow() - validationStart;
  let classification;
  const transactionStart = clockNow();
  await adapter.transaction(async () => {
    const stagingStart = clockNow();
    await adapter.stageRows(rows);
    timings.staging_ms = clockNow() - stagingStart;
    const matchingStart = clockNow();
    const candidates = await adapter.loadCandidates(rows);
    classification = classifySalesRows(rows, candidates, {
      importBatchId: options.importBatchId || '',
      idFactory: options.idFactory
    });
    timings.matching_ms = clockNow() - matchingStart;
  });
  timings.committing_ms = Math.max(0, clockNow() - transactionStart - timings.staging_ms - timings.matching_ms);
  timings.total_ms = clockNow() - started;
  return {
    preview: buildSalesPreview(rows, classification),
    classification,
    timings,
    metrics: adapter.metrics
  };
}

module.exports = {
  SALES_MUTABLE_FIELDS,
  normalizeOrderDate,
  normalizeSalesRows,
  detailIdentity,
  businessIdentity,
  hasSalesChanges,
  classifySalesRows,
  buildSalesPreview,
  createSqliteSalesImportAdapter,
  createPostgresSalesImportAdapter,
  createSalesImportRunStore,
  executeSalesImport,
  previewSalesImport
};
