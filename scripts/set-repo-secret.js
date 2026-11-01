#!/usr/bin/env node
'use strict';

/**
 * 写入 GitHub repository secret。
 * ============================================================================================
 * GitHub 的 secret 用仓库公钥加密。公钥是 Curve25519（32 字节），
 * 加密方式是 libsodium 的 sealed box（`crypto_box_seal`）：
 *
 *   nonce = blake2b(ephemeral_public_key || recipient_public_key) 前 24 字节
 *   ciphertext = ephemeral_public_key || XSalsa20-Poly1305(明文, nonce, 共享密钥)
 *
 * `crypto_box_seal` 需要 XSalsa20-Poly1305（24 字节 nonce），Node 内置的
 * chacha20-poly1305 只支持 12 字节 nonce，不兼容，因此这里用 libsodium。
 *
 * 用法：
 *   node scripts/set-repo-secret.js <NAME> <value>
 *   node scripts/set-repo-secret.js <NAME> --file <path>    # 多行内容用这个（私钥）
 */

const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');

const REPO = process.env.GITHUB_REPOSITORY || 'Hitech-Global/psi-inventory';
const API = 'https://api.github.com';
const SODIUM_DIR = path.join(os.tmpdir(), 'workbuddy-libsodium');

function gitHubToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  const { execFileSync } = require('child_process');
  const out = execFileSync('git', ['credential-osxkeychain', 'get'], {
    input: 'protocol=https\nhost=github.com\n\n',
    encoding: 'utf8',
  });
  const match = out.match(/^password=(.+)$/m);
  if (!match) throw new Error('无法从 git credential 读取 GitHub token');
  return match[1].trim();
}

function api(method, endpoint, body) {
  const token = gitHubToken();
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = https.request(`${API}${endpoint}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'user-agent': 'set-repo-secret',
        ...(payload ? { 'content-length': Buffer.byteLength(payload) } : {}),
      },
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed = null;
        try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(parsed);
        const message = parsed && parsed.message ? parsed.message : text;
        reject(new Error(`${method} ${endpoint} → HTTP ${res.statusCode}: ${message}`));
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * 载入 libsodium。装在临时目录里，不进项目的依赖 —— 这个脚本只在
 * 配置部署凭据时用一次，不值得给主项目加一个原生依赖。
 */
async function loadSodium() {
  const modulePath = path.join(SODIUM_DIR, 'node_modules', 'libsodium-wrappers');
  try {
    return require(modulePath);
  } catch {
    /* 还没装，继续 */
  }
  const { execFileSync } = require('child_process');
  fs.mkdirSync(SODIUM_DIR, { recursive: true });
  execFileSync('npm', ['install', 'libsodium-wrappers', '--silent', '--no-audit', '--no-fund'], {
    cwd: SODIUM_DIR,
    stdio: 'inherit',
  });
  return require(modulePath);
}

/**
 * sealed box 加密。
 *
 * crypto_box_seal 内部：临时密钥对 → nonce = blake2b(eph_pk || pk) 前24字节
 * → crypto_box_easy(明文, nonce, 收件方公钥, 临时私钥) → 前面拼上 eph_pk。
 */
function sealedBox(sodium, plaintext, recipientPublicKey) {
  if (recipientPublicKey.length !== 32) {
    throw new Error(`公钥长度应为 32 字节，实际 ${recipientPublicKey.length}`);
  }
  const ephemeral = sodium.crypto_box_keypair();
  const nonce = sodium.crypto_generichash(
    24,
    Buffer.concat([ephemeral.publicKey, recipientPublicKey]),
  );
  const box = sodium.crypto_box_easy(
    plaintext,
    nonce,
    recipientPublicKey,
    ephemeral.privateKey,
  );
  return Buffer.concat([ephemeral.publicKey, box]);
}

async function main() {
  const [name, ...rest] = process.argv.slice(2);
  if (!name || !rest.length) {
    console.error('用法: node scripts/set-repo-secret.js <NAME> <value>');
    console.error('      node scripts/set-repo-secret.js <NAME> --file <path>');
    process.exit(1);
  }

  let value;
  if (rest[0] === '--file') {
    const file = path.resolve(rest[1]);
    // 私钥文件末尾常带换行，去掉以免被当作内容的一部分
    value = fs.readFileSync(file, 'utf8').replace(/\n+$/, '');
  } else {
    value = rest.join(' ');
  }

  const sodium = await loadSodium();
  await sodium.ready;

  const { key, key_id: keyId } = await api('GET', `/repos/${REPO}/actions/secrets/public-key`);
  const publicKey = Buffer.from(key, 'base64');
  const encrypted = sealedBox(sodium, Buffer.from(value, 'utf8'), publicKey).toString('base64');

  await api('PUT', `/repos/${REPO}/actions/secrets/${encodeURIComponent(name)}`, {
    encrypted_value: encrypted,
    key_id: keyId,
  });

  const listed = await api('GET', `/repos/${REPO}/actions/secrets`);
  const names = (listed.secrets || []).map(s => s.name);
  console.log(`✅ ${name} 已写入（当前 secrets: ${names.join(', ') || '无'}）`);
}

main().catch(error => {
  console.error(`❌ ${error.message}`);
  process.exit(1);
});
