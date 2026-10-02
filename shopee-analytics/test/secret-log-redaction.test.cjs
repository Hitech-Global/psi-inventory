'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const shopRunner = fs.readFileSync(path.join(__dirname, '..', 'src', 'shop-sync-runner.js'), 'utf8');
const backfillRunner = fs.readFileSync(path.join(__dirname, '..', 'src', 'backfill-runner.js'), 'utf8');

for (const source of [shopRunner, backfillRunner]) {
  assert(source.includes("result: redactResult ? 'AVAILABLE' : result"));
}
for (const step of [
  "run('ads-token', () => ads.getAccessToken(shopId), { redactResult: true })",
  "run('ads-token-product-ads-overview', () => ads.getAccessToken(shopId), { required: false, redactResult: true })",
]) assert(shopRunner.includes(step), `missing redaction for ${step}`);
for (const step of [
  "run('ads-token-for-product-ads-history', () => ads.getAccessToken(shopId), { redactResult: true })",
  "run('ads-token-for-gms', () => ads.getAccessToken(shopId), { redactResult: true })",
]) assert(backfillRunner.includes(step), `missing redaction for ${step}`);

console.log('Shopee secret log redaction contract: ok');
