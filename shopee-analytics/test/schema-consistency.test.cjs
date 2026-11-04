'use strict';

/**
 * schema 文件之间的一致性。
 *
 * ★ 为什么需要这个测试
 * --------------------
 * 同一个数据库约束可能被**多个** schema 文件定义（这里就是
 * `shopee_oauth_states_app_role_check`）。如果它们给的清单不一样，
 * 就会出现这种情况：
 *
 *   schema.sql                      先执行，把约束放宽到 8 个应用
 *   schema-brand-portal-principal.sql  后执行，把约束收紧到 3 个
 *
 * 而生产库里已经有 VIDEO、ONLINE 的授权行 —— 收紧后既存数据违反约束，
 * `ADD CONSTRAINT` 直接失败，**整个 schema 应用中断**，部署卡死。
 *
 * 报出来的错是「check constraint ... is violated by some row」，
 * 看起来像是数据有问题、或者 schema 写得不对，
 * 真正的原因却是两个文件对同一约束给了不同的定义。
 * 这类问题靠人读代码很难发现，所以用测试锁住。
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const applySchema = fs.readFileSync(path.join(root, 'scripts', 'apply-schema.cjs'), 'utf8');

/** 从 apply-schema.cjs 里取出实际会执行的文件清单。 */
function schemaFiles() {
  const match = applySchema.match(/const SCHEMA_FILES = \[([\s\S]*?)\]/);
  assert.ok(match, '找不到 SCHEMA_FILES 清单');
  return match[1]
    .split(',')
    .map(name => name.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

/**
 * 取出某个文件里某个约束的 CHECK 清单。
 *
 * @param {string} file
 * @param {string} constraintName
 * @returns {Array<string>|null} 找不到返回 null
 */
function readConstraintValues(file, constraintName) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  // 只取 ADD CONSTRAINT 那一段（前面有 DROP CONSTRAINT IF EXISTS 的不算）。
  const pattern = new RegExp(
    'ADD\\s+CONSTRAINT\\s+' + constraintName + '\\s*\\n?\\s*CHECK\\s*\\(([^;]*?)\\)\\s*;',
    'is',
  );
  const match = text.match(pattern);
  if (!match) return null;
  return [...match[1].matchAll(/'([^']+)'/g)].map(item => item[1]).sort();
}

function testEverySchemaFileIsConsistent() {
  const files = schemaFiles();
  assert.ok(files.length >= 2, 'SCHEMA_FILES 清单异常');

  const constraintName = 'shopee_oauth_states_app_role_check';
  const definitions = [];
  for (const file of files) {
    const values = readConstraintValues(file, constraintName);
    if (values) definitions.push({ file, values });
  }

  assert.ok(definitions.length >= 2, '没有找到多个定义该约束的文件 —— 本测试需要至少两个');

  // ★ 所有定义必须完全一致。
  const first = definitions[0];
  for (const other of definitions.slice(1)) {
    assert.deepStrictEqual(
      other.values,
      first.values,
      `schema 文件对约束 ${constraintName} 的定义不一致：`
      + `\n  ${first.file} → ${first.values.join(', ')}`
      + `\n  ${other.file} → ${other.values.join(', ')}`
      + '\n不一致会导致后执行的那个把约束收紧，'
      + '既存数据违反约束 → schema 应用整体失败 → 部署卡死。',
    );
  }
}

function testConstraintCoversAllKnownRoles() {
  const values = readConstraintValues('schema.sql', 'shopee_oauth_states_app_role_check');
  assert.ok(values, 'schema.sql 里找不到该约束');
  // 仓库里用到的应用角色都应该在清单里 ——
  // 少一个就意味着那个应用的授权行写不进去。
  const roles = [
    'ADS', 'ERP', 'BRAND_PORTAL', 'MARKETING',
    'STORE_OPS_BRAIN', 'ORDER_ANALYSIS', 'VIDEO', 'ONLINE',
  ];
  for (const role of roles) {
    assert.ok(values.includes(role), `约束清单缺少 ${role}`);
  }
}

function testAppliedFileIsInSchema() {
  // apply-schema.cjs 里的每个文件都必须真实存在 —— 少一个就是静默跳过。
  for (const file of schemaFiles()) {
    assert.ok(
      fs.existsSync(path.join(root, file)),
      `SCHEMA_FILES 列了 ${file}，但文件不存在`,
    );
  }
}

const tests = [
  ['各 schema 文件对同一约束的定义一致', testEverySchemaFileIsConsistent],
  ['约束清单覆盖所有应用角色', testConstraintCoversAllKnownRoles],
  ['SCHEMA_FILES 列出的文件都存在', testAppliedFileIsInSchema],
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
  process.stdout.write(`schema consistency tests passed (${passed} cases)\n`);
}

main().catch((error) => {
  process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
  process.exit(1);
});
