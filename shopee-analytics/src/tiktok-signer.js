'use strict';

/**
 * TikTok Shop API 请求签名。
 * ============================================================================================
 * 依据官方《Sign your API request》：
 *   https://partner.tiktokshop.com/docv2/page/sign-your-api-request
 *   （文档正文经其只读 JSON 接口提取：document_id 678e3a3d4ddec3030b238faf, workspace_id 3）
 *
 * 算法（官方原文步骤）：
 *   1. 取全部 query 参数，**排除 `sign` 与 `access_token`**
 *   2. 参数名按字典序排序
 *   3. 依次拼接 `{key}{value}`
 *   4. 前面拼上请求路径（encoded path）
 *   5. 若 Content-Type 不是 multipart/form-data，**再拼上请求体的原始字节**
 *   6. 用 app secret 包住：`secret + input + secret`
 *   7. 以 app secret 为 HMAC-SHA256 密钥，输出小写 hex
 *
 * 两处容易做错的细节：
 *   - 请求体必须用**实际发送的原始字节**参与签名。解析后重新序列化会因字段顺序、
 *     空白、转义或字符集差异产生不同的签名。
 *   - API 版本 `202309` 及以后，access token 放在 `x-tts-access-token` 头里，
 *     不参与签名；旧版接口用 `access_token` 作为 query 参数时，也必须从签名里排除。
 */

const crypto = require('crypto');

const EXCLUDED_FROM_SIGNING = Object.freeze(['sign', 'access_token']);

function assertNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
}

/**
 * 按字典序排序参数名。默认用字符串比较，与官方的 sort.Slice(keys, keys[i] < keys[j]) 一致。
 */
function sortedKeys(query) {
  return Object.keys(query)
    .filter(key => !EXCLUDED_FROM_SIGNING.includes(key))
    .sort();
}

/**
 * 构造参与签名的字符串（HMAC 之前的明文部分）。
 *
 * @param {object} options
 * @param {string} options.path        请求路径，含前导斜杠，例如 '/authorization/202309/shops'
 * @param {object} options.query       query 参数对象
 * @param {string} [options.body]      请求体原始字符串；GET 请求为空
 * @param {string} [options.contentType] 请求的 Content-Type
 * @returns {string} 参与签名的明文串
 */
function buildSigningString({ path, query = {}, body = '', contentType = '' }) {
  assertNonEmptyString(path, 'path');

  const parts = [path];
  for (const key of sortedKeys(query)) {
    const value = query[key];
    if (value === undefined || value === null) continue;
    parts.push(key, String(value));
  }

  // multipart/form-data 的请求体不参与签名。
  if (!/^multipart\/form-data/i.test(contentType || '')) {
    if (body) parts.push(body);
  }

  return parts.join('');
}

/**
 * 计算请求签名。
 *
 * @param {object} options
 * @param {string} options.appSecret   app secret（HMAC 密钥，同时用于包裹待签名串）
 * @param {string} options.path        请求路径
 * @param {object} [options.query]     query 参数对象（会排除 sign 与 access_token）
 * @param {string} [options.body]      请求体原始字符串
 * @param {string} [options.contentType] Content-Type
 * @returns {string} 小写 hex 签名
 */
function signRequest({ appSecret, path, query = {}, body = '', contentType = '' }) {
  assertNonEmptyString(appSecret, 'appSecret');
  const payload = buildSigningString({ path, query, body, contentType });
  return crypto
    .createHmac('sha256', appSecret)
    .update(appSecret + payload + appSecret, 'utf8')
    .digest('hex');
}

/**
 * 生成带签名的 query 参数对象：app_key、timestamp、sign 加上调用方的参数。
 * 官方要求 app_key 与 timestamp 参与签名，因此它们必须在计算签名前就进入 query。
 *
 * @param {object} options
 * @param {string} options.appKey
 * @param {string} options.appSecret
 * @param {string} options.path
 * @param {object} [options.query]     额外的 query 参数
 * @param {string} [options.body]      请求体原始字符串
 * @param {string} [options.contentType] Content-Type
 * @param {number} [options.timestamp] 时间戳（秒），默认当前时间
 * @returns {object} 含 sign 的完整 query 参数对象
 */
function buildSignedQuery({
  appKey,
  appSecret,
  path,
  query = {},
  body = '',
  contentType = '',
  timestamp = Math.floor(Date.now() / 1000),
}) {
  assertNonEmptyString(appKey, 'appKey');
  const signedQuery = { ...query, app_key: appKey, timestamp };
  const sign = signRequest({
    appSecret,
    path,
    query: signedQuery,
    body,
    contentType,
  });
  return { ...signedQuery, sign };
}

module.exports = {
  EXCLUDED_FROM_SIGNING,
  buildSigningString,
  buildSignedQuery,
  signRequest,
  sortedKeys,
};
