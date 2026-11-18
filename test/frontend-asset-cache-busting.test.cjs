'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const logisticsHotfix = fs.readFileSync(path.join(root, 'scripts/logistics-detail-loading-hotfix.cjs'), 'utf8');

// Keep these core scripts unversioned in the source HTML. sendNoCacheHtml()
// injects the current deployed commit into their URLs on every deployment.
assert.match(html, /<script src="i18n\.js"><\/script>/);
assert.match(html, /<script src="app\.js"><\/script>/);
assert.doesNotMatch(html, /<script src="(?:i18n|app)\.js\?v=/);
assert.match(server, /const cacheBust = APP_COMMIT \? APP_COMMIT\.slice\(0, 12\)/);
assert.match(server, /if \(src\.indexOf\('\?v='\) !== -1\) return m/);
assert.ok(logisticsHotfix.includes("out = out.replace(appScriptPattern, '<script src=\"app.js\"></script>');"), 'postinstall must leave app.js unversioned for deployment cache busting');
assert.doesNotMatch(logisticsHotfix, /APP_CACHE_VERSION/, 'postinstall must not restore a pinned core asset version');

console.log('frontend core asset cache-busting: PASS');
