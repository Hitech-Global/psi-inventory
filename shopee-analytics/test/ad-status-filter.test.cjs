'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

const index = read('web/index.html');
const ui = read('web/product-card-ui-v2.js');
const app = read('web/app.js');
const i18n = read('web/i18n-v1.js');
const styles = read('web/styles.css');

assert(index.includes('class="ads-filter-toolbar"'));
assert(index.indexOf('ads-type-tabs') < index.indexOf('adStatusFilter'), 'status filter must sit to the right of ad type tabs');
for (const status of ['all', 'ongoing', 'paused', 'ended', 'deleted']) {
  assert(index.includes(`data-ad-status="${status}"`), `missing filter ${status}`);
}
assert(ui.includes('function normalizeAdStatus(value)'));
assert(ui.includes("'closed'"), 'Shopee closed status must normalize into ended');
assert(ui.includes('function applyAdStatusFilter(type = activeType())'));
assert(ui.includes('data-ad-status="${normalizeAdStatus(row.status)}"'), 'manual ads must expose normalized status');
assert(ui.includes('data-ad-status="${normalizeAdStatus(row.campaign_status)}"'), 'ad groups must expose normalized status');
assert(ui.includes("applyAdListFilters(type)") && ui.includes("applyAdListFilters('groups')"), 'manual/groups must use the unified status + link-search filter');
assert(ui.includes("$('#adStatusFilter')?.classList.toggle('hidden', type === 'auto')"));
assert(!ui.includes("$$$('.ads-type-tab')"), 'Product Card hierarchy must not call an undefined selector helper');
assert(ui.includes("$$('.ads-type-tab').forEach(button => button.addEventListener('click'"), 'ad tabs must bind with the multi-element selector helper');
assert(styles.includes('.ad-status-option.active') && styles.includes('.status-dot.ongoing'));
assert(i18n.includes("const adStatus = document.querySelector('.ad-status-option.active')"));
assert(app.includes('saved.adStatus') && app.includes("adStatusHost.dataset.adStatusValue = adStatus"));
assert(i18n.includes("['进行中', 'Ongoing']") && i18n.includes("['已删除', 'Deleted']"));
console.log('shared Single Product Ad / Ad Group status filter contract: ok');
