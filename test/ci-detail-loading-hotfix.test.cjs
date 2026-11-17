'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { patchAppSource, patchIndexSource, APP_MARKER } = require('../scripts/ci-detail-loading-hotfix.cjs');

const app = `async function viewCI(id, backPay, backMode){
  try{const ci=await api('/api/commercial-invoices/'+id);
    openModal('detail','body');
  }catch(e){showToast(e.message,'danger')}
}
// ==================== CI/PL × 物流合并 PHASE A（前端）====================
`;

const once = patchAppSource(app);
const twice = patchAppSource(once);
assert.equal(twice, once, 'CI loading app patch must be idempotent');
assert.ok(once.includes(APP_MARKER), 'loading marker must be installed');
assert.ok(once.indexOf('openModal(__ciLang') < once.indexOf("api('/api/commercial-invoices/'+id)"), 'loading modal must open before the CI API request');
assert.match(once, /data-request-id=/, 'loading shell must carry a request token');
assert.match(once, /classList\.contains\('show'\)/, 'stale requests must not reopen a closed modal');
assert.match(once, /function retryCIDetail\(\)/, 'failed requests must expose a retry action');
assert.match(once, /Unable to load CI details/, 'error state must be explicit');
assert.match(once, /Memuat detail CI/, 'Bahasa loading text must be available');
assert.match(once, /Gagal memuat detail CI/, 'Bahasa error text must be available');
new Function('window','document','getLang','openModal','api','showToast','esc',once);

const html = '<!doctype html><html><head><style>.base{color:#111}</style><script src="app.js?v=old"></script></head><body></body></html>';
const htmlOnce = patchIndexSource(html);
const htmlTwice = patchIndexSource(htmlOnce);
assert.equal(htmlTwice, htmlOnce, 'CI loading CSS patch must be idempotent');
assert.match(htmlOnce, /CI-DETAIL-LOADING-STYLE-V1/);
assert.match(htmlOnce, /ciDetailSpin/);
assert.match(htmlOnce, /prefers-reduced-motion/);
assert.match(htmlOnce, /ci-detail-error-card/);
assert.match(htmlOnce, /app\.js\?v=20261117-4/, 'app.js URL must be cache-busted for the patched frontend');

const repoRoot = path.join(__dirname, '..');
const liveApp = fs.readFileSync(path.join(repoRoot, 'app.js'), 'utf8');
const liveIndex = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
assert.ok(liveApp.includes(APP_MARKER), 'the immediate loading state must be installed in the live CI detail handler');
assert.match(liveApp, /window\.__ciDetailRetry=/, 'the live handler must retain a retry target');
assert.ok(liveIndex.includes('CI-DETAIL-LOADING-STYLE-V1'), 'the live loading skeleton styles must be installed');
assert.match(liveIndex, /app\.js\?v=20261117-4/, 'the live CI detail handler must be cache-busted');

console.log('ci-detail-loading hotfix: PASS');
