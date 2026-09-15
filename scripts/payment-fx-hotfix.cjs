'use strict';

/**
 * Payment FX production hotfix.
 *
 * Goals:
 * 1) Keep settlement FX exact-date only (never use a prior/stale business day).
 * 2) If Frankfurter has not published the requested same-day snapshot yet, try
 *    Open Exchange Rate API's latest USD snapshot and accept it ONLY when its own
 *    time_last_update_utc resolves to the exact requested UTC date. Cross rates
 *    are derived from that single same-date snapshot.
 * 3) Make /api/payment-requests/:id/payment-fx/resolve return JSON for every
 *    failure path so the browser never misreports an HTML 500 as "server not running".
 *
 * Render runs this from npm postinstall. The transformation is deterministic,
 * idempotent and fail-closed: if any source marker drifts, the build fails and
 * the previous production deploy stays live.
 */

const fs = require('node:fs');
const path = require('node:path');

const HOTFIX_MARKER = 'PAY-FX-HOTFIX: exact-date secondary provider';

function replaceExactlyOnce(source, needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first < 0) throw new Error(`[PAY-FX-HOTFIX] patch marker missing: ${label}`);
  const second = source.indexOf(needle, first + needle.length);
  if (second >= 0) throw new Error(`[PAY-FX-HOTFIX] patch marker duplicated: ${label}`);
  return source.slice(0, first) + replacement + source.slice(first + needle.length);
}

function patchPaymentFxSource(input) {
  if (input.includes(HOTFIX_MARKER)) return input;
  let source = input;

  // Cover the entire resolve route with its existing catch, including request/date/DB setup.
  source = replaceExactlyOnce(
    source,
    "app.post('/api/payment-requests/:id/payment-fx/resolve', requireApiPermission('payment_approve', 'payment_execute'), asyncHandler(async (req, res) => {\n  var rateDate = String((req.body || {}).rate_date || '').trim();",
    "app.post('/api/payment-requests/:id/payment-fx/resolve', requireApiPermission('payment_approve', 'payment_execute'), asyncHandler(async (req, res) => {\n  try {\n  var rateDate = String((req.body || {}).rate_date || '').trim();",
    'route-outer-try'
  );

  source = replaceExactlyOnce(
    source,
    "  try {\n    var country = resolveSettlementCountry(payment);",
    "    var country = resolveSettlementCountry(payment);",
    'remove-inner-try'
  );

  // Preserve exact-date semantics. Open ER is accepted only if the provider's own
  // UTC snapshot date exactly matches rateDate; otherwise we keep the blocker.
  // Use USD as the stable public base and derive from->to from one identical snapshot.
  source = replaceExactlyOnce(
    source,
    "  if (!providerRate || !(providerRate > 0) || providerDate !== rateDate) {\n    throw new SettlementError(400, '缺少 ' + rateDate + ' ' + fromCurrency + '→' + toCurrency + ' 的 realtime 付款汇率');\n  }\n  var cacheId = 'fxauto_' + rateDate + '_' + fromCurrency + '_' + toCurrency + '_' + SETTLEMENT_RATE_TYPE;",
    "  // PAY-FX-HOTFIX: exact-date secondary provider. Never accept a stale snapshot.\n  if (!providerRate || !(providerRate > 0) || providerDate !== rateDate) {\n    try {\n      var secondaryResp = await fetch('https://open.er-api.com/v6/latest/USD', { signal: AbortSignal.timeout(abortMs) });\n      if (secondaryResp.ok) {\n        var secondaryData = await secondaryResp.json();\n        var secondaryRawDate = secondaryData && secondaryData.time_last_update_utc;\n        var secondaryParsedDate = secondaryRawDate ? new Date(secondaryRawDate) : null;\n        var secondaryDate = secondaryParsedDate && !Number.isNaN(secondaryParsedDate.getTime())\n          ? secondaryParsedDate.toISOString().split('T')[0]\n          : null;\n        var secondaryRates = secondaryData && secondaryData.rates ? secondaryData.rates : null;\n        var secondaryFromUsd = apiFrom === 'USD' ? 1 : Number(secondaryRates && secondaryRates[apiFrom]);\n        var secondaryToUsd = apiTo === 'USD' ? 1 : Number(secondaryRates && secondaryRates[apiTo]);\n        var secondaryRate = secondaryFromUsd > 0 && secondaryToUsd > 0 ? (secondaryToUsd / secondaryFromUsd) : 0;\n        if (secondaryDate === rateDate && secondaryRate > 0) {\n          providerRate = secondaryRate;\n          providerDate = secondaryDate;\n        }\n      }\n    } catch (secondaryErr) {\n      // Secondary provider unavailable/invalid -> retain strict exact-date blocker below.\n    }\n  }\n  if (!providerRate || !(providerRate > 0) || providerDate !== rateDate) {\n    throw new SettlementError(400, '缺少 ' + rateDate + ' ' + fromCurrency + '→' + toCurrency + ' 的 realtime 付款汇率');\n  }\n  var cacheId = 'fxauto_' + rateDate + '_' + fromCurrency + '_' + toCurrency + '_' + SETTLEMENT_RATE_TYPE;",
    'secondary-provider'
  );

  // The front-end api() expects JSON. Unexpected route errors must not fall through
  // to Express' HTML 500 handler, which previously produced the misleading message
  // "服务器返回了非 JSON 响应，可能后端服务未正常启动".
  source = replaceExactlyOnce(
    source,
    "  } catch (e) {\n    if (e.name === 'SettlementError') {\n      return res.status(400).json({ error: e.message, blocker: true });\n    }\n    throw e;\n  }\n}));",
    "  } catch (e) {\n    if (e && e.name === 'SettlementError') {\n      return res.status(Number(e.status) || 400).json({ error: e.message, blocker: true });\n    }\n    console.error('[PAY-FX-RESOLVE] unexpected error', {\n      request_id: req.params.id,\n      rate_date: (typeof rateDate === 'string' ? rateDate : ''),\n      name: e && e.name,\n      message: e && e.message\n    });\n    return res.status(Number(e && e.status) || 500).json({\n      error: '付款日汇率解析失败：' + ((e && e.message) || '未知错误'),\n      blocker: true\n    });\n  }\n}));",
    'json-error-boundary'
  );

  return source;
}

function applyHotfix() {
  const serverPath = path.resolve(process.cwd(), 'server.js');
  const original = fs.readFileSync(serverPath, 'utf8');
  if (original.includes(HOTFIX_MARKER)) {
    console.log('[PAY-FX-HOTFIX] server.js already patched; no-op');
    return { changed: false, serverPath };
  }
  const patched = patchPaymentFxSource(original);
  fs.writeFileSync(serverPath, patched, 'utf8');
  console.log('[PAY-FX-HOTFIX] applied exact-date fallback + JSON error boundary');
  return { changed: true, serverPath };
}

if (require.main === module) {
  // Do not dirty ordinary developer worktrees on npm install.
  if (process.env.NODE_ENV === 'production' || process.env.RENDER) applyHotfix();
  else console.log('[PAY-FX-HOTFIX] non-production install; skipped');
}

module.exports = { HOTFIX_MARKER, patchPaymentFxSource, applyHotfix };
