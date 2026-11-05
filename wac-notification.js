'use strict';
const WAC_REPORT_CHUNK_SIZE = 50;

function compareWacHistoryChronology(a, b) {
  const confirmedCompare = String(a && a.confirmed_at || '').localeCompare(String(b && b.confirmed_at || ''));
  if (confirmedCompare) return confirmedCompare;
  const createdCompare = String(a && a.created_at || '').localeCompare(String(b && b.created_at || ''));
  if (createdCompare) return createdCompare;
  const versionCompare = Number(a && a.version_no || 0) - Number(b && b.version_no || 0);
  if (versionCompare) return versionCompare;
  return String(a && a.id || '').localeCompare(String(b && b.id || ''));
}

// 按业务生效时间寻找上一条 WAC。历史补录即使 created_at 较晚，只要 confirmed_at 更早，也必须作为上一条成本。
function resolveWacCostChangeHistory(currentRows, historyRows) {
  const rows = Array.isArray(currentRows) ? currentRows : [];
  const history = Array.isArray(historyRows) ? historyRows : [];
  const byId = new Map();
  const groups = new Map();
  const keyOf = row => JSON.stringify([
    String(row && row.sku_code || ''),
    String(row && row.country || ''),
    String(row && row.warehouse || '')
  ]);
  history.forEach(row => {
    if (!row || !row.sku_code) return;
    if (row.id) byId.set(String(row.id), row);
    const key = keyOf(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });
  groups.forEach(group => group.sort(compareWacHistoryChronology));

  return rows.map(row => {
    const currentId = String(row && (row.wac_id || row.id) || '');
    const current = (currentId && byId.get(currentId)) || row || {};
    const key = keyOf(current);
    const currentConfirmedAt = String(current.confirmed_at || row && row.confirmed_at || '');
    const currentCreatedAt = String(current.created_at || row && row.created_at || '');
    const currentVersion = Number(current.version_no || row && row.version_no || 0);
    const currentBatchId = String(current.logistics_batch_id || row && row.logistics_batch_id || '');
    const candidates = (groups.get(key) || []).filter(candidate => {
      if (currentId && String(candidate.id || '') === currentId) return false;
      if (currentBatchId && candidate.logistics_batch_id && String(candidate.logistics_batch_id) === currentBatchId) return false;
      const candidateConfirmedAt = String(candidate.confirmed_at || '');
      if (!candidateConfirmedAt || !currentConfirmedAt) return false;
      if (candidateConfirmedAt !== currentConfirmedAt) return candidateConfirmedAt < currentConfirmedAt;
      const candidateCreatedAt = String(candidate.created_at || '');
      if (candidateCreatedAt && currentCreatedAt && candidateCreatedAt !== currentCreatedAt) return candidateCreatedAt < currentCreatedAt;
      return Number(candidate.version_no || 0) < currentVersion;
    }).sort(compareWacHistoryChronology);
    const previous = candidates.length ? candidates[candidates.length - 1] : null;
    const fallbackOld = current.original_avg_cost !== undefined && current.original_avg_cost !== null
      ? current.original_avg_cost
      : (row && row.old_avg_cost);
    const oldRaw = previous ? previous.new_avg_cost : fallbackOld;
    const oldValue = Number(oldRaw);
    const hasOld = oldRaw !== null && oldRaw !== undefined && oldRaw !== '' && Number.isFinite(oldValue) && oldValue > 0;
    return {
      ...row,
      old_avg_cost: hasOld ? oldValue : null,
      previous_wac_id: previous ? previous.id : null
    };
  });
}

function buildWacCostChangeRows(logs) {
  return (Array.isArray(logs) ? logs : []).map(log => {
    const versionNo = Number(log && log.version_no || 0);
    const oldValue = Number(log && log.old_avg_cost);
    const newValue = Number(log && log.new_avg_cost);
    const hasOld = log && log.old_avg_cost !== null && log.old_avg_cost !== undefined &&
      log.old_avg_cost !== '' && Number.isFinite(oldValue) && oldValue > 0;
    const hasNew = log && log.new_avg_cost !== null && log.new_avg_cost !== undefined &&
      log.new_avg_cost !== '' && Number.isFinite(newValue);
    const isFirstTime = !hasOld;
    const oldWac = hasOld ? oldValue : null;
    const newWac = hasNew ? newValue : null;
    const changeAmount = !hasOld || !hasNew ? null : newValue - oldValue;
    const changePct = !hasOld || !hasNew || oldValue === 0 ? null : (changeAmount / oldValue) * 100;
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
function getUniqueWacCcRecipientIds(selectedIds) {
  const seen=new Set();
  const result=[];
  for(const raw of (Array.isArray(selectedIds)?selectedIds:[])){
    const id=String(raw||'').trim();
    if(!id||seen.has(id))continue;
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
    {name:'sku',display_name:'SKU',data_type:'text',width:'36%'},
    {name:'old_wac',display_name:(zh?'原 WAC (':'Previous WAC (')+currency+')',data_type:'text',width:'15%'},
    {name:'new_wac',display_name:(zh?'新 WAC (':'New WAC (')+currency+')',data_type:'text',width:'15%'},
    {name:'change_amount',display_name:(zh?'变化金额 (':'Change (')+currency+')',data_type:'text',width:'19%'},
    {name:'change_pct',display_name:zh?'环比变化':'Change %',data_type:'lark_md',width:'15%'}
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

function cleanFeishuFallbackText(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/<font\b[^>]*>/gi, '')
    .replace(/<\/font>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .trim();
}

function cardToFallbackText(card) {
  if (!card || typeof card !== 'object') return '';
  const lines = [];
  const add = value => {
    const normalized = cleanFeishuFallbackText(value);
    if (normalized) lines.push(normalized);
  };
  const title = card.header && card.header.title && card.header.title.content;
  const subtitle = card.header && card.header.subtitle && card.header.subtitle.content;
  add(title);
  add(subtitle);

  // Card 2.0 stores content in body.elements; legacy cards use top-level elements.
  const bodyElements = card.body && Array.isArray(card.body.elements) ? card.body.elements : [];
  const elements = bodyElements.length ? bodyElements : (Array.isArray(card.elements) ? card.elements : []);
  for (const element of elements) {
    if (!element || typeof element !== 'object') continue;
    if (element.tag === 'markdown' && typeof element.content === 'string') {
      add(element.content);
      continue;
    }
    if (element.tag === 'table') {
      const columns = Array.isArray(element.columns) ? element.columns : [];
      const rows = Array.isArray(element.rows) ? element.rows : [];
      if (columns.length) {
        add('');
        add('SKU 明细 / SKU Details');
        add(columns.map(column => cleanFeishuFallbackText(column && (column.display_name || column.name) || '')).join(' | '));
        for (const row of rows) {
          add(columns.map(column => {
            const key = column && column.name;
            const value = key && row && Object.prototype.hasOwnProperty.call(row, key) ? row[key] : '';
            if (value && typeof value === 'object') {
              if (typeof value.content === 'string') return cleanFeishuFallbackText(value.content);
              if (value.text && typeof value.text.content === 'string') return cleanFeishuFallbackText(value.text.content);
              return '';
            }
            return cleanFeishuFallbackText(value);
          }).join(' | '));
        }
      }
      continue;
    }
    if (element.tag === 'column_set') {
      const columns = Array.isArray(element.columns) ? element.columns : [];
      const cells = columns.map(column => (Array.isArray(column && column.elements) ? column.elements : []).map(child => {
        if (!child || typeof child !== 'object') return '';
        if (child.tag === 'markdown' && typeof child.content === 'string') return cleanFeishuFallbackText(child.content);
        if (child.tag === 'plain_text' && typeof child.content === 'string') return cleanFeishuFallbackText(child.content);
        if (child.tag === 'div' && child.text && typeof child.text.content === 'string') return cleanFeishuFallbackText(child.text.content);
        return '';
      }).filter(Boolean).join(' '));
      if (cells.some(Boolean)) add(cells.join(' | '));
      continue;
    }
    // Keep compatibility with the legacy card schema used by older notifications.
    if (element.tag === 'div') {
      const fields = Array.isArray(element.fields) ? element.fields : [];
      for (const field of fields) {
        const content = field && field.text && field.text.content;
        if (content) add(content);
      }
    } else if (element.tag === 'plain_text' && typeof element.content === 'string') {
      add(element.content);
    }
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

module.exports={WAC_REPORT_CHUNK_SIZE,compareWacHistoryChronology,resolveWacCostChangeHistory,buildWacCostChangeRows,summarizeWacCostChangeRows,chunkWacCostChangeRows,getUniqueWacCcRecipientIds,buildWacGroupRecipientId,parseWacGroupRecipientId,formatWacMoney,formatWacSignedMoney,buildWacCostChangeCard,cardToFallbackText};
