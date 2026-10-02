'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ui = fs.readFileSync(path.join(__dirname, '..', 'web', 'ad-group-import-async.js'), 'utf8');
const pickerV2 = fs.readFileSync(path.join(__dirname, '..', 'web', 'date-range-picker-v2.js'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '..', 'src', 'standalone-server.js'), 'utf8');

for (const label of ['本月', '上月', '今天', '昨天', '近7天', '近30天', '近半年']) {
  assert(ui.includes(`>${label}<`), `date preset ${label} must exist`);
}
assert(ui.includes("startLabel.classList.add('date-source-hidden')"), 'legacy start date field must be visually hidden');
assert(ui.includes("endLabel.classList.add('date-source-hidden')"), 'legacy end date field must be visually hidden');
assert(ui.includes('id="dateRangeButton"'), 'single date range trigger must exist');
assert(ui.includes('id="dateRangePopover"'), 'custom range popover must exist');
assert(ui.includes("$('#startDate')"), 'date range UI must preserve startDate contract');
assert(ui.includes("$('#endDate')"), 'date range UI must preserve endDate contract');
assert(pickerV2.includes('id="dateCalendarLeft"') && pickerV2.includes('id="dateCalendarRight"'), 'v2 date picker must render two month calendars');
assert(pickerV2.includes('date-picker-presets'), 'quick ranges must move into the left-side preset rail');
assert(pickerV2.includes('let awaitingRangeEnd = false'), 'calendar must support first-click single-day selection');
assert(pickerV2.includes('draftStart = value;\n      draftEnd = value;\n      awaitingRangeEnd = true;'), 'first day click must immediately form a valid single-day range');
assert(pickerV2.includes('event.stopPropagation()'), 'calendar clicks must not bubble into the outside-click reset handler');
assert(pickerV2.includes("new CustomEvent('shopee-date-range-changed'"), 'committed date changes must notify all data panels');
assert(ui.includes('Date range UI is owned exclusively by date-range-picker-v2.js.'), 'legacy ad-group date picker must stay disabled');
assert(!ui.includes('  enhanceDateRangeFilter();'), 'legacy date picker must not initialize alongside v2');
for (const label of ['本月', '上月', '今天', '昨天', '近7天', '近30天', '近半年']) assert(pickerV2.includes(`>${label}<`));
assert(server.includes('/date-range-picker-v2.js'), 'standalone server must load the double-month picker override');

console.log('compact date range filter tests: ok');
