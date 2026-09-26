'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ui = fs.readFileSync(path.join(__dirname, '..', 'web', 'ad-group-import-async.js'), 'utf8');

for (const label of ['本月', '上月', '今天', '昨天', '近7天', '近30天', '近半年']) {
  assert(ui.includes(`>${label}<`), `date preset ${label} must exist`);
}
assert(ui.includes("startLabel.classList.add('date-source-hidden')"), 'legacy start date field must be visually hidden');
assert(ui.includes("endLabel.classList.add('date-source-hidden')"), 'legacy end date field must be visually hidden');
assert(ui.includes('id="dateRangeButton"'), 'single date range trigger must exist');
assert(ui.includes('id="dateRangePopover"'), 'custom range popover must exist');
assert(ui.includes("$('#startDate')"), 'date range UI must preserve startDate contract');
assert(ui.includes("$('#endDate')"), 'date range UI must preserve endDate contract');

console.log('compact date range filter tests: ok');
