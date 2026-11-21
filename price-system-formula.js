'use strict';

const BUILTIN_PRICE_VARIABLES = Object.freeze([
  'purchase_price_rmb',
  'purchase_price_usd',
  'standard_purchase_price',
  'weighted_avg_cost',
  'inventory_wac',
  'reference_customs_rate',
  'landing_cost',
  'srp',
  'stock_qty',
  'inventory_qty'
]);

function tokenize(expression) {
  const source = String(expression || '');
  const tokens = [];
  let i = 0;
  while (i < source.length) {
    if (/\s/.test(source[i])) { i++; continue; }
    const rest = source.slice(i);
    const number = rest.match(/^(?:\d+(?:\.\d*)?|\.\d+)/);
    if (number) {
      tokens.push({ type: 'number', value: Number(number[0]) });
      i += number[0].length;
      continue;
    }
    const identifier = rest.match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (identifier) {
      tokens.push({ type: 'identifier', value: identifier[0] });
      i += identifier[0].length;
      continue;
    }
    if ('+-*/()%'.includes(source[i])) {
      tokens.push({ type: source[i], value: source[i] });
      i++;
      continue;
    }
    throw new Error('公式包含不支持的字符：' + source[i]);
  }
  return tokens;
}

function getFormulaVariables(expression) {
  const seen = new Set();
  tokenize(expression).forEach(token => {
    if (token.type === 'identifier') seen.add(token.value);
  });
  return Array.from(seen);
}

function evaluateFormula(expression, variables) {
  const tokens = tokenize(expression);
  if (!tokens.length) throw new Error('公式不能为空');
  let cursor = 0;
  const values = variables || {};

  function peek(type) { return cursor < tokens.length && tokens[cursor].type === type; }
  function take() { return tokens[cursor++]; }

  function parsePrimary() {
    if (peek('number')) return take().value;
    if (peek('identifier')) {
      const name = take().value;
      if (!Object.prototype.hasOwnProperty.call(values, name)) {
        throw new Error('公式引用了未知字段：' + name);
      }
      const value = Number(values[name] == null ? 0 : values[name]);
      if (!Number.isFinite(value)) throw new Error('字段不是有效数字：' + name);
      return value;
    }
    if (peek('(')) {
      take();
      const value = parseExpression();
      if (!peek(')')) throw new Error('公式括号不匹配');
      take();
      return value;
    }
    throw new Error('公式语法错误');
  }

  function parseUnary() {
    if (peek('+')) { take(); return parseUnary(); }
    if (peek('-')) { take(); return -parseUnary(); }
    let value = parsePrimary();
    // A trailing percent sign converts the preceding number/field to a ratio.
    // Example: 7.2% * srp === 0.072 * srp.
    if (peek('%')) { take(); value /= 100; }
    return value;
  }

  function parseTerm() {
    let value = parseUnary();
    while (peek('*') || peek('/')) {
      const operator = take().type;
      const right = parseUnary();
      if (operator === '/' && right === 0) throw new Error('公式不能除以 0');
      value = operator === '*' ? value * right : value / right;
    }
    return value;
  }

  function parseExpression() {
    let value = parseTerm();
    while (peek('+') || peek('-')) {
      const operator = take().type;
      const right = parseTerm();
      value = operator === '+' ? value + right : value - right;
    }
    return value;
  }

  const result = parseExpression();
  if (cursor !== tokens.length) throw new Error('公式存在多余内容');
  if (!Number.isFinite(result)) throw new Error('公式计算结果不是有效数字');
  return result;
}

function validateFormula(expression, allowedVariables) {
  const variables = getFormulaVariables(expression);
  const allowed = new Set(allowedVariables || []);
  const unknown = variables.filter(name => !allowed.has(name));
  if (unknown.length) throw new Error('公式引用了未知字段：' + unknown.join(', '));
  const sample = {};
  variables.forEach(name => { sample[name] = 1; });
  evaluateFormula(expression, sample);
  return { valid: true, variables };
}

module.exports = { BUILTIN_PRICE_VARIABLES, tokenize, getFormulaVariables, evaluateFormula, validateFormula };
