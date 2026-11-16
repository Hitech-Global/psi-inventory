'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const asset = fs.readFileSync(path.join(root, 'assets/ci-expense-modal-mac.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

assert.match(html, /assets\/ci-expense-modal-mac\.js\?v=/);
assert.match(asset, /global\.viewCICost = viewCICost/);
assert.match(asset, /shared-logistics-fees/);
assert.match(asset, /manual_freight_display_totals/);
assert.match(asset, /manual_freight_pending_fx/);
assert.match(asset, /ci\.cost\.kg_pl_gross_weight/);
assert.match(asset, /batch_totals_display/);
assert.match(asset, /fmtMoney\(value, code\)/);
assert.match(asset, /ci\.cost\.freight_fx_note/);
assert.match(asset, /ci\.cost\.currency_note/);
assert.match(asset, /hasPermission\('ci_edit'\)/);
assert.match(asset, /hasPermission\('payment_create'\)/);
assert.match(asset, /saveCiCostInputs/);
const rateInputsStart = asset.indexOf('var skuRows');
const rateInputsEnd = asset.indexOf('ci.cost.summary', rateInputsStart);
assert.ok(rateInputsStart >= 0 && rateInputsEnd > rateInputsStart, 'duty-rate input section must exist');
assert.doesNotMatch(asset.slice(rateInputsStart, rateInputsEnd), /saveCiCostInputs/,
  'save action should not be hidden after the long SKU table');
const footerStart = asset.indexOf('var footer =');
const footerEnd = asset.indexOf('ensureStyles();', footerStart);
assert.ok(footerStart >= 0 && footerEnd > footerStart, 'CI cost modal footer must exist');
const modalFooter = asset.slice(footerStart, footerEnd);
assert.match(modalFooter, /canEdit && !summary\.cost_confirmed/,
  'save action must respect CI edit permission and cost-confirmed lock');
assert.ok(modalFooter.indexOf('saveCiCostInputs') >= 0 &&
  modalFooter.indexOf('saveCiCostInputs') < modalFooter.indexOf('closeModal'),
  'save action must be visible in the fixed modal footer before Close');
assert.match(asset, /confirmCiCosts/);
assert.match(asset, /allocateCosts/);
assert.match(asset, /createCustomsDutyPay/);
assert.match(asset, /createInspectionFeePay/);
assert.match(asset, /createWarehousePay/);
assert.match(asset, /text-align:left!important/);
assert.doesNotMatch(asset, /text-right|text-align:right/i);
assert.doesNotMatch(asset, /landing_cost_total/);

const routeStart = server.indexOf("app.get('/api/commercial-invoices/:id/cost-summary'");
const routeEnd = server.indexOf("// 设置CI是否有关税/商检费用", routeStart);
assert.ok(routeStart >= 0 && routeEnd > routeStart, 'CI cost-summary route must exist');
const route = server.slice(routeStart, routeEnd);
assert.match(route, /goods_currency/);
assert.match(route, /customs_duty_currency/);
assert.match(route, /findDutyCountry\(dutyCountryKey\)/);
assert.match(route, /dutyCountryRaw !== dutyCountryKey \? findDutyCountry\(dutyCountryRaw\) : null/);
assert.match(route, /manualFreightDisplayTotals/);
assert.match(route, /settledConversion/);
assert.match(route, /manual_freight_display_totals/);
assert.match(route, /summary\.landing_cost_total\s*=\s*null/);
assert.doesNotMatch(route, /summary\.goods_amount\s*\+\s*summary\.warehouse_arrival_total/);

console.log('CI expense modal Mac layout and currency display contract: PASS');
