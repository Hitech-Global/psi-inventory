'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ShopeeTokenManager } = require('../src/token-manager');
const { ShopeeAuthClient } = require('../src/auth-client');

const url = new ShopeeAuthClient({ partnerId:'123', partnerKey:'secret', fetchImpl: async()=>{} })
  .buildAuthorizationUrl({ redirectUri:'https://example.com/callback', timestamp:100, authType:'principal' });
assert.strictEqual(new URL(url).searchParams.get('auth_type'), 'principal');

let bodySeen = null;
const tokenRepository = {
  async load(){ return { accessToken:'old', refreshToken:'refresh', expiresAt:new Date('2026-09-01T00:00:00Z') }; },
  async save(){}, async markRefreshError(){},
};
const manager = new ShopeeTokenManager({
  tokenRepository,
  credentialLoader:()=>({partnerId:'123',partnerKey:'secret'}),
  now:()=>new Date('2026-09-29T00:00:00Z'),
  fetchImpl:async (_url, options)=>{
    bodySeen=JSON.parse(options.body);
    return { ok:true,status:200,text:async()=>JSON.stringify({access_token:'new',refresh_token:'new-refresh',expire_in:14400}) };
  },
});
(async()=>{
  const token=await manager.getAccessToken({appRole:'BRAND_PORTAL',shopId:4567});
  assert.strictEqual(token,'new');
  assert.strictEqual(bodySeen.principal_id,4567);
  assert.strictEqual(bodySeen.shop_id,undefined);
  const schema=fs.readFileSync(path.join(__dirname,'..','schema-brand-portal-principal.sql'),'utf8');
  assert(schema.includes('brand_portal_principal_id'));
  const bootstrap=fs.readFileSync(path.join(__dirname,'..','scripts','bootstrap-brand-portal-principal.cjs'),'utf8');
  assert(bootstrap.includes("appRole: 'BRAND_PORTAL'"));
  assert(!bootstrap.includes('console.log(bundle.accessToken)'));
  console.log('Brand Portal principal auth contract: ok');
})().catch(error=>{console.error(error);process.exitCode=1;});
