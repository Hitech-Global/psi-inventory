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

const SUPPORTED_FORMULA_FUNCTIONS = Object.freeze({
  MIN: (...values) => Math.min(...values),
  MAX: (...values) => Math.max(...values)
});

function normalizeExpression(expression) {
  let source = String(expression == null ? '' : expression).trim();
  if (source.startsWith('=')) {
    source = source.slice(1).trim();
    if (source.startsWith('=')) throw new Error('公式开头只能有一个等号');
  }
  return source;
}

function tokenize(expression) {
  const source = normalizeExpression(expression);
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
    if ('+-*/(),%'.includes(source[i])) {
      tokens.push({ type: source[i], value: source[i] });
      i++;
      continue;
    }
    throw new Error('公式包含不支持的字符：' + source[i]);
  }
  if (tokens.length > 500) throw new Error('公式过长，请拆分计算');
  return tokens;
}

function getFormulaVariables(expression) {
  const seen = new Set();
  const tokens = tokenize(expression);
  tokens.forEach((token, index) => {
    if (token.type !== 'identifier') return;
    if (tokens[index + 1] && tokens[index + 1].type === '(') return;
    seen.add(token.value);
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
      if (peek('(')) {
        const functionName = name.toUpperCase();
        const formulaFunction = Object.prototype.hasOwnProperty.call(SUPPORTED_FORMULA_FUNCTIONS, functionName) ? SUPPORTED_FORMULA_FUNCTIONS[functionName] : null;
        if (!formulaFunction) throw new Error('不支持的公式函数：' + name);
        take();
        if (peek(')')) throw new Error(functionName + ' 函数至少需要一个参数');
        const args = [];
        while (true) {
          args.push(parseExpression());
          if (peek(',')) {
            take();
            if (peek(')') || cursor >= tokens.length) throw new Error('函数参数不能为空');
            continue;
          }
          if (peek(')')) {
            take();
            break;
          }
          if (cursor >= tokens.length) throw new Error('公式括号不匹配');
          throw new Error('函数参数之间请使用逗号');
        }
        const result = formulaFunction(...args);
        if (!Number.isFinite(result)) throw new Error('公式计算结果不是有效数字');
        return result;
      }
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

module.exports = {
  BUILTIN_PRICE_VARIABLES,
  SUPPORTED_FORMULA_FUNCTIONS,
  tokenize,
  getFormulaVariables,
  evaluateFormula,
  validateFormula
};
