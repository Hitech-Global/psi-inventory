'use strict';

module.exports = function installQuotationManagement(deps) {
  const { app, query, queryOne, run, transaction, genId, asyncHandler, requireApiPermission } = deps;
  run("CREATE TABLE IF NOT EXISTS quotation_prices (id TEXT PRIMARY KEY, sku_code TEXT NOT NULL, brand TEXT NOT NULL, product_type TEXT NOT NULL, quote_price NUMERIC NOT NULL, currency TEXT NOT NULL, quote_date TEXT NOT NULL, remark TEXT DEFAULT '', import_batch_id TEXT, created_at TEXT, updated_at TEXT, supplier_id TEXT NOT NULL DEFAULT '', supplier_part_no TEXT NOT NULL DEFAULT '', supplier_part_no_key TEXT NOT NULL DEFAULT '', psi_sku_code TEXT NOT NULL DEFAULT '', match_status TEXT NOT NULL DEFAULT 'matched', model TEXT NOT NULL DEFAULT '', spec TEXT NOT NULL DEFAULT '', source_sheet TEXT NOT NULL DEFAULT '', source_row INTEGER NOT NULL DEFAULT 0)");
  const quotationIsPg = String(process.env.DB_DRIVER || 'sqlite').toLowerCase() === 'pg';
  const quotationColumnRows = quotationIsPg
    ? query("SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='quotation_prices'").rows
    : query('PRAGMA table_info(quotation_prices)').rows;
  const quotationColumns = new Set(quotationColumnRows.map(r => String(r.column_name || r.name || '')));
  const quotationAddColumns = [
    ['supplier_id', "TEXT NOT NULL DEFAULT ''"],
    ['supplier_part_no', "TEXT NOT NULL DEFAULT ''"],
    ['supplier_part_no_key', "TEXT NOT NULL DEFAULT ''"],
    ['psi_sku_code', "TEXT NOT NULL DEFAULT ''"],
    ['match_status', "TEXT NOT NULL DEFAULT 'matched'"],
    ['model', "TEXT NOT NULL DEFAULT ''"],
    ['spec', "TEXT NOT NULL DEFAULT ''"],
    ['source_sheet', "TEXT NOT NULL DEFAULT ''"],
    ['source_row', 'INTEGER NOT NULL DEFAULT 0']
  ];
  for (const [name, definition] of quotationAddColumns) {
    if (!quotationColumns.has(name)) run('ALTER TABLE quotation_prices ADD COLUMN ' + name + ' ' + definition);
  }
  run("UPDATE quotation_prices SET supplier_part_no=sku_code WHERE supplier_part_no=''");
  run("UPDATE quotation_prices SET supplier_part_no_key=UPPER(TRIM(supplier_part_no)) WHERE supplier_part_no_key=''");
  run("UPDATE quotation_prices SET supplier_id=COALESCE((SELECT id FROM suppliers WHERE name=quotation_prices.brand OR associated_brands LIKE '%' || quotation_prices.brand || '%' ORDER BY CASE WHEN name=quotation_prices.brand THEN 0 ELSE 1 END LIMIT 1),'') WHERE supplier_id=''");
  run("UPDATE quotation_prices SET psi_sku_code=sku_code,match_status='matched' WHERE psi_sku_code='' AND EXISTS (SELECT 1 FROM skus WHERE UPPER(TRIM(skus.sku_code))=UPPER(TRIM(quotation_prices.sku_code)) AND skus.brand=quotation_prices.brand)");
  run("UPDATE quotation_prices SET match_status='unlinked' WHERE psi_sku_code='' AND match_status='matched'");
  run("CREATE TABLE IF NOT EXISTS quotation_sku_mappings (id TEXT PRIMARY KEY, supplier_id TEXT NOT NULL DEFAULT '', brand TEXT NOT NULL DEFAULT '', supplier_part_no TEXT NOT NULL, supplier_part_no_key TEXT NOT NULL, psi_sku_code TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '', UNIQUE(supplier_id,brand,supplier_part_no_key))");
  run('CREATE INDEX IF NOT EXISTS idx_quotation_sku_mappings_lookup ON quotation_sku_mappings (supplier_id,brand,supplier_part_no_key)');
  if (quotationIsPg) run('ALTER TABLE quotation_sku_mappings ENABLE ROW LEVEL SECURITY');
  run('DROP INDEX IF EXISTS uq_quotation_prices_sku_brand_date');
  run('CREATE UNIQUE INDEX IF NOT EXISTS uq_quotation_prices_supplier_sku_brand_date ON quotation_prices (supplier_id,sku_code,brand,quote_date)');
  run('CREATE INDEX IF NOT EXISTS idx_quotation_prices_brand_sku_date ON quotation_prices (brand,sku_code,quote_date)');
  run('CREATE INDEX IF NOT EXISTS idx_quotation_prices_brand_date ON quotation_prices (brand,quote_date)');

  const pct = (a, b) => {
    a = Number(a); b = Number(b);
    return Number.isFinite(a) && Number.isFinite(b) && b !== 0
      ? Math.round(((a - b) / b) * 10000) / 100
      : null;
  };
  const isQuoted = r => !!r && Number(r.quote_price) > 0;
  const pairKey = (brand, sku) => String(brand || '') + '|' + String(sku || '');

  function getBrandCurrencyMap() {
    const rows = query('SELECT brand, default_quote_currency FROM brand_settings').rows;
    return new Map(rows.map(r => [String(r.brand || '').trim(), String(r.default_quote_currency || '').trim().toUpperCase()]));
  }

  // Quote categories are supplier-controlled;  // Quote categories are supplier-controlled; only the linked SKU master decides
  // whether a quote can appear in active procurement analysis and its top-level category.
  // Historical quotation_prices records remain untouched for audit/re-import.
  const masterCategorySql = "COALESCE(NULLIF(TRIM(sm.category),''),'未分类')";
  const activeSkuJoinSql = ` INNER JOIN skus sm ON UPPER(TRIM(sm.sku_code))=UPPER(TRIM(COALESCE(NULLIF(q.psi_sku_code,''),q.sku_code))) AND LOWER(TRIM(sm.brand))=LOWER(TRIM(q.brand))`;
  const activeSkuWhereSql = "LOWER(TRIM(COALESCE(sm.status,'normal'))) NOT IN ('stopped','discontinued','inactive','停产','已停产','eol','end_of_life') AND LOWER(TRIM(COALESCE(sm.lifecycle_status,''))) NOT IN ('stopped','discontinued','停产','已停产','eol','end_of_life')";

  // The SKU master is authoritative when its top-level category is filled.
  // Legacy Netac SKUs have blank category fields, so fold supplier subcategories
  // into stable parent categories without altering either source table.
  function primaryQuotationCategory(masterCategory, importedType) {
    const master = String(masterCategory || '').trim();
    if (master && master !== '未分类') return master;
    const type = String(importedType || '').trim();
    if (!type) return '未分类';
    const v = type.toLowerCase();
    if (/dram|dimm|ddr[345]/i.test(v)) return 'DRAM';
    if (/microsd|sdhc|sdxc|cfexpress|memory\s*card/i.test(v)) return 'Memory Card';
    if (/card\s*reader/i.test(v)) return 'Card Reader';
    if (/ssd\s*enclosure|usb\s*hub|mini\s*pc\s*hub|data\s*cable|charging\s*cable|power\s*bank/i.test(v)) return 'Accessories';
    if (/ssd/i.test(v)) return 'SSD';
    if (/hdd|hard\s*drive/i.test(v)) return 'HDD';
    if (/usb|write\s*protect\s*drive/i.test(v)) return 'USB Flash';
    if (/tws|headset|headphone|earphone|earbud/i.test(v)) return 'Audio';
    if (/keyboard/i.test(v)) return 'Keyboard';
    if (/mouse/i.test(v)) return 'Mouse';
    return type;
  }

  function buildSummary(req) {
    const brand = String(req.query.brand || '').trim(), type = String(req.query.product_type || '').trim(), kw = String(req.query.keyword || '').trim().toLowerCase(), from = String(req.query.date_from || '').trim(), to = String(req.query.date_to || '').trim();
    let sql = `SELECT q.*,sm.sku_code AS master_sku_code,${masterCategorySql} AS master_category FROM quotation_prices q${activeSkuJoinSql} WHERE ${activeSkuWhereSql}`, ps = [];
    if (brand) { sql += ' AND q.brand=?'; ps.push(brand); }
    if (kw) { sql += ` AND (LOWER(q.sku_code) LIKE ? OR LOWER(q.product_type) LIKE ? OR LOWER(q.brand) LIKE ? OR LOWER(sm.sku_code) LIKE ? OR LOWER(sm.category) LIKE ?)`; const q = '%' + kw + '%'; ps.push(q, q, q, q, q); }
    if (from) { sql += ' AND q.quote_date>=?'; ps.push(from); }
    if (to) { sql += ' AND q.quote_date<=?'; ps.push(to); }
    sql += ' ORDER BY q.brand,q.sku_code,q.quote_date DESC,q.created_at DESC';

    const allHistory = query(sql, ps).rows, grouped = new Map();
    for (const r of allHistory) { const k = pairKey(r.brand, r.sku_code); if (!grouped.has(k)) grouped.set(k, []); grouped.get(k).push(r); }
    // Filter by the latest quote's primary category, keeping every historical
    // record in the selected SKU group for accurate previous-price comparisons.
    const by = new Map([...grouped].filter(([, a]) => !type || primaryQuotationCategory(a[0].master_category, a[0].product_type) === type));
    const history = [...by.values()].flat();
    const rows = [];

    for (const a of by.values()) {
      const event = a[0], latest = isQuoted(event) ? event : null, prev = latest ? a.slice(1).find(isQuoted) || null : null;
      rows.push({
        sku_code: event.sku_code, supplier_part_no: event.supplier_part_no || event.sku_code,
        psi_sku_code: event.master_sku_code, match_status: event.match_status === 'unlinked' ? 'unlinked' : 'matched',
        supplier_id: event.supplier_id || '', model: event.model || '', spec: event.spec || '',
        brand: event.brand, product_type: primaryQuotationCategory(event.master_category, event.product_type),
        latest_price: latest ? Number(latest.quote_price) : null, currency: event.currency,
        latest_date: event.quote_date, quote_status: latest ? 'quoted' : 'no_quote',
        previous_price: prev ? Number(prev.quote_price) : null,
        vs_previous_pct: latest && prev ? pct(latest.quote_price, prev.quote_price) : null,
        history_count: a.length, quoted_history_count: a.filter(isQuoted).length
      });
    }

    rows.sort((a, b) => String(a.sku_code).localeCompare(String(b.sku_code)));

    const actual = query("SELECT brand FROM skus WHERE brand IS NOT NULL AND brand<>'' UNION SELECT brand FROM quotation_prices WHERE brand IS NOT NULL AND brand<>'' ORDER BY brand").rows.map(r => r.brand), brands = actual;
    let tsql = `SELECT DISTINCT sm.category AS master_category,q.product_type AS imported_type FROM quotation_prices q${activeSkuJoinSql} WHERE ${activeSkuWhereSql}`, tps = [];
    if (brand) { tsql += ' AND q.brand=?'; tps.push(brand); }
    const productTypes = [...new Set(query(tsql, tps).rows.map(r => primaryQuotationCategory(r.master_category, r.imported_type)))].sort((a,b) => a.localeCompare(b));

    const changes = rows.map(r => r.vs_previous_pct).filter(v => v !== null), types = {};
    rows.forEach(r => types[r.product_type || '未分类'] = (types[r.product_type || '未分类'] || 0) + 1);
    const trendMap = new Map();
    for (const h of history) { if (!isQuoted(h)) continue; if (!trendMap.has(h.quote_date)) trendMap.set(h.quote_date, []); trendMap.get(h.quote_date).push(Number(h.quote_price)); }
    const trend = [...trendMap].sort((a, b) => String(a[0]).localeCompare(String(b[0]))).slice(-24).map(([date, v]) => ({ date, avg_price: v.reduce((s, n) => s + n, 0) / v.length, count: v.length }));
    const month = new Date().toISOString().slice(0, 7), quotedHistoryCount = history.filter(isQuoted).length, noQuoteCount = rows.filter(r => r.quote_status === 'no_quote').length;
    const distinctSkuCount = new Set(rows.map(r => String(r.sku_code || '').trim().toUpperCase())).size;
    const currencySymbols = Object.fromEntries(query("SELECT code,symbol FROM currencies WHERE status='active'").rows.map(r => [String(r.code || '').trim().toUpperCase(), String(r.symbol || '').trim()]));

    return {
      brands, brand_currencies: Object.fromEntries(brandCurrencies), currency_symbols: currencySymbols, product_types: productTypes, rows,
      report: {
        brand: brand || null, currency: brand ? (brandCurrencies.get(brand) || (rows[0] && rows[0].currency) || '') : '',
        sku_count: distinctSkuCount, unlinked_count: rows.filter(r => r.match_status === 'unlinked').length, history_count: history.length, quoted_history_count: quotedHistoryCount, no_quote_count: noQuoteCount,
        updated_this_month: rows.filter(r => String(r.latest_date || '').slice(0, 7) === month).length,
        up_count: changes.filter(v => v > 0).length, down_count: changes.filter(v => v < 0).length,
        avg_change_pct: changes.length ? Math.round(changes.reduce((s, v) => s + v, 0) / changes.length * 100) / 100 : null,
        product_types: types,
        top_movers: rows.filter(r => r.vs_previous_pct !== null).sort((a, b) => Math.abs(b.vs_previous_pct) - Math.abs(a.vs_previous_pct)).slice(0, 5), trend
      }
    };
  }

  app.get('/api/quotation-management/summary', requireApiPermission('quotation_view'), asyncHandler((req, res) => {
    try { res.json(buildSummary(req)); } catch (e) { res.status(500).json({ error: e.message }); }
  }));

  app.get('/api/quotation-management/sku/:sku', requireApiPermission('quotation_view'), asyncHandler((req, res) => {
    try {
      const sku = String(req.params.sku || '').trim(), brand = String(req.query.brand || '').trim();
      if (!sku || !brand) return res.status(400).json({ error: '缺少 SKU 或品牌' });
      const h = query('SELECT * FROM quotation_prices WHERE sku_code=? AND brand=? ORDER BY quote_date DESC,created_at DESC', [sku, brand]).rows;
      const isUnlinked = !!(h[0] && h[0].match_status === 'unlinked');
      res.json({
        sku_code: sku, brand, match_status: isUnlinked ? 'unlinked' : 'matched',
        supplier_part_no: (h[0] && h[0].supplier_part_no) || sku,
        psi_sku_code: (h[0] && h[0].psi_sku_code) || '',
        history: h.map((r, i) => {
          const quoted = isQuoted(r), prev = quoted ? h.slice(i + 1).find(isQuoted) || null : null;
          return {
            ...r, quote_price: quoted ? Number(r.quote_price) : null,
            quote_status: quoted ? 'quoted' : 'no_quote',
            vs_previous_pct: quoted && prev ? pct(r.quote_price, prev.quote_price) : null
          };
        })
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  }));

  // Legacy route retained for local/dev compatibility. Production registers quotation-import-fast.js first.
  app.post('/api/quotation-management/import', requireApiPermission('quotation_view'), asyncHandler((req, res) => {
    try {
      const input = Array.isArray((req.body || {}).rows) ? req.body.rows : [], mode = (req.body || {}).duplicate_mode === 'overwrite' ? 'overwrite' : 'skip';
      if (!input.length) return res.status(400).json({ error: '导入数据不能为空' });
      if (input.length > 5000) return res.status(400).json({ error: '单次最多导入5000行' });
      const brandCurrencies = getBrandCurrencyMap();
      const activeCurrencies = new Set(query("SELECT code FROM currencies WHERE status='active'").rows.map(r => String(r.code || '').trim().toUpperCase()));
      const rows = [], errors = [];
      input.forEach((r, i) => {
        const sku = String(r.sku_code || r.SKU || r['SKU'] || '').trim(), brand = String(r.brand || r['品牌'] || '').trim(), product_type = String(r.product_type || r['产品类型'] || '').trim(), priceRaw = r.quote_price ?? r['FOB价格'] ?? r['报价价格'] ?? r['报价'], priceText = String(priceRaw ?? '').trim(), quote_price = Number(priceText), expected = brandCurrencies.get(brand) || '', currency = String(r.currency || r['币种'] || expected || '').trim().toUpperCase(), quote_date = String(r.quote_date || r['报价日期'] || '').trim().slice(0, 10), remark = String(r.remark || r['备注'] || '').trim();
        if (!sku || !brand || !product_type || priceText === '' || !Number.isFinite(quote_price) || quote_price < 0 || !/^\d{4}-\d{2}-\d{2}$/.test(quote_date) || !currency) errors.push({ row: i + 2, reason: '必填字段缺失或格式错误' });
        else if (!expected) errors.push({ row: i + 2, reason: '品牌 ' + brand + ' 尚未设置默认报价币种，请先到系统管理→品牌设置配置' });
        else if (currency !== expected) errors.push({ row: i + 2, reason: brand + ' 默认报价币种应为 ' + expected });
        else if (!activeCurrencies.has(currency)) errors.push({ row: i + 2, reason: '币种 ' + currency + ' 未在系统管理→币种设置中启用' });
        else rows.push({ sku, brand, product_type, quote_price, currency, quote_date, remark });
      });
      if (errors.length) return res.status(400).json({ error: '导入校验失败', errors });
      let inserted = 0, updated = 0, skipped = 0, no_quote = 0; const batch = genId('quoteimp'), now = new Date().toISOString();
      transaction(() => {
        for (const r of rows) {
          if (r.quote_price === 0) no_quote++;
          const old = queryOne('SELECT id FROM quotation_prices WHERE sku_code=? AND brand=? AND quote_date=?', [r.sku, r.brand, r.quote_date]);
          if (old) {
            if (mode === 'overwrite') { run('UPDATE quotation_prices SET product_type=?,quote_price=?,currency=?,remark=?,import_batch_id=?,updated_at=? WHERE id=?', [r.product_type, r.quote_price, r.currency, r.remark, batch, now, old.id]); updated++; }
            else skipped++;
          } else {
            run('INSERT INTO quotation_prices (id,sku_code,brand,product_type,quote_price,currency,quote_date,remark,import_batch_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [genId('quote'), r.sku, r.brand, r.product_type, r.quote_price, r.currency, r.quote_date, r.remark, batch, now, now]); inserted++;
          }
        }
      });
      res.json({ success: true, inserted, updated, skipped, no_quote, total: rows.length, import_batch_id: batch });
    } catch (e) { res.status(500).json({ error: e.message }); }
  }));
};
