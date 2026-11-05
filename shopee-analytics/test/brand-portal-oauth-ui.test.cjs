'use strict';
const fs=require('fs');
const path=require('path');
const assert=require('assert');
const root=path.join(__dirname,'..');
const router=fs.readFileSync(path.join(root,'src','http-router.js'),'utf8');
const server=fs.readFileSync(path.join(root,'src','standalone-server.js'),'utf8');
const html=fs.readFileSync(path.join(root,'web','index.html'),'utf8');
const app=fs.readFileSync(path.join(root,'web','app.js'),'utf8');
// 店铺连接现在在平台接入页上，共享的渲染脚本也跟到那里去了。
const platformPage=fs.readFileSync(path.join(root,'web','connections.html'),'utf8');
const schema=fs.readFileSync(path.join(root,'schema-brand-portal-principal.sql'),'utf8');
assert(router.includes("'/brand-portal/status'"));
assert(router.includes("'/brand-portal/oauth/start'"));
assert(router.includes("'/brand-portal/oauth/callback'"));
assert(router.includes('ROLE_SUPER_ADMIN'));
assert(server.includes('new BrandPortalOAuthService({ pool })'));
// 授权入口搬到了设置面板的「店铺接口」里
const panel=fs.readFileSync(path.join(root,'web','shop-connections-ui-v1.js'),'utf8');
assert(panel.includes('data-connect="brand-portal"'));
assert(panel.includes('/brand-portal/oauth/start?shop_id='));
assert(panel.includes('需先在服务端配置 Brand Portal Partner ID / Key'));
assert(platformPage.includes('shop-connections-ui-v1.js'));
assert(app.includes('goToPlatformConnections'));
// ★ 约束必须允许全部应用角色，不只是最初的那三个。
// 应用已经不止 ADS/ERP/BRAND_PORTAL 了（还有 MARKETING、STORE_OPS_BRAIN、
// ORDER_ANALYSIS、VIDEO、ONLINE），而生产库里已有 VIDEO/ONLINE 的授权行。
// 约束只列三个会让既存数据违反它 → ADD CONSTRAINT 失败 → 整个 schema 应用中断。
// 完整清单与 schema.sql 一致；两个 schema 文件对同一约束的定义必须相同。
assert(
  schema.includes("'ADS', 'ERP', 'BRAND_PORTAL', 'MARKETING', 'STORE_OPS_BRAIN'")
  && schema.includes("'ORDER_ANALYSIS', 'VIDEO', 'ONLINE'"),
  'app_role 约束必须覆盖全部应用角色',
);
console.log('Brand Portal UI/OAuth route contract: ok');
