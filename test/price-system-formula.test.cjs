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

test('latest confirmed WAC is the only built-in WAC formula source', () => {
  assert.ok(BUILTIN_PRICE_VARIABLES.includes('landing_cost'));
  assert.equal(BUILTIN_PRICE_VARIABLES.includes('inventory_wac'), false);
  assert.equal(BUILTIN_PRICE_VARIABLES.includes('weighted_avg_cost'), false);
  assert.throws(() => validateFormula('weighted_avg_cost', BUILTIN_PRICE_VARIABLES), /未知字段/);
  assert.ok(Math.abs(evaluateFormula('landing_cost * 1.1', { landing_cost: 100 }) - 110) < 1e-9);
  assert.equal(validateFormula('landing_cost + platform_fee', ['landing_cost', 'platform_fee']).valid, true);
});

test('supports percentage literals and SRP as a formula dependency', () => {
  assert.ok(BUILTIN_PRICE_VARIABLES.includes('srp'));
  assert.ok(Math.abs(evaluateFormula('7.2% * srp', { srp: 1000 }) - 72) < 1e-9);
  assert.equal(evaluateFormula('8%', {}), 0.08);
  assert.ok(Math.abs(evaluateFormula('-7.2% * srp', { srp: 1000 }) + 72) < 1e-9);
  assert.equal(validateFormula('7.2% * srp', BUILTIN_PRICE_VARIABLES).valid, true);
});


test('supports Excel-style optional equals and MIN/MAX functions', () => {
  const formula = '=MIN(srp * 6.5%, 80000)';
  assert.equal(evaluateFormula(formula, { srp: 1000000 }), 65000);
  assert.equal(evaluateFormula('MIN(srp * 6.5%, 80000)', { srp: 2000000 }), 80000);
  assert.equal(evaluateFormula('MAX(5, 10, 3)', {}), 10);
  assert.equal(evaluateFormula('min(5, MAX(10, 3))', {}), 5);
  assert.deepEqual(getFormulaVariables('=MIN(srp * 6.5%, MAX(platform_fee, 80000))'), ['srp', 'platform_fee']);
  assert.equal(validateFormula(formula, ['srp']).valid, true);
});

test('rejects unsupported functions, malformed function arguments and repeated equals', () => {
  assert.throws(() => evaluateFormula('SUM(1, 2)', {}), /不支持的公式函数/);
  assert.throws(() => evaluateFormula('constructor(1)', {}), /不支持的公式函数/);
  assert.throws(() => evaluateFormula('MIN(1,)', {}), /参数不能为空/);
  assert.throws(() => evaluateFormula('MIN(1, 2', {}), /括号不匹配/);
  assert.throws(() => evaluateFormula('==MIN(1, 2)', {}), /一个等号/);
  assert.throws(() => evaluateFormula('1, 2', {}), /多余内容/);
});

test('automatically normalizes referenced percentage fields without changing formula ratios', () => {
  const options = { percentVariables: ['dealer_profit_rate', 'ads_budget'] };
  assert.ok(Math.abs(evaluateFormula('srp * (1 - dealer_profit_rate)', { srp: 120700, dealer_profit_rate: 18 }, options) - 98974) < 1e-9);
  assert.equal(evaluateFormula('srp * ads_budget', { srp: 1000, ads_budget: 8 }, options), 80);
  assert.ok(Math.abs(evaluateFormula('srp * (1 - profit_rate)', { srp: 1000, profit_rate: 0.18 }, options) - 820) < 1e-9);
  assert.equal(validateFormula('srp * (1 - dealer_profit_rate)', ['srp', 'dealer_profit_rate'], options).valid, true);
});


test('supports live exchange-rate formula variable and fails closed when unavailable', () => {
  assert.ok(BUILTIN_PRICE_VARIABLES.includes('exchange_rate'));
  assert.equal(evaluateFormula('fob * exchange_rate', { fob: 4.38, exchange_rate: 18200 }), 79716);
  assert.equal(validateFormula('fob * exchange_rate', ['fob', ...BUILTIN_PRICE_VARIABLES]).valid, true);
  assert.throws(() => evaluateFormula('fob * exchange_rate', { fob: 4.38 }), /实时汇率暂不可用/);
});
