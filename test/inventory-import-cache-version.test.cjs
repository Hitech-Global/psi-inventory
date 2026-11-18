'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

test('inventory import assets use deployment-time or explicit cache-busting', () => {
  assert.match(html, /<script src="i18n\.js"><\/script>/, 'i18n.js must use deployment-time cache busting');
  assert.match(html, /<script src="app\.js"><\/script>/, 'app.js must use deployment-time cache busting');
  assert.match(server, /const cacheBust = APP_COMMIT \? APP_COMMIT\.slice\(0, 12\)/, 'server must inject the deployed commit into core frontend asset URLs');

  const explicitVersions = [
    ['assets/inv-import-rules.js', /<script src="assets\/inv-import-rules\.js\?v=[^"]+"><\/script>/],
    ['assets/bigseller-inventory-import.js', /<script src="assets\/bigseller-inventory-import\.js\?v=[^"]+"><\/script>/]
  ];
  for (const [name, pattern] of explicitVersions) {
    assert.match(html, pattern, name + ' must retain its explicit asset version');
  }
});
