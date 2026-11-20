'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { BUILTIN_PRICE_VARIABLES, evaluateFormula, getFormulaVariables, validateFormula } = require('../price-system-formula');

test('evaluates arithmetic, precedence, parentheses and unary signs', () => {
  assert.ok(Math.abs(evaluateFormula('(purchase_price_rmb + freight) * 1.08', { purchase_price_rmb: 100, freight: 20 }) - 129.6) < 1e-9);
  assert.equal(evaluateFormula('-2 + 3 * 4', {}), 10);
  assert.equal(evaluateFormula('10 / (2 + 3)', {}), 2);
});

test('lists formula variables and validates against available fields', () => {
  assert.deepEqual(getFormulaVariables('fob + platform_fee / 100 + fob'), ['fob', 'platform_fee']);
  assert.equal(validateFormula('fob + platform_fee', ['fob', 'platform_fee']).valid, true);
  assert.throws(() => validateFormula('fob + missing', ['fob']), /未知字段/);
});

test('rejects unsupported characters, malformed syntax and division by zero', () => {
  assert.throws(() => evaluateFormula('process.exit(1)', {}), /不支持的字符|语法错误/);
  assert.throws(() => evaluateFormula('(1 + 2', {}), /括号/);
  assert.throws(() => evaluateFormula('10 / 0', {}), /除以 0/);
});

test('Landing Cost is available as a built-in SRP formula variable', () => {
  assert.ok(BUILTIN_PRICE_VARIABLES.includes('landing_cost'));
  assert.ok(Math.abs(evaluateFormula('landing_cost * 1.1', { landing_cost: 100 }) - 110) < 1e-9);
  assert.equal(validateFormula('landing_cost + platform_fee', ['landing_cost', 'platform_fee']).valid, true);
});
