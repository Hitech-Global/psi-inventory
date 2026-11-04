(function(){
'use strict';

const BRAND_CCY=Object.freeze({Netac:'USD',Redragon:'RMB',BOYA:'RMB',Joypeer:'RMB'});
const pad=n=>String(n).padStart(2,'0');
const clean=v=>String(v??'').trim();
const norm=v=>clean(v).toLowerCase().replace(/[\s_\-./\\()[\]{}:：;；,，]+/g,'');
const partKey=v=>clean(v).toUpperCase();
const mapKey=(supplier,brand,part)=>[supplier,brand,partKey(part)].join('\u0001');

function excelSerialToISO(value){
  const n=Number(value);
  if(!Number.isFinite(n)||n<=0)return '';
  if(window.XLSX&&window.XLSX.SSF&&typeof window.XLSX.SSF.parse_date_code==='function'){
    const p=window.XLSX.SSF.parse_date_code(n);
    if(p&&p.y&&p.m&&p.d)return p.y+'-'+pad(p.m)+'-'+pad(p.d);
  }
  const ms=Date.UTC(1899,11,30)+Math.floor(n)*86400000;
  const d=new Date(ms);
  return Number.isNaN(d.getTime())?'':d.toISOString().slice(0,10);
}
function normalizeDate(value){
  if(value instanceof Date&&!Number.isNaN(value.getTime()))return value.toISOString().slice(0,10);
  if(typeof value==='number')return excelSerialToISO(value);
  const s=clean(value);
  if(!s)return '';
  if(/^\d+(?:\.\d+)?$/.test(s)&&Number(s)>1000)return excelSerialToISO(Number(s));
  let m=s.match(/^(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})(?:\D.*)?$/);
  if(m)return m[1]+'-'+pad(m[2])+'-'+pad(m[3]);
  m=s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/);
  if(m)return m[3]+'-'+pad(m[1])+'-'+pad(m[2]);
  if(/^\d{4}-\d{2}-\d{2}T/.test(s))return s.slice(0,10);
  return s;
}
function parsePrice(value){
  if(value==null||clean(value)==='')return 0;
  const s=clean(value).replace(/[,\s]/g,'').replace(/[￥¥$€£]/g,'');
  if(!s)return 0;
  if(/^\(.*\)$/.test(s))return -Math.abs(Number(s.slice(1,-1)));
  return Number(s);
}
function classifyHeader(value){
  const raw=clean(value),h=norm(raw);
  if(!h)return '';
  if(/^(psisku|internal(sku|item)|hitechsku|systemsku|内部sku|系统sku|内部编码|系统编码)$/.test(h))return 'psi_sku_code';
  if(/^(brand|品牌)$/.test(h))return 'brand';
  if(/^(producttype|type|category|productcategory|品类|产品类型|类别|产品类别)$/.test(h))return 'product_type';
  if(/^(currency|curr|币种|货币)$/.test(h))return 'currency';
  if(/^(quotedate|quotationdate|date|报价日期|日期)$/.test(h))return 'quote_date';
  if(/^(model|modelno|modelnumber|型号|产品型号)$/.test(h))return 'model';
  if(/^(spec|specification|capacity|memory|color|colour|size|规格|容量|颜色|容量规格)$/.test(h))return 'spec';
  if(/^(remark|remarks|note|notes|comment|comments|备注|说明)$/.test(h))return 'remark';
  if(/^(partno|partnumber|pn|itemno|itemnumber|productcode|productno|suppliersku|supplierpartno|vendorpartno|货号|料号|供应商料号|供应商sku|产品编码|物料编码|sku|stockkeepingunit)$/.test(h))return 'supplier_part_no';
  if(/(fob|price|quote|quotation|unitprice|报价|单价|价格)/.test(h))return 'quote_price';
  return '';
}
function currencyFromHeader(value){
  const h=clean(value).toUpperCase();
  if(/\bUSD\b/.test(h)||h.includes('美元'))return 'USD';
  if(/\b(RMB|CNY)\b/.test(h)||h.includes('人民币'))return 'RMB';
  if(/\b(EUR)\b/.test(h))return 'EUR';
  if(/\b(THB)\b/.test(h))return 'THB';
  if(/\b(IDR)\b/.test(h))return 'IDR';
  if(/\b(MYR)\b/.test(h))return 'MYR';
  return '';
}
function headerInfo(row){
  const columns={};
  (row||[]).forEach((v,i)=>{
    const key=classifyHeader(v);
    if(!key)return;
    if(!columns[key])columns[key]=[];
    columns[key].push({index:i,header:clean(v),currency:currencyFromHeader(v)});
  });
  return columns;
}
function findHeader(matrix){
  const max=Math.min((matrix||[]).length,30);
  for(let i=0;i<max;i++){
    const c=headerInfo(matrix[i]);
    if(c.supplier_part_no&&c.quote_price)return {index:i,columns:c};
  }
  return null;
}
function cell(row,columns,key){
  const cols=columns[key]||[];
  for(const c of cols){
    const v=row&&row[c.index];
    if(v!=null&&clean(v)!=='')return {value:v,column:c};
  }
  if(key==='quote_price'&&cols.length)return {value:'',column:cols[0]};
  return {value:'',column:null};
}
function parseSheetRows(sheets,options){
  const opts=options||{},rows=[],recognized=[],ignored=[],errors=[];
  for(const sheet of (sheets||[])){
    const matrix=Array.isArray(sheet.rows)?sheet.rows:[];
    const found=findHeader(matrix);
    if(!found){ignored.push({name:sheet.name||'',reason:'未识别到料号和报价列'});continue;}
    const before=rows.length;
    for(let i=found.index+1;i<matrix.length;i++){
      const source=matrix[i]||[];
      const part=cell(source,found.columns,'supplier_part_no').value;
      if(clean(part)==='')continue;
      const brandCell=cell(source,found.columns,'brand').value;
      const brand=clean(brandCell)||clean(opts.brand);
      const priceCell=cell(source,found.columns,'quote_price');
      const currencyCell=cell(source,found.columns,'currency').value;
      const dateCell=cell(source,found.columns,'quote_date').value;
      const model=cell(source,found.columns,'model').value;
      const spec=cell(source,found.columns,'spec').value;
      const type=cell(source,found.columns,'product_type').value;
      const psiSku=cell(source,found.columns,'psi_sku_code').value;
      const remark=cell(source,found.columns,'remark').value;
      const price=parsePrice(priceCell.value);
      const headerCurrency=priceCell.column&&priceCell.column.currency||'';
      rows.push({
        supplier_part_no:clean(part),sku_code:clean(part),psi_sku_code:clean(psiSku),
        match_status:'unlinked',match_source:clean(psiSku)?'manual':'unlinked',
        brand,brand_source:clean(brandCell)?'file':'default',
        product_type:clean(type),model:clean(model),spec:clean(spec),
        quote_price:price,currency:clean(currencyCell||headerCurrency||BRAND_CCY[brand]||opts.currency).toUpperCase(),
        quote_date:normalizeDate(dateCell||opts.quote_date),quote_date_source:clean(dateCell)?'file':'default',remark:clean(remark),
        source_sheet:clean(sheet.name),source_row:i+1,supplier_id:clean(opts.supplier_id)
      });
    }
    recognized.push({name:clean(sheet.name),header_row:found.index+1,row_count:rows.length-before});
  }
  if(rows.length>5000)errors.push({row:0,reason:'所有工作表合计 '+rows.length+' 行，单次最多支持 5000 行'});
  return {rows,recognized_sheets:recognized,ignored_sheets:ignored,errors};
}
function normalizeRow(row){
  const r={...(row||{})};
  const part=clean(r.supplier_part_no||r['供应商料号']||r['Part No.']||r['Part No']||r.part_no||r.sku_code||r.SKU||r['SKU']);
  const date=normalizeDate(r.quote_date||r['报价日期']);
  const brand=clean(r.brand||r['品牌']);
  if(part){r.supplier_part_no=part;if(!r.sku_code)r.sku_code=part;}
  if(date)r.quote_date=date;
  if(!r.currency&&BRAND_CCY[brand])r.currency=BRAND_CCY[brand];
  if(r.quote_price==null){
    const raw=r['FOB价格']??r['报价价格']??r['报价']??r['FOB Price']??r['Price'];
    if(raw!=null)r.quote_price=parsePrice(raw);
  }
  if(!r.product_type)r.product_type=clean(r['产品类型']||r['Product Type']||'');
  if(!r.match_status)r.match_status=r.psi_sku_code?'matched':'unlinked';
  return r;
}
function matchRows(input,metadata,options){
  const opts=options||{},meta=metadata||{},skus=Array.isArray(meta.skus)?meta.skus:[];
  const skuMap=new Map(),mappingMap=new Map();
  skus.forEach(s=>{const b=clean(s.brand),code=clean(s.sku_code);if(b&&code)skuMap.set(b.toLowerCase()+'|'+norm(code),s);});
  (Array.isArray(meta.mappings)?meta.mappings:[]).forEach(m=>{
    mappingMap.set(mapKey(m.supplier_id,m.brand,m.supplier_part_no),m.psi_sku_code);
  });
  return (input||[]).map(raw=>{
    const r=normalizeRow(raw);
    if(r.brand_source==='default'&&!clean(r.brand))r.brand=clean(opts.brand);
    if(r.brand_source==='default'&&clean(opts.brand))r.brand=clean(opts.brand);
    r.supplier_id=clean(opts.supplier_id||r.supplier_id);
    const part=clean(r.supplier_part_no||r.sku_code),brand=clean(r.brand);
    const manual=clean(r.match_source)==='manual'&&clean(r.psi_sku_code);
    let found=null,source='';
    if(manual){found=skuMap.get(brand.toLowerCase()+'|'+norm(r.psi_sku_code));source='manual';}
    if(!found){
      const mapped=mappingMap.get(mapKey(r.supplier_id,brand,part));
      if(mapped){found=skuMap.get(brand.toLowerCase()+'|'+norm(mapped));if(found)source='saved';}
    }
    if(!found){
      found=skuMap.get(brand.toLowerCase()+'|'+norm(part));
      if(found)source='exact';
    }
    if(found){
      r.psi_sku_code=clean(found.sku_code);r.sku_code=clean(found.sku_code);
      r.match_status='matched';r.match_source=source||'exact';
      if(!r.product_type)r.product_type=clean(found.category);
      if(!r.model)r.model=clean(found.model);
      if(!r.spec)r.spec=clean(found.color_spec);
    }else{
      r.psi_sku_code='';r.sku_code=part;r.match_status='unlinked';
      if(!manual)r.match_source='unlinked';
    }
    if(!r.product_type)r.product_type='未分类';
    return r;
  });
}
function validateRows(rows){
  const errors=[];
  (rows||[]).forEach((raw,i)=>{
    const r=normalizeRow(raw);
    const part=clean(r.supplier_part_no||r.sku_code||r.SKU||r['SKU']);
    const brand=clean(r.brand||r['品牌']);
    const priceRaw=r.quote_price??r['FOB价格']??r['报价价格']??r['报价'];
    const priceText=clean(priceRaw);
    const price=priceText===''?0:parsePrice(priceRaw);
    const currency=clean(r.currency||r['币种']||BRAND_CCY[brand]).toUpperCase();
    const date=normalizeDate(r.quote_date||r['报价日期']);
    let reason='';
    if(!part)reason='供应商料号为空';
    else if(!brand)reason='品牌为空（请在导入窗口选择品牌）';
    else if(!Number.isFinite(price)||price<0)reason='FOB 价格格式错误（空白或 0 表示未报价）';
    else if(!/^\d{4}-\d{2}-\d{2}$/.test(date))reason='报价日期格式无法识别';
    else if(!currency)reason='币种为空';
    else if(BRAND_CCY[brand]&&currency!==BRAND_CCY[brand])reason=brand+' 默认币种应为 '+BRAND_CCY[brand];
    if(reason)errors.push({row:Number(r.source_row)||i+2,reason});
  });
  return errors;
}

window.QuotationImportNormalizer=Object.freeze({
  normalizeDate,normalizeRow,parseSheetRows,matchRows,validateRows,BRAND_CCY
});

function install(){
  if(typeof window.api!=='function')return false;
  if(window.api.__quotationImportNormalizer)return true;
  const original=window.api;
  function wrapped(url,method,body){
    const isImport=String(url||'').split('?')[0]==='/api/quotation-management/import'&&String(method||'GET').toUpperCase()==='POST';
    if(isImport&&body&&Array.isArray(body.rows)){
      const rows=body.rows.map(normalizeRow),errors=validateRows(rows);
      if(errors.length){
        const preview=errors.slice(0,8).map(e=>'第 '+e.row+' 行：'+e.reason).join('\n');
        const more=errors.length>8?'\n另有 '+(errors.length-8)+' 行错误':'';
        return Promise.reject(new Error('导入校验失败（'+errors.length+' 行）\n'+preview+more));
      }
      body={...body,rows};
    }
    return original.call(this,url,method,body);
  }
  wrapped.__quotationImportNormalizer=true;
  wrapped.__originalApi=original;
  window.api=wrapped;
  return true;
}
if(!install()){
  const retry=()=>{if(!install())setTimeout(install,300);};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',retry,{once:true});else retry();
}
})();