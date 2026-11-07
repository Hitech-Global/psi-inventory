(function(root){
'use strict';

function normalizeHeader(value){
  return String(value==null?'':value).trim().toLowerCase().replace(/[\s._()（）\[\]{}:：-]/g,'');
}
function parseNumber(value){
  if(typeof value==='number'&&Number.isFinite(value))return value;
  const s=String(value==null?'':value).replace(/,/g,'').trim();
  const m=s.match(/-?\d+(?:\.\d+)?/);
  return m?Number(m[0]):0;
}
function parseCartonIds(value){
  const text=String(value==null?'':value).trim();
  const ids=new Set();
  if(!text)return ids;
  text.split(/[,，;；、/]+/).forEach(token=>{
    const part=token.trim();
    if(!part)return;
    const range=part.match(/#?\s*(\d+)\s*[-–—~至]\s*#?\s*(\d+)/);
    if(range){
      const a=Number(range[1]),b=Number(range[2]);
      if(Math.abs(b-a)<=1000){
        for(let n=Math.min(a,b);n<=Math.max(a,b);n++)ids.add(String(n));
        return;
      }
    }
    const matches=part.match(/\d+/g)||[];
    matches.forEach(n=>ids.add(String(Number(n))));
  });
  return ids;
}
function parseMeasureToCbm(value){
  if(typeof value==='number'&&Number.isFinite(value))return value>0?value:null;
  const text=String(value==null?'':value).trim();
  if(!text)return null;
  const explicit=text.match(/(-?\d+(?:\.\d+)?)\s*(?:cbm|m(?:3|³))/i);
  if(explicit)return Number(explicit[1]);
  const dimensions=text.match(/(\d+(?:\.\d+)?)\s*[*x×]\s*(\d+(?:\.\d+)?)\s*[*x×]\s*(\d+(?:\.\d+)?)/i);
  if(dimensions&&/cm/i.test(text)){
    const countMatch=text.match(/[*x×]\s*(\d+(?:\.\d+)?)\s*(?:ctns?|cartons?)/i);
    const count=countMatch?Number(countMatch[1]):1;
    return Number(dimensions[1])*Number(dimensions[2])*Number(dimensions[3])*count/1000000;
  }
  const plain=text.match(/-?\d+(?:\.\d+)?/);
  return plain?Number(plain[0]):null;
}
function findPackingListHeader(rows){
  for(let i=0;i<(rows||[]).length;i++){
    const cells=(rows[i]||[]).map(normalizeHeader);
    const find=key=>cells.findIndex(v=>v===key);
    const columns={
      sku:find('item'),
      qty:find('qtypcs'),
      net:find('nwkg'),
      gross:find('gwkg'),
      carton:find('cntno'),
      measure:find('meas')
    };
    if(columns.sku>=0&&columns.qty>=0&&columns.net>=0&&columns.gross>=0&&columns.carton>=0){
      return {headerIndex:i,columns};
    }
  }
  return null;
}
function findPackingListSheet(workbook,XLSX){
  if(!workbook||!Array.isArray(workbook.SheetNames)||!XLSX||!XLSX.utils)return null;
  for(const sheetName of workbook.SheetNames){
    const sheet=workbook.Sheets[sheetName];
    if(!sheet)continue;
    const rows=XLSX.utils.sheet_to_json(sheet,{header:1,defval:'',raw:true});
    const header=findPackingListHeader(rows);
    if(header)return {sheetName,rows,headerIndex:header.headerIndex,columns:header.columns};
  }
  return null;
}
function round6(value){return Math.round((Number(value)||0)*1000000)/1000000;}
function parsePackingListRows(rows,headerIndex){
  const header=findPackingListHeader(rows||[]);
  if(!header)throw new Error('未找到PL表头（需要 Item、QTY(PCS)、N.W.(KG)、G.W.(KG)、CNT NO.）');
  const columns=header.columns;
  const start=Math.max(header.headerIndex,Number.isInteger(headerIndex)?headerIndex:header.headerIndex)+1;
  const grouped=new Map();
  let totalRow=null;
  for(let i=start;i<(rows||[]).length;i++){
    const row=rows[i]||[];
    if(!row.some(v=>String(v==null?'':v).trim()!==''))continue;
    const first=String(row[0]==null?'':row[0]).trim();
    if(/^total\b/i.test(first)){
      totalRow=row;
      continue;
    }
    const sku=String(row[columns.sku]==null?'':row[columns.sku]).trim();
    if(!sku)continue;
    const key=sku.toUpperCase();
    if(!grouped.has(key)){
      grouped.set(key,{sku_code:sku,total_qty:0,gross_weight:0,net_weight:0,cartonIds:new Set()});
    }
    const item=grouped.get(key);
    item.total_qty+=parseNumber(row[columns.qty]);
    item.gross_weight+=parseNumber(row[columns.gross]);
    item.net_weight+=parseNumber(row[columns.net]);
    parseCartonIds(row[columns.carton]).forEach(id=>item.cartonIds.add(id));
  }
  const items=Array.from(grouped.values()).map(item=>({
    sku_code:item.sku_code,
    total_qty:item.total_qty,
    cartons:item.cartonIds.size,
    gross_weight:item.gross_weight,
    net_weight:item.net_weight,
    cbm:0
  }));
  if(!items.length)throw new Error('PL工作表中没有有效SKU明细');

  let totalCartons=totalRow?parseNumber(totalRow[columns.carton]):0;
  if(!(totalCartons>0)){
    const allCartons=new Set();
    items.forEach(item=>{
      const original=grouped.get(item.sku_code.toUpperCase());
      original.cartonIds.forEach(id=>allCartons.add(id));
    });
    totalCartons=allCartons.size;
  }
  let totalCbm=columns.measure>=0&&totalRow?parseMeasureToCbm(totalRow[columns.measure]):null;
  if(!(totalCbm>0)&&columns.measure>=0){
    for(let i=start;i<(rows||[]).length;i++){
      const value=parseMeasureToCbm((rows[i]||[])[columns.measure]);
      if(value>0){totalCbm=value;break;}
    }
  }
  if(totalCbm>0){
    const grossSum=items.reduce((sum,item)=>sum+item.gross_weight,0);
    const qtySum=items.reduce((sum,item)=>sum+item.total_qty,0);
    const basis=items.map(item=>grossSum>0?item.gross_weight:(qtySum>0?item.total_qty:1));
    const basisSum=basis.reduce((sum,value)=>sum+value,0);
    let allocated=0;
    items.forEach((item,index)=>{
      const value=index===items.length-1
        ? totalCbm-allocated
        : round6(totalCbm*(basisSum>0?basis[index]/basisSum:1/items.length));
      item.cbm=value;
      allocated+=value;
    });
  }
  return {
    items,
    total_cartons:totalCartons,
    total_cbm:totalCbm||0,
    source:'packing-list'
  };
}
function parseWorkbook(workbook,XLSX){
  const sheet=findPackingListSheet(workbook,XLSX);
  if(!sheet)return null;
  const parsed=parsePackingListRows(sheet.rows,sheet.headerIndex);
  parsed.source_sheet=sheet.sheetName;
  return parsed;
}
const api={normalizeHeader,parseNumber,parseCartonIds,parseMeasureToCbm,findPackingListHeader,findPackingListSheet,parsePackingListRows,parseWorkbook};
root.PLImportParser=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
