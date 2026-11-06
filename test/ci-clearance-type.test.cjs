'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const app = fs.readFileSync(require.resolve('../app.js'), 'utf8');
const server = fs.readFileSync(require.resolve('../server.js'), 'utf8');
const pgDb = fs.readFileSync(require.resolve('../db.js'), 'utf8');
const sqliteDb = fs.readFileSync(require.resolve('../db-sqlite.js'), 'utf8');
const editPatch = require('../scripts/ci-edit-before-pl-hotfix.cjs');
const editUi = editPatch.patchAppPerfSource('/* perf */');

assert.match(app, /ci-clearance-filter/);
assert.ok(app.includes('nci-clearance-type') && app.includes('formal') && app.includes('正清'), 'create form must offer 正清');
assert.ok(app.includes('nci-clearance-type') && app.includes('non_formal') && app.includes('非正清'), 'create form must offer 非正清');
assert.match(app, /clearance_type:clearanceType/);
assert.match(app, /ciClearanceLabel\(c\.clearance_type\)/);
assert.ok(app.includes('nci-clearance-type'), 'create form must include clearance selector');
assert.match(app, /清关方式/);

assert.match(server, /clearance_type === 'formal' \|\| clearance_type === 'non_formal'/);
assert.match(server, /COALESCE\(clearance_type, ''\) = ''/);
assert.match(server, /请选择清关方式：正清或非正清/);
assert.match(server, /fields\.push\('clearance_type = \\?'/);
const insert = server.match(/INSERT INTO commercial_invoices \(([^\n]+?)\) VALUES \(([^\n]+?)\)/);
assert.ok(insert, 'operational CI INSERT must be found');
assert.equal(insert[1].split(',').length, (insert[2].match(/\?/g) || []).length, 'CI INSERT columns and placeholders must match');
assert.match(insert[1], /clearance_type/);
assert.match(server, /ciCurrency, clearanceType, 0, piTotalAmount/);

assert.match(pgDb, /ALTER TABLE commercial_invoices ADD COLUMN IF NOT EXISTS clearance_type TEXT NOT NULL DEFAULT ''/);
assert.match(sqliteDb, /name: 'clearance_type', sql: "TEXT NOT NULL DEFAULT ''"/);

assert.match(editUi, /id="eci-clearance-type"/);
assert.match(editUi, /clearance_type:clearanceType/);
assert.match(editUi, /请选择清关方式：正清或非正清/);
new Function(editUi);

console.log('CI clearance type contract: PASS');
