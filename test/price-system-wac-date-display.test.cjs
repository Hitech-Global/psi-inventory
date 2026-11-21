'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('WAC-synced Landing Cost displays only its date in a lighter compact style', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'assets', 'price-system.js'), 'utf8');
  assert.match(source, /const rawDate=lc&&\(lc\.last_inbound_date\|\|lc\.confirmed_at\)\|\|''/);
  assert.match(source, /const wacDate=String\(rawDate\)\.slice\(0,10\)/);
  assert.match(source, /ps-landing-meta\{font-size:9px;line-height:1\.3;color:#a1a1a6;margin-top:1px\}/);
  assert.doesNotMatch(source, /lc\.warehouse,lc\.ci_no/);
});
