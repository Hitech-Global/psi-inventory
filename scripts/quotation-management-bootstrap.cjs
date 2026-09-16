'use strict';
const fs=require('node:fs');
const path=require('node:path');
const SERVER_MARKER='// QUOTATION-MANAGEMENT-V1';
const INDEX_MARKER='<script src="quotation-management.js"></script>';
const IMPORT_NORMALIZER_MARKER='<script src="quotation-import-normalizer.js"></script>';
const IMPORT_PROGRESS_MARKER='<script src="quotation-import-progress.js"></script>';
const INDEX_BLOCK=INDEX_MARKER+'\n'+IMPORT_NORMALIZER_MARKER+'\n'+IMPORT_PROGRESS_MARKER;
function once(src,needle,repl,label){const a=src.indexOf(needle);if(a<0)throw new Error('[QUOTATION] missing '+label);if(src.indexOf(needle,a+needle.length)>=0)throw new Error('[QUOTATION] duplicate '+label);return src.slice(0,a)+repl+src.slice(a+needle.length);}
function patchServerSource(src){if(src.includes(SERVER_MARKER))return src;const code=SERVER_MARKER+"\nrequire('./quotation-import-fast.js')({ app, query, run, genId, asyncHandler, requireApiPermission });\nrequire('./quotation-server.js')({ app, query, queryOne, run, transaction, genId, asyncHandler, requireApiPermission });\n\n";return once(src,'// ==================== 原库存数量导入 ====================',code+'// ==================== 原库存数量导入 ====================','server anchor');}
function patchIndexSource(src){
  if(src.includes(IMPORT_PROGRESS_MARKER))return src;
  if(src.includes(IMPORT_NORMALIZER_MARKER))return src.replace(IMPORT_NORMALIZER_MARKER,IMPORT_NORMALIZER_MARKER+'\n'+IMPORT_PROGRESS_MARKER);
  if(src.includes(INDEX_MARKER))return src.replace(INDEX_MARKER,INDEX_BLOCK);
  return once(src,'</body>',INDEX_BLOCK+'\n</body>','index anchor');
}
function apply(){const sp=path.resolve(process.cwd(),'server.js'),ip=path.resolve(process.cwd(),'index.html');const s=fs.readFileSync(sp,'utf8'),i=fs.readFileSync(ip,'utf8'),ps=patchServerSource(s),pi=patchIndexSource(i);if(ps!==s)fs.writeFileSync(sp,ps);if(pi!==i)fs.writeFileSync(ip,pi);console.log('[QUOTATION] runtime patch applied');}
if(require.main===module){if(process.env.NODE_ENV==='production'||process.env.RENDER)apply();else console.log('[QUOTATION] non-production install; skipped');}
module.exports={SERVER_MARKER,INDEX_MARKER,IMPORT_NORMALIZER_MARKER,IMPORT_PROGRESS_MARKER,patchServerSource,patchIndexSource,apply};
