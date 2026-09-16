'use strict';

module.exports=function installQuotationImportFast(deps){
  const {app,query,run,genId,asyncHandler,requireApiPermission}=deps;
  const BRAND_CCY=Object.freeze({Netac:'USD',Redragon:'RMB',BOYA:'RMB',Joypeer:'RMB'});
  const keyOf=r=>r.sku+'\u0001'+r.brand+'\u0001'+r.quote_date;

  function parseRows(req){
    const input=Array.isArray((req.body||{}).rows)?req.body.rows:[];
    const mode=(req.body||{}).duplicate_mode==='overwrite'?'overwrite':'skip';
    if(!input.length){const e=new Error('导入数据不能为空');e.status=400;throw e;}
    if(input.length>5000){const e=new Error('单次最多导入5000行');e.status=400;throw e;}
    const rows=[],errors=[];
    input.forEach((r,i)=>{
      const sku=String(r.sku_code||r.SKU||r['SKU']||'').trim();
      const brand=String(r.brand||r['品牌']||'').trim();
      const product_type=String(r.product_type||r['产品类型']||'').trim();
      const priceRaw=r.quote_price??r['FOB价格']??r['报价价格']??r['报价'];
      const priceText=String(priceRaw??'').trim();
      const quote_price=Number(priceText);
      const currency=String(r.currency||r['币种']||BRAND_CCY[brand]||'').trim().toUpperCase();
      const quote_date=String(r.quote_date||r['报价日期']||'').trim().slice(0,10);
      const remark=String(r.remark||r['备注']||'').trim();
      const expected=BRAND_CCY[brand];
      if(!sku||!brand||!product_type||priceText===''||!Number.isFinite(quote_price)||quote_price<0||!/^\d{4}-\d{2}-\d{2}$/.test(quote_date)||!currency){
        errors.push({row:i+2,reason:'必填字段缺失或格式错误'});
      }else if(expected&&currency!==expected){
        errors.push({row:i+2,reason:brand+' 默认币种应为 '+expected});
      }else rows.push({sku,brand,product_type,quote_price,currency,quote_date,remark});
    });
    if(errors.length){const e=new Error('导入校验失败');e.status=400;e.errors=errors;throw e;}
    return {rows,mode};
  }

  function getExisting(rows){
    if(!rows.length)return new Set();
    const vals=[],ps=[];
    for(const r of rows){vals.push('(?,?,?)');ps.push(r.sku,r.brand,r.quote_date);}
    const sql=`WITH incoming(sku_code,brand,quote_date) AS (VALUES ${vals.join(',')}) SELECT q.sku_code,q.brand,q.quote_date FROM quotation_prices q JOIN incoming i ON i.sku_code=q.sku_code AND i.brand=q.brand AND i.quote_date=q.quote_date`;
    return new Set(query(sql,ps).rows.map(r=>r.sku_code+'\u0001'+r.brand+'\u0001'+r.quote_date));
  }

  function collapseRows(rows,mode){
    const map=new Map();
    if(mode==='overwrite'){
      for(const r of rows)map.set(keyOf(r),r); // last row wins
    }else{
      for(const r of rows)if(!map.has(keyOf(r)))map.set(keyOf(r),r); // first row wins
    }
    return [...map.values()];
  }

  function bulkWrite(rows,mode,batch,now){
    if(!rows.length)return;
    const vals=[],ps=[];
    for(const r of rows){
      vals.push('(?,?,?,?,?,?,?,?,?,?,?)');
      ps.push(genId('quote'),r.sku,r.brand,r.product_type,r.quote_price,r.currency,r.quote_date,r.remark,batch,now,now);
    }
    let sql=`INSERT INTO quotation_prices (id,sku_code,brand,product_type,quote_price,currency,quote_date,remark,import_batch_id,created_at,updated_at) VALUES ${vals.join(',')} `;
    if(mode==='overwrite'){
      sql+=`ON CONFLICT (sku_code,brand,quote_date) DO UPDATE SET product_type=EXCLUDED.product_type,quote_price=EXCLUDED.quote_price,currency=EXCLUDED.currency,remark=EXCLUDED.remark,import_batch_id=EXCLUDED.import_batch_id,updated_at=EXCLUDED.updated_at`;
    }else sql+=`ON CONFLICT (sku_code,brand,quote_date) DO NOTHING`;
    run(sql,ps);
  }

  app.post('/api/quotation-management/import',requireApiPermission('cost_view'),asyncHandler((req,res)=>{
    try{
      const {rows,mode}=parseRows(req);
      const existing=getExisting(rows);
      let inserted=0,updated=0,skipped=0;
      const seen=new Set(existing);
      for(const r of rows){
        const k=keyOf(r);
        if(seen.has(k)){if(mode==='overwrite')updated++;else skipped++;}
        else{inserted++;seen.add(k);}
      }
      const no_quote=rows.filter(r=>r.quote_price===0).length;
      const batch=genId('quoteimp'),now=new Date().toISOString();
      bulkWrite(collapseRows(rows,mode),mode,batch,now);
      res.json({success:true,inserted,updated,skipped,no_quote,total:rows.length,import_batch_id:batch});
    }catch(e){
      res.status(e.status||500).json({error:e.message,errors:e.errors||undefined});
    }
  }));
};
