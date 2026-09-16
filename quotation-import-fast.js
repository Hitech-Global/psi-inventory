'use strict';

module.exports=function installQuotationImportFast(deps){
  const {app,query,run,genId,asyncHandler,requireApiPermission}=deps;
  const {withAsyncPoolClient}=require('./pg-async');
  const BRAND_CCY=Object.freeze({Netac:'USD',Redragon:'RMB',BOYA:'RMB',Joypeer:'RMB'});
  const MAX_ROWS=5000;
  const RUN_TTL_MS=30*60*1000;
  const runs=new Map();
  const keyOf=r=>r.sku+'\u0001'+r.brand+'\u0001'+r.quote_date;
  const nowIso=()=>new Date().toISOString();
  const isPg=()=>String(process.env.DB_DRIVER||'sqlite').toLowerCase()==='pg';
  const yieldLoop=()=>new Promise(resolve=>setImmediate(resolve));

  function cleanupRuns(){
    const cutoff=Date.now()-RUN_TTL_MS;
    for(const [id,r] of runs){
      const t=Date.parse(r.updated_at||r.started_at||0)||0;
      if(t<cutoff)runs.delete(id);
    }
  }
  function setRun(id,patch){
    cleanupRuns();
    const prev=runs.get(id)||{import_id:id,status:'running',phase:'starting',percent:0,processed_count:0,total_count:0,inserted:0,updated:0,skipped:0,no_quote:0,started_at:nowIso()};
    const next={...prev,...patch,import_id:id,updated_at:nowIso()};
    if(['completed','failed','blocked'].includes(next.status)&&!next.finished_at)next.finished_at=nowIso();
    runs.set(id,next);return next;
  }
  function terminal(r){return !!r&&['completed','failed','blocked'].includes(r.status);}

  function parseRows(req){
    const input=Array.isArray((req.body||{}).rows)?req.body.rows:[];
    const mode=(req.body||{}).duplicate_mode==='overwrite'?'overwrite':'skip';
    if(!input.length){const e=new Error('导入数据不能为空');e.status=400;throw e;}
    if(input.length>MAX_ROWS){const e=new Error('本次导入共 '+input.length+' 行，单次最多支持 '+MAX_ROWS+' 行，请拆分后重试。');e.status=422;e.code='IMPORT_ROW_LIMIT_EXCEEDED';throw e;}
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

  function collapseRows(rows,mode){
    const map=new Map();
    if(mode==='overwrite')for(const r of rows)map.set(keyOf(r),r);
    else for(const r of rows)if(!map.has(keyOf(r)))map.set(keyOf(r),r);
    return [...map.values()];
  }

  function existingSqlite(rows){
    if(!rows.length)return new Set();
    const vals=[],ps=[];
    for(const r of rows){vals.push('(?,?,?)');ps.push(r.sku,r.brand,r.quote_date);}
    const sql=`WITH incoming(sku_code,brand,quote_date) AS (VALUES ${vals.join(',')}) SELECT q.sku_code,q.brand,q.quote_date FROM quotation_prices q JOIN incoming i ON i.sku_code=q.sku_code AND i.brand=q.brand AND i.quote_date=q.quote_date`;
    return new Set(query(sql,ps).rows.map(r=>r.sku_code+'\u0001'+r.brand+'\u0001'+r.quote_date));
  }

  async function existingPg(aq,rows){
    if(!rows.length)return new Set();
    const payload=rows.map(r=>({sku_code:r.sku,brand:r.brand,quote_date:r.quote_date}));
    const found=await aq(`WITH incoming AS (
      SELECT * FROM jsonb_to_recordset(?::jsonb) AS x(sku_code TEXT, brand TEXT, quote_date TEXT)
    )
    SELECT q.sku_code,q.brand,q.quote_date
    FROM quotation_prices q
    JOIN incoming i ON i.sku_code=q.sku_code AND i.brand=q.brand AND i.quote_date=q.quote_date`,[JSON.stringify(payload)]);
    return new Set(found.map(r=>r.sku_code+'\u0001'+r.brand+'\u0001'+r.quote_date));
  }

  function preparedRows(rows,importId,now){
    return rows.map(r=>({id:genId('quote'),sku_code:r.sku,brand:r.brand,product_type:r.product_type,quote_price:r.quote_price,currency:r.currency,quote_date:r.quote_date,remark:r.remark,import_batch_id:importId,created_at:now,updated_at:now}));
  }

  function bulkWriteSqlite(rows,mode,importId,now){
    if(!rows.length)return;
    const vals=[],ps=[];
    for(const r of preparedRows(rows,importId,now)){
      vals.push('(?,?,?,?,?,?,?,?,?,?,?)');
      ps.push(r.id,r.sku_code,r.brand,r.product_type,r.quote_price,r.currency,r.quote_date,r.remark,r.import_batch_id,r.created_at,r.updated_at);
    }
    let sql=`INSERT INTO quotation_prices (id,sku_code,brand,product_type,quote_price,currency,quote_date,remark,import_batch_id,created_at,updated_at) VALUES ${vals.join(',')} `;
    if(mode==='overwrite')sql+=`ON CONFLICT (sku_code,brand,quote_date) DO UPDATE SET product_type=EXCLUDED.product_type,quote_price=EXCLUDED.quote_price,currency=EXCLUDED.currency,remark=EXCLUDED.remark,import_batch_id=EXCLUDED.import_batch_id,updated_at=EXCLUDED.updated_at`;
    else sql+=`ON CONFLICT (sku_code,brand,quote_date) DO NOTHING`;
    run(sql,ps);
  }

  async function bulkWritePg(arun,rows,mode,importId,now){
    if(!rows.length)return;
    const payload=preparedRows(rows,importId,now);
    let sql=`INSERT INTO quotation_prices (id,sku_code,brand,product_type,quote_price,currency,quote_date,remark,import_batch_id,created_at,updated_at)
      SELECT id,sku_code,brand,product_type,quote_price,currency,quote_date,remark,import_batch_id,created_at,updated_at
      FROM jsonb_to_recordset(?::jsonb) AS x(
        id TEXT, sku_code TEXT, brand TEXT, product_type TEXT, quote_price NUMERIC,
        currency TEXT, quote_date TEXT, remark TEXT, import_batch_id TEXT, created_at TEXT, updated_at TEXT
      ) `;
    if(mode==='overwrite')sql+=`ON CONFLICT (sku_code,brand,quote_date) DO UPDATE SET product_type=EXCLUDED.product_type,quote_price=EXCLUDED.quote_price,currency=EXCLUDED.currency,remark=EXCLUDED.remark,import_batch_id=EXCLUDED.import_batch_id,updated_at=EXCLUDED.updated_at`;
    else sql+=`ON CONFLICT (sku_code,brand,quote_date) DO NOTHING`;
    await arun(sql,[JSON.stringify(payload)]);
  }

  function counts(rows,collapsed,existing,mode){
    let inserted=0,updated=0;
    for(const r of collapsed){if(existing.has(keyOf(r)))updated+=mode==='overwrite'?1:0;else inserted++;}
    const inFileDuplicates=rows.length-collapsed.length;
    const skipped=mode==='skip'?(collapsed.filter(r=>existing.has(keyOf(r))).length+inFileDuplicates):inFileDuplicates;
    return {inserted,updated,skipped};
  }

  app.get('/api/quotation-management/import/:importId/status',requireApiPermission('cost_view'),asyncHandler(async(req,res)=>{
    const id=String(req.params.importId||'').trim();
    let r=runs.get(id);
    if(!r&&isPg()){
      try{
        await withAsyncPoolClient(async(aq)=>{
          const rows=await aq('SELECT COUNT(*)::int AS n FROM quotation_prices WHERE import_batch_id = ?',[id]);
          const n=Number(rows&&rows[0]&&rows[0].n)||0;
          if(n>0)r=setRun(id,{status:'completed',phase:'completed',percent:100,processed_count:n,total_count:n,inserted:n,message:'导入已完成（服务重启后恢复）'});
        });
      }catch(_e){}
    }
    if(!r)return res.status(404).json({error:'导入任务不存在或状态已过期',import_id:id,status:'unknown'});
    res.json(r);
  }));

  app.post('/api/quotation-management/import',requireApiPermission('cost_view'),asyncHandler(async(req,res)=>{
    const importId=String((req.body||{}).import_id||genId('quoteimp')).trim();
    const prior=runs.get(importId);
    if(prior){return res.status(terminal(prior)?200:202).json(prior);}
    setRun(importId,{status:'running',phase:'validating',percent:3,message:'正在校验报价数据'});
    await yieldLoop();
    try{
      const {rows,mode}=parseRows(req);
      setRun(importId,{total_count:rows.length,phase:'deduplicating',percent:12,message:'正在整理重复记录'});
      await yieldLoop();
      const collapsed=collapseRows(rows,mode);
      let existing;
      setRun(importId,{phase:'matching',percent:28,message:'正在匹配已有报价'});
      await yieldLoop();
      if(isPg()){
        await withAsyncPoolClient(async(aq,_aqOne,arun)=>{
          existing=await existingPg(aq,collapsed);
          const c=counts(rows,collapsed,existing,mode);
          setRun(importId,{...c,phase:'writing',percent:62,processed_count:0,message:'正在批量写入报价'});
          await yieldLoop();
          await bulkWritePg(arun,collapsed,mode,importId,nowIso());
        });
      }else{
        existing=existingSqlite(collapsed);
        const c=counts(rows,collapsed,existing,mode);
        setRun(importId,{...c,phase:'writing',percent:62,processed_count:0,message:'正在批量写入报价'});
        await yieldLoop();
        bulkWriteSqlite(collapsed,mode,importId,nowIso());
      }
      const c=counts(rows,collapsed,existing,mode);
      const no_quote=rows.filter(r=>r.quote_price===0).length;
      const done=setRun(importId,{...c,no_quote,status:'completed',phase:'completed',percent:100,processed_count:rows.length,total_count:rows.length,message:'导入完成'});
      res.json(done);
    }catch(e){
      const blocked=(e.status||400)<500;
      const failed=setRun(importId,{status:blocked?'blocked':'failed',phase:blocked?'blocked':'failed',percent:0,message:e.message||'导入失败',error:e.message,errors:e.errors||undefined,code:e.code});
      res.status(e.status||500).json(failed);
    }
  }));
};
