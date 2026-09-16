'use strict';

module.exports = function installQuotationManagement(deps) {
  const { app, query, queryOne, run, transaction, genId, asyncHandler, requireApiPermission } = deps;
  const BRAND_CCY = Object.freeze({ Netac: 'USD', Redragon: 'RMB', BOYA: 'RMB', Joypeer: 'RMB' });
  const PURCHASE_FX_RATE_TYPE = 'quotation_purchase';
  const MAX_FX_WARM_REQUESTS = 20;

  run("CREATE TABLE IF NOT EXISTS quotation_prices (id TEXT PRIMARY KEY, sku_code TEXT NOT NULL, brand TEXT NOT NULL, product_type TEXT NOT NULL, quote_price NUMERIC NOT NULL, currency TEXT NOT NULL, quote_date TEXT NOT NULL, remark TEXT DEFAULT '', import_batch_id TEXT, created_at TEXT, updated_at TEXT)");
  run('CREATE UNIQUE INDEX IF NOT EXISTS uq_quotation_prices_sku_brand_date ON quotation_prices (sku_code,brand,quote_date)');
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
  const fxKey = (date, from, to) => [date, String(from || '').toUpperCase(), String(to || '').toUpperCase()].join('|');
  const apiCurrency = c => String(c || '').toUpperCase() === 'RMB' ? 'CNY' : String(c || '').toUpperCase();

  function parseIdList(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value.map(String).filter(Boolean);
    const s = String(value).trim();
    if (!s) return [];
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch (_e) {}
    return s.split(/[,&;|]/).map(x => x.trim()).filter(Boolean);
  }

  function cachedFxMap(requirements) {
    const reqs = [...new Map((requirements || []).filter(x => x && x.rate_date && x.from_currency && x.to_currency).map(x => [fxKey(x.rate_date, x.from_currency, x.to_currency), x])).values()];
    const out = new Map();
    if (!reqs.length) return out;
    const dates = [...new Set(reqs.map(x => x.rate_date))];
    const currencies = [...new Set(reqs.flatMap(x => [String(x.from_currency).toUpperCase(), String(x.to_currency).toUpperCase()]))];
    const dph = dates.map(() => '?').join(','), cph = currencies.map(() => '?').join(',');
    const rows = query(`SELECT rate_date,from_currency,to_currency,rate,rate_type,created_at,id FROM exchange_rates WHERE rate_date IN (${dph}) AND from_currency IN (${cph}) AND to_currency IN (${cph}) ORDER BY created_at DESC,id DESC`, [...dates, ...currencies, ...currencies]).rows;
    for (const r of rows) {
      const rate = Number(r.rate);
      if (!(rate > 0)) continue;
      const direct = fxKey(r.rate_date, r.from_currency, r.to_currency);
      if (!out.has(direct)) out.set(direct, { rate, rate_type: r.rate_type || '', source: 'cache' });
      const reverse = fxKey(r.rate_date, r.to_currency, r.from_currency);
      if (!out.has(reverse)) out.set(reverse, { rate: 1 / rate, rate_type: r.rate_type || '', source: 'cache_reverse' });
    }
    return out;
  }

  function purchaseBaselines(pairs) {
    const uniq = [...new Map((pairs || []).filter(p => p && p.sku && p.brand).map(p => [pairKey(p.brand, p.sku), {
      brand: String(p.brand), sku: String(p.sku), target_currency: String(p.currency || BRAND_CCY[p.brand] || '').toUpperCase()
    }])).values()];
    const out = new Map();
    if (!uniq.length) return { map: out, missing_fx: [] };

    const wanted = new Map(uniq.map(p => [pairKey(p.brand, p.sku), p]));
    const skus = [...new Set(uniq.map(p => p.sku))];
    const ph = skus.map(() => '?').join(',');
    const ciRows = query(`
      SELECT ci.id AS ci_id,ci.ci_no,ci.brand,ci.currency,
             COALESCE(NULLIF(ci.actual_ship_date,''),NULLIF(ci.ci_date,''),ci.created_at) AS purchase_date,
             ci.created_at AS ci_created_at,ci.related_pi_ids,ci.related_pi_nos,
             cii.sku_code,cii.unit_price,cii.pi_id,cii.pi_no,cii.created_at AS item_created_at
      FROM commercial_invoice_items cii
      JOIN commercial_invoices ci ON ci.id=cii.ci_id
      WHERE cii.sku_code IN (${ph}) AND cii.unit_price IS NOT NULL
      ORDER BY cii.sku_code,ci.brand,
               COALESCE(NULLIF(ci.actual_ship_date,''),NULLIF(ci.ci_date,''),ci.created_at) DESC,
               ci.created_at DESC,ci.id DESC,cii.created_at DESC,cii.id DESC`, skus).rows;

    // One latest CI per brand + SKU. Keep every row for that SKU inside that CI so merged-PI ambiguity is visible.
    const latestGroups = new Map();
    for (const r of ciRows) {
      const k = pairKey(r.brand, r.sku_code);
      if (!wanted.has(k)) continue;
      let g = latestGroups.get(k);
      if (!g) {
        g = { ci_id: r.ci_id, rows: [], meta: r };
        latestGroups.set(k, g);
      }
      if (g.ci_id === r.ci_id) g.rows.push(r);
    }

    const ambiguous = [];
    for (const [k, g] of latestGroups) {
      const prices = [...new Set(g.rows.map(r => String(r.unit_price)).filter(Boolean))].map(Number).filter(Number.isFinite);
      if (prices.length === 1) {
        out.set(k, {
          status: 'exact', source_kind: 'ci', source_reason: 'latest_ci',
          ci_id: g.meta.ci_id, ci_no: g.meta.ci_no,
          source_doc_no: g.meta.ci_no, source_date: g.meta.purchase_date,
          purchase_date: g.meta.purchase_date,
          currency: String(g.meta.currency || '').toUpperCase(), unit_price: prices[0]
        });
      } else if (prices.length > 1) {
        const piIds = new Set();
        g.rows.forEach(r => { if (r.pi_id) piIds.add(String(r.pi_id)); });
        parseIdList(g.meta.related_pi_ids).forEach(id => piIds.add(id));
        ambiguous.push({ key: k, group: g, pi_ids: [...piIds] });
      }
    }

    // Merged CI fallback: for duplicate SKU + different prices, use the SKU FOB from the latest-dated PI linked to that CI.
    const allPiIds = [...new Set(ambiguous.flatMap(x => x.pi_ids))];
    if (ambiguous.length && allPiIds.length) {
      const piph = allPiIds.map(() => '?').join(','), sph = skus.map(() => '?').join(',');
      const piRows = query(`
        SELECT pi.id AS pi_id,pi.pi_no,pi.pi_date,pi.currency,pi.created_at AS pi_created_at,
               pii.sku_code,pii.unit_price,pii.created_at AS item_created_at
        FROM proforma_invoice_items pii
        JOIN proforma_invoices pi ON pi.id=pii.pi_id
        WHERE pi.id IN (${piph}) AND pii.sku_code IN (${sph}) AND pii.unit_price IS NOT NULL
        ORDER BY pi.pi_date DESC,pi.created_at DESC,pi.id DESC,pii.created_at DESC,pii.id DESC`, [...allPiIds, ...skus]).rows;
      const byPiSku = new Map();
      for (const r of piRows) {
        const k = String(r.pi_id) + '|' + String(r.sku_code);
        if (!byPiSku.has(k)) byPiSku.set(k, []);
        byPiSku.get(k).push(r);
      }
      for (const a of ambiguous) {
        const sku = wanted.get(a.key).sku;
        const candidates = [];
        for (const piId of a.pi_ids) {
          const rows = byPiSku.get(String(piId) + '|' + sku) || [];
          if (rows.length) candidates.push({ pi_id: piId, rows, meta: rows[0] });
        }
        candidates.sort((x, y) => {
          const xd = String(x.meta.pi_date || ''), yd = String(y.meta.pi_date || '');
          if (xd !== yd) return yd.localeCompare(xd);
          const xc = String(x.meta.pi_created_at || ''), yc = String(y.meta.pi_created_at || '');
          if (xc !== yc) return yc.localeCompare(xc);
          return String(y.pi_id).localeCompare(String(x.pi_id));
        });
        const chosen = candidates[0];
        if (!chosen) {
          out.set(a.key, {
            status: 'ambiguous', source_kind: 'ci', source_reason: 'merged_ci_pi_missing',
            ci_id: a.group.meta.ci_id, ci_no: a.group.meta.ci_no,
            purchase_date: a.group.meta.purchase_date, currency: String(a.group.meta.currency || '').toUpperCase(), unit_price: null
          });
          continue;
        }
        const prices = [...new Set(chosen.rows.map(r => String(r.unit_price)).filter(Boolean))].map(Number).filter(Number.isFinite);
        if (prices.length !== 1) {
          out.set(a.key, {
            status: 'ambiguous', source_kind: 'pi', source_reason: 'latest_pi_has_multiple_prices',
            ci_id: a.group.meta.ci_id, ci_no: a.group.meta.ci_no,
            pi_id: chosen.meta.pi_id, pi_no: chosen.meta.pi_no,
            source_doc_no: chosen.meta.pi_no, source_date: chosen.meta.pi_date,
            purchase_date: a.group.meta.purchase_date, currency: String(chosen.meta.currency || '').toUpperCase(), unit_price: null
          });
          continue;
        }
        out.set(a.key, {
          status: 'exact', source_kind: 'pi', source_reason: 'merged_ci_latest_pi',
          ci_id: a.group.meta.ci_id, ci_no: a.group.meta.ci_no,
          pi_id: chosen.meta.pi_id, pi_no: chosen.meta.pi_no,
          source_doc_no: chosen.meta.pi_no, source_date: chosen.meta.pi_date,
          purchase_date: a.group.meta.purchase_date,
          currency: String(chosen.meta.currency || '').toUpperCase(), unit_price: prices[0]
        });
      }
    }

    const fxRequirements = [];
    for (const [k, p] of out) {
      const target = wanted.get(k) && wanted.get(k).target_currency;
      if (p && p.status === 'exact' && p.unit_price != null && target && p.currency && target !== p.currency) {
        fxRequirements.push({ rate_date: String(p.source_date || p.purchase_date || '').slice(0, 10), from_currency: p.currency, to_currency: target });
      }
    }
    const fxMap = cachedFxMap(fxRequirements), missingFx = new Map();
    for (const [k, p] of out) {
      const target = wanted.get(k) && wanted.get(k).target_currency;
      p.original_unit_price = p.unit_price;
      p.original_currency = p.currency;
      p.target_currency = target || p.currency;
      if (p.status !== 'exact' || p.unit_price == null || !target || !p.currency) continue;
      if (target === p.currency) {
        p.comparable_unit_price = Number(p.unit_price);
        p.comparable_currency = target;
        p.fx_rate = 1;
        p.comparison_status = 'exact';
        continue;
      }
      const rateDate = String(p.source_date || p.purchase_date || '').slice(0, 10);
      const cached = fxMap.get(fxKey(rateDate, p.currency, target));
      if (cached && cached.rate > 0) {
        p.comparable_unit_price = Number(p.unit_price) * Number(cached.rate);
        p.comparable_currency = target;
        p.fx_rate = Number(cached.rate);
        p.fx_rate_date = rateDate;
        p.fx_rate_type = cached.rate_type || PURCHASE_FX_RATE_TYPE;
        p.comparison_status = 'converted';
      } else {
        p.comparable_unit_price = null;
        p.comparable_currency = target;
        p.comparison_status = 'fx_missing';
        const req = { rate_date: rateDate, from_currency: p.currency, to_currency: target };
        if (rateDate) missingFx.set(fxKey(rateDate, p.currency, target), req);
      }
    }
    return { map: out, missing_fx: [...missingFx.values()] };
  }

  function buildSummary(req) {
    const brand = String(req.query.brand || '').trim(), type = String(req.query.product_type || '').trim(), kw = String(req.query.keyword || '').trim().toLowerCase(), from = String(req.query.date_from || '').trim(), to = String(req.query.date_to || '').trim();
    let sql = 'SELECT * FROM quotation_prices WHERE 1=1', ps = [];
    if (brand) { sql += ' AND brand=?'; ps.push(brand); }
    if (type) { sql += ' AND product_type=?'; ps.push(type); }
    if (kw) { sql += ' AND (LOWER(sku_code) LIKE ? OR LOWER(product_type) LIKE ? OR LOWER(brand) LIKE ?)'; const q = '%' + kw + '%'; ps.push(q, q, q); }
    if (from) { sql += ' AND quote_date>=?'; ps.push(from); }
    if (to) { sql += ' AND quote_date<=?'; ps.push(to); }
    sql += ' ORDER BY brand,sku_code,quote_date DESC,created_at DESC';

    const history = query(sql, ps).rows, by = new Map();
    for (const r of history) { const k = pairKey(r.brand, r.sku_code); if (!by.has(k)) by.set(k, []); by.get(k).push(r); }
    const purchase = purchaseBaselines([...by.values()].map(a => ({ brand: a[0].brand, sku: a[0].sku_code, currency: a[0].currency || BRAND_CCY[a[0].brand] })));
    const pmap = purchase.map, rows = [];

    for (const [k, a] of by) {
      const event = a[0], latest = isQuoted(event) ? event : null, prev = latest ? a.slice(1).find(isQuoted) || null : null, p = pmap.get(k) || null;
      const comparable = !!latest && !!p && p.status === 'exact' && p.comparable_unit_price != null && String(p.comparable_currency || '').toUpperCase() === String(latest.currency || '').toUpperCase();
      rows.push({
        sku_code: event.sku_code, brand: event.brand, product_type: event.product_type,
        latest_price: latest ? Number(latest.quote_price) : null, currency: event.currency, latest_date: event.quote_date,
        quote_status: latest ? 'quoted' : 'no_quote', previous_price: prev ? Number(prev.quote_price) : null,
        vs_previous_pct: latest && prev ? pct(latest.quote_price, prev.quote_price) : null,
        last_purchase_price: comparable ? Number(p.comparable_unit_price) : null,
        last_purchase_currency: comparable ? p.comparable_currency : (p ? p.currency : null),
        last_purchase_original_price: p && p.unit_price != null ? Number(p.unit_price) : null,
        last_purchase_original_currency: p ? p.currency : null,
        last_purchase_date: p ? p.purchase_date : null,
        last_purchase_source_date: p ? p.source_date : null,
        last_purchase_ci_no: p ? p.ci_no : null,
        last_purchase_pi_no: p ? p.pi_no || null : null,
        last_purchase_source_kind: p ? p.source_kind || null : null,
        last_purchase_source_reason: p ? p.source_reason || null : null,
        last_purchase_fx_rate: p && p.fx_rate ? p.fx_rate : null,
        last_purchase_fx_rate_date: p && p.fx_rate_date ? p.fx_rate_date : null,
        purchase_status: latest ? (p ? (p.status !== 'exact' ? p.status : (p.comparison_status || 'exact')) : 'missing') : 'no_quote',
        vs_purchase_pct: latest && comparable ? pct(latest.quote_price, p.comparable_unit_price) : null,
        history_count: a.length, quoted_history_count: a.filter(isQuoted).length
      });
    }
    rows.sort((a, b) => String(a.sku_code).localeCompare(String(b.sku_code)));

    const actual = query("SELECT DISTINCT brand FROM quotation_prices WHERE brand IS NOT NULL AND brand<>'' ORDER BY brand").rows.map(r => r.brand), brands = [...new Set(['Netac', 'Redragon', 'BOYA', 'Joypeer', ...actual])];
    let tsql = "SELECT DISTINCT product_type FROM quotation_prices WHERE product_type IS NOT NULL AND product_type<>''", tps = [];
    if (brand) { tsql += ' AND brand=?'; tps.push(brand); }
    tsql += ' ORDER BY product_type';
    const productTypes = query(tsql, tps).rows.map(r => r.product_type);

    const changes = rows.map(r => r.vs_previous_pct).filter(v => v !== null), pchanges = rows.map(r => r.vs_purchase_pct).filter(v => v !== null), types = {};
    rows.forEach(r => types[r.product_type || '未分类'] = (types[r.product_type || '未分类'] || 0) + 1);
    const trendMap = new Map();
    for (const h of history) { if (!isQuoted(h)) continue; if (!trendMap.has(h.quote_date)) trendMap.set(h.quote_date, []); trendMap.get(h.quote_date).push(Number(h.quote_price)); }
    const trend = [...trendMap].sort((a, b) => String(a[0]).localeCompare(String(b[0]))).slice(-24).map(([date, v]) => ({ date, avg_price: v.reduce((s, n) => s + n, 0) / v.length, count: v.length }));
    const month = new Date().toISOString().slice(0, 7), quotedHistoryCount = history.filter(isQuoted).length, noQuoteCount = rows.filter(r => r.quote_status === 'no_quote').length;
    const distinctSkuCount = new Set(rows.map(r => String(r.sku_code || '').trim().toUpperCase())).size;

    return {
      brands, product_types: productTypes, rows, missing_purchase_fx: purchase.missing_fx,
      report: {
        brand: brand || null, currency: brand ? (BRAND_CCY[brand] || (rows[0] && rows[0].currency) || '') : '',
        sku_count: distinctSkuCount, history_count: history.length, quoted_history_count: quotedHistoryCount, no_quote_count: noQuoteCount,
        updated_this_month: rows.filter(r => String(r.latest_date || '').slice(0, 7) === month).length,
        up_count: changes.filter(v => v > 0).length, down_count: changes.filter(v => v < 0).length,
        avg_change_pct: changes.length ? Math.round(changes.reduce((s, v) => s + v, 0) / changes.length * 100) / 100 : null,
        above_purchase_count: pchanges.filter(v => v > 0).length, below_purchase_count: pchanges.filter(v => v < 0).length,
        comparable_purchase_count: pchanges.length,
        fx_pending_count: rows.filter(r => r.purchase_status === 'fx_missing').length,
        product_types: types,
        top_movers: rows.filter(r => r.vs_previous_pct !== null).sort((a, b) => Math.abs(b.vs_previous_pct) - Math.abs(a.vs_previous_pct)).slice(0, 5),
        top_purchase_gaps: rows.filter(r => r.vs_purchase_pct !== null).sort((a, b) => Math.abs(b.vs_purchase_pct) - Math.abs(a.vs_purchase_pct)).slice(0, 5), trend
      }
    };
  }

  async function fetchExactFx(rateDate, fromCurrency, toCurrency) {
    const from = String(fromCurrency || '').toUpperCase(), to = String(toCurrency || '').toUpperCase();
    if (!rateDate || !from || !to) throw new Error('汇率参数不完整');
    if (from === to) return 1;
    const apiFrom = apiCurrency(from), apiTo = apiCurrency(to);
    const url = `https://api.frankfurter.dev/v1/${encodeURIComponent(rateDate)}?base=${encodeURIComponent(apiFrom)}&symbols=${encodeURIComponent(apiTo)}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(4500), headers: { accept: 'application/json' } });
    if (!resp.ok) throw new Error('历史汇率服务 HTTP ' + resp.status);
    const data = await resp.json();
    const providerDate = String(data && data.date || '');
    const rate = Number(data && data.rates && data.rates[apiTo]);
    if (providerDate !== rateDate || !(rate > 0)) throw new Error('历史汇率服务未返回精确日期 ' + rateDate);
    return rate;
  }

  app.get('/api/quotation-management/summary', requireApiPermission('cost_view'), asyncHandler((req, res) => {
    try { res.json(buildSummary(req)); } catch (e) { res.status(500).json({ error: e.message }); }
  }));

  app.post('/api/quotation-management/purchase-fx/warm', requireApiPermission('cost_view'), asyncHandler(async (req, res) => {
    try {
      const raw = Array.isArray((req.body || {}).requests) ? req.body.requests : [];
      const reqs = [...new Map(raw.map(x => ({
        rate_date: String(x && x.rate_date || '').slice(0, 10),
        from_currency: String(x && x.from_currency || '').toUpperCase(),
        to_currency: String(x && x.to_currency || '').toUpperCase()
      })).filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x.rate_date) && x.from_currency && x.to_currency).map(x => [fxKey(x.rate_date, x.from_currency, x.to_currency), x])).values()].slice(0, MAX_FX_WARM_REQUESTS);
      if (!reqs.length) return res.json({ success: true, warmed: 0, cached: 0, failed: [] });
      const existing = cachedFxMap(reqs); let warmed = 0, cached = 0; const failed = [];
      for (const x of reqs) {
        const k = fxKey(x.rate_date, x.from_currency, x.to_currency);
        if (existing.has(k)) { cached++; continue; }
        try {
          const rate = await fetchExactFx(x.rate_date, x.from_currency, x.to_currency);
          const id = ['qfx', x.rate_date, x.from_currency, x.to_currency].join('_');
          const now = new Date().toISOString();
          run(`INSERT INTO exchange_rates (id,from_currency,to_currency,rate,rate_date,rate_type,created_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET rate=EXCLUDED.rate,rate_date=EXCLUDED.rate_date,rate_type=EXCLUDED.rate_type,created_at=EXCLUDED.created_at`, [id, x.from_currency, x.to_currency, rate, x.rate_date, PURCHASE_FX_RATE_TYPE, now]);
          warmed++;
        } catch (e) { failed.push({ ...x, error: e.message }); }
      }
      res.json({ success: failed.length === 0, warmed, cached, failed });
    } catch (e) { res.status(500).json({ error: e.message }); }
  }));

  app.get('/api/quotation-management/sku/:sku', requireApiPermission('cost_view'), asyncHandler((req, res) => {
    try {
      const sku = String(req.params.sku || '').trim(), brand = String(req.query.brand || '').trim();
      if (!sku || !brand) return res.status(400).json({ error: '缺少 SKU 或品牌' });
      const h = query('SELECT * FROM quotation_prices WHERE sku_code=? AND brand=? ORDER BY quote_date DESC,created_at DESC', [sku, brand]).rows;
      const targetCurrency = (h[0] && h[0].currency) || BRAND_CCY[brand] || '';
      const purchase = purchaseBaselines([{ sku, brand, currency: targetCurrency }]);
      const p = purchase.map.get(pairKey(brand, sku)) || null;
      res.json({
        sku_code: sku, brand, purchase: p, missing_purchase_fx: purchase.missing_fx,
        history: h.map((r, i) => {
          const quoted = isQuoted(r), prev = quoted ? h.slice(i + 1).find(isQuoted) || null : null;
          const comparable = quoted && p && p.status === 'exact' && p.comparable_unit_price != null && String(p.comparable_currency || '').toUpperCase() === String(r.currency || '').toUpperCase();
          return { ...r, quote_price: quoted ? Number(r.quote_price) : null, quote_status: quoted ? 'quoted' : 'no_quote', vs_previous_pct: quoted && prev ? pct(r.quote_price, prev.quote_price) : null, vs_purchase_pct: comparable ? pct(r.quote_price, p.comparable_unit_price) : null };
        })
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  }));

  // Legacy route retained for local/dev compatibility. Production registers quotation-import-fast.js first.
  app.post('/api/quotation-management/import', requireApiPermission('cost_view'), asyncHandler((req, res) => {
    try {
      const input = Array.isArray((req.body || {}).rows) ? req.body.rows : [], mode = (req.body || {}).duplicate_mode === 'overwrite' ? 'overwrite' : 'skip';
      if (!input.length) return res.status(400).json({ error: '导入数据不能为空' });
      if (input.length > 5000) return res.status(400).json({ error: '单次最多导入5000行' });
      const rows = [], errors = [];
      input.forEach((r, i) => {
        const sku = String(r.sku_code || r.SKU || r['SKU'] || '').trim(), brand = String(r.brand || r['品牌'] || '').trim(), product_type = String(r.product_type || r['产品类型'] || '').trim(), priceRaw = r.quote_price ?? r['FOB价格'] ?? r['报价价格'] ?? r['报价'], priceText = String(priceRaw ?? '').trim(), quote_price = Number(priceText), currency = String(r.currency || r['币种'] || BRAND_CCY[brand] || '').trim().toUpperCase(), quote_date = String(r.quote_date || r['报价日期'] || '').trim().slice(0, 10), remark = String(r.remark || r['备注'] || '').trim(), expected = BRAND_CCY[brand];
        if (!sku || !brand || !product_type || priceText === '' || !Number.isFinite(quote_price) || quote_price < 0 || !/^\d{4}-\d{2}-\d{2}$/.test(quote_date) || !currency) errors.push({ row: i + 2, reason: '必填字段缺失或格式错误' });
        else if (expected && currency !== expected) errors.push({ row: i + 2, reason: brand + ' 默认币种应为 ' + expected });
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
