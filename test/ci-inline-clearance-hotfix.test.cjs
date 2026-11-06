'use strict';
const assert=require('node:assert/strict');
const {patchAppPerfSource,patchServerSource}=require('../scripts/ci-inline-clearance-hotfix.cjs');
const ui=patchAppPerfSource('function renderOperationalCITable(data){return data;}');
assert.equal(patchAppPerfSource(ui),ui);
assert.match(ui,/CI-INLINE-CLEARANCE-UI-V2/);
assert.ok(ui.includes("querySelectorAll('tr.clickable-detail-row')"));
assert.match(ui,/ciRows\.length!==data\.length/);
assert.match(ui,/var row=ciRows\[i\]/);
assert.match(ui,/ci-clearance-inline/);
assert.match(ui,/updateCIClearanceInline/);
assert.match(ui,/清关方式/);
assert.match(ui,/global\.api\('\/api\/commercial-invoices\/'/);
new Function(ui);
const server=[
"app.put('/api/commercial-invoices/:id', handler);",
"    const generatedPl = queryOne('SELECT id, pl_no FROM packing_lists WHERE related_ci_id = ? LIMIT 1', [id]);",
"    if (generatedPl) return res.status(409).json({ error: '该CI已生成PL，不能编辑', locked: true, lock_reason: 'pl_generated', pl_no: generatedPl.pl_no || '' });",
"    if (d.clearance_type !== undefined) { fields.push('clearance_type = ?'); values.push(v); }"
].join('\n');
const out=patchServerSource(server);
assert.match(out,/clearanceOnlyEdit = d\.clearance_type !== undefined/);
assert.match(out,/Object\.keys\(d\)\.every\(k => k === 'clearance_type'\)/);
assert.match(out,/generatedPl && !clearanceOnlyEdit/);
assert.equal(patchServerSource(out),out);
new Function(out);
const legacy='prefix\\n// CI-INLINE-CLEARANCE-UI-V1\\nold-index-based-wrapper();';
const migrated=patchAppPerfSource(legacy);
assert.ok(!migrated.includes('CI-INLINE-CLEARANCE-UI-V1'),'legacy index wrapper must be replaced');
assert.match(migrated,/CI-INLINE-CLEARANCE-UI-V2/);
assert.ok(migrated.includes('tr.clickable-detail-row'));
assert.equal(patchAppPerfSource(migrated),migrated,'V2 patch must be idempotent');
console.log('CI inline clearance edit regression: PASS');
