#!/usr/bin/env node
'use strict';

/**
 * What a partner may actually reach.
 *
 * The partner list on the platform says which applications a shop holds;
 * it does not say which calls those applications are allowed to make. The
 * permission is granted per application, and the only reliable way to
 * find out what a partner may do is to ask it.
 *
 * So this asks. For each application it is given, it calls the endpoints
 * that belong to it and reports what came back: the figures, the error,
 * or the refusal. An application that answers is one the shop may use.
 *
 * Usage:
 *   node scripts/probe-shopee-apps.cjs --app MARKETING:1244910:key --shop 1326456001
 *   node scripts/probe-shopee-apps.cjs --app MARKETING:1244910:key --shop 1326456001 --json
 *
 * The access token is read from the environment variable of the role, so
 * the key never has to be written into a file.
 */

const { ShopeeClient } = require('../src/shopee-client');
const { appSpec } = require('../src/config');
const { ENDPOINTS } = require('../src/catalog');

/**
 * The calls worth asking about, by the application they belong to.
 *
 * These are the endpoints the system would make. An application that is
 * allowed one of them is an application the shop may use for that job.
 */
const ENDPOINTS_BY_APP = {
  ADS: ['adsDailyPerformance', 'adsGmsCampaignPerformance', 'adsRecommendedRoi', 'shopInfo'],
  STORE_OPS: ['vouchers', 'discounts'],
  ERP: ['returns', 'accountHealth', 'penaltyPointHistory', 'orders'],
  BRAND_PORTAL: ['shopSalesPerformance', 'shopLivestreamPerformance', 'marketingHotListing'],
  MARKETING: [
    'amsShopPerformance',
    'amsProductPerformance',
    'amsAffiliatePerformance',
    'amsContentPerformance',
    'amsCampaignKeyMetrics',
    'amsOpenCampaignPerformance',
    'amsConversionReport',
    'amsValidationList',
    'amsPerformanceUpdateTime',
  ],
  VIDEO: ['videoList', 'liveSessionList'],
  ONLINE: ['onlineShopList'],
  STORE_OPS_BRAIN: ['storeOpsBrainOverview'],
  ORDER_ANALYSIS: ['orderAnalysis'],
};

function parseArgs(argv) {
  const args = { apps: [], shopId: null, json: false, principalId: null };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--app') args.apps.push(argv[++index]);
    else if (value === '--shop') args.shopId = argv[++index];
    else if (value === '--principal') args.principalId = argv[++index];
    else if (value === '--json') args.json = true;
  }
  return args;
}

/**
 * A short account of what came back.
 */
function describe(body) {
  if (!body || typeof body !== 'object') return String(body).slice(0, 200);
  if (body.error) return `error=${body.error} ${body.message || ''}`.trim();
  const payload = body.response || body;
  const keys = Object.keys(payload || {});
  if (!keys.length) return '（空）';
  const head = keys.slice(0, 6).join(', ');
  const list = payload.list || payload.items || payload.data;
  const count = Array.isArray(list) ? `，${list.length} 条` : '';
  return `${head}${count}`;
}

async function probe({ role, partnerId, partnerKey, shopId, accessToken, principalId }) {
  const client = new ShopeeClient({ partnerId, partnerKey });
  const results = [];
  for (const key of ENDPOINTS_BY_APP[role] || []) {
    const endpoint = ENDPOINTS[key];
    if (!endpoint) continue;
    try {
      const response = endpoint.app === 'BRAND_PORTAL' && principalId
        ? await client.principalRequest({
          path: endpoint.path,
          method: endpoint.method,
          principalId,
          accessToken,
          query: { start_date: '', end_date: '' },
        })
        : await client.shopRequest({
          path: endpoint.path,
          method: endpoint.method,
          shopId,
          accessToken,
          query: { start_date: '', end_date: '' },
        });
      const body = response && response.body ? response.body : response;
      results.push({ key, label: key, path: endpoint.path, ok: true, summary: describe(body), body });
    } catch (error) {
      results.push({
        key,
        label: key,
        path: endpoint.path,
        ok: false,
        summary: String(error.message || error).slice(0, 220),
        body: error.body || null,
      });
    }
  }
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.apps.length) {
    console.error('用法: node scripts/probe-shopee-apps.cjs --app ROLE:PARTNER_ID:PARTNER_KEY [--shop SHOP_ID] [--json]');
    process.exit(1);
  }

  const report = [];
  for (const spec of args.apps) {
    const [role, partnerId, partnerKey] = String(spec).split(':');
    if (!role || !partnerId) {
      console.error(`跳过无法识别的 --app: ${spec}`);
      continue;
    }
    const env = process.env;
    const specEnv = appSpec(role);
    const token = String(env[specEnv.accessToken] || '').trim();
    const results = await probe({
      role,
      partnerId,
      partnerKey: partnerKey || '',
      shopId: args.shopId || env.SHOPEE_SHOP_ID || '',
      accessToken: token,
      principalId: args.principalId || env.SHOPEE_BRAND_PORTAL_PRINCIPAL_ID || '',
    });
    report.push({ role, partnerId, results });
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  for (const app of report) {
    console.log(`\n【${app.role}】Partner ${app.partnerId}`);
    for (const row of app.results) {
      const mark = row.ok ? '✅' : '❌';
      console.log(`  ${mark} ${row.label.padEnd(28)} ${row.path}`);
      console.log(`     ${row.summary}`);
    }
  }
  console.log('');
}

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { ENDPOINTS_BY_APP, describe };
