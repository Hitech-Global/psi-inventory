'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { generatePONumber, countryCode } = require('../po-number');

const countryCases = [
  ['Indonesia', 'ID'], ['印度尼西亚', 'ID'], ['印度尼西亚共和国', 'ID'], ['印尼', 'ID'], ['ID', 'ID'],
  ['Thailand', 'TH'], ['泰国', 'TH'], ['泰王国', 'TH'], ['TH', 'TH'],
  ['Malaysia', 'MY'], ['马来西亚', 'MY'], ['马来西亚联邦', 'MY'], ['马来', 'MY'], ['MY', 'MY'],
  ['China', 'CN'], ['中国', 'CN'], ['CN', 'CN'],
  ['Singapore', 'SG'], ['新加坡', 'SG'], ['SG', 'SG'],
  ['Vietnam', 'VN'], ['越南', 'VN'], ['VN', 'VN'],
  ['Philippines', 'PH'], ['菲律宾', 'PH'], ['PH', 'PH'],
  ['United States', 'US'], ['美国', 'US'], ['US', 'US'],
  ['United Kingdom', 'GB'], ['英国', 'GB'], ['GB', 'GB'],
  ['Australia', 'AU'], ['澳大利亚', 'AU'], ['AU', 'AU'],
  ['Japan', 'JP'], ['日本', 'JP'], ['JP', 'JP'],
  ['South Korea', 'KR'], ['韩国', 'KR'], ['KR', 'KR'],
  ['Taiwan', 'TW'], ['台湾', 'TW'], ['TW', 'TW'],
  ['India', 'IN'], ['印度', 'IN'], ['IN', 'IN'],
  ['Germany', 'DE'], ['德国', 'DE'], ['DE', 'DE'],
  ['France', 'FR'], ['法国', 'FR'], ['FR', 'FR'],
  ['Netherlands', 'NL'], ['荷兰', 'NL'], ['NL', 'NL'],
  ['United Arab Emirates', 'AE'], ['阿联酋', 'AE'], ['AE', 'AE']
];

for (const [name, code] of countryCases) {
  assert.equal(countryCode(name), code, 'country alias should resolve: ' + name);
}
assert.equal(countryCode('  mAlAySiA  '), 'MY');
assert.equal(countryCode('ＭＹ'), 'MY');

assert.equal(generatePONumber('Indonesia', '2026-11-03', 1793697665123), 'PO-20261103-ID-97665123');
assert.equal(generatePONumber('印度尼西亚', '2026-11-03', 1793697665123), 'PO-20261103-ID-97665123');
assert.equal(generatePONumber('马来西亚', '2026-11-03', 1793697665123), 'PO-20261103-MY-97665123');
assert.equal(generatePONumber('MY', '2026-11-03', 1793697665123), 'PO-20261103-MY-97665123');
assert.match(generatePONumber('泰国', '2026-11-03', 1793697665123), /^PO-20261103-TH-\d{8}$/);

assert.throws(() => generatePONumber('Unknownland', '2026-11-03', 1), /无法识别国家缩写/);
assert.throws(() => generatePONumber('Indonesia', '03/11/2026', 1), /PO日期格式无效/);
assert.throws(() => generatePONumber('Indonesia', '2026-02-31', 1), /PO日期格式无效/);

// Both PO creation APIs must keep using the same country-normalizing number helper.
const poPlanServer = fs.readFileSync(path.join(__dirname, '../po-plan-server.js'), 'utf8');
const mainServer = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
assert.match(poPlanServer, /app\.post\(['"]\/api\/po-plans['"]/);
assert.match(poPlanServer, /generatePONumber\(country\s*,\s*poDate\)/);
assert.match(mainServer, /app\.post\(['"]\/api\/purchase-orders['"]/);
assert.match(mainServer, /generatePONumber\(d\.country\s*\|\|\s*''\s*,\s*poDate\)/);

console.log('po-number-date-country: PASS');
