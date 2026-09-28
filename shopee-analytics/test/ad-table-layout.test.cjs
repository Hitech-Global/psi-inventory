'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const styles = fs.readFileSync(path.join(__dirname, '..', 'web', 'styles.css'), 'utf8');

assert(styles.includes('#adsManualPanel .product-ads-table-wrap table,\n#adsGroupImportPanel .table-wrap table{width:max-content;min-width:100%;table-layout:auto}'), 'ad tables must expand horizontally instead of compressing columns');
assert(styles.includes('#adsGroupImportPanel .table-wrap td{min-width:96px}'), 'ad metric cells need a readable minimum width');
assert(styles.includes('#adsGroupImportPanel .table-wrap td:first-child{width:320px;min-width:320px;max-width:320px}'), 'ad info column needs a bounded readable width');
assert(styles.includes('#adsGroupImportPanel .campaign-name strong{display:-webkit-box;overflow:hidden'), 'long ad names must be clipped inside the first column');
assert(styles.includes('-webkit-line-clamp:2;white-space:normal;overflow-wrap:anywhere'), 'long ad names must wrap to at most two lines');

console.log('ad table anti-overlap layout contract: ok');