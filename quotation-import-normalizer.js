(function(){
'use strict';

const BRAND_CCY={Netac:'RMB',Redragon:'RMB',BOYA:'RMB',Joypeer:'RMB'};
const pad=n=>String(n).padStart(2,'0');

function excelSerialToISO(value){
  const n=Number(value);
  if(!Number.isFinite(n)||n<=0)return '';
  if(window.XLSX&&XLSX.SSF&&typeof XLSX.SSF.parse_date_code==='function'){
    const p=XLSX.SSF.parse_date_code(n);
    if(p&&p.y&&p.m&&p.d)return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
  }
  const ms=Date.UTC(1899,11,30)+Math.floor(n)*86400000;
  const d=new Date(ms);
  return Number.isNaN(d.getTime())?'':d.toISOString().slice(0,10);
}

function normalizeDate(value){
  if(value instanceof Date&&!Number.isNaN(value.getTime()))return value.toISOString().slice(0,10);
  if(typeof value==='number')return excelSerialToISO(value);
  const s=String(value??'').trim();
  if(!s)return '';
  if(/^\d+(?:\.\d+)?$/.test(s)&&Number(s)>1000)return excelSerialToISO(Number(s));
  let m=s.match(/^(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})(?:\D.*)?$/);
  if(m)return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m=s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/);
  if(m)return `${m[3]}-${pad(m[1])}-${pad(m[2])}`;
  if(/^\d{4}-\d{2}-\d{2}T/.test(s))return s.slice(0,10);
  return s;
}

function pick(r,keys){for(const k of keys){if(r&&Object.prototype.hasOwnProperty.call(r,k)&&r[k]!==''&&r[k]!=null)return r[k];}return '';}

function normalizeRow(row){
  const r={...(row||{})};
  const date=normalizeDate(pick(r,['quote_date','报价日期']));
  const brand=String(pick(r,['brand','品牌'])||'').trim();
  if(date){r.quote_date=date;r['报价日期']=date;}
  if(!pick(r,['currency','币种'])&&BRAND_CCY[brand])r.currency=BRAND_CCY[brand];
  return r;
}

function validateRows(rows){
  const errors=[];
  rows.forEach((r,i)=>{
    const sku=String(pick(r,['sku_code','SKU'])||'').trim();
    const brand=String(pick(r,['brand','品牌'])||'').trim();
    const productType=String(pick(r,['product_type','产品类型'])||'').trim();
    const priceRaw=pick(r,['quote_price','FOB价格','报价价格','报价']);
    const priceText=String(priceRaw??'').trim();
    const price=Number(priceText);
    const currency=String(pick(r,['currency','币种'])||BRAND_CCY[brand]||'').trim().toUpperCase();
    const date=normalizeDate(pick(r,['quote_date','报价日期']));
    let reason='';
    if(!sku)reason='SKU 为空';
    else if(!brand)reason='品牌为空';
    else if(!productType)reason='产品类型为空';
    else if(priceText===''||!Number.isFinite(price)||price<0)reason='FOB 价格格式错误（0 允许，表示未报价）';
    else if(!/^\d{4}-\d{2}-\d{2}$/.test(date))reason='报价日期格式无法识别';
    else if(!currency)reason='币种为空';
    else if(BRAND_CCY[brand]&&currency!==BRAND_CCY[brand])reason=`${brand} 币种应为 ${BRAND_CCY[brand]}`;
    if(reason)errors.push({row:i+2,reason});
  });
  return errors;
}

window.QuotationImportNormalizer=Object.freeze({normalizeDate,normalizeRow,validateRows,BRAND_CCY});

function install(){
  if(typeof window.api!=='function')return false;
  if(window.api.__quotationImportNormalizer)return true;
  const original=window.api;
  function wrapped(url,method,body){
    const isImport=String(url||'').split('?')[0]==='/api/quotation-management/import'&&String(method||'GET').toUpperCase()==='POST';
    if(isImport&&body&&Array.isArray(body.rows)){
      const rows=body.rows.map(normalizeRow);
      const errors=validateRows(rows);
      if(errors.length){
        const preview=errors.slice(0,8).map(e=>`第 ${e.row} 行：${e.reason}`).join('\n');
        const more=errors.length>8?`\n另有 ${errors.length-8} 行错误`:'';
        return Promise.reject(new Error(`导入校验失败（${errors.length} 行）\n${preview}${more}`));
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
