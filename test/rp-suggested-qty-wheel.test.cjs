'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const start = app.indexOf("Cols.target_stock={");
const end = app.indexOf("Cols.last_inbound_date={", start);
assert(start >= 0 && end > start, 'suggested purchase quantity column source must exist');
const source = app.slice(start, end);
const match = source.match(/<input type="number" class="rp-target-stock-input"[\s\S]*?>/);
assert(match, 'suggested purchase quantity must remain a numeric input');
assert.match(match[0], /onwheel="this\.blur\(\)"/, 'wheel over the focused quantity input must blur it before native number stepping');
assert.match(match[0], /oninput="onChannelTargetStockInput\(this\)"/, 'manual input handler must remain unchanged');
assert.match(match[0], /onchange="onChannelTargetStockChange\(this\)"/, 'save-on-change handler must remain unchanged');
assert.match(match[0], /data-rid=/, 'row binding must remain unchanged');
assert.match(match[0], /data-channel=/, 'channel binding must remain unchanged');
console.log('rp-suggested-qty-wheel: PASS');
