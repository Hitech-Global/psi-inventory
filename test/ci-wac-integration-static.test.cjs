'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const app = path.join(root, 'app.js');
const server = path.join(root, 'server.js');
const index = path.join(root, 'index.html');
const ciLogistics = path.join(root, 'ci-list-inline-logistics.js');
const integration = path.join(root, 'assets', 'ci-wac-integration.js');
const patch = path.join(root, 'scripts', 'ci-wac-summary-hotfix.cjs');

for (const file of [app, ciLogistics, integration, patch]) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
}

// CI regression jobs install dependencies with --ignore-scripts. Apply the same
// idempotent source patch explicitly before validating the backend.
execFileSync(process.execPath, [patch], { stdio: 'pipe' });
execFileSync(process.execPath, ['--check', server], { stdio: 'pipe' });

const ciSrc = fs.readFileSync(ciLogistics, 'utf8');
const integrationSrc = fs.readFileSync(integration, 'utf8');
const serverSrc = fs.readFileSync(server, 'utf8');
const indexSrc = fs.readFileSync(index, 'utf8');

assert.ok(ciSrc.includes('wacActionsHtml(b, ciId)'), 'CI logistics rows must render WAC actions beside edit');
assert.ok(ciSrc.includes('data-ci-logi-wac-confirm'), 'pending batches must expose WAC confirmation action');
assert.ok(ciSrc.includes('data-ci-logi-wac-exclude'), 'pending batches must expose no-calculation action');
assert.ok(ciSrc.includes('data-ci-logi-wac-restore'), 'excluded batches must expose restore action');
assert.ok(ciSrc.includes('data-ci-logi-wac-cc'), 'confirmed batches must retain the supplemental CC action');
assert.ok(ciSrc.includes('data-ci-logi-row'), 'clicking a logistics row must open the combined detail');
assert.ok(ciSrc.includes('refreshCIListLogistics'), 'CI logistics panel must support a targeted refresh');

assert.ok(integrationSrc.includes('viewLogWacDetail'), 'combined logistics/WAC detail entry missing');
assert.ok(integrationSrc.includes('installWacApiTimeouts'), 'WAC read requests must have timeout protection');
assert.ok(integrationSrc.includes('__ciWacApiTimeoutWrapped'), 'WAC API timeout wrapper must install only once');
assert.ok(integrationSrc.includes('WAC预览加载超时'), 'WAC preview timeout must explain that confirmation was not submitted');
assert.ok(integrationSrc.includes('wacDetailBusy'), 'WAC detail loading must reject duplicate in-flight actions');
const submitWrapperStart = integrationSrc.indexOf('var originalSubmitWacConfirm = global.submitWacConfirm;');
const submitWrapperEnd = integrationSrc.indexOf('function hideLegacyWacPage()', submitWrapperStart);
const submitWrapperSrc = integrationSrc.slice(submitWrapperStart, submitWrapperEnd);
assert.ok(submitWrapperSrc.includes('wacSubmitBusy'), 'WAC confirmation must block duplicate submissions');
assert.ok(submitWrapperSrc.includes('wac.submitting'), 'WAC confirmation must show a submitting state');
assert.ok(submitWrapperSrc.includes('global.__ciWacConfirmSubmitted'), 'CI refresh must only run after a successful WAC commit');
assert.ok(submitWrapperSrc.includes('noOpLoadWacPending'), 'Integrated CI confirmation must skip the hidden legacy WAC-list refresh');
assert.ok(submitWrapperSrc.includes('setTimeout(function ()'), 'CI logistics refresh must run asynchronously after WAC commit');
assert.ok(!submitWrapperSrc.includes('await global.refreshCIListLogistics(ciId)'), 'WAC submit must not wait for CI list refresh');
assert.ok(integrationSrc.includes('wac.refresh_timeout'), 'CI logistics refresh GET must have a timeout fallback');
assert.ok(indexSrc.includes('assets/ci-wac-integration.js?v=20261113-4'), 'WAC submit integration must use the latest cache-busted asset');
assert.ok(ciSrc.includes('runWacDetailAction'), 'WAC row actions must show loading state');
assert.ok(ciSrc.includes('data-wac-loading'), 'WAC row actions must prevent duplicate clicks while loading');
assert.ok(integrationSrc.includes('renderLogisticsDetail'), 'logistics detail content must be embedded in WAC detail');
assert.ok(integrationSrc.includes('wacMeta.shared_freight_breakdown'), 'shared freight allocation must be visible in logistics batch detail');
assert.ok(integrationSrc.includes('合并运费分摊（已计入WAC）'), 'shared freight section must clearly distinguish allocated common bills');
assert.ok(integrationSrc.includes("\"合并运费分摊（已计入WAC）\":\"Shared Freight Allocation (Included in WAC)\""), 'missing English translation for 合并运费分摊（已计入WAC）');
assert.ok(integrationSrc.includes("\"上方费用为物流批次自身录入费用；合并账单按原分摊比例折算为目标本币后，在此单独列示。\":\"The costs above are entered directly on this logistics batch. Shared bills are converted to the target local currency using their original allocation ratios and shown separately here.\""), 'missing English translation for 上方费用为物流批次自身录入费用；合并账单按原分摊比例折算为目标本币后，在此单独列示。');
assert.ok(integrationSrc.includes("\"本批合并运费分摊合计\":\"Total Shared Freight Allocated to This Batch\""), 'missing English translation for 本批合并运费分摊合计');
assert.ok(integrationSrc.includes("\"最后实际付款日期\":\"Last Actual Payment Date\""), 'missing English translation for 最后实际付款日期');
assert.ok(integrationSrc.includes("\"CI商品成本汇率\":\"CI Goods Cost FX Rate\""), 'missing English translation for CI商品成本汇率');
assert.ok(integrationSrc.includes("\"合并账单\":\"Shared Freight Bill\""), 'missing English translation for 合并账单');
assert.ok(integrationSrc.includes("\"分摊依据\":\"Allocation Basis\""), 'missing English translation for 分摊依据');
assert.ok(integrationSrc.includes("\"本批分摊金额\":\"Amount Allocated to This Batch\""), 'missing English translation for 本批分摊金额');
assert.ok(integrationSrc.includes("\"实际付款及汇率快照\":\"Actual Payments and FX Snapshots\""), 'missing English translation for 实际付款及汇率快照');
assert.ok(integrationSrc.includes('renderLogisticsDetail(log, plData, wacMeta)'), 'WAC preview metadata must be passed into logistics detail');
assert.ok(integrationSrc.includes('submitCIWacExclude'), 'CI no-calculation submission missing');
assert.ok(integrationSrc.includes('submitCIWacRestore'), 'CI WAC restore submission missing');
assert.ok(integrationSrc.includes('openWacCcFromCI'), 'confirmed-batch CC entry missing');
assert.ok(integrationSrc.includes("page === 'inbound'"), 'legacy WAC page route must redirect');
assert.ok(integrationSrc.includes("data-page=\"inbound\""), 'legacy WAC navigation entry must be hidden');

const notificationPos = indexSrc.indexOf('<script src="wac-notification-ui.js"></script>');
const integrationPos = indexSrc.indexOf('assets/ci-wac-integration.js');
assert.ok(notificationPos >= 0 && integrationPos > notificationPos,
  'CI WAC integration must load after WAC notification UI');
assert.ok(indexSrc.includes('ci-list-inline-logistics.js'), 'CI logistics list module must remain loaded');
assert.ok(indexSrc.includes('assets/wac-blocked-import-controls.js?v=20261113-2'), 'blocked WAC import controls must use the latest cache-busted asset');

assert.ok(serverSrc.includes('CI-WAC-STATUS-IN-CI-LOGISTICS-20261110'), 'CI logistics endpoint WAC status projection missing');
assert.ok(serverSrc.includes('CI-WAC-SUMMARY-PROJECTION-20261110'), 'CI WAC summary helper missing');
assert.ok(serverSrc.includes('refreshCIWacSummary(meta.ci_id || ci.id)'), 'WAC confirm must recompute CI completion');
assert.ok(serverSrc.includes('CI-WAC-EXCLUSION-SUMMARY-20261110'), 'WAC exclusion must recompute CI completion');
assert.ok(serverSrc.includes('CI-WAC-RESTORE-SUMMARY-20261110'), 'WAC restore must reopen CI completion');
assert.ok(serverSrc.includes('CI-WAC-OPS-GET-SUMMARY-20261110'), 'ops-prep read must use current batch-level WAC state');
assert.ok(serverSrc.includes('CI-WAC-OPS-POST-SUMMARY-20261110'), 'ops-prep write must enforce current batch-level WAC state');
assert.ok(serverSrc.includes('CI-WAC-OPS-READY-SUMMARY-20261110'), 'ops-ready must enforce current batch-level WAC state');

console.log('CI inline WAC integration static checks: PASS');
