'use strict';

/**
 * CI 触发契约测试
 * ============================================================================================
 * 背景：本仓库的 Shopee Analytics CI 最初只有 `pull_request` 触发。
 * 直接 push 到 `feat/shopee-analytics-v1-foundation` 的提交不会触发任何检查，
 * 曾出现过「标签契约被破坏、但分支 HEAD 从未跑过 CI」的情况
 * （commit 0589bec 引入旧式 Broad ROAS 标签，check-runs 为 0）。
 *
 * 本测试断言：
 *   1. push 触发器存在，且覆盖本开发分支；
 *   2. push 与 pull_request 的 paths 过滤保持一致，避免两条路径覆盖面不同；
 *   3. 纯测试步骤确实执行了完整套件（run-all.cjs）而非只跑个别文件。
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
const workflowPath = path.join(REPO, '.github', 'workflows', 'shopee-analytics-ci.yml');
const yml = fs.readFileSync(workflowPath, 'utf8');

// ---- push 触发器必须覆盖开发分支 ----------------------------------------------
assert.match(
  yml,
  /push:\s*\n\s*branches:\s*\n(?:\s*-\s*"[^"]+"\s*\n)+/,
  'CI 必须配置 push 触发器（直推分支不得绕过校验）'
);
assert.match(
  yml,
  /push:[\s\S]*?branches:[\s\S]*?-\s*"feat\/shopee-analytics-v1-foundation"/,
  'push 触发器必须覆盖 feat/shopee-analytics-v1-foundation'
);

// ---- push 与 pull_request 的 paths 过滤必须一致 -------------------------------
const pullRequestBlock = yml.slice(yml.indexOf('pull_request:'), yml.indexOf('push:'));
const pushBlock = yml.slice(yml.indexOf('push:'), yml.indexOf('workflow_dispatch:'));

const extractPaths = block => {
  const pathsIndex = block.indexOf('paths:');
  if (pathsIndex < 0) return null;
  const rest = block.slice(pathsIndex + 'paths:'.length);
  const paths = [];
  for (const line of rest.split('\n')) {
    const match = line.match(/^\s*-\s*"([^"]+)"\s*$/);
    if (match) paths.push(match[1]);
    else if (paths.length && line.trim() && !line.trim().startsWith('-')) break;
  }
  return paths;
};

const pullRequestPaths = extractPaths(pullRequestBlock);
const pushPaths = extractPaths(pushBlock);
assert.ok(pullRequestPaths && pullRequestPaths.length, 'pull_request 必须保留 paths 过滤');
assert.deepStrictEqual(
  pushPaths,
  pullRequestPaths,
  'push 与 pull_request 的 paths 过滤必须一致，否则两条路径覆盖面不同'
);

// ---- 必须真的跑完整套件与 PG 集成 ---------------------------------------------
assert.match(
  yml,
  /run:\s*node shopee-analytics\/test\/run-all\.cjs/,
  'CI 必须运行完整套件 shopee-analytics/test/run-all.cjs'
);
assert.match(
  yml,
  /run:\s*node shopee-analytics\/test\/postgres\.integration\.cjs/,
  'CI 必须运行 PostgreSQL 集成测试'
);
assert.match(
  yml,
  /SHOPEE_ANALYTICS_TEST_DATABASE_URL:/,
  'PG 集成测试必须注入隔离数据库连接串'
);

console.log('Shopee Analytics CI trigger contract: ok');
