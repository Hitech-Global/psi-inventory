'use strict';
const MARKER='// CI-CLEARANCE-FILTER-ALL-MODES-V1';
function patchSource(src){
  if(src.includes(MARKER))return src;
  const patch=[
    '',MARKER,'(function(global){',"  'use strict';","  if(!global||typeof global.addEventListener!=='function')return;","  global.addEventListener('DOMContentLoaded',function(){",
    "    var filter=document.getElementById('ci-clearance-filter');",'    if(!filter)return;','    function selected(){return filter.value||"";}',
    '    function matches(row,value){','      if(!value)return true;','      var actual=String(row&&row.clearance_type||"").trim();','      if(value==="unset")return actual==="";','      return actual===value;','    }',
    '    function filtered(rows){return Array.isArray(rows)?rows.filter(function(row){return matches(row,selected());}):rows;}',
    "    if(typeof global.renderUnifiedCITable==='function'&&!global.renderUnifiedCITable.__ciClearanceFilterWrapped){",
    '      var originalUnified=global.renderUnifiedCITable;','      function unifiedFiltered(operationalData,historicalData){return originalUnified.call(this,filtered(operationalData),filtered(historicalData));}',
    '      unifiedFiltered.__ciClearanceFilterWrapped=true;unifiedFiltered.__original=originalUnified;global.renderUnifiedCITable=unifiedFiltered;','    }',
    "    if(typeof global.renderHistoricalCITable==='function'&&!global.renderHistoricalCITable.__ciClearanceFilterWrapped){",
    '      var originalHistorical=global.renderHistoricalCITable;','      function historicalFiltered(data){return originalHistorical.call(this,filtered(data));}',
    '      historicalFiltered.__ciClearanceFilterWrapped=true;historicalFiltered.__original=originalHistorical;global.renderHistoricalCITable=historicalFiltered;','    }',
    "    if(typeof global.onCISourceModeChange==='function'&&!global.onCISourceModeChange.__ciClearanceFilterWrapped){",
    '      var originalModeChange=global.onCISourceModeChange;','      function modeChange(){var result=originalModeChange.apply(this,arguments);var current=document.getElementById("ci-clearance-filter");if(current)current.disabled=false;return result;}',
    '      modeChange.__ciClearanceFilterWrapped=true;modeChange.__original=originalModeChange;global.onCISourceModeChange=modeChange;','    }',
    "  },{once:true});","})(typeof window!=='undefined'?window:(typeof globalThis!=='undefined'?globalThis:this));",''
  ].join('\n');
  return src.replace(/\s*$/,'')+'\n'+patch;
}
function apply(){
  const fs=require('node:fs'),path=require('node:path');
  const file=path.join(__dirname,'..','app-perf.js'),src=fs.readFileSync(file,'utf8'),next=patchSource(src);
  if(next!==src)fs.writeFileSync(file,next,'utf8');
  require('node:child_process').execFileSync(process.execPath,['--check',file],{stdio:'inherit'});
  console.log('[CI-CLEARANCE-FILTER] applied');
}
if(require.main===module)apply();
module.exports={MARKER,patchSource};
