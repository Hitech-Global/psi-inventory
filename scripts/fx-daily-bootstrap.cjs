'use strict';

/**
 * FX-P0 bootstrap hotfix.
 *
 * Why this exists:
 * - production exchange_rates.rate used NUMERIC(18,8), which destroys IDR/RMB daily precision;
 * - server.js stamps provider results with server "today" instead of the provider snapshot date;
 * - inventory reads can accidentally consume settlement-generated fxauto_* rows because both use rate_type=realtime.
 *
 * The production column migration is tracked separately in db-migrations/fx-rate-precision.sql.
 * This bootstrap applies a deterministic, fail-closed source transformation before Node loads server.js.
 * It is enabled with NODE_OPTIONS="--require ./scripts/fx-daily-bootstrap.cjs".
 *
 * Fail-closed rule: every expected source marker must match exactly once. If server.js drifts,
 * startup aborts instead of silently running an incomplete FX patch.
 */

const fs = require('node:fs');
const path = require('node:path');

function parseProviderDataDate(data, today) {
  const raw = data && data.time_last_update_utc;
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  const dataDate = parsed.toISOString().split('T')[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataDate)) return null;
  if (today && dataDate > today) return null;
  return dataDate;
}

function replaceExactlyOnce(source, needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first < 0) throw new Error(`[FX-P0] patch marker missing: ${label}`);
  const second = source.indexOf(needle, first + needle.length);
  if (second >= 0) throw new Error(`[FX-P0] patch marker duplicated: ${label}`);
  return source.slice(0, first) + replacement + source.slice(first + needle.length);
}

function patchServerSource(input) {
  let source = input;

  source = replaceExactlyOnce(
    source,
    "// 复用系统既有 UTC 业务日期口径（new Date().toISOString().split('T')[0]，与 /api/exchange-rates/refresh 一致）。\nasync function resolveInventoryCurrencyRates({ currencies, today, fetchImpl }) {",
    "// provider 快照日期以 time_last_update_utc 为准；禁止把尚未更新的昨日快照伪装成 today。\nfunction getInventoryProviderDataDate(data, today) {\n  const raw = data && data.time_last_update_utc;\n  if (!raw) return null;\n  const parsed = new Date(raw);\n  if (Number.isNaN(parsed.getTime())) return null;\n  const dataDate = parsed.toISOString().split('T')[0];\n  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(dataDate) || dataDate > today) return null;\n  return dataDate;\n}\nasync function resolveInventoryCurrencyRates({ currencies, today, fetchImpl }) {",
    'provider-date-helper'
  );

  source = replaceExactlyOnce(
    source,
    "  let fallbackMaxDate = '';      // fallback 时使用的最近成功日期（用于页面如实展示）",
    "  let fallbackMaxDate = '';      // fallback 时使用的最近成功日期（用于页面如实展示）\n  let providerDataDate = '';     // 本次 provider 返回的真实 UTC 快照日期",
    'provider-date-state'
  );

  source = replaceExactlyOnce(
    source,
    "    // 仅以【今天】作为命中条件：今天有则直接用，无则进入自动获取流程（不再静默回退到旧日期）\n    const row = queryOne('SELECT rate, rate_date FROM exchange_rates WHERE from_currency = ? AND to_currency = ? AND rate_date = ? ORDER BY created_at DESC LIMIT 1', [curr, 'RMB', today]);",
    "    // 仅命中库存自动汇率：settlement 历史 fxauto_* 行不得占用库存 daily cache。\n    const row = queryOne(\"SELECT rate, rate_date FROM exchange_rates WHERE from_currency = ? AND to_currency = ? AND rate_date = ? AND rate_type = 'realtime' AND id NOT LIKE 'fxauto_%' ORDER BY created_at DESC LIMIT 1\", [curr, 'RMB', today]);",
    'inventory-today-reader'
  );

  source = replaceExactlyOnce(
    source,
    "      const resp = await fetchImpl('https://open.er-api.com/v6/latest/CNY');\n      const data = await resp.json();\n      if (data && data.rates) {",
    "      const resp = await fetchImpl('https://open.er-api.com/v6/latest/CNY');\n      const data = await resp.json();\n      const dataDate = getInventoryProviderDataDate(data, today);\n      if (data && data.rates && dataDate) {\n        providerDataDate = dataDate;",
    'resolver-provider-date-parse'
  );

  source = replaceExactlyOnce(
    source,
    "rates[curr] = { rate: cnyToForeign, date: today, source: 'realtime' };",
    "rates[curr] = { rate: cnyToForeign, date: dataDate, source: 'realtime' };",
    'resolver-rate-date'
  );

  source = replaceExactlyOnce(
    source,
    "            // 缓存到DB（存foreignToRmb方便复用）；当天已存在则跳过，避免重复行\n            const exists = queryOne('SELECT 1 FROM exchange_rates WHERE from_currency = ? AND to_currency = ? AND rate_date = ? AND rate_type = ?', [curr, 'RMB', today, 'realtime']);\n            if (!exists) run('INSERT INTO exchange_rates (id, from_currency, to_currency, rate, rate_date, rate_type) VALUES (?, ?, ?, ?, ?, ?)',\n              [genId('rate'), curr, 'RMB', foreignToRmb, today, 'realtime']);",
    "            // 缓存到DB（存foreignToRmb方便复用）；只检查/写入 provider 的真实快照日期。\n            const exists = queryOne(\"SELECT 1 FROM exchange_rates WHERE from_currency = ? AND to_currency = ? AND rate_date = ? AND rate_type = ? AND id NOT LIKE 'fxauto_%'\", [curr, 'RMB', dataDate, 'realtime']);\n            if (!exists) run('INSERT INTO exchange_rates (id, from_currency, to_currency, rate, rate_date, rate_type) VALUES (?, ?, ?, ?, ?, ?)',\n              [genId('rate'), curr, 'RMB', foreignToRmb, dataDate, 'realtime']);",
    'resolver-cache-write'
  );

  source = replaceExactlyOnce(
    source,
    "  function applyFallback(curr) {\n    const row = queryOne('SELECT rate, rate_date FROM exchange_rates WHERE from_currency = ? AND to_currency = ? ORDER BY rate_date DESC, created_at DESC LIMIT 1', [curr, 'RMB']);",
    "  function applyFallback(curr) {\n    const row = queryOne(\"SELECT rate, rate_date FROM exchange_rates WHERE from_currency = ? AND to_currency = ? AND rate_type = 'realtime' AND id NOT LIKE 'fxauto_%' ORDER BY rate_date DESC, created_at DESC LIMIT 1\", [curr, 'RMB']);",
    'inventory-fallback-reader'
  );

  source = replaceExactlyOnce(
    source,
    "  const rate_date = usedFallback ? (fallbackMaxDate || today) : today;",
    "  const rate_date = usedFallback ? (fallbackMaxDate || today) : (providerDataDate || today);",
    'resolver-response-date'
  );

  source = replaceExactlyOnce(
    source,
    "    // 删除今天的汇率缓存\n    run('DELETE FROM exchange_rates WHERE rate_date = ? AND rate_type = ?', [today, 'realtime']);",
    "    // 先读取 provider 真快照日期，再只覆盖对应日期的库存自动汇率；避免先删 today 及误删 settlement。",
    'refresh-early-delete'
  );

  source = replaceExactlyOnce(
    source,
    "    const refreshed = {};\n    if (currencies.length > 0) {",
    "    const refreshed = {};\n    let dataDate = '';\n    if (currencies.length > 0) {",
    'refresh-date-state'
  );

  // This occurrence is now the only remaining plain refresh parser after the resolver parser was transformed above.
  source = replaceExactlyOnce(
    source,
    "        const resp = await fetch('https://open.er-api.com/v6/latest/CNY');\n        const data = await resp.json();\n        if (data && data.rates) {",
    "        const resp = await fetch('https://open.er-api.com/v6/latest/CNY');\n        const data = await resp.json();\n        dataDate = getInventoryProviderDataDate(data, today) || '';\n        if (!dataDate) return res.status(503).json({ error: '汇率供应商快照日期缺失/非法，已拒绝伪装为今日汇率' });\n        if (data && data.rates) {",
    'refresh-provider-date-parse'
  );

  source = replaceExactlyOnce(
    source,
    "              refreshed[curr] = Math.round(foreignToRmb * 1000000) / 1000000;\n              run('INSERT INTO exchange_rates (id, from_currency, to_currency, rate, rate_date, rate_type) VALUES (?, ?, ?, ?, ?, ?)',\n                [genId('rate'), curr, 'RMB', foreignToRmb, today, 'realtime']);",
    "              refreshed[curr] = foreignToRmb;\n              run(\"DELETE FROM exchange_rates WHERE from_currency = ? AND to_currency = ? AND rate_date = ? AND rate_type = 'realtime' AND id LIKE 'rate_%'\", [curr, 'RMB', dataDate]);\n              run('INSERT INTO exchange_rates (id, from_currency, to_currency, rate, rate_date, rate_type) VALUES (?, ?, ?, ?, ?, ?)',\n                [genId('rate'), curr, 'RMB', foreignToRmb, dataDate, 'realtime']);",
    'refresh-write'
  );

  source = replaceExactlyOnce(
    source,
    "    res.json({ success: true, refreshed, date: today });",
    "    res.json({ success: true, refreshed, date: dataDate || today });",
    'refresh-response-date'
  );

  return source;
}

function applyBootstrap() {
  const serverPath = path.resolve(process.cwd(), 'server.js');
  const original = fs.readFileSync(serverPath, 'utf8');
  const alreadyPatched = original.includes('function getInventoryProviderDataDate(data, today)');
  if (alreadyPatched) {
    console.log('[FX-P0] server.js already patched; bootstrap no-op');
    return { changed: false, serverPath };
  }
  const patched = patchServerSource(original);
  fs.writeFileSync(serverPath, patched, 'utf8');
  console.log('[FX-P0] applied provider-date + inventory FX isolation runtime patch');
  return { changed: true, serverPath };
}

const loadedAsNodePreload = (process.env.NODE_OPTIONS || '').includes('fx-daily-bootstrap.cjs');
if (loadedAsNodePreload) {
  // Loaded through NODE_OPTIONS --require: patch server.js before Node loads the main module.
  applyBootstrap();
}

module.exports = { parseProviderDataDate, patchServerSource, applyBootstrap };
