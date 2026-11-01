'use strict';

/**
 * TikTok Shop 签名器测试。
 * 官方示例向量来自《Sign your API request》文档本身，
 * 用于确认实现与平台一致 —— 签名算法错一个字符就是 401。
 */

const assert = require('assert');
const {
  buildSigningString,
  buildSignedQuery,
  signRequest,
  sortedKeys,
} = require('../src/tiktok-signer');

// 官方文档示例：Get Authorized Shops
const OFFICIAL = {
  appKey: '29a39d',
  appSecret: 'e59af819cc',
  path: '/authorization/202309/shops',
  timestamp: 1623812664,
  expectedSign: 'b596b73e0cc6de07ac26f036364178ab16b0a907af13d43f0a0cd2345f582dc8',
};

// 官方示例向量：签名必须与文档给出的值完全一致
assert.strictEqual(
  signRequest({
    appSecret: OFFICIAL.appSecret,
    path: OFFICIAL.path,
    query: { app_key: OFFICIAL.appKey, timestamp: OFFICIAL.timestamp },
  }),
  OFFICIAL.expectedSign,
);

// 文档第 4 步后的中间串：路径 + 排序后的 {key}{value}
assert.strictEqual(
  buildSigningString({
    path: OFFICIAL.path,
    query: { app_key: OFFICIAL.appKey, timestamp: OFFICIAL.timestamp },
  }),
  OFFICIAL.path + 'app_key29a39dtimestamp1623812664',
);

// 完整 query：app_key + timestamp + sign
assert.deepStrictEqual(
  buildSignedQuery({
    appKey: OFFICIAL.appKey,
    appSecret: OFFICIAL.appSecret,
    path: OFFICIAL.path,
    timestamp: OFFICIAL.timestamp,
  }),
  {
    app_key: OFFICIAL.appKey,
    timestamp: OFFICIAL.timestamp,
    sign: OFFICIAL.expectedSign,
  },
);

// sign 与 access_token 不参与签名
assert.deepStrictEqual(
  sortedKeys({ sign: 'x', access_token: 'y', app_key: 'k', timestamp: '1' }),
  ['app_key', 'timestamp'],
);

// 遗留的 sign / access_token 不得影响签名结果
const baseSign = signRequest({
  appSecret: OFFICIAL.appSecret,
  path: OFFICIAL.path,
  query: { app_key: OFFICIAL.appKey, timestamp: OFFICIAL.timestamp },
});
assert.strictEqual(
  signRequest({
    appSecret: OFFICIAL.appSecret,
    path: OFFICIAL.path,
    query: {
      app_key: OFFICIAL.appKey,
      timestamp: OFFICIAL.timestamp,
      sign: 'stale-value',
      access_token: 'legacy-token',
    },
  }),
  baseSign,
);

// shop_cipher 存在时必须参与签名
assert.notStrictEqual(
  signRequest({
    appSecret: OFFICIAL.appSecret,
    path: '/order/202309/orders',
    query: {
      app_key: OFFICIAL.appKey,
      timestamp: OFFICIAL.timestamp,
      shop_cipher: 'cipher-value',
    },
  }),
  signRequest({
    appSecret: OFFICIAL.appSecret,
    path: '/order/202309/orders',
    query: { app_key: OFFICIAL.appKey, timestamp: OFFICIAL.timestamp },
  }),
);

// 参数按字典序排序，与插入顺序无关
const sortedA = buildSigningString({
  path: '/x',
  query: { timestamp: '1', app_key: 'k', zz: 'z', aa: 'a' },
});
const sortedB = buildSigningString({
  path: '/x',
  query: { aa: 'a', zz: 'z', app_key: 'k', timestamp: '1' },
});
assert.strictEqual(sortedA, sortedB);
assert.strictEqual(sortedA, '/xaaaapp_keyktimestamp1zzz');

// 非 multipart 的请求体参与签名
assert.strictEqual(
  buildSigningString({
    path: '/x',
    query: { app_key: 'k' },
    body: '{"a":1}',
    contentType: 'application/json',
  }),
  '/xapp_keyk{"a":1}',
);

// multipart/form-data 的请求体不参与签名
assert.strictEqual(
  buildSigningString({
    path: '/x',
    query: { app_key: 'k' },
    body: 'binary-ish-body',
    contentType: 'multipart/form-data; boundary=xyz',
  }),
  '/xapp_keyk',
);

// 文档要求用实际发送的原始字节：空白差异会改变签名
assert.notStrictEqual(
  buildSigningString({ path: '/x', query: { app_key: 'k' }, body: '{"a":1,"b":2}' }),
  buildSigningString({ path: '/x', query: { app_key: 'k' }, body: '{"a": 1, "b": 2}' }),
);

// 缺少 app secret 或 path 时必须报错
assert.throws(
  () => signRequest({ appSecret: '', path: '/x' }),
  /appSecret must be a non-empty string/,
);
assert.throws(
  () => signRequest({ appSecret: 'secret', path: '' }),
  /path must be a non-empty string/,
);

// null 与 undefined 的参数值被跳过
assert.strictEqual(
  buildSigningString({
    path: '/x',
    query: { app_key: 'k', missing: undefined, empty: null },
  }),
  '/xapp_keyk',
);

console.log('tiktok signer tests passed');
