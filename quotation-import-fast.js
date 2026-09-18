'use strict';

module.exports=function installQuotationImportFast(deps){
  const {app,query,run,genId,asyncHandler,requireApiPermission}=deps;
  const crypto=require('node:crypto');
  const {withAsyncPoolClient,withGenerateClient}=require('./pg-async');
  const BRAND_CCY=Object.freeze({Netac:'RMB',Redragon:'RMB',BOYA:'RMB',Joypeer:'RMB'});
  const MAX_ROWS=5000;
  const STALE_MS=90*1000;
  const keyOf=r=>r.sku+'\u0001'+r.brand+'\u0001'+r.quote_date;
  const nowIso=()=>new Date().toISOString();
  const isPg=()=>String(process.env.DB_DRIVER||'sqlite').toLowerCase()==='pg';
  let ensurePgPromise=null;

  function normalizeDate(value){
    if(value instanceof Date&&!Number.isNaN(value.getTime()))return value.toISOString().slice(0,10);
    if(typeof value==='number'||/^\d+(?:\.\d+)?$/.test(String(value||''))){
      const n=Number(value);
      if(Number.isFinite(n)&&n>1000){
        const d=new Date(Date.UTC(1899,11,30)+Math.floor(n)*86400000);
        if(!Number.isNaN(d.getTime()))return d.toISOString().slice(0,10);
      }
    }
    const s=String(value??'').trim();if(!s)return '';
    let m=s.match(/^(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})/);
    if(m)return m[1]+'-'+String(m[2]).padStart(2,'0')+'-'+String(m[3]).padStart(2,'0');
    if(/^\d{4}-\d{2}-\d{2}T/.test(s))return s.slice(0,10);
    return s.slice(0,10);
  }

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
      const quote_date=normalizeDate(r.quote_date||r['报价日期']||'');
      const remark=String(r.remark||r['备注']||'').trim();
      const expected=BRAND_CCY[brand];
      let reason='';
      if(!sku)reason='SKU 为空';
      else if(!brand)reason='品牌为空';
      else if(!product_type)reason='产品类型为空';
      else if(priceText===''||!Number.isFinite(quote_price)||quote_price<0)reason='FOB 价格格式错误（0 允许，表示未报价）';
      else if(!/^\d{4}-\d{2}-\d{2}$/.test(quote_date))reason='报价日期格式无法识别';
      else if(!currency)reason='币种为空';
      else if(expected&&currency!==expected)reason=brand+' 默认币种应为 '+expected;
      if(reason)errors.push({row:i+2,reason});
      else rows.push({sku,brand,product_type,quote_price,currency,quote_date,remark});
    });
    if(errors.length){const e=new Error('导入校验失败（'+errors.length+' 行）');e.status=400;e.errors=errors;throw e;}
    return {rows,mode};
  }

  function collapseRows(rows,mode){
    const map=new Map();
    if(mode==='overwrite')for(const r of rows)map.set(keyOf(r),r);
    else for(const r of rows)if(!map.has(keyOf(r)))map.set(keyOf(r),r);
    return [...map.values()];
  }
  function hashRows(rows,mode){return crypto.createHash('sha256').update(JSON.stringify({mode,rows})).digest('hex');}
  function counts(rows,collapsed,existing,mode){
    let inserted=0,updated=0;
    for(const r of collapsed){
      if(existing.has(keyOf(r))){if(mode==='overwrite')updated++;}
      else inserted++;
    }
    const inFileDuplicates=rows.length-collapsed.length;
    const skipped=(mode==='skip'?collapsed.filter(r=>existing.has(keyOf(r))).length:0)+inFileDuplicates;
    return {inserted,updated,skipped};
  }

  async function ensurePgTable(){
    if(!isPg())return;
    if(!ensurePgPromise)ensurePgPromise=withAsyncPoolClient(async(_aq,_aqOne,arun)=>{
      await arun(`CREATE TABLE IF NOT EXISTS quotation_import_runs (
        import_id TEXT PRIMARY KEY,
        request_hash TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'running',
        phase TEXT NOT NULL DEFAULT 'starting',
        percent INTEGER NOT NULL DEFAULT 0,
        total_count INTEGER NOT NULL DEFAULT 0,
        processed_count INTEGER NOT NULL DEFAULT 0,
        inserted INTEGER NOT NULL DEFAULT 0,
        updated INTEGER NOT NULL DEFAULT 0,
        skipped INTEGER NOT NULL DEFAULT 0,
        no_quote INTEGER NOT NULL DEFAULT 0,
        duplicate_mode TEXT NOT NULL DEFAULT 'skip',
        error TEXT NOT NULL DEFAULT '',
        errors_json TEXT NOT NULL DEFAULT '',
        message TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        finished_at TEXT NOT NULL DEFAULT ''
      )`);
      await arun('CREATE INDEX IF NOT EXISTS idx_quotation_import_runs_updated ON quotation_import_runs(updated_at)');
    }).catch(e=>{ensurePgPromise=null;throw e;});
    return ensurePgPromise;
  }

  function runBody(r){
    if(!r)return null;
    let errors=[];try{errors=r.errors_json?JSON.parse(r.errors_json):[]}catch(_e){}
    return {...r,percent:Number(r.percent)||0,total_count:Number(r.total_count)||0,processed_count:Number(r.processed_count)||0,inserted:Number(r.inserted)||0,updated:Number(r.updated)||0,skipped:Number(r.skipped)||0,no_quote:Number(r.no_quote)||0,errors};
  }
  async function getPgRun(id){
    await ensurePgTable();
    return withAsyncPoolClient(async(_aq,aqOne)=>runBody(await aqOne('SELECT * FROM quotation_import_runs WHERE import_id=?',[id])));
  }
  async function savePgRun(id,patch){
    await ensurePgTable();
    const prev=await getPgRun(id);
    const ts=nowIso();
    const base={import_id:id,request_hash:'',status:'running',phase:'starting',percent:0,total_count:0,processed_count:0,inserted:0,updated:0,skipped:0,no_quote:0,duplicate_mode:'skip',error:'',errors_json:'',message:'',created_at:prev&&prev.created_at||ts,updated_at:ts,finished_at:''};
    const next={...base,...(prev||{}),...(patch||{}),updated_at:ts};
    if(next.status==='running')next.finished_at='';
    else if(['completed','failed','blocked','unknown_pending_reconcile'].includes(next.status)&&!next.finished_at)next.finished_at=ts;
    await withAsyncPoolClient(async(_aq,_aqOne,arun)=>arun(`INSERT INTO quotation_import_runs(import_id,request_hash,status,phase,percent,total_count,processed_count,inserted,updated,skipped,no_quote,duplicate_mode,error,errors_json,message,created_at,updated_at,finished_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(import_id) DO UPDATE SET request_hash=EXCLUDED.request_hash,status=EXCLUDED.status,phase=EXCLUDED.phase,percent=EXCLUDED.percent,total_count=EXCLUDED.total_count,processed_count=EXCLUDED.processed_count,inserted=EXCLUDED.inserted,updated=EXCLUDED.updated,skipped=EXCLUDED.skipped,no_quote=EXCLUDED.no_quote,duplicate_mode=EXCLUDED.duplicate_mode,error=EXCLUDED.error,errors_json=EXCLUDED.errors_json,message=EXCLUDED.message,updated_at=EXCLUDED.updated_at,finished_at=EXCLUDED.finished_at`,[next.import_id,next.request_hash,next.status,next.phase,next.percent,next.total_count,next.processed_count,next.inserted,next.updated,next.skipped,next.no_quote,next.duplicate_mode,next.error,next.errors_json,next.message,next.created_at,next.updated_at,next.finished_at]));
    return runBody(next);
  }

  async function countImportedByJob(importId){
    return withAsyncPoolClient(async(_aq,aqOne)=>Number((await aqOne('SELECT COUNT(*)::int AS n FROM quotation_prices WHERE import_batch_id=?',[importId]))?.n)||0);
  }
  async function reconcilePgRun(runState){
    if(!runState||runState.status!=='running')return runState;
    const age=Date.now()-(Date.parse(runState.updated_at)||0);
    if(age<STALE_MS)return runState;
    const phase=String(runState.phase||'');
    if(['writing','finalizing'].includes(phase)){
      const n=await countImportedByJob(runState.import_id);
      const expected=runState.duplicate_mode==='overwrite'
        ? (Number(runState.inserted)||0)+(Number(runState.updated)||0)
        : (Number(runState.inserted)||0);
      if(n===expected){
        return savePgRun(runState.import_id,{status:'completed',phase:'completed',percent:100,processed_count:runState.total_count,message:'导入已完成（刷新后自动确认）'});
      }
      if(n===0){
        return savePgRun(runState.import_id,{status:'failed',phase:'failed',percent:0,error:'导入进程在提交前中断，数据库未写入',message:'导入已中断且确认零写入，可重新发起导入。'});
      }
      return savePgRun(runState.import_id,{status:'unknown_pending_reconcile',phase:'unknown_pending_reconcile',error:'导入结果无法自动确认',message:'导入进程曾中断，检测到部分关联记录；请勿重复提交同一任务。'});
    }
    return savePgRun(runState.import_id,{status:'failed',phase:'failed',percent:0,error:'导入进程在写入前中断，数据库未写入',message:'导入已中断且确认尚未进入写入阶段，可重新发起导入。'});
  }

  async function existingPg(rows){
    if(!rows.length)return new Set();
    const payload=rows.map(r=>({sku_code:r.sku,brand:r.brand,quote_date:r.quote_date}));
    return withAsyncPoolClient(async(aq)=>new Set((await aq(`WITH incoming AS (
      SELECT * FROM jsonb_to_recordset(?::jsonb) AS x(sku_code TEXT,brand TEXT,quote_date TEXT)
    )
    SELECT q.sku_code,q.brand,q.quote_date
    FROM quotation_prices q
    JOIN incoming i ON i.sku_code=q.sku_code AND i.brand=q.brand AND i.quote_date=q.quote_date`,[JSON.stringify(payload)])).map(r=>r.sku_code+'\u0001'+r.brand+'\u0001'+r.quote_date)));
  }
  function existingSqlite(rows){
    if(!rows.length)return new Set();
    const vals=[],ps=[];
    for(const r of rows){vals.push('(?,?,?)');ps.push(r.sku,r.brand,r.quote_date);}
    return new Set(query(`WITH incoming(sku_code,brand,quote_date) AS (VALUES ${vals.join(',')}) SELECT q.sku_code,q.brand,q.quote_date FROM quotation_prices q JOIN incoming i ON i.sku_code=q.sku_code AND i.brand=q.brand AND i.quote_date=q.quote_date`,ps).rows.map(r=>r.sku_code+'\u0001'+r.brand+'\u0001'+r.quote_date));
  }
  function preparedRows(rows,importId,now){return rows.map(r=>({id:genId('quote'),sku_code:r.sku,brand:r.brand,product_type:r.product_type,quote_price:r.quote_price,currency:r.currency,quote_date:r.quote_date,remark:r.remark,import_batch_id:importId,created_at:now,updated_at:now}));}

  async function bulkWritePg(rows,mode,importId,now){
    if(!rows.length)return 0;
    const payload=preparedRows(rows,importId,now);
    return withGenerateClient(async(aq,_aqOne)=>{
      let sql=`INSERT INTO quotation_prices(id,sku_code,brand,product_type,quote_price,currency,quote_date,remark,import_batch_id,created_at,updated_at)
        SELECT id,sku_code,brand,product_type,quote_price,currency,quote_date,remark,import_batch_id,created_at,updated_at
        FROM jsonb_to_recordset(?::jsonb) AS x(id TEXT,sku_code TEXT,brand TEXT,product_type TEXT,quote_price NUMERIC,currency TEXT,quote_date TEXT,remark TEXT,import_batch_id TEXT,created_at TEXT,updated_at TEXT) `;
      if(mode==='overwrite')sql+=`ON CONFLICT(sku_code,brand,quote_date) DO UPDATE SET product_type=EXCLUDED.product_type,quote_price=EXCLUDED.quote_price,currency=EXCLUDED.currency,remark=EXCLUDED.remark,import_batch_id=EXCLUDED.import_batch_id,updated_at=EXCLUDED.updated_at `;
      else sql+=`ON CONFLICT(sku_code,brand,quote_date) DO NOTHING `;
      sql+='RETURNING sku_code';
      const written=await aq(sql,[JSON.stringify(payload)]);
      return written.length;
    });
  }
  function bulkWriteSqlite(rows,mode,importId,now){
    if(!rows.length)return 0;
    const vals=[],ps=[];
    for(const r of preparedRows(rows,importId,now)){
      vals.push('(?,?,?,?,?,?,?,?,?,?,?)');
      ps.push(r.id,r.sku_code,r.brand,r.product_type,r.quote_price,r.currency,r.quote_date,r.remark,r.import_batch_id,r.created_at,r.updated_at);
    }
    let sql=`INSERT INTO quotation_prices(id,sku_code,brand,product_type,quote_price,currency,quote_date,remark,import_batch_id,created_at,updated_at) VALUES ${vals.join(',')} `;
    if(mode==='overwrite')sql+=`ON CONFLICT(sku_code,brand,quote_date) DO UPDATE SET product_type=EXCLUDED.product_type,quote_price=EXCLUDED.quote_price,currency=EXCLUDED.currency,remark=EXCLUDED.remark,import_batch_id=EXCLUDED.import_batch_id,updated_at=EXCLUDED.updated_at`;
    else sql+=`ON CONFLICT(sku_code,brand,quote_date) DO NOTHING`;
    const r=run(sql,ps);return Number((r&&(r.changes!=null?r.changes:r.rowCount))||0);
  }

  async function executePgImport(importId,rows,mode,collapsed){
    try{
      await savePgRun(importId,{status:'running',phase:'validating',percent:15,processed_count:0,message:'报价数据校验完成'});
      await savePgRun(importId,{phase:'matching',percent:35,message:'正在匹配已有报价'});
      const existing=await existingPg(collapsed);
      const c=counts(rows,collapsed,existing,mode);
      const no_quote=rows.filter(r=>r.quote_price===0).length;
      const writeRows=mode==='overwrite'?collapsed:collapsed.filter(r=>!existing.has(keyOf(r)));
      await savePgRun(importId,{...c,no_quote,phase:'writing',percent:68,processed_count:0,message:'正在批量写入报价'});
      const written=await bulkWritePg(writeRows,mode,importId,nowIso());
      await savePgRun(importId,{...c,no_quote,phase:'finalizing',percent:92,processed_count:rows.length,message:'报价写入完成，正在确认结果'});
      const expected=mode==='overwrite'?c.inserted+c.updated:c.inserted;
      if(written!==expected){
        console.warn('[quotation-import] written count differs', {importId,written,expected,mode});
      }
      await savePgRun(importId,{...c,no_quote,status:'completed',phase:'completed',percent:100,processed_count:rows.length,total_count:rows.length,message:'导入完成'});
    }catch(e){
      console.error('[quotation-import] background job failed',importId,e&&e.message?e.message:e);
      try{await savePgRun(importId,{status:'failed',phase:'failed',percent:0,error:e&&e.message?e.message:String(e),message:'报价导入失败'});}catch(e2){console.error('[quotation-import] failed to persist failure',importId,e2&&e2.message?e2.message:e2);}
    }
  }

  app.get('/api/quotation-management/import/:importId/status',requireApiPermission('quotation_view'),asyncHandler(async(req,res)=>{
    const id=String(req.params.importId||'').trim();
    if(!id)return res.status(400).json({error:'import_id 不能为空'});
    if(!isPg())return res.status(404).json({error:'本地模式不保留任务状态',status:'unknown'});
    let r=await getPgRun(id);
    if(!r)return res.status(404).json({error:'导入任务不存在',import_id:id,status:'unknown'});
    r=await reconcilePgRun(r);
    res.json(r);
  }));

  app.post('/api/quotation-management/import',requireApiPermission('quotation_view'),asyncHandler(async(req,res)=>{
    const importId=String((req.body||{}).import_id||genId('quoteimp')).trim();
    try{
      const {rows,mode}=parseRows(req);
      const collapsed=collapseRows(rows,mode);
      const requestHash=hashRows(rows,mode);
      if(isPg()){
        let prior=await getPgRun(importId);
        if(prior){
          if(prior.request_hash&&prior.request_hash!==requestHash)return res.status(409).json({error:'同一 import_id 的导入内容不一致，已拒绝重复提交',status:prior.status,import_id:importId});
          prior=await reconcilePgRun(prior);
          return res.status(prior.status==='running'?202:200).json(prior);
        }
        const queued=await savePgRun(importId,{request_hash:requestHash,status:'running',phase:'queued',percent:8,total_count:rows.length,processed_count:0,duplicate_mode:mode,message:'报价文件已接收，准备导入'});
        res.status(202).json(queued);
        setImmediate(()=>{executePgImport(importId,rows,mode,collapsed).catch(e=>console.error('[quotation-import] unhandled job error',e&&e.message?e.message:e));});
        return;
      }

      const existing=existingSqlite(collapsed);
      const c=counts(rows,collapsed,existing,mode);
      const no_quote=rows.filter(r=>r.quote_price===0).length;
      const writeRows=mode==='overwrite'?collapsed:collapsed.filter(r=>!existing.has(keyOf(r)));
      bulkWriteSqlite(writeRows,mode,importId,nowIso());
      return res.json({success:true,import_id:importId,status:'completed',phase:'completed',percent:100,total_count:rows.length,processed_count:rows.length,...c,no_quote,message:'导入完成'});
    }catch(e){
      const body={error:e.message,errors:e.errors||undefined,code:e.code,import_id:importId,status:'blocked'};
      return res.status(e.status||500).json(body);
    }
  }));
};
