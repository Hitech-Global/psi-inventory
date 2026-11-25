(function(root){
'use strict';

function normalizeHeader(value){
  return String(value==null?'':value).trim().toLowerCase().replace(/[\s._()（）\[\]{}:：-]/g,'');
}
function normalizeSku(value){
  return String(value==null?'':value).trim().toLowerCase();
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
function findColumn(headers,aliases){
  for(const alias of aliases){
    const index=headers.findIndex(value=>value===alias);
    if(index>=0)return index;
  }
  return -1;
}
function buildHeaderCandidate(rows,index,span){
  const first=rows[index]||[];
  const second=span===2?(rows[index+1]||[]):[];
  const width=Math.max(first.length,second.length);
  const headers=[];
  for(let col=0;col<width;col++){
    const a=String(first[col]==null?'':first[col]).trim();
    const b=String(second[col]==null?'':second[col]).trim();
    headers.push(normalizeHeader(span===2?[a,b].filter(Boolean).join(' '):a));
  }
  const columns={
    sku:findColumn(headers,['item','modelno','modelnumber','sku','skucode','partno','productmodel','model']),
    qty:findColumn(headers,['totalqty','totalqtypcs','qtypcs','quantitypcs','totalquantity','quantity','qty']),
    net:findColumn(headers,['totalnw','totalnwkg','totalnwkgs','totalnetweight','totalnetweightkg','nwkg','nwkgs','netweightkg','netweight','nw']),
    gross:findColumn(headers,['totalgw','totalgwkg','totalgwkgs','totalgrossweight','totalgrossweightkg','gwkg','gwkgs','grossweightkg','grossweight','gw']),
    cartonCount:findColumn(headers,['totalctn','totalctns','totalctnctn','totalcarton','totalcartons','ctnqty','cartonqty','cartons']),
    cartonIds:findColumn(headers,['cntno','ctnno','cartonno','cartonid','cartonnumbers','cartonnumber']),
    measure:findColumn(headers,['meas','measurement']),
    cbmTotal:findColumn(headers,['totalcbm','totalcbmm3','totalvolume','totalvolumecbm'])
  };
  columns.carton=columns.cartonCount>=0?columns.cartonCount:columns.cartonIds;
  if(columns.sku>=0&&columns.qty>=0&&columns.net>=0&&columns.gross>=0&&columns.carton>=0){
    return {headerIndex:index,headerRowSpan:span,columns};
  }
  return null;
}
function findPackingListHeader(rows){
  for(let i=0;i<(rows||[]).length;i++){
    const single=buildHeaderCandidate(rows,i,1);
    if(single)return single;
    if(i+1<(rows||[]).length){
      const double=buildHeaderCandidate(rows,i,2);
      if(double)return double;
    }
  }
  return null;
}
function findPackingListSheet(workbook,XLSX){
  if(!workbook||!Array.isArray(workbook.SheetNames)||!XLSX||!XLSX.utils)return null;
  const names=workbook.SheetNames.slice().sort((a,b)=>{
    const score=name=>{
      const value=String(name||'').trim().toLowerCase();
      if(value==='pl')return 0;
      if(/packing.?list|装箱单/.test(value))return 1;
      return 2;
    };
    return score(a)-score(b);
  });
  for(const sheetName of names){
    const sheet=workbook.Sheets[sheetName];
    if(!sheet)continue;
    const rows=XLSX.utils.sheet_to_json(sheet,{header:1,defval:'',raw:true});
    const header=findPackingListHeader(rows);
    if(header)return {sheetName,rows,headerIndex:header.headerIndex,headerRowSpan:header.headerRowSpan,columns:header.columns};
  }
  return null;
}
function round6(value){
  return Math.round((Number(value)||0)*1000000)/1000000;
}
function rowValue(row,index){
  return index>=0?row[index]:null;
}
function extractReferenceCiNo(rows){
  for(const row of rows||[]){
    for(const cell of row||[]){
      const match=String(cell==null?'':cell).match(/\b(?:INV|CI)\s*NO\.?\s*[:：]?\s*([A-Z0-9][A-Z0-9_-]*)/i);
      if(match)return match[1].trim();
    }
  }
  return '';
}
function parsePackingListRows(rows,headerIndex){
  const header=findPackingListHeader(rows||[]);
  if(!header)throw new Error('未找到PL表头（需要 SKU/Model No.、数量、箱数、毛重和净重字段）');
  const columns=header.columns;
  const requestedIndex=Number.isInteger(headerIndex)?headerIndex:header.headerIndex;
  const start=Math.max(header.headerIndex+header.headerRowSpan-1,requestedIndex)+1;
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
      grouped.set(key,{sku_code:sku,total_qty:0,gross_weight:0,net_weight:0,cartons:0,cartonIds:new Set(),cbm:0,hasDirectCbm:false});
    }
    const item=grouped.get(key);
    item.total_qty+=parseNumber(row[columns.qty]);
    item.gross_weight+=parseNumber(row[columns.gross]);
    item.net_weight+=parseNumber(row[columns.net]);
    if(columns.cartonCount>=0){
      item.cartons+=parseNumber(row[columns.cartonCount]);
    }else{
      parseCartonIds(row[columns.cartonIds]).forEach(id=>item.cartonIds.add(id));
    }
    if(columns.cbmTotal>=0){
      const rowCbm=parseNumber(row[columns.cbmTotal]);
      if(rowCbm>0){
        item.cbm+=rowCbm;
        item.hasDirectCbm=true;
      }
    }
  }
  const items=Array.from(grouped.values()).map(item=>({
    sku_code:item.sku_code,
    total_qty:item.total_qty,
    cartons:columns.cartonCount>=0?item.cartons:item.cartonIds.size,
    gross_weight:item.gross_weight,
    net_weight:item.net_weight,
    cbm:item.cbm,
    _hasDirectCbm:item.hasDirectCbm
  }));
  if(!items.length)throw new Error('PL工作表中没有有效SKU明细');

  let totalCartons=totalRow?parseNumber(totalRow[columns.carton]):0;
  if(!(totalCartons>0)){
    if(columns.cartonCount>=0){
      totalCartons=items.reduce((sum,item)=>sum+item.cartons,0);
    }else{
      const allCartons=new Set();
      grouped.forEach(item=>item.cartonIds.forEach(id=>allCartons.add(id)));
      totalCartons=allCartons.size;
    }
  }

  const hasDirectItemCbm=items.some(item=>item._hasDirectCbm);
  let totalCbm=0;
  if(columns.cbmTotal>=0){
    totalCbm=totalRow?parseNumber(totalRow[columns.cbmTotal]):0;
    if(!(totalCbm>0)&&hasDirectItemCbm){
      totalCbm=items.reduce((sum,item)=>sum+item.cbm,0);
    }
  }else if(columns.measure>=0){
    totalCbm=totalRow?parseMeasureToCbm(rowValue(totalRow,columns.measure)):null;
    if(!(totalCbm>0)){
      for(let i=start;i<(rows||[]).length;i++){
        const value=parseMeasureToCbm(rowValue(rows[i]||[],columns.measure));
        if(value>0){totalCbm=value;break;}
      }
    }
  }

  if(!hasDirectItemCbm&&totalCbm>0){
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
  items.forEach(item=>{delete item._hasDirectCbm;});

  return {
    items,
    total_cartons:totalCartons,
    total_cbm:totalCbm||0,
    reference_ci_no:extractReferenceCiNo(rows),
    source:'packing-list'
  };
}
function validateImportAgainstCI(importItems,ciItems,plCheck){
  const shippedBySku=new Map();
  const existingPlBySku=new Map();
  (ciItems||[]).forEach(item=>{
    const key=normalizeSku(item.sku_code);
    if(!key)return;
    shippedBySku.set(key,(shippedBySku.get(key)||0)+(Number(item.shipped_qty)||0));
  });
  (plCheck||[]).forEach(item=>{
    const key=normalizeSku(item.sku_code);
    if(!key)return;
    existingPlBySku.set(key,(existingPlBySku.get(key)||0)+(Number(item.pl_qty)||0));
  });
  const unmatched=[];
  const overages=[];
  let matched=0;
  (importItems||[]).forEach(item=>{
    const key=normalizeSku(item.sku_code);
    if(!key||!shippedBySku.has(key)){
      if(item.sku_code)unmatched.push(String(item.sku_code));
      return;
    }
    matched++;
    const remaining=Math.max(0,(shippedBySku.get(key)||0)-(existingPlBySku.get(key)||0));
    const importedQty=Number(item.total_qty)||0;
    if(importedQty>remaining+1e-6){
      overages.push({sku_code:item.sku_code,imported_qty:importedQty,remaining_qty:remaining});
    }
  });
  return {matched,unmatched,overages};
}
function parseWorkbook(workbook,XLSX){
  const sheet=findPackingListSheet(workbook,XLSX);
  if(!sheet)return null;
  const parsed=parsePackingListRows(sheet.rows,sheet.headerIndex);
  parsed.source_sheet=sheet.sheetName;
  return parsed;
}
const api={
  normalizeHeader,parseNumber,parseCartonIds,parseMeasureToCbm,
  findPackingListHeader,findPackingListSheet,parsePackingListRows,
  validateImportAgainstCI,extractReferenceCiNo,parseWorkbook
};
root.PLImportParser=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
