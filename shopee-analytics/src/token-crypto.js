'use strict';

const crypto = require('crypto');

function loadMasterKey(env = process.env) {
  const raw = env.SHOPEE_TOKEN_MASTER_KEY;
  if (!raw) throw new Error('SHOPEE_TOKEN_MASTER_KEY is required');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('SHOPEE_TOKEN_MASTER_KEY must be base64 for exactly 32 bytes');
  }
  return key;
}

function encryptTokenBundle(bundle, key) {
  if (!key || key.length !== 32) throw new Error('32-byte encryption key is required');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(bundle), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    tokenBlob: encrypted.toString('base64'),
    tokenIv: iv.toString('base64'),
    tokenTag: tag.toString('base64'),
  };
}

function decryptTokenBundle({ tokenBlob, tokenIv, tokenTag }, key) {
  if (!key || key.length !== 32) throw new Error('32-byte encryption key is required');
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(tokenIv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(tokenTag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(tokenBlob, 'base64')),
    decipher.final(),
  ]);
  const bundle = JSON.parse(decrypted.toString('utf8'));
  if (!bundle.accessToken || !bundle.refreshToken) {
    throw new Error('Encrypted token bundle is incomplete');
  }
  return bundle;
}

module.exports = { loadMasterKey, encryptTokenBundle, decryptTokenBundle };
