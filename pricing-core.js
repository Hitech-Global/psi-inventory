'use strict';

const FUNCTIONS = {
  ROUND: (value, digits) => {
    const places = digits == null ? 0 : Math.max(0, Math.min(8, Math.trunc(Number(digits))));
    const factor = Math.pow(10, places);
    return Math.round(Number(value) * factor) / factor;
  },
  MIN: (...values) => Math.min(...values.map(Number)),
  MAX: (...values) => Math.max(...values.map(Number)),
  ABS: value => Math.abs(Number(value)),
  CEIL: value => Math.ceil(Number(value)),
  FLOOR: value => Math.floor(Number(value)),
  SQRT: value => Math.sqrt(Number(value)),
  POW: (a, b) => Math.pow(Number(a), Number(b))
};

function tokenizeFormula(source) {
  const input = String(source || '').trim();
  if (!input) throw new Error('公式不能为空');
  const tokens = [];
  let index = 0;
  while (index < input.length) {
    const rest = input.slice(index);
    const whitespace = rest.match(/^\s+/);
    if (whitespace) { index += whitespace[0].length; continue; }
    const number = rest.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i);
    if (number) {
      tokens.push({ type: 'number', value: Number(number[0]) });
      index += number[0].length;
      continue;
    }
    const identifier = rest.match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (identifier) {
      tokens.push({ type: 'identifier', value: identifier[0] });
      index += identifier[0].length;
      continue;
    }
    const char = input[index];
    if ('+-*/%(),'.includes(char)) {
      tokens.push({ type: char, value: char });
      index++;
      continue;
    }
    throw new Error('公式包含不支持的字符：' + char);
  }
  tokens.push({ type: 'eof', value: '' });
  return tokens;
}

function evaluateFormula(expression, variables) {
  const tokens = tokenizeFormula(expression);
  const values = Object.create(null);
  Object.keys(variables || {}).forEach(key => {
    values[String(key).toUpperCase()] = Number(variables[key]);
  });
  let cursor = 0;
  const peek = () => tokens[cursor];
  const take = type => {
    if (peek().type !== type) throw new Error('公式语法错误，预期 ' + type);
    return tokens[cursor++];
  };
  function parseExpression() {
    let value = parseTerm();
    while (peek().type === '+' || peek().type === '-') {
      const op = tokens[cursor++].type;
      const right = parseTerm();
      value = op === '+' ? value + right : value - right;
    }
    return value;
  }
  function parseTerm() {
    let value = parseUnary();
    while (peek().type === '*' || peek().type === '/') {
      const op = tokens[cursor++].type;
      const right = parseUnary();
      if (op === '/' && right === 0) throw new Error('公式除数不能为 0');
      value = op === '*' ? value * right : value / right;
    }
    return value;
  }
  function parseUnary() {
    if (peek().type === '+') { cursor++; return parseUnary(); }
    if (peek().type === '-') { cursor++; return -parseUnary(); }
    return parsePrimary();
  }
  function parsePrimary() {
    if (peek().type === 'number') return take('number').value;
    if (peek().type === '(') {
      take('(');
      const value = parseExpression();
      take(')');
      return parsePostfix(value);
    }
    if (peek().type === 'identifier') {
      const name = take('identifier').value.toUpperCase();
      if (peek().type === '(') {
        take('(');
        const args = [];
        if (peek().type !== ')') {
          args.push(parseExpression());
          while (peek().type === ',') { take(','); args.push(parseExpression()); }
        }
        take(')');
        const fn = FUNCTIONS[name];
        if (!fn) throw new Error('不支持的公式函数：' + name);
        return parsePostfix(fn(...args));
      }
      if (!Object.prototype.hasOwnProperty.call(values, name)) {
        throw new Error('公式引用了未定义变量：' + name);
      }
      const value = values[name];
      if (!Number.isFinite(value)) throw new Error('变量 ' + name + ' 不是有效数字');
      return parsePostfix(value);
    }
    throw new Error('公式语法错误，存在无效表达式');
  }
  function parsePostfix(value) {
    let result = Number(value);
    while (peek().type === '%') { take('%'); result = result / 100; }
    return result;
  }
  const result = parseExpression();
  if (peek().type !== 'eof') throw new Error('公式末尾存在多余内容');
  if (!Number.isFinite(result)) throw new Error('公式计算结果不是有效数字');
  return result;
}

function normalizeFieldKey(value) {
  const key = String(value || '').trim().toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!key) throw new Error('字段名称不能为空');
  return key.slice(0, 48);
}

function ruleMatches(rule, sku, today) {
  if (!rule || String(rule.status || 'active') !== 'active') return false;
  if (rule.effective_from && String(rule.effective_from) > today) return false;
  if (rule.effective_to && String(rule.effective_to) < today) return false;
  const type = String(rule.scope_type || 'global');
  if (type === 'sku') return String(rule.scope_value || '').trim() === String(sku.sku_code || '').trim();
  if (type === 'category') {
    const category = String(sku.category || '').trim();
    const expected = String(rule.scope_value || '').trim();
    return expected === '__UNCATEGORIZED__' ? !category : expected === category;
  }
  return type === 'global' || type === 'all';
}

function resolvePricingRule(rules, sku, today) {
  const date = today || new Date().toISOString().slice(0, 10);
  const rank = { global: 1, all: 1, category: 2, sku: 3 };
  return (Array.isArray(rules) ? rules : [])
    .filter(rule => ruleMatches(rule, sku, date))
    .sort((a, b) => {
      const ar = rank[String(a.scope_type || 'global')] || 0;
      const br = rank[String(b.scope_type || 'global')] || 0;
      if (br !== ar) return br - ar;
      const ap = Number(a.priority || 0), bp = Number(b.priority || 0);
      if (bp !== ap) return bp - ap;
      return String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || ''));
    })[0] || null;
}

function calculateRuleValue(rule, context) {
  if (!rule) return null;
  const vars = context || {};
  const type = String(rule.calculation_type || 'manual').toLowerCase();
  let value = null;
  if (type === 'fixed' || type === 'manual') {
    if (rule.fixed_amount === '' || rule.fixed_amount == null) return null;
    value = Number(rule.fixed_amount);
  } else if (type === 'percentage' || type === 'capped') {
    const basisName = String(rule.basis || 'SRP').toUpperCase();
    const basis = Number(vars[basisName]);
    if (!Number.isFinite(basis)) return null;
    value = basis * Number(rule.rate || 0) / 100;
    if (type === 'capped' && rule.cap_amount !== '' && rule.cap_amount != null) {
      value = Math.min(value, Number(rule.cap_amount));
    }
    if (rule.floor_amount !== '' && rule.floor_amount != null) {
      value = Math.max(value, Number(rule.floor_amount));
    }
  } else if (type === 'formula') {
    value = evaluateFormula(rule.formula, vars);
  } else {
    throw new Error('不支持的费用计算方式：' + type);
  }
  if (!Number.isFinite(value)) throw new Error('费用计算结果无效');
  if (Number(rule.per_order || 0) === 1) {
    const quantity = Number(rule.items_per_order || 1);
    if (!(quantity > 0)) throw new Error('每单商品数量必须大于 0');
    value = value / quantity;
  }
  return Math.round(value * 10000) / 10000;
}

function resolveFieldValue(field, rules, sku, context, override) {
  if (override && Number(override.is_applicable) === 0) return null;
  if (override && override.value !== null && override.value !== undefined && override.value !== '') {
    const value = Number(override.value);
    return Number.isFinite(value) ? value : null;
  }
  if (field && String(field.calculation_type || 'manual') === 'formula' && field.formula) {
    return evaluateFormula(field.formula, context || {});
  }
  const rule = resolvePricingRule(rules, sku);
  return calculateRuleValue(rule, context);
}

module.exports = {
  evaluateFormula,
  normalizeFieldKey,
  resolvePricingRule,
  calculateRuleValue,
  resolveFieldValue
};
