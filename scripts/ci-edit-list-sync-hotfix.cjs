'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');

const APP_PERF=path.join(__dirname,'..','app-perf.js');
const MARKER='// CI-EDIT-LIST-SYNC-V1';

function patchAppPerfSource(src){
  if(src.includes(MARKER)) return src;
  const anchor="await api('/api/commercial-invoices/'+id,'PUT',payload);";
  if(!src.includes(anchor)) throw new Error('[CI-EDIT-LIST-SYNC] save anchor missing');
  const insert=anchor+"\n      "+MARKER+"\n      var __ciListRefresh=Promise.resolve();\n      try {\n        if (typeof document!=='undefined' && document.getElementById('ci-table') && typeof loadCI==='function') {\n          __ciListRefresh=Promise.resolve(loadCI()).catch(function(e){ try{ console.warn('[CI-EDIT] list refresh failed:',e&&e.message); }catch(_){} });\n        }\n      } catch (e) {}";
  return src.replace(anchor,insert);
}

function apply(){
  const src=fs.readFileSync(APP_PERF,'utf8');
  const out=patchAppPerfSource(src);
  if(out!==src) fs.writeFileSync(APP_PERF,out,'utf8');
  execFileSync(process.execPath,['--check',APP_PERF],{stdio:'inherit'});
  console.log('[CI-EDIT] post-save CI list sync applied');
}

if(require.main===module) apply();
module.exports={MARKER,patchAppPerfSource};
