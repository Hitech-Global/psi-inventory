'use strict';
const fs=require('node:fs');
const path=require('node:path');
const SERVER_MARKER='// QUOTATION-MANAGEMENT-V1';
const BODY_GUARD_MARKER='// QUOTATION-IMPORT-BODY-GUARD-V1';
const ASSET_VERSION='20260916e';
const INDEX_MARKER='<script src="quotation-management.js?v='+ASSET_VERSION+'"></script>';
const IMPORT_NORMALIZER_MARKER='<script src="quotation-import-normalizer.js?v='+ASSET_VERSION+'"></script>';
const IMPORT_PROGRESS_MARKER='<script src="quotation-import-progress.js?v='+ASSET_VERSION+'"></script>';
const PROCUREMENT_BRIEF_MARKER='<script src="quotation-procurement-brief.js?v='+ASSET_VERSION+'"></script>';
const INDEX_BLOCK=INDEX_MARKER+'\n'+IMPORT_NORMALIZER_MARKER+'\n'+IMPORT_PROGRESS_MARKER+'\n'+PROCUREMENT_BRIEF_MARKER;
function once(src,needle,repl,label){const a=src.indexOf(needle);if(a<0)throw new Error('[QUOTATION] missing '+label);if(src.indexOf(needle,a+needle.length)>=0)throw new Error('[QUOTATION] duplicate '+label);return src.slice(0,a)+repl+src.slice(a+needle.length);}
function patchServerSource(src){
  let out=src;
  if(!out.includes(BODY_GUARD_MARKER)){
    const anchor="app.use(express.json({ limit: '50mb' }));";
    const guard=BODY_GUARD_MARKER+"\nconst quotationImportJsonParser = express.json({ limit: '10mb' });\napp.use((req, res, next) => {\n  if (req.method !== 'POST' || req.path !== '/api/quotation-management/import') return next();\n  quotationImportJsonParser(req, res, (err) => {\n    if (!err) return next();\n    const status = err.status || err.statusCode || 413;\n    return res.status(status).json({ error: '报价导入请求体过大（上限 10MB），请拆分后重试。', code: 'IMPORT_BODY_TOO_LARGE', limit: '10mb' });\n  });\n});\n";
    out=once(out,anchor,guard+anchor,'json parser anchor');
  }
  if(!out.includes(SERVER_MARKER)){
    const code=SERVER_MARKER+"\nrequire('./quotation-import-fast.js')({ app, query, run, genId, asyncHandler, requireApiPermission });\nrequire('./quotation-server.js')({ app, query, queryOne, run, transaction, genId, asyncHandler, requireApiPermission });\n\n";
    out=once(out,'// ==================== 原库存数量导入 ====================',code+'// ==================== 原库存数量导入 ====================','server anchor');
  }
  return out;
}
function patchIndexSource(src){
  let out=src
    .replace(/\s*<script src="quotation-management\.js(?:\?[^\"]*)?"><\/script>/g,'')
    .replace(/\s*<script src="quotation-import-normalizer\.js(?:\?[^\"]*)?"><\/script>/g,'')
    .replace(/\s*<script src="quotation-import-progress\.js(?:\?[^\"]*)?"><\/script>/g,'')
    .replace(/\s*<script src="quotation-procurement-brief\.js(?:\?[^\"]*)?"><\/script>/g,'');
  return once(out,'</body>',INDEX_BLOCK+'\n</body>','index anchor');
}
function patchQuotationServerSource(src){
  let out=src;
  const old='sku_count:rows.length,history_count:history.length';
  const next="sku_count:new Set(rows.map(r=>String(r.sku_code||'').trim().toUpperCase())).size,history_count:history.length";
  if(out.includes(old))out=out.replace(old,next);
  return out;
}
function patchQuotationManagementSource(src){
  let out=src;
  out=out.replace("$('#qm-count').textContent='共 '+r.length+' 个 SKU';","$('#qm-count').textContent='共 '+new Set(r.map(x=>String(x.sku_code||\'\').trim().toUpperCase())).size+' 个去重 SKU';");
  out=out.replace('<span>SKU 总数</span>','<span>SKU 总数（去重）</span>');
  out=out.replace('<span>历史记录</span>','<span>历史报价记录</span>');
  out=out.replace('当前覆盖 ${r.sku_count} 个 SKU，共 ${r.history_count} 条历史记录','当前覆盖 ${r.sku_count} 个去重 SKU，共 ${r.history_count} 条历史报价记录');
  out=out.replace('SKU数:r.sku_count,历史记录数:r.history_count','去重SKU数:r.sku_count,历史报价记录数:r.history_count');
  return out;
}
function apply(){
  const sp=path.resolve(process.cwd(),'server.js'),ip=path.resolve(process.cwd(),'index.html'),qsp=path.resolve(process.cwd(),'quotation-server.js'),qmp=path.resolve(process.cwd(),'quotation-management.js');
  const s=fs.readFileSync(sp,'utf8'),i=fs.readFileSync(ip,'utf8'),qs=fs.readFileSync(qsp,'utf8'),qm=fs.readFileSync(qmp,'utf8');
  const ps=patchServerSource(s),pi=patchIndexSource(i),pqs=patchQuotationServerSource(qs),pqm=patchQuotationManagementSource(qm);
  if(ps!==s)fs.writeFileSync(sp,ps);if(pi!==i)fs.writeFileSync(ip,pi);if(pqs!==qs)fs.writeFileSync(qsp,pqs);if(pqm!==qm)fs.writeFileSync(qmp,pqm);
  console.log('[QUOTATION] runtime patch applied');
}
if(require.main===module){if(process.env.NODE_ENV==='production'||process.env.RENDER)apply();else console.log('[QUOTATION] non-production install; skipped');}
module.exports={SERVER_MARKER,BODY_GUARD_MARKER,ASSET_VERSION,INDEX_MARKER,IMPORT_NORMALIZER_MARKER,IMPORT_PROGRESS_MARKER,PROCUREMENT_BRIEF_MARKER,patchServerSource,patchIndexSource,patchQuotationServerSource,patchQuotationManagementSource,apply};