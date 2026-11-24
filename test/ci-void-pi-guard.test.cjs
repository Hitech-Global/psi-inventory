'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const i18n = fs.readFileSync(path.join(root, 'i18n.js'), 'utf8');

const voidStart = server.indexOf("app.post('/api/proforma-invoices/:id/void'");
const voidEnd = server.indexOf('// ==================== CI/PL 管理', voidStart);
assert.ok(voidStart >= 0 && voidEnd > voidStart, 'PI void route must exist');
const voidRoute = server.slice(voidStart, voidEnd);
assert.ok(voidRoute.includes('JOIN commercial_invoices ci ON ci.id = cii.ci_id'), 'PI void guard must join CI headers');
assert.ok(voidRoute.includes("COALESCE(ci.ci_status,'') NOT IN ('cancelled','reversed')"), 'cancelled/reversed CI rows must not block PI void');
assert.ok(voidRoute.includes('piMultiPO.restoreMultiAllocations(pi.id,query,run)'), 'multi-PO allocations must still be restored');
assert.ok(voidRoute.includes('multiRelated.forEach(poId=>piMultiPO.updatePOStatus(poId,query,run))'), 'PO statuses must be recalculated after release');

const ciStart = server.indexOf("app.get('/api/commercial-invoices'");
const ciEnd = server.indexOf('// P2-LOGISTICS-CLOSED-LOOP', ciStart);
assert.ok(ciStart >= 0 && ciEnd > ciStart, 'CI list endpoint must exist');
const ciRoute = server.slice(ciStart, ciEnd);
assert.ok(ciRoute.includes("if (ci_status === 'active')"), 'CI endpoint must support active-only filter');
assert.ok(ciRoute.includes("else if (ci_status === 'cancelled')"), 'CI endpoint must support voided-only filter');

assert.ok(app.includes('id="ci-status-filter"'), 'CI list must expose status filter');
assert.ok(app.includes("ci_status='+encodeURIComponent(ciStatus)"), 'CI list request must pass selected status');
assert.ok(app.includes("mode==='all'&&ciStatus==='cancelled'"), 'voided-only filter must not mix in historical CI rows');
assert.ok(app.includes("t('ci.048','已作废')"), 'voided CI row must be labelled');
assert.ok(i18n.includes('I18N.dict.zh["ci.046"]="CI状态";'), 'CI status filter label must be translated');
assert.ok(i18n.includes('I18N.dict.en["ci.049"]="All statuses";'), 'CI status filter options must be translated');
console.log('CI voided-history / multi-PO PI void regression checks passed.');
