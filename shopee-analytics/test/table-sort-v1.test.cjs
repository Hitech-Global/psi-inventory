'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const sorter = read('web/table-sort-v1.js');
const server = read('src/standalone-server.js');

for (const token of ['▲','▼','data-sort-dir="asc"','data-sort-dir="desc"','MutationObserver','dataset.sortDetail','dataset.sortGroup']) {
  assert(sorter.includes(token), `missing sorter contract ${token}`);
}
assert(sorter.includes("table thead th:not([data-no-sort])"), 'all tables must be sortable unless explicitly opted out');
assert(server.includes("'/table-sort-v1.js'"), 'sorter must be loaded by standalone app');
console.log('Shopee-style table sort contract: ok');
