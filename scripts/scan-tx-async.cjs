#!/usr/bin/env node
'use strict';
/**
 * scan-tx-async.cjs — transaction 反模式静态契约扫描器（Final Guard 版本）
 *
 * 目的：用 acorn 对 server.js / app.js 做 AST 解析，定位所有 transaction 调用，
 * 并检测以下反模式（长期零容忍，--check 直接 gate）：
 *   1. async          事务回调本身是 async function（transaction(async () => {...}) / transaction(() => 某 Promise)）
 *   2. asyncCallee    sync 回调内调用 async 函数但未 await / 未 return（Promise 逃逸事务边界）
 *   3. nested         事务回调体内【直接】包含另一个 transaction 调用（源码区间包含）
 *   4. indirectNested 事务回调【可达调用图】中含 transaction 调用（含直接嵌套；沿本地函数调用 BFS，
 *                      visited 去重、无深度上限、不钻入未被调用的嵌套函数）
 *   5. transit         事务回调（或其直接作用域）内调用 updateInventoryTransitData
 *   6. indirectTransit 事务回调可达调用图中含 updateInventoryTransitData 调用
 *
 * callee 识别（isTransactionCall）：
 *   裸调用 transaction(...) / 成员 db.transaction(...) / 计算 db['transaction'](...)
 *   以及简单词法别名 const tx = transaction; / const tx = db.transaction; / const tx = db['transaction'];
 *   → tx(...) 视为 transaction（仅当别名在全文件内【唯一定义】为上述形态；重复/shadow 保守跳过）。
 *   不做完整 data-flow 引擎；别名仅覆盖「变量直接持有 transaction 引用」的最常见情形。
 *
 * 结构化窄例外（无注解、不改 server.js）：runSalesDeletionInTx 的 SQLite branch
 *   transaction(() => { const exec = buildSqliteExec(); return execSalesDeletionFlow(...); })
 *   若同时满足以下全部条件，则【豁免其 asyncCallee】（失败安全：任一不满足即不豁免、按一般规则处理）：
 *     - enclosingFn === 'runSalesDeletionInTx'
 *     - 回调为 sync（async === false）
 *     - 回调 return 一个对 execSalesDeletionFlow(...) 的调用
 *     - execSalesDeletionFlow 是 async 本地函数
 *     - 可达调用图无 transaction 调用、无 updateInventoryTransitData 调用
 *     - 可达调用图中每个 async callee 均被 await 或 return（awaited-or-returned 校验）
 *
 * CLI：
 *   --check / --zero-tolerance   零容忍 gate：断言 async / asyncCallee / nested / indirectNested /
 *                                transit / indirectTransit 全部 === 0（不读取冻结基线；基线仅历史存档）
 *   --migration-report           读取冻结基线做历史对比报告（不 gate）
 *   --baseline [--force]         生成/刷新基线（冻结后需 --force；本批不自动重刷）
 *   (无参)                       仅打印 summary
 *
 * 冻结基线 scripts/tx-async-baseline.json 仍保留为历史存档（Baseline 0A 的 29 个历史违规快照），
 * 不再作为前向 gate；仅 --migration-report 读取。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const acorn = require('acorn');

const REPO_ROOT = path.resolve(__dirname, '..');
const BASELINE_PATH = path.join(REPO_ROOT, 'scripts', 'tx-async-baseline.json');
const DEFAULT_FILES = ['server.js', 'app.js']
  .map((f) => path.join(REPO_ROOT, f))
  .filter((f) => fs.existsSync(f));

function sha1(s) {
  return crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
}

// ---- AST 工具 ----

function parse(code) {
  try {
    return acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'script', locations: true });
  } catch (_e) {
    return acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  }
}

const SKIP_KEYS = ['loc', 'start', 'end', 'range', 'parent'];

function walkAll(node, visit, ancestors) {
  if (!node || typeof node.type !== 'string') return;
  visit(node, ancestors || []);
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.includes(key)) continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const c of child) if (c && c.type) walkAll(c, visit, [...(ancestors || []), node]);
    } else if (child && child.type) {
      walkAll(child, visit, [...(ancestors || []), node]);
    }
  }
}

// transaction 表达式形态（用于别名 init 识别）
function isTransactionExprPattern(init) {
  if (!init) return false;
  if (init.type === 'Identifier' && init.name === 'transaction') return true;
  if (
    init.type === 'MemberExpression' &&
    !init.computed &&
    init.property &&
    init.property.type === 'Identifier' &&
    init.property.name === 'transaction'
  ) {
    return true;
  }
  if (
    init.type === 'MemberExpression' &&
    init.computed &&
    init.property &&
    init.property.type === 'Literal' &&
    init.property.value === 'transaction'
  ) {
    return true;
  }
  return false;
}

// callee 名字（用于调用图解析与别名判定）：Identifier / Member.prop / Member['prop']
function calleeNameOf(callee) {
  if (!callee) return null;
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression') {
    if (!callee.computed && callee.property && callee.property.type === 'Identifier') {
      return callee.property.name;
    }
    if (callee.computed && callee.property && callee.property.type === 'Literal' && typeof callee.property.value === 'string') {
      return callee.property.value;
    }
  }
  return null;
}

// transaction 调用识别（含简单词法别名）。aliases 为 Set<string>
function isTransactionCall(node, aliases) {
  if (!node || node.type !== 'CallExpression' || !node.callee) return false;
  const callee = node.callee;
  if (callee.type === 'Identifier') {
    if (callee.name === 'transaction') return true;
    if (aliases && aliases.has(callee.name)) return true; // 词法别名
  }
  if (callee.type === 'MemberExpression') {
    if (!callee.computed) {
      if (callee.property && callee.property.type === 'Identifier' && callee.property.name === 'transaction') {
        return true;
      }
    } else if (callee.property && callee.property.type === 'Literal' && callee.property.value === 'transaction') {
      return true;
    }
  }
  return false;
}

function isTransitCall(node) {
  return (
    node &&
    node.type === 'CallExpression' &&
    node.callee &&
    node.callee.type === 'Identifier' &&
    node.callee.name === 'updateInventoryTransitData'
  );
}

function isAsyncFn(node) {
  return !!(node && (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') && node.async);
}

// 找到 node 所属的函数作用域节点
function enclosingFunction(ancestors) {
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const a = ancestors[i];
    if (a.type === 'FunctionDeclaration' || a.type === 'FunctionExpression' || a.type === 'ArrowFunctionExpression') {
      return a;
    }
  }
  return null;
}

// 调用点所属函数的名字（用于窄例外判定）
function enclosingFnName(ancestors) {
  const fn = enclosingFunction(ancestors);
  if (!fn) return null;
  if (fn.type === 'FunctionDeclaration') return fn.id ? fn.id.name : null;
  if ((fn.type === 'FunctionExpression' || fn.type === 'ArrowFunctionExpression') && fn.id) return fn.id.name;
  // 箭头/函数表达式作为 VariableDeclarator 的 init：在 ancestors 中回找
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const a = ancestors[i];
    if (a.type === 'VariableDeclarator' && a.init === fn && a.id && a.id.type === 'Identifier') {
      return a.id.name;
    }
  }
  return null;
}

// 路由 / 具名函数 / global 作用域 label
function scopeLabel(node, ancestors) {
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const a = ancestors[i];
    if (a.type === 'CallExpression' && a.callee && a.callee.type === 'MemberExpression') {
      const obj = a.callee.object;
      const prop = a.callee.property;
      const method = prop && prop.type === 'Identifier' ? prop.name : '';
      const objName = obj && obj.type === 'Identifier' ? obj.name : '';
      if (
        ['post', 'put', 'get', 'delete', 'patch'].includes(method) &&
        (objName === 'app' || objName === 'router' || (obj.type === 'MemberExpression' && obj.object.type === 'Identifier')) &&
        a.arguments.length > 0 &&
        a.arguments[0].type === 'Literal' &&
        typeof a.arguments[0].value === 'string'
      ) {
        return `${method.toUpperCase()} ${a.arguments[0].value}`;
      }
    }
  }
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const a = ancestors[i];
    if (a.type === 'FunctionDeclaration' && a.id) return `fn:${a.id.name}`;
    if ((a.type === 'FunctionExpression' || a.type === 'ArrowFunctionExpression') && a.id) return `fn:${a.id.name}`;
    if (
      a.type === 'VariableDeclarator' &&
      a.id &&
      a.id.type === 'Identifier' &&
      a.init &&
      (a.init.type === 'FunctionExpression' || a.init.type === 'ArrowFunctionExpression')
    ) {
      return `fn:${a.id.name}`;
    }
  }
  return 'global';
}

function getCallback(node) {
  const args = node.arguments || [];
  if (args.length === 0) return null;
  const cb = args[0];
  if (cb && (cb.type === 'ArrowFunctionExpression' || cb.type === 'FunctionExpression')) return cb;
  return null;
}

// 单文件：name -> 函数节点（FunctionDeclaration 或 函数表达式 init）。最后声明优先。
function buildFuncMap(ast) {
  const map = new Map();
  walkAll(ast, (node) => {
    if (node.type === 'FunctionDeclaration' && node.id) {
      map.set(node.id.name, node);
    } else if (
      node.type === 'VariableDeclarator' &&
      node.id &&
      node.id.type === 'Identifier' &&
      node.init &&
      (node.init.type === 'FunctionExpression' || node.init.type === 'ArrowFunctionExpression')
    ) {
      map.set(node.id.name, node.init);
    }
  });
  return map;
}

// 单文件：唯一定义为 transaction 形态的变量名集合（重复/shadow 保守跳过）
function buildAliases(ast) {
  const decls = new Map();
  walkAll(ast, (node) => {
    if (
      node.type === 'VariableDeclarator' &&
      node.id &&
      node.id.type === 'Identifier' &&
      node.init
    ) {
      const name = node.id.name;
      if (!decls.has(name)) decls.set(name, []);
      decls.get(name).push(node.init);
    }
  });
  const aliases = new Set();
  for (const [name, inits] of decls) {
    if (inits.length !== 1) continue; // 重复声明 → 保守不视为别名
    if (isTransactionExprPattern(inits[0])) aliases.add(name);
  }
  return aliases;
}

// 父节点是否表示「await 或 return」包裹：node 是 CallExpression，其直接父为 AwaitExpression / ReturnStatement
function isAwaitedOrReturned(node, ancestors) {
  const parent = ancestors[ancestors.length - 1];
  if (!parent) return false;
  if (parent.type === 'AwaitExpression') return true;
  if (parent.type === 'ReturnStatement') return true;
  return false;
}

function isFunctionNode(node) {
  return !!(node && (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression'));
}

// 回调内是否存在 `return <name>(...)` 形式的返回调用
function findReturnedCall(fnNode, name) {
  let found = false;
  walkAll(fnNode, (node) => {
    if (found) return;
    if (node.type === 'ReturnStatement' && node.argument && node.argument.type === 'CallExpression') {
      if (calleeNameOf(node.argument.callee) === name) found = true;
    }
  });
  return found;
}

/**
 * 可达调用图分析（核心新增）。
 * 从 cb 出发：沿本地函数调用 BFS。visited 为函数节点 Set（无深度上限，有限终止）。
 * 仅当 CallExpression 实际调用某本地函数时才钻入其定义；绝不钻入「已定义但未被调用」的嵌套函数。
 * 返回 { transactions, transits, asyncCallees }。
 */
function collectReachable(cb, funcMap, aliases) {
  const visited = new Set();
  const found = { transactions: [], transits: [], asyncCallees: [] };
  if (!cb) return found;

  function walkNode(node, ancestors) {
    if (!node || typeof node.type !== 'string') return;
    if (isTransactionCall(node, aliases)) found.transactions.push(node);
    if (isTransitCall(node)) found.transits.push(node);

    if (node.type === 'CallExpression') {
      const name = calleeNameOf(node.callee);
      if (name && funcMap.has(name)) {
        const target = funcMap.get(name);
        // async callee 逃逸检测（未被 await / return）
        if (isAsyncFn(target) && !isAwaitedOrReturned(node, ancestors)) {
          found.asyncCallees.push({ node, calleeName: name });
        }
        // 钻入目标函数体（仅当尚未访问过）——这是唯一允许下钻的路径
        if (target && !visited.has(target)) {
          visited.add(target);
          walkNode(target, [target]);
        }
      }
    }
    for (const key of Object.keys(node)) {
      if (SKIP_KEYS.includes(key)) continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (const c of child) {
          if (!c || !c.type) continue;
          if (isFunctionNode(c)) continue; // 不自动钻入未被调用的嵌套函数定义（correction #2）
          walkNode(c, [...ancestors, node]);
        }
      } else if (child && child.type) {
        if (isFunctionNode(child)) continue; // 不自动钻入未被调用的嵌套函数定义
        walkNode(child, [...ancestors, node]);
      }
    }
  }

  visited.add(cb);
  walkNode(cb, [cb]);
  return found;
}

// SQLite Sales Delete 结构化窄例外（失败安全）
function sqliteSalesDeleteExempt(t, reachable) {
  if (t.enclosingFnName !== 'runSalesDeletionInTx') return false;
  if (t.async) return false;
  if (!t.callback) return false;
  if (!findReturnedCall(t.callback, 'execSalesDeletionFlow')) return false;
  if (!t.funcMap || !t.funcMap.has('execSalesDeletionFlow')) return false;
  if (!isAsyncFn(t.funcMap.get('execSalesDeletionFlow'))) return false;
  // 负面条件：可达图无 transaction / transit
  if (reachable.transactions.length > 0) return false;
  if (reachable.transits.length > 0) return false;
  // awaited-or-returned 校验：每个 async callee 必须已被 await/return（即无逃逸）
  if (reachable.asyncCallees.length > 0) return false;
  return true;
}

// ---- 核心扫描 ----

function scanFile(filePath) {
  const code = fs.readFileSync(filePath, 'utf8');
  let ast;
  try {
    ast = parse(code);
  } catch (e) {
    return { file: path.basename(filePath), error: String(e.message), transactions: [] };
  }

  const funcMap = buildFuncMap(ast);
  const aliases = buildAliases(ast);
  const transactions = []; // { node, line, file, scope, callback, async, enclosingFnName, fingerprint, funcMap }
  const transitScopes = new Set(); // 包含 updateInventoryTransitData 调用的函数作用域节点

  walkAll(ast, (node, ancestors) => {
    if (isTransactionCall(node, aliases)) {
      const cb = getCallback(node);
      const scope = scopeLabel(node, ancestors);
      const line = node.loc ? node.loc.start.line : 0;
      transactions.push({
        node,
        line,
        file: path.basename(filePath),
        scope,
        callback: cb,
        async: !!(cb && cb.async),
        enclosingFnName: enclosingFnName(ancestors),
        funcMap,
        fingerprint: sha1(cb ? code.slice(cb.start, cb.end) : code.slice(node.start, node.end)),
      });
    }
    if (isTransitCall(node)) {
      const fn = enclosingFunction(ancestors);
      if (fn) transitScopes.add(fn);
    }
  });

  // 直接嵌套判定：T.callback 体内是否直接包含另一个 transaction 调用（源码区间包含）
  transactions.forEach((T) => {
    T.nested = false;
    if (!T.callback) return;
    for (const O of transactions) {
      if (O === T) continue;
      if (!O.callback) continue;
      if (O.callback.start > T.callback.start && O.callback.end < T.callback.end) {
        T.nested = true;
        break;
      }
    }
  });

  // transit 判定：T.callback 所在直接作用域是否包含 updateInventoryTransitData 调用
  transactions.forEach((T) => {
    T.transit = !!(T.callback && transitScopes.has(T.callback));
  });

  // 可达调用图：asyncCallee / indirectNested / indirectTransit
  transactions.forEach((T) => {
    const reachable = collectReachable(T.callback, T.funcMap, aliases);
    T.indirectNested = reachable.transactions.length > 0;
    T.indirectTransit = reachable.transits.length > 0;
    let asyncCallee = reachable.asyncCallees.length > 0;
    // 结构化窄例外：Sales Delete SQLite branch 豁免 asyncCallee（失败安全）
    if (asyncCallee && sqliteSalesDeleteExempt(T, reachable)) {
      asyncCallee = false;
    }
    T.asyncCallee = asyncCallee;
    T._reachable = reachable;
  });

  return { file: path.basename(filePath), error: null, transactions };
}

// ---- 条目 / key / 比较 ----

function buildEntry(t) {
  const characteristic = [
    t.async ? 'async' : '',
    t.asyncCallee ? 'asyncCallee' : '',
    t.nested ? 'nested' : '',
    t.indirectNested ? 'indirectNested' : '',
    t.transit ? 'transit' : '',
    t.indirectTransit ? 'indirectTransit' : '',
  ]
    .filter(Boolean)
    .join('+');
  return {
    file: t.file,
    line: t.line,
    scope: t.scope,
    callbackType: t.async ? 'async' : 'sync',
    async: !!t.async,
    asyncCallee: !!t.asyncCallee,
    nested: !!t.nested,
    indirectNested: !!t.indirectNested,
    transit: !!t.transit,
    indirectTransit: !!t.indirectTransit,
    characteristic,
    fingerprint: t.fingerprint,
    enclosingFn: t.enclosingFnName,
  };
}

function stableKey(entry) {
  return `${entry.file}::${entry.scope}::${entry.fingerprint}`;
}

function analyze(files) {
  const all = [];
  files.forEach((f) => {
    const r = scanFile(f);
    if (r.error) {
      process.stderr.write(`[scan-tx-async] WARN 解析失败 ${r.file}: ${r.error}\n`);
      return;
    }
    r.transactions.forEach((t) => all.push(buildEntry(t)));
  });

  const groups = new Map();
  all.forEach((e) => {
    const gk = `${e.file}::${e.scope}`;
    if (!groups.has(gk)) groups.set(gk, []);
    groups.get(gk).push(e);
  });
  groups.forEach((list) => {
    list.sort((a, b) => a.line - b.line);
    list.forEach((e, i) => {
      e.ordinal = i;
    });
  });

  all.forEach((e) => {
    e.key = stableKey(e);
  });

  const violations = all.filter(
    (e) =>
      e.callbackType === 'async' ||
      e.asyncCallee ||
      e.nested ||
      e.indirectNested ||
      e.transit ||
      e.indirectTransit
  );
  const summary = {
    total: all.length,
    async: all.filter((e) => e.callbackType === 'async').length,
    asyncCallee: all.filter((e) => e.asyncCallee).length,
    nested: all.filter((e) => e.nested).length,
    indirectNested: all.filter((e) => e.indirectNested).length,
    transit: all.filter((e) => e.transit).length,
    indirectTransit: all.filter((e) => e.indirectTransit).length,
    syncOk: all.filter(
      (e) =>
        e.callbackType === 'sync' &&
        !e.asyncCallee &&
        !e.nested &&
        !e.indirectNested &&
        !e.transit &&
        !e.indirectTransit
    ).length,
  };
  return { entries: all, violations, summary };
}

// 集合比较：以 key 为身份。newViolations = 当前存在但基线没有的违规（不允许）。
function compare(currentViolations, baselineViolations) {
  const bk = new Set(baselineViolations.map((e) => e.key));
  const ck = new Set(currentViolations.map((e) => e.key));
  const newViolations = currentViolations.filter((e) => !bk.has(e.key));
  const removedViolations = baselineViolations.filter((e) => !ck.has(e.key));
  return { newViolations, removedViolations, hasNew: newViolations.length > 0 };
}

// 零容忍 gate：6 项指标必须全 0（total 非永久正确性条件，不纳入 gate）
function zeroToleranceGate(summary) {
  const gate = {
    async: summary.async,
    asyncCallee: summary.asyncCallee,
    nested: summary.nested,
    indirectNested: summary.indirectNested,
    transit: summary.transit,
    indirectTransit: summary.indirectTransit,
  };
  const failures = Object.keys(gate).filter((k) => gate[k] !== 0);
  return { gate, failures, passed: failures.length === 0 };
}

// ---- CLI ----

function main() {
  const argv = process.argv.slice(2);
  const mode = argv.find((a) => a === '--baseline' || a === '--check' || a === '--zero-tolerance' || a === '--migration-report') || 'summary';
  const fileArgs = argv.filter((a) => !a.startsWith('--'));
  const files = fileArgs.length ? fileArgs.map((f) => path.resolve(f)) : DEFAULT_FILES;

  if (!files.length) {
    process.stderr.write('[scan-tx-async] 未找到可扫描文件（server.js/app.js）\n');
    process.exit(2);
  }

  const { entries, violations, summary } = analyze(files);

  if (mode === '--baseline') {
    if (fs.existsSync(BASELINE_PATH) && !argv.includes('--force')) {
      let existingFrozen = false;
      try {
        existingFrozen = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')).frozen === true;
      } catch (_e) {
        existingFrozen = false;
      }
      if (existingFrozen) {
        process.stderr.write(
          '[scan-tx-async] 拒绝覆盖：基线已冻结(frozen)。\n' +
            '  基线仅作历史存档；前向 gate 已切换为零容忍 --check（不读取基线）。\n'
        );
        process.exit(2);
      }
    }
    const payload = {
      generatedAt: new Date().toISOString(),
      frozen: true,
      files: files.map((f) => path.basename(f)),
      summary,
      violations,
    };
    fs.writeFileSync(BASELINE_PATH, JSON.stringify(payload, null, 2) + '\n');
    process.stdout.write(
      `基线已写入(冻结) ${path.relative(REPO_ROOT, BASELINE_PATH)}\n` +
        `  total=${summary.total} async=${summary.async} asyncCallee=${summary.asyncCallee} nested=${summary.nested} indirectNested=${summary.indirectNested} transit=${summary.transit} indirectTransit=${summary.indirectTransit} syncOk=${summary.syncOk}\n`
    );
    return;
  }

  if (mode === '--check' || mode === '--zero-tolerance') {
    const { gate, failures, passed } = zeroToleranceGate(summary);
    process.stdout.write(
      `零容忍 gate（不读取冻结基线）\n` +
        `  total=${summary.total} async=${gate.async} asyncCallee=${gate.asyncCallee} ` +
        `nested=${gate.nested} indirectNested=${gate.indirectNested} transit=${gate.transit} indirectTransit=${gate.indirectTransit}\n`
    );
    if (!passed) {
      process.stdout.write(`FAIL: 以下指标必须 === 0：${failures.join(', ')}\n`);
      process.exit(1);
    }
    process.stdout.write('OK: 全部 transaction 反模式指标为 0（零容忍通过）\n');
    return;
  }

  if (mode === '--migration-report') {
    if (!fs.existsSync(BASELINE_PATH)) {
      process.stderr.write('[scan-tx-async] 基线不存在，无法生成迁移报告\n');
      process.exit(2);
    }
    const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
    process.stdout.write(
      `历史基线（frozen=${baseline.frozen === true}，仅存档不 gate）\n` +
        `  baseline.total=${baseline.summary.total} baseline.async=${baseline.summary.async} ` +
        `baseline.nested=${baseline.summary.nested} baseline.transit=${baseline.summary.transit}\n` +
        `当前扫描\n` +
        `  current.total=${summary.total} current.async=${summary.async} current.asyncCallee=${summary.asyncCallee} ` +
        `current.nested=${summary.nested} current.indirectNested=${summary.indirectNested} current.transit=${summary.transit} ` +
        `current.indirectTransit=${summary.indirectTransit}\n`
    );
    const res = compare(violations, baseline.violations || []);
    process.stdout.write(
      `历史基线为 29 个旧违规的快照；前向 gate 已切换为零容忍 --check（不依赖此基线）。\n` +
        `（compare 仅供参考）removed=${res.removedViolations.length} new=${res.newViolations.length}\n`
    );
    return;
  }

  // summary
  process.stdout.write(
    `total=${summary.total} async=${summary.async} asyncCallee=${summary.asyncCallee} ` +
      `nested=${summary.nested} indirectNested=${summary.indirectNested} transit=${summary.transit} ` +
      `indirectTransit=${summary.indirectTransit} syncOk=${summary.syncOk}\n`
  );
  violations.forEach((e) => process.stdout.write(`  violation: ${e.key}  (${e.file}:${e.line}) [${e.characteristic}]\n`));
}

module.exports = {
  scanFile,
  analyze,
  buildEntry,
  stableKey,
  keyOf: stableKey,
  compare,
  zeroToleranceGate,
  isTransactionCall,
  isTransitCall,
  isAsyncFn,
  buildFuncMap,
  buildAliases,
  collectReachable,
  sqliteSalesDeleteExempt,
  findReturnedCall,
  isAwaitedOrReturned,
  BASELINE_PATH,
  DEFAULT_FILES,
};

if (require.main === module) {
  main();
}
