'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'assets/ci-summary-compact.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

assert.match(script, /运营采购金额/);
assert.match(script, /历史采购金额/);
assert.match(script, /采购金额合计/);
assert.match(script, /Total Procurement Amount by Currency/);
assert.match(script, /Total Purchase Amount/);
assert.match(script, /matchesLabelText/);
assert.match(script, /characterData: true/);
assert.match(script, /Historical Purchase Amount/);
assert.match(script, /Operational Purchase Amount/);
assert.match(script, /psi-ci-summary-hidden/);
assert.match(script, /psi-ci-summary-total/);
assert.match(script, /MutationObserver/);
assert.match(script, /getBoundingClientRect/);
assert.match(html, /assets\/ci-summary-compact\.js\?v=/);

// The display-only adapter must not rewrite financial amounts or replace page markup.
assert.doesNotMatch(script, /\.innerHTML\s*=/);
assert.doesNotMatch(script, /(?:node|card|labelNode|descendants\[[^\]]+\])\.textContent\s*=/);
assert.doesNotMatch(script, /\.innerText\s*=/);
assert.doesNotMatch(script, /fetch\s*\(/);
assert.doesNotMatch(script, /XMLHttpRequest/);

console.log('CI compact procurement summary source contract: PASS');
