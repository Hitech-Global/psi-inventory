'use strict';
const assert = require('node:assert/strict');
const { patchIndexSource, MARKER } = require('../scripts/logistics-create-mac-hotfix.cjs');

const html = '<!doctype html><html><head><style>.base{color:#111}</style></head><body></body></html>';
const once = patchIndexSource(html);
const twice = patchIndexSource(once);
const patch = once.slice(once.indexOf(MARKER));

assert.equal(twice, once, 'logistics create Mac style patch must be idempotent');
assert.match(once, /LOGISTICS-CREATE-MAC-STYLE-V1/);
assert.match(once, /\.modal-ci-create:has\(#npl-no\)/, 'must target logistics create form');
assert.match(once, /selectCIForPL/, 'must target CI-selection step too');
assert.match(once, /#pl-drop-zone/, 'PL import drop zone should be styled');
assert.match(once, /#ci-readonly-costs/, 'readonly CI cost block should be styled');
assert.match(once, /\.data-table th[^{]*\{[^}]*text-align:left!important/s, 'selection/detail table headers should be left aligned');
assert.match(once, /\.data-table td[^{]*\{[^}]*text-align:left!important/s, 'selection/detail table cells should be left aligned');
assert.match(once, /Pure CSS: no API, listener, timer or render-path change/);
assert.doesNotMatch(patch, /addEventListener|setTimeout|setInterval|fetch\(|api\(/, 'style patch must not add runtime work');

console.log('logistics-create-mac hotfix: PASS');
