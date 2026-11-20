'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../pricing-core');

test('SRP formula supports arithmetic, parentheses, variables and safe functions', () => {
  assert.equal(core.evaluateFormula('ROUND(FOB_RMB * 2.2 * RMB_TO_LOCAL, 0)', {
    FOB_RMB: 82,
    RMB_TO_LOCAL: 2700
  }), 487080);
  assert.equal(core.evaluateFormula('100 * 10%', {}), 10);
  assert.equal(core.evaluateFormula('MAX(100, MIN(120, 110)) + ABS(-5)', {}), 115);
});

test('SRP formula rejects unknown variables, unsupported functions and code execution', () => {
  assert.throws(() => core.evaluateFormula('FOB_RMB * UNKNOWN_RATE', { FOB_RMB: 10 }), /未定义变量/);
  assert.throws(() => core.evaluateFormula('process.exit()', {}), /不支持的字符|未定义变量/);
  assert.throws(() => core.evaluateFormula('10 / 0', {}), /除数不能为 0/);
});

test('pricing rules resolve SKU override before category before global default', () => {
  const rules = [
    { id: 'global', scope_type: 'global', calculation_type: 'rate', rate: 5, status: 'active' },
    { id: 'category', scope_type: 'category', scope_value: 'Mouse', calculation_type: 'rate', rate: 7.2, status: 'active' },
    { id: 'sku', scope_type: 'sku', scope_value: 'RDK512RGB', calculation_type: 'rate', rate: 8, status: 'active' }
  ];
  assert.equal(core.resolvePricingRule(rules, { sku_code: 'RDK512RGB', category: 'Mouse' }).id, 'sku');
  assert.equal(core.resolvePricingRule(rules, { sku_code: 'RDK515RGB', category: 'Mouse' }).id, 'category');
  assert.equal(core.resolvePricingRule(rules, { sku_code: 'RDK700', category: 'Keyboard' }).id, 'global');
});

test('uncategorized SKU can match an explicit uncategorized rule', () => {
  const rules = [
    { id: 'uncategorized', scope_type: 'category', scope_value: '__UNCATEGORIZED__', calculation_type: 'rate', rate: 2.5, status: 'active' },
    { id: 'global', scope_type: 'global', calculation_type: 'rate', rate: 5, status: 'active' }
  ];
  assert.equal(core.resolvePricingRule(rules, { sku_code: 'SKU-1', category: '' }).id, 'uncategorized');
});

test('fee calculations support percentage, cap, fixed amount and per-order allocation', () => {
  assert.equal(core.calculateRuleValue({ calculation_type: 'rate', rate: 7.2 }, {}), 7.2);
  assert.equal(core.calculateRuleValue({ calculation_type: 'percentage', basis: 'SRP', rate: 7.2 }, { SRP: 469000 }), 33768);
  assert.equal(core.calculateRuleValue({ calculation_type: 'capped', basis: 'SRP', rate: 8.5, cap_amount: 30000, per_order: 1, items_per_order: 2 }, { SRP: 469000 }), 15000);
  assert.equal(core.calculateRuleValue({ calculation_type: 'fixed', fixed_amount: 1250 }, {}), 1250);
});

test('field keys are normalized into stable database-safe identifiers', () => {
  assert.equal(core.normalizeFieldKey('Landing Cost/IDR'), 'LANDING_COST_IDR');
  assert.equal(core.normalizeFieldKey('Commission Fee'), 'COMMISSION_FEE');
  assert.throws(() => core.normalizeFieldKey('---'), /字段名称不能为空/);
});

test('pricing page reuses SKU category and live inventory quantity rather than creating another category master', () => {
  const root = path.join(__dirname, '..');
  const server = fs.readFileSync(path.join(root, 'pricing-server.js'), 'utf8');
  const migration = fs.readFileSync(path.join(root, 'migrations', 'pricing-system.js'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'assets', 'pricing-management.css'), 'utf8');
  assert.match(server, /FROM skus WHERE brand = \?/);
  assert.match(server, /SUM\(COALESCE\(i\.available_qty, 0\)\)/);
  assert.match(server, /category \|\| '未分类'/);
  assert.match(app, /id:'pricing-system'/);
  assert.match(migration, /pricing_fields/);
  assert.doesNotMatch(migration, /CREATE TABLE IF NOT EXISTS pricing_categories/);
  assert.match(css, /\.ps-stock\.zero/);
});
