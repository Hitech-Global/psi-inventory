'use strict';
const assert = require('node:assert/strict');
const { patchIndexSource, MARKER } = require('../scripts/ci-detail-mac-hotfix.cjs');

const html = '<!doctype html><html><head><style>.base{color:#111}</style></head><body></body></html>';
const once = patchIndexSource(html);
const twice = patchIndexSource(once);

assert.equal(twice, once, 'CI detail style patch must be idempotent');
assert.match(once, /CI-DETAIL-MAC-STYLE-V1/);
assert.match(once, /\.modal-ci-create:has\(#ci-acc-items\)/, 'must scope style to operational CI detail');
assert.match(once, /\.data-table th\{[^}]*text-align:left!important/s, 'detail table headers must be left aligned');
assert.match(once, /\.data-table td\{[^}]*text-align:left!important/s, 'detail table cells must be left aligned');
assert.match(once, /\.data-table \.text-right,[\s\S]*\.data-table \.text-center,[\s\S]*text-align:left!important/, 'right/center helper classes must be overridden inside CI detail');
assert.match(once, /Pure CSS: no API, listener, timer or render-path change/);
assert.doesNotMatch(once.slice(once.indexOf(MARKER)), /addEventListener|setTimeout|setInterval|fetch\(|api\(/, 'style patch must not add runtime work');

console.log('ci-detail-mac hotfix: PASS');
