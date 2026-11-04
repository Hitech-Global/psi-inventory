'use strict';

/**
 * import 契约：每个从相对路径 import 的名字，目标模块必须真的导出它。
 *
 * ★ 为什么需要这个测试
 * --------------------
 * 本次线上事故的直接原因是一行 import 写错了模块：
 *
 *   const { loadTikTokRateLimitRetryOptions } = require('./rate-limit-retry');
 *
 * 而那个函数实际在 `./tiktok-token-manager`。
 * 结果：app 容器启动即抛
 *   TypeError: loadTikTokRateLimitRetryOptions is not a function
 * 容器进入无限重启，线上一直是旧版本 —— 而**所有测试都是绿的**，
 * 因为语法检查只验语法，测试也不加载这个装配路径。
 *
 * 所以「语法对」与「能跑起来」之间还有一道缝，这道缝就是 import 的名字对不对。
 * 这个测试补的就是这道缝。
 *
 * ★ 为什么不用 require 直接加载整个模块
 *   有些模块在加载时就会连数据库或读环境变量，直接 require 会失败。
 *   所以这里只**静态读**导出表（module.exports 里的键），不执行模块。
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'src');

/**
 * 解析一个模块路径（补 .js / index.js）。
 *
 * @param {string} fromFile
 * @param {string} request
 * @returns {string|null}
 */
function resolveModule(fromFile, request) {
  const base = path.resolve(path.dirname(fromFile), request);
  for (const candidate of [base, `${base}.js`, path.join(base, 'index.js')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/**
 * 静态读出一个模块导出的名字。
 *
 * 不执行模块 —— 只看源码里的 module.exports。
 *
 * ★ 一个文件里可能有**多处** module.exports（后写的覆盖先写的），
 *   所以要把所有处的导出名取并集。
 *   只取第一处会漏掉后来补上的名字 —— shop-health-evaluation.js 就是这样：
 *   前面导出了 4 个，后面又导出 8 个，真正生效的是后面那份。
 *
 * ★ 两种写法都要认：
 *   module.exports = { a, b, c };                       单行
 *   module.exports = {                                    多行
 *     a,
 *     b,
 *   };
 *
 * @param {string} file
 * @returns {Set<string>}
 */
function readExports(file) {
  const text = fs.readFileSync(file, 'utf8');
  const names = new Set();

  let cursor = -1;
  while ((cursor = text.indexOf('module.exports', cursor + 1)) >= 0) {
    const open = text.indexOf('{', cursor);
    if (open < 0) continue;
    // 用括号配对找结尾 —— 正则的非贪婪匹配会在遇到花括号里的第一个 `}` 时就停。
    let depth = 0;
    let end = -1;
    for (let i = open; i < text.length; i += 1) {
      const ch = text[i];
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end <= open) continue;

    const body = text.slice(open + 1, end);
    // 按顶层逗号切分 —— 嵌套的对象/数组里也有逗号，要跳过。
    let level = 0;
    let current = '';
    const parts = [];
    for (const ch of body) {
      if (ch === '{' || ch === '[' || ch === '(') level += 1;
      if (ch === '}' || ch === ']' || ch === ')') level -= 1;
      if (ch === ',' && level === 0) {
        parts.push(current);
        current = '';
        continue;
      }
      current += ch;
    }
    if (current.trim()) parts.push(current);

    for (const raw of parts) {
      const part = raw.trim();
      if (!part) continue;
      // 有别名时（a: b）导出的是左边那个名字。
      const name = part.split(':')[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }

  // 也有 module.exports.foo = 形式。
  for (const m of text.matchAll(/module\.exports\.([A-Za-z_$][\w$]*)\s*=/g)) {
    names.add(m[1]);
  }
  return names;
}

/**
 * 检查一个文件里的相对路径 import。
 *
 * @param {string} file
 * @returns {Array<string>} 问题描述
 */
function checkImports(file) {
  const text = fs.readFileSync(file, 'utf8');
  const problems = [];
  const pattern = /const \{([^}]+)\}\s*=\s*require\('(\.[^']+)'\)/g;
  for (const match of text.matchAll(pattern)) {
    const [, namesBlock, request] = match;
    const target = resolveModule(file, request);
    if (!target) {
      problems.push(`${request} —— 文件不存在`);
      continue;
    }
    const exports = readExports(target);
    for (const raw of namesBlock.split(',')) {
      const part = raw.trim();
      if (!part) continue;
      // `a: b` 形式导入的是 a（左边是原模块里的名字）。
      const original = part.split(':')[0].trim();
      if (!/^[A-Za-z_$][\w$]*$/.test(original)) continue;
      if (!exports.has(original)) {
        problems.push(`${request} 没有导出 ${original}`);
      }
    }
  }
  return problems;
}

/** 递归列出 src 下的 js 文件。 */
function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

function testEveryRelativeImportResolves() {
  const files = walk(srcDir);
  const problems = [];
  for (const file of files) {
    for (const problem of checkImports(file)) {
      problems.push(`${path.basename(file)}: ${problem}`);
    }
  }
  assert.deepStrictEqual(
    problems,
    [],
    '以下 import 指向的名字在目标模块里不存在 —— 容器会启动即崩：\n  '
    + problems.join('\n  '),
  );
}

function testTheKnownBadImportStaysFixed() {
  // 具体盯住这次出事的那个 import ——
  // loadTikTokRateLimitRetryOptions 在 tiktok-token-manager，不在 rate-limit-retry。
  const server = fs.readFileSync(path.join(srcDir, 'standalone-server.js'), 'utf8');
  const wrong = /require\('\.\/rate-limit-retry'\)/.test(
    server.match(/const \{[^}]*loadTikTokRateLimitRetryOptions[^}]*\} = require\('[^']+'\);/)?.[0] || '',
  );
  assert.strictEqual(
    wrong, false,
    'loadTikTokRateLimitRetryOptions 从 rate-limit-retry 取是错的 —— 它在 tiktok-token-manager',
  );
  assert.match(
    server,
    /const \{ loadTikTokRateLimitRetryOptions \} = require\('\.\/tiktok-token-manager'\);/,
    'standalone-server 应从 tiktok-token-manager 取 loadTikTokRateLimitRetryOptions',
  );
}

const tests = [
  ['所有相对 import 的名字都真实存在', testEveryRelativeImportResolves],
  ['本次出错的 import 保持修复状态', testTheKnownBadImportStaysFixed],
];

async function main() {
  let passed = 0;
  const failures = [];
  for (const [name, fn] of tests) {
    try {
      await fn();
      passed += 1;
    } catch (error) {
      failures.push({ name, error });
    }
  }
  if (failures.length) {
    for (const f of failures) {
      process.stderr.write(`❌ ${f.name}\n   ${f.error && f.error.message}\n`);
    }
    throw new Error(`${failures.length} 个测试失败（共 ${tests.length} 个）`);
  }
  process.stdout.write(`import contract tests passed (${passed} cases)\n`);
}

main().catch((error) => {
  process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
  process.exit(1);
});
