'use strict';
const assert = require('node:assert/strict');
const { generatePONumber, countryCode } = require('../po-number');

assert.equal(countryCode('Indonesia'), 'ID');
assert.equal(countryCode('Thailand'), 'TH');
assert.equal(countryCode('Malaysia'), 'MY');
assert.equal(countryCode('ID'), 'ID');
assert.equal(generatePONumber('Indonesia', '2026-11-03', 1793697665123), 'PO-20261103-ID-97665123');
assert.match(generatePONumber('Thailand', '2026-11-03', 1793697665123), /^PO-20261103-TH-\d{8}$/);
assert.throws(() => generatePONumber('Unknownland', '2026-11-03', 1), /无法识别国家缩写/);
assert.throws(() => generatePONumber('Indonesia', '03/11/2026', 1), /PO日期格式无效/);
console.log('po-number-date-country: PASS');
