'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('inventory import client assets use cache-busted script URLs', () => {
  const expected = [
    ['i18n.js', /<script src="i18n\.js\?v=[^"]+"><\/script>/],
    ['assets/inv-import-rules.js', /<script src="assets\/inv-import-rules\.js\?v=[^"]+"><\/script>/],
    ['app.js', /<script src="app\.js\?v=[^"]+"><\/script>/],
    ['assets/bigseller-inventory-import.js', /<script src="assets\/bigseller-inventory-import\.js\?v=[^"]+"><\/script>/]
  ];

  for (const [name, pattern] of expected) {
    assert.match(html, pattern, name + ' must be cache-busted so clients receive the latest import behavior');
  }
});
