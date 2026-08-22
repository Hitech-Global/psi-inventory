#!/usr/bin/env node
'use strict';
/**
 * scan-tx-async.cjs — transaction(async) / nested-transaction 静态契约扫描器
 *
 * 目的（Batch 0A，只读分析 + 基线固化，不修改任何业务代码）：
 *   - 用 acorn 对 server.js / app.js 做真实 AST 解析，定位所有 transaction 调用。
 *   - 支持的 callee 形式（AST 规则）：
 *       1) 裸调用        transaction(...)
 *       2) 成员调用      db.transaction(...) / obj.transaction(...)
 *       3) 计算成员调用  db['transaction'](...)   （computed，property 为字面量 'transaction'）
 *     已知边界（P0 不扩展）：任意别名调用 `const tx = transaction; tx(async () => {})`
 *       属于 data-flow / 别名传播问题，当前纯 AST 结构匹配不保证识别，
 *       需后续 data-flow analysis，本批不处理（见下方「已知边界」）。
 *   - 对每个 transaction 调用判定：
 *       * callbackType: 'async' | 'sync'   （是否 async 回调 —— 当前契约禁止）
 *       * nested:       是否自身位于另一个 transaction 回调内部（直接嵌套事务 —— 当前契约禁止）
 *       * transit:      其回调（或作用域）内是否调用 updateInventoryTransitData
 *                       （该函数内部会再开一个 transaction，构成「事务内调 transit」嵌套 —— 当前契约禁止）
 *   - 稳定身份（key）只依赖：文件 + 路由/函数作用域 + 回调源码 sha1 指纹，
 *     不依赖绝对行号、不依赖作用域内序号(ordinal)、不依赖契约特征，
 *     因此后续 server.js 大规模行号漂移 / 同作用域 ordinal 重排都不会误判为「新增违规」。
 *
 * 契约（当前阶段）：
 *   - sync transaction callback：允许
 *   - async / Promise 返回型 transaction callback：禁止（未来由 db.js 运行时 guard 兜底，本批不加）
 *   - nested transaction（事务内再开事务）：业务代码应消除（updateInventoryTransitData 移出事务）
 *
 * 冻结基线（frozent baseline）语义 —— Batch 0A 最终生成后必须冻结：
 *   - scripts/tx-async-baseline.json 在本次 Batch 0A 最终生成后冻结，
 *     Batch 1 / 2A / 2B / 2C 都不得重新生成或刷新。
 *   - 整个迁移期 gate 固定判断：currentViolations ⊆ frozenBaseline
 *        newViolations = currentSet - frozenBaselineSet  必须始终为 0
 *     允许旧违规逐步减少：29 → X → X → 0，但基线文件始终保留最初 29 个历史违规。
 *   - 仅 Final Guard Batch 在「current violations = 0」之后，才删除基线 / 切换 zero-tolerance。
 *   - --check 只读取冻结基线，绝不自动覆盖。
 *   - 基线生成必须是显式命令（--baseline），且冻结后覆盖需 --force，
 *     普通 migration / test 流程不得自动 regenerate baseline。
 *
 * CLI：
 *   node scripts/scan-tx-async.cjs --baseline [--force] [files...]   显式生成/刷新（冻结后覆盖需 --force）
 *   node scripts/scan-tx-async.cjs --check    [files...]             只读读取冻结基线做比较，发现新增违规则退出码 1
 *   node scripts/scan-tx-async.cjs            [files...]             仅打印 summary（不读/写基线）
 *
 * 已知边界（P0 不扩展）：
 *   - 别名调用 `const tx = transaction; tx(async () => {})` 不保证识别（需 data-flow analysis）。
 *   - 仅做结构匹配：db.transaction / obj.transaction / db['transaction'] 均识别，
 *     但运行时动态决定目标的情形（如通过变量持有方法引用）不在本扫描器覆盖范围内。
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

function isTransactionCall(node) {
  if (!node || node.type !== 'CallExpression' || !node.callee) return false;
  const callee = node.callee;
  // 1) 裸调用：transaction(...)
  if (callee.type === 'Identifier' && callee.name === 'transaction') return true;
  // 2) 成员调用：db.transaction(...) / obj.transaction(...)
  //    非 computed：property 为 Identifier 且 name === 'transaction'
  //    computed：db['transaction'](...) —— property 为 Literal 且 value === 'transaction'
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

// 找到 node 所属的函数作用域节点（用于 transit / nested 判定）
function enclosingFunction(ancestors) {
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const a = ancestors[i];
    if (
      a.type === 'FunctionDeclaration' ||
      a.type === 'FunctionExpression' ||
      a.type === 'ArrowFunctionExpression'
    ) {
      return a;
    }
  }
  return null;
}

// 找到调用点所属的逻辑作用域 label：优先 app.post/put/get 路由字符串，其次具名函数，最后 global
function scopeLabel(node, ancestors) {
  // 路由：向上找 `app.post('/x', ...)` / `router.post(...)` 等，首参为字符串字面量
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
  // 具名函数（含 const fn = () => {}）
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const a = ancestors[i];
    if (a.type === 'FunctionDeclaration' && a.id) return `fn:${a.id.name}`;
    if (
      (a.type === 'FunctionExpression' || a.type === 'ArrowFunctionExpression') &&
      a.id
    ) {
      return `fn:${a.id.name}`;
    }
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

// ---- 核心扫描 ----

function scanFile(filePath) {
  const code = fs.readFileSync(filePath, 'utf8');
  let ast;
  try {
    ast = parse(code);
  } catch (e) {
    return { file: path.basename(filePath), error: String(e.message), transactions: [] };
  }

  const transactions = []; // { node, line, callback, scope, async, fingerprint }
  const transitScopes = new Set(); // 包含 updateInventoryTransitData 调用的函数作用域节点

  // 单次遍历收集两类节点 + 上下文
  function walk(node, ancestors) {
    if (!node || typeof node.type !== 'string') return;

    if (isTransactionCall(node)) {
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
        // 指纹取自「回调源码片段」sha1（无回调时退回到调用表达式本身），
        // 与行号/作用域内序号无关 —— 这是 stable identity 的唯一依据。
        fingerprint: sha1(cb ? code.slice(cb.start, cb.end) : code.slice(node.start, node.end)),
      });
    }

    if (isTransitCall(node)) {
      const fn = enclosingFunction(ancestors);
      if (fn) transitScopes.add(fn);
    }

    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'start' || key === 'end' || key === 'range' || key === 'parent')
        continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (const c of child) if (c && c.type) walk(c, [...ancestors, node]);
      } else if (child && child.type) {
        walk(child, [...ancestors, node]);
      }
    }
  }
  walk(ast, []);

  // 嵌套判定：某 transaction T 的回调内部是否包含另一个 transaction O（O 严格位于 T.callback 区间内）
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

  // transit 判定：T.callback 所在作用域是否包含 updateInventoryTransitData 调用
  transactions.forEach((T) => {
    T.transit = !!(T.callback && transitScopes.has(T.callback));
  });

  return { file: path.basename(filePath), error: null, transactions };
}

// ---- 条目 / key / 比较 ----

function buildEntry(t) {
  const characteristic = [
    t.async ? 'async' : 'sync',
    t.nested ? 'nested' : '',
    t.transit ? 'transit' : '',
  ]
    .filter(Boolean)
    .join('+');
  return {
    file: t.file,
    line: t.line, // 辅助信息（显示用），不参与 key
    scope: t.scope,
    callbackType: t.async ? 'async' : 'sync',
    nested: !!t.nested,
    transit: !!t.transit,
    characteristic,
    fingerprint: t.fingerprint, // 辅助信息（显示用），但不单独作为 key
  };
}

/**
 * 稳定身份（stable identity）—— 不依赖行号 / 作用域内序号 / 契约特征：
 *   文件 + 路由或函数作用域 + 回调源码指纹(sha1)
 * 该身份在以下变化下保持稳定：
 *   - 前面插入/删除代码导致行号漂移
 *   - 同作用域内其它 transaction 被删除导致 ordinal 重排
 *   - 该调用点的「特征」变化（如 async→sync、去掉 transit），因为特征不进入 key，
 *     修复后该点会从 violations 中消失（removed），而不会误报成「新增违规」。
 * 已知局限：同一作用域内若两个 transaction 回调源码逐字相同，会共享同一指纹 →
 *   退化为一个身份（修复其一无法被单独计数）。当前 29 处违规指纹均不重复，见报告。
 */
function stableKey(entry) {
  return `${entry.file}::${entry.scope}::${entry.fingerprint}`;
}

function analyze(files) {
  const all = [];
  files.forEach((f) => {
    const r = scanFile(f);
    if (r.error) {
      // 解析失败不应导致基线崩溃，仅告警
      process.stderr.write(`[scan-tx-async] WARN 解析失败 ${r.file}: ${r.error}\n`);
      return;
    }
    r.transactions.forEach((t) => all.push(buildEntry(t)));
  });

  // 仅用于「显示」的作用域内序号：同文件+同 scope 按行号排序后编号（不参与 key）
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

  const violations = all.filter((e) => e.callbackType === 'async' || e.nested || e.transit);
  const summary = {
    total: all.length,
    async: all.filter((e) => e.callbackType === 'async').length,
    nested: all.filter((e) => e.nested).length,
    transit: all.filter((e) => e.transit).length,
    syncOk: all.filter((e) => e.callbackType === 'sync' && !e.nested && !e.transit).length,
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

// ---- CLI ----

function main() {
  const argv = process.argv.slice(2);
  const mode = argv.find((a) => a === '--baseline' || a === '--check') || 'summary';
  const fileArgs = argv.filter((a) => !a.startsWith('--'));
  const files = fileArgs.length ? fileArgs.map((f) => path.resolve(f)) : DEFAULT_FILES;

  if (!files.length) {
    process.stderr.write('[scan-tx-async] 未找到可扫描文件（server.js/app.js）\n');
    process.exit(2);
  }

  const { entries, violations, summary } = analyze(files);

  if (mode === '--baseline') {
    // 冻结保护：若已存在「frozen」基线且未显式 --force，拒绝覆盖（防误刷）。
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
            '  仅 Final Guard Batch 在 current violations = 0 之后，才允许 --baseline --force 重新生成 / 删除切换 zero-tolerance。\n'
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
        `  total=${summary.total} async=${summary.async} nested=${summary.nested} transit=${summary.transit} syncOk=${summary.syncOk}\n`
    );
    return;
  }

  if (mode === '--check') {
    if (!fs.existsSync(BASELINE_PATH)) {
      process.stderr.write('[scan-tx-async] 基线不存在，请先运行 --baseline\n');
      process.exit(2);
    }
    const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
    const res = compare(violations, baseline.violations || []);
    process.stdout.write(
      `读取冻结基线(frozen=${baseline.frozen === true}); ` +
        `当前 total=${summary.total} async=${summary.async} nested=${summary.nested} transit=${summary.transit}\n`
    );
    if (res.hasNew) {
      process.stdout.write(`发现 ${res.newViolations.length} 个新增违规位置（基线之外）：\n`);
      res.newViolations.forEach((e) =>
        process.stdout.write(`  + ${e.key}  (${e.file}:${e.line})\n`)
      );
      process.stdout.write('FAIL: 存在新增 transaction(async)/nested 违规\n');
      process.exit(1);
    }
    process.stdout.write(
      `OK: 无新增违规（已消除 ${res.removedViolations.length} 个旧违规；允许逐步减少，但不得新增）\n`
    );
    return;
  }

  // summary
  process.stdout.write(
    `total=${summary.total} async=${summary.async} nested=${summary.nested} transit=${summary.transit} syncOk=${summary.syncOk}\n`
  );
  violations.forEach((e) => process.stdout.write(`  violation: ${e.key}  (${e.file}:${e.line})\n`));
}

module.exports = {
  scanFile,
  analyze,
  buildEntry,
  stableKey,
  keyOf: stableKey, // 兼容别名
  compare,
  BASELINE_PATH,
  DEFAULT_FILES,
};

if (require.main === module) {
  main();
}
