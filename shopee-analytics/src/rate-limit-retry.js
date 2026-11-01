'use strict';

/**
 * Shopee Open Platform 限流退避策略
 * ============================================================================================
 * 背景：Shopee 广告类接口对单店铺有 QPS 限制，超限返回
 *   - HTTP 429，或
 *   - error code `ads_rate_limit_shop_api`
 * src/shopee-client.js 已把这类错误标记为 `err.kind === 'RATE_LIMIT'`，
 * 并在响应带 `Retry-After` 时解析出 `err.retryAfterSeconds`，但此前没有任何消费方，
 * 限流会直接冒泡为一次同步失败。
 *
 * 策略（对齐项目全局规则「严格遵守平台API限流，增加节流、退避策略，避免店铺API被封禁」）：
 *   1. 只对可重试错误退避：RATE_LIMIT，以及 5xx / 429 这类瞬时服务端错误。
 *      4xx 业务错误（参数非法、权限不足等）不重试 —— 重试不会变好，只会放大限流。
 *   2. 退避时长：服务端给了 Retry-After 就以它为准（这是平台的权威节流指示）；
 *      没给则用指数退避 baseDelayMs * 2^(attempt-1)，并叠加随机抖动（jitter），
 *      避免多店铺/多 worker 同时醒来形成惊群。
 *   3. 等待时长受 maxDelayMs 封顶，避免平台返回异常大的 Retry-After 时把同步卡死。
 *   4. 尝试次数受 maxAttempts 限制；用尽后抛出最后一次错误，保留原始 kind/status/code/requestId，
 *      让上层 sync 状态机照旧记录真实失败原因。
 *
 * 只读约束：本模块不改变任何请求语义，也不引入写操作。
 */

const DEFAULT_MAX_ATTEMPTS = 4;
const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 60000;

/** 判断错误是否值得退避重试。 */
function isRetryableError(error) {
  if (!error) return false;
  if (error.kind === 'RATE_LIMIT') return true;
  const status = Number(error.status);
  if (!Number.isFinite(status)) return false;
  // 429 与 5xx 属于瞬时故障；其余 4xx 是请求本身有问题，重试无意义。
  return status === 429 || status >= 500;
}

/**
 * 计算第 attempt 次失败后应等待的毫秒数。
 *
 * @param {object} params
 * @param {number} params.attempt 已失败次数（1 表示第一次失败后）
 * @param {number} [params.baseDelayMs] 指数退避基数
 * @param {number} [params.maxDelayMs] 单次等待上限
 * @param {number} [params.retryAfterSeconds] 服务端 Retry-After（秒）
 * @param {() => number} [params.random] 随机源（便于测试注入）
 * @returns {number} 等待毫秒数
 */
function computeBackoffDelay({
  attempt,
  baseDelayMs = DEFAULT_BASE_DELAY_MS,
  maxDelayMs = DEFAULT_MAX_DELAY_MS,
  retryAfterSeconds,
  random = Math.random,
} = {}) {
  const safeBase = Math.max(0, Number(baseDelayMs) || 0);
  const safeMax = Math.max(0, Number(maxDelayMs) || 0);
  const cap = safeMax > 0 ? safeMax : Number.POSITIVE_INFINITY;

  // 平台明确给了 Retry-After 时以平台为准，但仍受 maxDelayMs 封顶，
  // 防止异常大的响应头把整轮同步卡死。
  const retryAfter = Number(retryAfterSeconds);
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1000, cap);
  }

  const exponential = safeBase * Math.pow(2, Math.max(0, attempt - 1));
  const bounded = Math.min(exponential, cap);
  // 抖动取 [50%, 100%) 区间：既保证一定退避，也打散同步重试。
  const jitter = bounded * (0.5 + 0.5 * random());
  return Math.max(0, Math.round(jitter));
}

/**
 * 以退避策略执行一次请求。
 *
 * @param {() => Promise<any>} fn 实际请求函数
 * @param {object} [options]
 * @param {number} [options.maxAttempts] 最大尝试次数（含首次）
 * @param {number} [options.baseDelayMs]
 * @param {number} [options.maxDelayMs]
 * @param {(ms: number) => Promise<void>} [options.sleep] 等待实现（便于测试注入）
 * @param {(info: object) => void} [options.onRetry] 每次重试前的回调（用于日志）
 * @returns {Promise<any>} 成功结果
 */
async function withRateLimitRetry(fn, options = {}) {
  const maxAttempts = Math.max(1, Number(options.maxAttempts) || DEFAULT_MAX_ATTEMPTS);
  const sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      return await fn();
    } catch (error) {
      if (attempt >= maxAttempts || !isRetryableError(error)) throw error;
      const delayMs = computeBackoffDelay({
        attempt,
        baseDelayMs: options.baseDelayMs,
        maxDelayMs: options.maxDelayMs,
        retryAfterSeconds: error && error.retryAfterSeconds,
        random: options.random,
      });
      if (typeof options.onRetry === 'function') {
        options.onRetry({
          attempt,
          delayMs,
          kind: error && error.kind,
          status: error && error.status,
          code: error && error.code,
          requestId: error && error.requestId,
        });
      }
      if (delayMs > 0) await sleep(delayMs);
    }
  }
}

module.exports = {
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_BASE_DELAY_MS,
  DEFAULT_MAX_DELAY_MS,
  isRetryableError,
  computeBackoffDelay,
  withRateLimitRetry,
};
