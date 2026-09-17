'use strict';
const fs=require('node:fs');
const path=require('node:path');
const SERVER_MARKER='// PO-DYNAMIC-PLAN-V1';
const ASSET_VERSION='20260917b';
const UI_MARKER='<script src="po-plan-ui.js?v='+ASSET_VERSION+'"></script>';
function once(src,needle,repl,label){const i=src.indexOf(needle);if(i<0)throw new Error('[PO-PLAN] missing '+label);if(src.indexOf(needle,i+needle.length)>=0)throw new Error('[PO-PLAN] duplicate '+label);return src.slice(0,i)+repl+src.slice(i+needle.length);}
function patchServer(src){if(src.includes(SERVER_MARKER))return src;const code=SERVER_MARKER+"\nrequire('./po-plan-server.js')({ app, query, queryOne, run, transaction, genId, asyncHandler, requireApiPermission, updateInventoryTransitDataAsync });\n\n";return once(src,'// ==================== 原库存数量导入 ====================',code+'// ==================== 原库存数量导入 ====================','server anchor');}
function patchIndex(src){let out=src.replace(/\s*<script src="po-plan-ui\.js(?:\?[^\"]*)?"><\/script>/g,'');return once(out,'</body>',UI_MARKER+'\n</body>','index anchor');}
function patchApp(src){let out=src;const old="api('/api/purchase-orders?status=approved')";const next="api('/api/po-plans/available')";if(out.includes(old))out=once(out,old,next,'PI available PO query');return out;}
function apply(){const sp=path.resolve(process.cwd(),'server.js'),ip=path.resolve(process.cwd(),'index.html'),ap=path.resolve(process.cwd(),'app.js');const s=fs.readFileSync(sp,'utf8'),i=fs.readFileSync(ip,'utf8'),a=fs.readFileSync(ap,'utf8');const ps=patchServer(s),pi=patchIndex(i),pa=patchApp(a);if(ps!==s)fs.writeFileSync(sp,ps);if(pi!==i)fs.writeFileSync(ip,pi);if(pa!==a)fs.writeFileSync(ap,pa);console.log('[PO-PLAN] runtime patch applied');}
if(require.main===module){if(process.env.NODE_ENV==='production'||process.env.RENDER)apply();else console.log('[PO-PLAN] non-production install; skipped');}
module.exports={SERVER_MARKER,ASSET_VERSION,patchServer,patchIndex,patchApp,apply};
