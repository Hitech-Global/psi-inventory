'use strict';
const WAC_REPORT_CHUNK_SIZE = 50;

function buildWacCostChangeRows(logs) {
  return (Array.isArray(logs) ? logs : []).map(log => {
    const versionNo = Number(log && log.version_no || 0);
    const isFirstTime = versionNo === 1;
    const oldValue = Number(log && log.old_avg_cost);
    const newValue = Number(log && log.new_avg_cost);
    const hasOld = Number.isFinite(oldValue);
    const hasNew = Number.isFinite(newValue);
    const oldWac = isFirstTime ? null : (hasOld ? oldValue : null);
    const newWac = hasNew ? newValue : null;
    const changeAmount = isFirstTime || !hasOld || !hasNew ? null : newValue - oldValue;
    const changePct = isFirstTime || !hasOld || !hasNew || oldValue === 0 ? null : (changeAmount / oldValue) * 100;
    return { sku_code:String(log && log.sku_code || ''), version_no:versionNo, is_first_time:isFirstTime, old_wac:oldWac, new_wac:newWac, change_amount:changeAmount, change_pct:changePct };
  }).sort((a,b) => {
    if (a.is_first_time !== b.is_first_time) return a.is_first_time ? 1 : -1;
    const ah=Number.isFinite(a.change_pct), bh=Number.isFinite(b.change_pct);
    if (ah !== bh) return ah ? -1 : 1;
    if (ah && Math.abs(a.change_pct) !== Math.abs(b.change_pct)) return Math.abs(b.change_pct)-Math.abs(a.change_pct);
    return a.sku_code.localeCompare(b.sku_code);
  });
}
function summarizeWacCostChangeRows(rows) {
  const list=Array.isArray(rows)?rows:[];
  return {
    total:list.length,
    increase:list.filter(r=>!r.is_first_time&&Number(r.change_amount)>0).length,
    decrease:list.filter(r=>!r.is_first_time&&Number(r.change_amount)<0).length,
    unchanged:list.filter(r=>!r.is_first_time&&r.change_amount!==null&&Number(r.change_amount)===0).length,
    first_time:list.filter(r=>r.is_first_time).length
  };
}
function chunkWacCostChangeRows(rows, chunkSize) {
  const list=Array.isArray(rows)?rows:[];
  const size=Math.max(1,Math.floor(Number(chunkSize)||WAC_REPORT_CHUNK_SIZE));
  const chunks=[];
  for(let i=0;i<list.length;i+=size) chunks.push(list.slice(i,i+size));
  return chunks;
}
function getNewWacCcRecipientIds(selectedIds, existingRecipientIds) {
  const existing=new Set((Array.isArray(existingRecipientIds)?existingRecipientIds:[]).map(v=>String(v||'').trim()).filter(Boolean));
  const seen=new Set();
  const result=[];
  for(const raw of (Array.isArray(selectedIds)?selectedIds:[])){
    const id=String(raw||'').trim();
    if(!id||seen.has(id)||existing.has(id))continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}
function buildWacGroupRecipientId(language, chatId) {
  const lang=String(language||'').trim().toLowerCase()==='en'?'en':'zh';
  const id=String(chatId||'').trim();
  return id?'group:'+lang+':'+id:'';
}
function parseWacGroupRecipientId(value) {
  const match=String(value||'').trim().match(/^group:(zh|en):(.+)$/);
  return match?{language:match[1],chat_id:match[2]}:null;
}
function formatWacMoney(value) {
  if(value===null||value===undefined||value===''||!Number.isFinite(Number(value))) return '—';
  return Number(value).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
}
function formatWacSignedMoney(value) {
  if(value===null||value===undefined||value===''||!Number.isFinite(Number(value))) return '—';
  const n=Number(value);
  return (n>0?'+':n<0?'-':'')+formatWacMoney(Math.abs(n));
}
function safeCardText(value) {
  return String(value===null||value===undefined||value===''?'—':value).replace(/[\r\n]+/g,' ').replace(/[<>]/g,'');
}
function buildWacCostChangeCard(report, language) {
  const zh=language!=='en';
  const rows=Array.isArray(report&&report.rows)?report.rows:[];
  const summary=report&&report.summary?report.summary:summarizeWacCostChangeRows(rows);
  const currency=safeCardText(report&&report.local_currency||'');
  const partNo=Number(report&&report.part_no||1), partCount=Number(report&&report.part_count||1);
  const batchNo=safeCardText(report&&report.batch_no), brand=safeCardText(report&&report.brand);
  const country=safeCardText(zh?(report&&report.country):(report&&(report.country_en||report.country))), warehouse=safeCardText(report&&report.warehouse);
  const ciNo=safeCardText(report&&report.ci_no), date=safeCardText(report&&report.confirmed_at);
  const summaryText=zh?[
    '**品牌：** '+brand+'　**国家：** '+country+'　**仓库：** '+warehouse,
    '**物流批次：** '+batchNo+'　**CI：** '+ciNo+'　**确认日期：** '+date,
    '**SKU：** '+summary.total+' 个　**上涨：** <font color=\'red\'>'+summary.increase+'</font>　**下降：** <font color=\'green\'>'+summary.decrease+'</font>　**持平：** '+summary.unchanged+'　**首次建立：** '+summary.first_time,
    '**明细分段：** '+partNo+'/'+partCount+'（本段 '+rows.length+' 个 SKU）'
  ].join('\n'):[
    '**Brand:** '+brand+'　**Country:** '+country+'　**Warehouse:** '+warehouse,
    '**Logistics Batch:** '+batchNo+'　**CI:** '+ciNo+'　**Confirmed:** '+date,
    '**SKUs:** '+summary.total+'　**Increased:** <font color=\'red\'>'+summary.increase+'</font>　**Decreased:** <font color=\'green\'>'+summary.decrease+'</font>　**Unchanged:** '+summary.unchanged+'　**First-time:** '+summary.first_time,
    '**Report part:** '+partNo+'/'+partCount+' ('+rows.length+' SKUs in this part)'
  ].join('\n');
  const columns=[
    {name:'sku',display_name:'SKU',data_type:'text',width:'auto'},
    {name:'old_wac',display_name:(zh?'原 WAC (':'Previous WAC (')+currency+')',data_type:'text',width:'auto'},
    {name:'new_wac',display_name:(zh?'新 WAC (':'New WAC (')+currency+')',data_type:'text',width:'auto'},
    {name:'change_amount',display_name:(zh?'变化金额 (':'Change (')+currency+')',data_type:'text',width:'auto'},
    {name:'change_pct',display_name:zh?'环比变化':'Change %',data_type:'lark_md',width:'auto'}
  ];
  const tableRows=rows.map(row=>{
    let pct;
    if(row.is_first_time) pct='<font color=\'grey\'>'+(zh?'首次建立':'First-time')+'</font>';
    else if(!Number.isFinite(row.change_pct)) pct='—';
    else if(row.change_pct>0) pct='<font color=\'red\'>+'+row.change_pct.toFixed(2)+'%</font>';
    else if(row.change_pct<0) pct='<font color=\'green\'>'+row.change_pct.toFixed(2)+'%</font>';
    else pct='<font color=\'grey\'>0.00%</font>';
    return {sku:safeCardText(row.sku_code),old_wac:row.is_first_time?'—':formatWacMoney(row.old_wac),new_wac:formatWacMoney(row.new_wac),change_amount:row.is_first_time?'—':formatWacSignedMoney(row.change_amount),change_pct:pct};
  });
  return {
    schema:'2.0',
    config:{update_multi:true},
    header:{title:{tag:'plain_text',content:zh?'WAC 成本变动报告':'WAC Cost Change Report'},subtitle:{tag:'plain_text',content:batchNo},template:'blue',padding:'12px 12px 12px 12px'},
    body:{direction:'vertical',padding:'12px 12px 12px 12px',elements:[
      {tag:'markdown',content:summaryText,text_align:'left',text_size:'normal_v2',margin:'0px 0px 8px 0px'},
      {tag:'table',page_size:10,row_height:'low',columns,rows:tableRows}
    ]}
  };
}
module.exports={WAC_REPORT_CHUNK_SIZE,buildWacCostChangeRows,summarizeWacCostChangeRows,chunkWacCostChangeRows,getNewWacCcRecipientIds,buildWacGroupRecipientId,parseWacGroupRecipientId,formatWacMoney,formatWacSignedMoney,buildWacCostChangeCard};
