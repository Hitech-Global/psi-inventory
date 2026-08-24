// 订单预测「建议采购」手工输入保护层（前端 manual override）单元测试。
// 直接抽取 app.js 中真实的 rpGetManualStock / rpSetManualStock / rpClearManualStock
// 进行校验，确保「未设置 vs 显式 0」「渠道隔离」「清除」语义正确（对应验收用例 1、10）。
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');

function extract(name) {
  const start = src.indexOf('function ' + name);
  if (start < 0) throw new Error('not found: ' + name);
  let depth = 0;
  let i = src.indexOf('{', start);
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error('unbalanced braces: ' + name);
}

global.window = {};
const code =
  extract('rpGetManualStock') + '\n' +
  extract('rpSetManualStock') + '\n' +
  extract('rpClearManualStock');
eval(code);

let failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL: ' + msg); failed++; }
  else { console.log('ok:   ' + msg); }
}

// 1. 未设置 → undefined（用于「未设置时回退系统值」判断）
assert(rpGetManualStock('online', 'r1') === undefined, 'unset returns undefined');

// 2. 显式输入 0 → 0（关键：不能被系统值覆盖，对应验收用例 1 的 SKU B=0）
rpSetManualStock('online', 'r1', 0);
assert(rpGetManualStock('online', 'r1') === 0, 'explicit 0 preserved (=== 0, not undefined)');

// 3. 普通值保留
rpSetManualStock('online', 'r2', 174);
assert(rpGetManualStock('online', 'r2') === 174, 'explicit 174 preserved');

// 4. 线上/线下按 channel 隔离（对应验收用例 10：online=100 / offline=200 不串值）
rpSetManualStock('online', 'r3', 100);
rpSetManualStock('offline', 'r3', 200);
assert(
  rpGetManualStock('online', 'r3') === 100 && rpGetManualStock('offline', 'r3') === 200,
  'online/offline isolated per channel'
);

// 5. 清除后回到未设置
rpClearManualStock();
assert(
  rpGetManualStock('online', 'r1') === undefined &&
  rpGetManualStock('offline', 'r3') === undefined,
  'rpClearManualStock clears all'
);

// 6. 一个 key 被设置不影响同渠道其它 key 的取值
rpSetManualStock('online', 'r9', 5);
assert(rpGetManualStock('online', 'rX') === undefined, 'unrelated key still undefined');

console.log(failed ? ('\n' + failed + ' assertion(s) FAILED') : '\nALL PASSED');
process.exit(failed ? 1 : 0);
