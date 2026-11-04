'use strict';

module.exports=function installQuotationImportFast(deps){
  const {app,query,run,transaction,genId,asyncHandler,requireApiPermission}=deps;
  const crypto=require('node:crypto');
  const {withAsyncPoolClient,withGenerateClient}=require('./pg-async');
  const BRAND_CCY=Object.freeze({Netac:'USD',Redragon:'RMB',BOYA:'RMB',Joypeer:'RMB'});
  const MAX_ROWS=5000;
  const STALE_MS=90*1000;
  const clean=v=>String(v??'').trim();
  const norm=v=>clean(v).toUpperCase();
  const keyOf=r=>[r.supplier_id,r.sku,r.brand,r.quote_date].join('\u0001');
  const mappingKey=(supplier,brand,part)=>[supplier,brand,norm(part)].join('\u0001');
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

  function parseIdList(value){
    if(Array.isArray(value))return value.map(v=>String(v||'').trim()).filter(Boolean);
    try{const a=JSON.parse(String(value||'[]'));return Array.isArray(a)?a.map(v=>String(v||'').trim()).filter(Boolean):[];}catch(_e){return [];}
  }
  function badRequest(message,errors){
    const e=new Error(message);e.status=400;if(errors)e.errors=errors;return e;
  }
  function parseRows(req){
    const body=req.body||{},input=Array.isArray(body.rows)?body.rows:[];
    const mode=body.duplicate_mode==='overwrite'?'overwrite':'skip';
    if(!input.length)throw badRequest('导入数据不能为空');
    if(input.length>MAX_ROWS)throw badRequest('本次导入共 '+input.length+' 行，单次最多支持 '+MAX_ROWS+' 行，请拆分后重试。');
    const supplierId=clean(body.supplier_id);
    let supplier=null;
    if(supplierId){
      supplier=query("SELECT id,name,associated_brands,default_currency,status FROM suppliers WHERE id=? AND status='active'",[supplierId]).rows[0]||null;
      if(!supplier)throw badRequest('所选供应商不存在或已停用，请重新选择。');
    }
    const supplierBrands=supplier?parseIdList(supplier.associated_brands):[];
    const skuRows=query("SELECT sku_code,brand,category,model,product_name,color_spec,barcode FROM skus WHERE COALESCE(status,'normal')<>'deleted'").rows;
    const skuMap=new Map(),brandMap=new Map();
    skuRows.forEach(x=>{const b=clean(x.brand);if(b){brandMap.set(b.toLowerCase(),b);skuMap.set(b.toLowerCase()+'|'+norm(x.sku_code),x);}});
    const savedMappings=supplierId?query('SELECT supplier_id,brand,supplier_part_no_key,psi_sku_code FROM quotation_sku_mappings WHERE supplier_id=?',[supplierId]).rows:[];
    const mappingMap=new Map(savedMappings.map(x=>[mappingKey(x.supplier_id,x.brand,x.supplier_part_no_key),x.psi_sku_code]));
    const manualMap=new Map(),mappingUpdates=[];
    (Array.isArray(body.mapping_updates)?body.mapping_updates:[]).forEach(x=>{
      const brand=clean(x.brand),part=clean(x.supplier_part_no),psi=clean(x.psi_sku_code);
      if(supplierId&&brand&&part&&psi)manualMap.set(mappingKey(supplierId,brand,part),psi);
    });
    const rows=[],errors=[];
    input.forEach((raw,i)=>{
      const r=raw||{};
      const part=clean(r.supplier_part_no||r['供应商料号']||r['Part No.']||r.part_no||r.sku_code||r.SKU||r['SKU']);
      const rawBrand=clean((r.brand_source==='default'?body.brand:r.brand)||r['品牌']||body.brand||(supplierBrands.length===1?supplierBrands[0]:''));
      const brand=supplierBrands.find(x=>x.toLowerCase()===rawBrand.toLowerCase())||brandMap.get(rawBrand.toLowerCase())||rawBrand;
      const priceRaw=r.quote_price??r['FOB价格']??r['报价价格']??r['报价'];
      const priceText=clean(priceRaw);
      const quote_price=priceText===''?0:Number(priceText.replace(/[,\s]/g,'').replace(/[￥¥$€£]/g,''));
      const currency=clean(r.currency||r['币种']||BRAND_CCY[brand]||(supplier&&supplier.default_currency)||'').toUpperCase();
      const quote_date=normalizeDate(r.quote_date||r['报价日期']||body.quote_date||'');
      const expected=BRAND_CCY[brand];
      let reason='';
      if(!part)reason='供应商料号为空';
      else if(!brand)reason='品牌为空，请选择品牌或在表格中提供品牌';
      else if(supplierBrands.length&&!supplierBrands.includes(brand))reason='供应商 '+supplier.name+' 未关联品牌 '+brand;
      else if(!Number.isFinite(quote_price)||quote_price<0)reason='FOB 价格格式错误（空白或 0 表示未报价）';
      else if(!/^\d{4}-\d{2}-\d{2}$/.test(quote_date))reason='报价日期格式无法识别';
      else if(!currency)reason='币种为空';
      else if(expected&&currency!==expected)reason=brand+' 默认币种应为 '+expected;
      if(reason){errors.push({row:Number(r.source_row)||i+2,reason});return;}
      let match=null,matchSource='unlinked';
      if(clean(r.match_source)==='manual'&&clean(r.psi_sku_code)){
        match=skuMap.get(brand.toLowerCase()+'|'+norm(r.psi_sku_code))||null;
        if(!match){errors.push({row:Number(r.source_row)||i+2,reason:'手动选择的 PSI SKU 不存在或品牌不一致：'+clean(r.psi_sku_code)});return;}
        matchSource='manual';
      }
      if(!match){
        const mk=mappingKey(supplierId,brand,part),manualMapped=manualMap.get(mk),savedMapped=mappingMap.get(mk),mapped=manualMapped||savedMapped;
        if(mapped){
          match=skuMap.get(brand.toLowerCase()+'|'+norm(mapped))||null;
          if(!match&&manualMapped){errors.push({row:Number(r.source_row)||i+2,reason:'手动映射指向无效 SKU：'+mapped});return;}
          if(match)matchSource=manualMapped?'manual':'saved';
        }
      }
      if(!match){
        match=skuMap.get(brand.toLowerCase()+'|'+norm(part))||null;
        if(match)matchSource='exact';
      }
      const psiSku=match?clean(match.sku_code):'';
      rows.push({
        sku:psiSku||part,brand,product_type:(clean(r.product_type||r['产品类型'])&&clean(r.product_type||r['产品类型'])!=='未分类'?clean(r.product_type||r['产品类型']):clean(match&&match.category))||'未分类',
        quote_price,currency,quote_date,remark:clean(r.remark||r['备注']),supplier_id:supplierId,
        supplier_part_no:part,supplier_part_no_key:norm(part),psi_sku_code:psiSku,
        match_status:match?'matched':'unlinked',model:clean(r.model||r['型号']||(match&&match.model)||''),
        spec:clean(r.spec||r['规格']||(match&&match.color_spec)||''),source_sheet:clean(r.source_sheet),
        source_row:Number(r.source_row)||i+2,match_source:matchSource
      });
      if(matchSource==='manual'&&supplierId)mappingUpdates.push({
        supplier_id:supplierId,brand,supplier_part_no:part,supplier_part_no_key:norm(part),psi_sku_code:psiSku
      });
    });
    const mappingTargets=new Map();
    mappingUpdates.forEach(m=>{const k=mappingKey(m.supplier_id,m.brand,m.supplier_part_no_key),prior=mappingTargets.get(k);if(prior&&prior!==m.psi_sku_code)errors.push({row:0,reason:'同一供应商料号被手动关联到多个 PSI SKU：'+m.supplier_part_no});else mappingTargets.set(k,m.psi_sku_code);});
    if(errors.length)throw badRequest('导入校验失败（'+errors.length+' 行）',errors);
    const mappings=[...new Map(mappingUpdates.map(x=>[mappingKey(x.supplier_id,x.brand,x.supplier_part_no_key),x])).values()];
    return {rows,mode,mappings};
  }
  function collapseRows(rows,mode){
    const map=new Map();
    if(mode==='overwrite')for(const r of rows)map.set(keyOf(r),r);
    else for(const r of rows)if(!map.has(keyOf(r)))map.set(keyOf(r),r);
    return [...map.values()];
  }
  function hashRows(rows,mode,mappings){return crypto.createHash('sha256').update(JSON.stringify({mode,rows,mappings})).digest('hex');}
  function counts(rows,collapsed,existing,mode){
    let inserted=0,updated=0;
    for(const r of collapsed){
      if(existing.has(keyOf(r))){if(mode==='overwrite')updated++;}
      else inserted++;
    }
    const inFileDuplicates=rows.length-collapsed.length;
    const skipped=(mode==='skip'?collapsed.filter(r=>existing.has(keyOf(r))).length:0)+inFileDuplicates;
    return {inserted,updated,skipped,unlinked:rows.filter(r=>r.match_status==='unlinked').length};
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
        unlinked INTEGER NOT NULL DEFAULT 0,
        duplicate_mode TEXT NOT NULL DEFAULT 'skip',
        error TEXT NOT NULL DEFAULT '',
        errors_json TEXT NOT NULL DEFAULT '',
        message TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        finished_at TEXT NOT NULL DEFAULT ''
      )`);
      await arun('ALTER TABLE quotation_import_runs ADD COLUMN IF NOT EXISTS unlinked INTEGER NOT NULL DEFAULT 0');
      await arun('CREATE INDEX IF NOT EXISTS idx_quotation_import_runs_updated ON quotation_import_runs(updated_at)');
    }).catch(e=>{ensurePgPromise=null;throw e;});
    return ensurePgPromise;
  }

  function runBody(r){
    if(!r)return null;
    let errors=[];try{errors=r.errors_json?JSON.parse(r.errors_json):[]}catch(_e){}
    return {...r,percent:Number(r.percent)||0,total_count:Number(r.total_count)||0,processed_count:Number(r.processed_count)||0,inserted:Number(r.inserted)||0,updated:Number(r.updated)||0,skipped:Number(r.skipped)||0,no_quote:Number(r.no_quote)||0,unlinked:Number(r.unlinked)||0,errors};
  }
  async function getPgRun(id){
    await ensurePgTable();
    return withAsyncPoolClient(async(_aq,aqOne)=>runBody(await aqOne('SELECT * FROM quotation_import_runs WHERE import_id=?',[id])));
  }
  async function savePgRun(id,patch){
    await ensurePgTable();
    const prev=await getPgRun(id);
    const ts=nowIso();
    const base={import_id:id,request_hash:'',status:'running',phase:'starting',percent:0,total_count:0,processed_count:0,inserted:0,updated:0,skipped:0,no_quote:0,unlinked:0,duplicate_mode:'skip',error:'',errors_json:'',message:'',created_at:prev&&prev.created_at||ts,updated_at:ts,finished_at:''};
    const next={...base,...(prev||{}),...(patch||{}),updated_at:ts};
    if(next.status==='running')next.finished_at='';
    else if(['completed','failed','blocked','unknown_pending_reconcile'].includes(next.status)&&!next.finished_at)next.finished_at=ts;
    await withAsyncPoolClient(async(_aq,_aqOne,arun)=>arun(`INSERT INTO quotation_import_runs(import_id,request_hash,status,phase,percent,total_count,processed_count,inserted,updated,skipped,no_quote,unlinked,duplicate_mode,error,errors_json,message,created_at,updated_at,finished_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(import_id) DO UPDATE SET request_hash=EXCLUDED.request_hash,status=EXCLUDED.status,phase=EXCLUDED.phase,percent=EXCLUDED.percent,total_count=EXCLUDED.total_count,processed_count=EXCLUDED.processed_count,inserted=EXCLUDED.inserted,updated=EXCLUDED.updated,skipped=EXCLUDED.skipped,no_quote=EXCLUDED.no_quote,unlinked=EXCLUDED.unlinked,duplicate_mode=EXCLUDED.duplicate_mode,error=EXCLUDED.error,errors_json=EXCLUDED.errors_json,message=EXCLUDED.message,updated_at=EXCLUDED.updated_at,finished_at=EXCLUDED.finished_at`,[next.import_id,next.request_hash,next.status,next.phase,next.percent,next.total_count,next.processed_count,next.inserted,next.updated,next.skipped,next.no_quote,next.unlinked,next.duplicate_mode,next.error,next.errors_json,next.message,next.created_at,next.updated_at,next.finished_at]));
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
    const payload=rows.map(r=>({supplier_id:r.supplier_id,sku_code:r.sku,brand:r.brand,quote_date:r.quote_date}));
    const sql='WITH incoming AS (SELECT * FROM jsonb_to_recordset(?::jsonb) AS x(supplier_id TEXT,sku_code TEXT,brand TEXT,quote_date TEXT)) '+
      'SELECT q.supplier_id,q.sku_code,q.brand,q.quote_date FROM quotation_prices q JOIN incoming i '+
      'ON i.supplier_id=q.supplier_id AND i.sku_code=q.sku_code AND i.brand=q.brand AND i.quote_date=q.quote_date';
    return withAsyncPoolClient(async(aq)=>new Set((await aq(sql,[JSON.stringify(payload)])).map(r=>[r.supplier_id,r.sku_code,r.brand,r.quote_date].join('\u0001'))));
  }
  function existingSqlite(rows){
    if(!rows.length)return new Set();
    const vals=[],ps=[];
    for(const r of rows){vals.push('(?,?,?,?)');ps.push(r.supplier_id,r.sku,r.brand,r.quote_date);}
    const sql='WITH incoming(supplier_id,sku_code,brand,quote_date) AS (VALUES '+vals.join(',')+') '+
      'SELECT q.supplier_id,q.sku_code,q.brand,q.quote_date FROM quotation_prices q JOIN incoming i '+
      'ON i.supplier_id=q.supplier_id AND i.sku_code=q.sku_code AND i.brand=q.brand AND i.quote_date=q.quote_date';
    return new Set(query(sql,ps).rows.map(r=>[r.supplier_id,r.sku_code,r.brand,r.quote_date].join('\u0001')));
  }
  function preparedRows(rows,importId,now){
    return rows.map(r=>({
      id:genId('quote'),sku_code:r.sku,brand:r.brand,product_type:r.product_type,quote_price:r.quote_price,currency:r.currency,
      quote_date:r.quote_date,remark:r.remark,import_batch_id:importId,created_at:now,updated_at:now,
      supplier_id:r.supplier_id,supplier_part_no:r.supplier_part_no,supplier_part_no_key:r.supplier_part_no_key,
      psi_sku_code:r.psi_sku_code,match_status:r.match_status,model:r.model,spec:r.spec,
      source_sheet:r.source_sheet,source_row:r.source_row
    }));
  }
  async function bulkWritePg(rows,mode,importId,now,mappings){
    if(!rows.length&&!mappings.length)return 0;
    const payload=preparedRows(rows,importId,now);
    return withGenerateClient(async(aq)=>{
      if(mappings.length){
        const mapPayload=mappings.map(m=>({...m,id:genId('qmap'),created_at:now,updated_at:now}));
        const mapSql='INSERT INTO quotation_sku_mappings(id,supplier_id,brand,supplier_part_no,supplier_part_no_key,psi_sku_code,created_at,updated_at) '+
          'SELECT id,supplier_id,brand,supplier_part_no,supplier_part_no_key,psi_sku_code,created_at,updated_at '+
          'FROM jsonb_to_recordset(?::jsonb) AS x(id TEXT,supplier_id TEXT,brand TEXT,supplier_part_no TEXT,supplier_part_no_key TEXT,psi_sku_code TEXT,created_at TEXT,updated_at TEXT) '+
          'ON CONFLICT(supplier_id,brand,supplier_part_no_key) DO UPDATE SET supplier_part_no=EXCLUDED.supplier_part_no,psi_sku_code=EXCLUDED.psi_sku_code,updated_at=EXCLUDED.updated_at';
        await aq(mapSql,[JSON.stringify(mapPayload)]);
      }
      let written=0;
      if(payload.length){
        const cols='id,sku_code,brand,product_type,quote_price,currency,quote_date,remark,import_batch_id,created_at,updated_at,supplier_id,supplier_part_no,supplier_part_no_key,psi_sku_code,match_status,model,spec,source_sheet,source_row';
        let sql='INSERT INTO quotation_prices('+cols+') SELECT '+cols+' FROM jsonb_to_recordset(?::jsonb) AS x('+
          'id TEXT,sku_code TEXT,brand TEXT,product_type TEXT,quote_price NUMERIC,currency TEXT,quote_date TEXT,remark TEXT,import_batch_id TEXT,created_at TEXT,updated_at TEXT,'+
          'supplier_id TEXT,supplier_part_no TEXT,supplier_part_no_key TEXT,psi_sku_code TEXT,match_status TEXT,model TEXT,spec TEXT,source_sheet TEXT,source_row INTEGER) ';
        if(mode==='overwrite')sql+='ON CONFLICT(supplier_id,sku_code,brand,quote_date) DO UPDATE SET product_type=EXCLUDED.product_type,quote_price=EXCLUDED.quote_price,currency=EXCLUDED.currency,remark=EXCLUDED.remark,import_batch_id=EXCLUDED.import_batch_id,updated_at=EXCLUDED.updated_at,supplier_part_no=EXCLUDED.supplier_part_no,supplier_part_no_key=EXCLUDED.supplier_part_no_key,psi_sku_code=EXCLUDED.psi_sku_code,match_status=EXCLUDED.match_status,model=EXCLUDED.model,spec=EXCLUDED.spec,source_sheet=EXCLUDED.source_sheet,source_row=EXCLUDED.source_row ';
        else sql+='ON CONFLICT(supplier_id,sku_code,brand,quote_date) DO NOTHING ';
        sql+='RETURNING sku_code';
        written=(await aq(sql,[JSON.stringify(payload)])).length;
      }
      if(mappings.length){
        const updateSql="UPDATE quotation_prices q SET sku_code=m.psi_sku_code,psi_sku_code=m.psi_sku_code,match_status='matched', "+
          "product_type=CASE WHEN q.product_type='' OR q.product_type='未分类' THEN COALESCE(NULLIF(s.category,''),q.product_type) ELSE q.product_type END,updated_at=? "+
          "FROM quotation_sku_mappings m LEFT JOIN skus s ON s.sku_code=m.psi_sku_code AND s.brand=m.brand "+
          "WHERE q.supplier_id=m.supplier_id AND q.brand=m.brand AND q.supplier_part_no_key=m.supplier_part_no_key "+
          "AND q.match_status='unlinked' AND m.supplier_id=? AND NOT EXISTS(SELECT 1 FROM quotation_prices q2 "+
          "WHERE q2.supplier_id=q.supplier_id AND q2.brand=q.brand AND q2.quote_date=q.quote_date AND q2.sku_code=m.psi_sku_code AND q2.id<>q.id)";
        await aq(updateSql,[now,mappings[0].supplier_id]);
      }
      return written;
    });
  }
  function saveMappingsSqlite(mappings,now){
    for(const m of mappings){
      run('INSERT INTO quotation_sku_mappings(id,supplier_id,brand,supplier_part_no,supplier_part_no_key,psi_sku_code,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?) '+
        'ON CONFLICT(supplier_id,brand,supplier_part_no_key) DO UPDATE SET supplier_part_no=excluded.supplier_part_no,psi_sku_code=excluded.psi_sku_code,updated_at=excluded.updated_at',
        [genId('qmap'),m.supplier_id,m.brand,m.supplier_part_no,m.supplier_part_no_key,m.psi_sku_code,now,now]);
    }
  }
  function applyMappingsSqlite(mappings,now){
    for(const m of mappings){
      run("UPDATE quotation_prices SET sku_code=?,psi_sku_code=?,match_status='matched', "+
        "product_type=CASE WHEN product_type='' OR product_type='未分类' THEN COALESCE((SELECT NULLIF(category,'') FROM skus WHERE sku_code=? AND brand=?),'未分类') ELSE product_type END,updated_at=? "+
        "WHERE supplier_id=? AND brand=? AND supplier_part_no_key=? AND match_status='unlinked' "+
        "AND NOT EXISTS(SELECT 1 FROM quotation_prices q2 WHERE q2.supplier_id=quotation_prices.supplier_id AND q2.brand=quotation_prices.brand "+
        "AND q2.quote_date=quotation_prices.quote_date AND q2.sku_code=? AND q2.id<>quotation_prices.id)",
        [m.psi_sku_code,m.psi_sku_code,m.psi_sku_code,m.brand,now,m.supplier_id,m.brand,m.supplier_part_no_key,m.psi_sku_code]);
    }
  }
  function bulkWriteSqlite(rows,mode,importId,now){
    if(!rows.length)return 0;
    const vals=[],ps=[];
    for(const r of preparedRows(rows,importId,now)){
      vals.push('(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
      ps.push(r.id,r.sku_code,r.brand,r.product_type,r.quote_price,r.currency,r.quote_date,r.remark,r.import_batch_id,r.created_at,r.updated_at,r.supplier_id,r.supplier_part_no,r.supplier_part_no_key,r.psi_sku_code,r.match_status,r.model,r.spec,r.source_sheet,r.source_row);
    }
    const cols='id,sku_code,brand,product_type,quote_price,currency,quote_date,remark,import_batch_id,created_at,updated_at,supplier_id,supplier_part_no,supplier_part_no_key,psi_sku_code,match_status,model,spec,source_sheet,source_row';
    let sql='INSERT INTO quotation_prices('+cols+') VALUES '+vals.join(',');
    if(mode==='overwrite')sql+=' ON CONFLICT(supplier_id,sku_code,brand,quote_date) DO UPDATE SET product_type=excluded.product_type,quote_price=excluded.quote_price,currency=excluded.currency,remark=excluded.remark,import_batch_id=excluded.import_batch_id,updated_at=excluded.updated_at,supplier_part_no=excluded.supplier_part_no,supplier_part_no_key=excluded.supplier_part_no_key,psi_sku_code=excluded.psi_sku_code,match_status=excluded.match_status,model=excluded.model,spec=excluded.spec,source_sheet=excluded.source_sheet,source_row=excluded.source_row';
    else sql+=' ON CONFLICT(supplier_id,sku_code,brand,quote_date) DO NOTHING';
    const r=run(sql,ps);return Number((r&&(r.changes!=null?r.changes:r.rowCount))||0);
  }

  async function executePgImport(importId,rows,mode,collapsed,mappings){
    try{
      await savePgRun(importId,{status:'running',phase:'validating',percent:15,processed_count:0,message:'报价数据校验完成'});
      await savePgRun(importId,{phase:'matching',percent:35,message:'正在匹配 SKU 主数据和历史料号映射'});
      const existing=await existingPg(collapsed),c=counts(rows,collapsed,existing,mode);
      const no_quote=rows.filter(r=>r.quote_price===0).length;
      const writeRows=mode==='overwrite'?collapsed:collapsed.filter(r=>!existing.has(keyOf(r)));
      await savePgRun(importId,{...c,no_quote,phase:'writing',percent:68,processed_count:0,message:'正在批量写入报价和料号映射'});
      const written=await bulkWritePg(writeRows,mode,importId,nowIso(),mappings);
      await savePgRun(importId,{...c,no_quote,phase:'finalizing',percent:92,processed_count:rows.length,message:'报价写入完成，正在确认结果'});
      const expected=mode==='overwrite'?c.inserted+c.updated:c.inserted;
      if(written!==expected)console.warn('[quotation-import] written count differs',{importId,written,expected,mode});
      await savePgRun(importId,{...c,no_quote,status:'completed',phase:'completed',percent:100,processed_count:rows.length,total_count:rows.length,message:'导入完成'});
    }catch(e){
      console.error('[quotation-import] background job failed',importId,e&&e.message?e.message:e);
      try{await savePgRun(importId,{status:'failed',phase:'failed',percent:0,error:e&&e.message?e.message:String(e),message:'报价导入失败'});}catch(e2){console.error('[quotation-import] failed to persist failure',importId,e2&&e2.message?e2.message:e2);}
    }
  }
  app.get('/api/quotation-management/import-options',requireApiPermission('quotation_view'),asyncHandler((req,res)=>{
    try{res.json(importOptions());}catch(e){res.status(500).json({error:e.message});}
  }));
  app.get('/api/quotation-management/import/:importId/status',requireApiPermission('quotation_view'),asyncHandler(async(req,res)=>{
    const id=String(req.params.importId||'').trim();
    if(!id)return res.status(400).json({error:'import_id 不能为空'});
    if(!isPg())return res.status(404).json({error:'本地模式不保留任务状态',status:'unknown'});
    let r=await getPgRun(id);
    if(!r)return res.status(404).json({error:'导入任务不存在',import_id:id,status:'unknown'});
    r=await reconcilePgRun(r);res.json(r);
  }));
  app.post('/api/quotation-management/import',requireApiPermission('quotation_view'),asyncHandler(async(req,res)=>{
    const importId=String((req.body||{}).import_id||genId('quoteimp')).trim();
    try{
      const {rows,mode,mappings}=parseRows(req);
      const collapsed=collapseRows(rows,mode);
      const requestHash=hashRows(rows,mode,mappings);
      if(isPg()){
        let prior=await getPgRun(importId);
        if(prior){
          if(prior.request_hash&&prior.request_hash!==requestHash)return res.status(409).json({error:'同一 import_id 的导入内容不一致，已拒绝重复提交',status:prior.status,import_id:importId});
          prior=await reconcilePgRun(prior);
          return res.status(prior.status==='running'?202:200).json(prior);
        }
        const queued=await savePgRun(importId,{request_hash:requestHash,status:'running',phase:'queued',percent:8,total_count:rows.length,processed_count:0,duplicate_mode:mode,message:'报价文件已接收，准备导入'});
        res.status(202).json(queued);
        setImmediate(()=>{executePgImport(importId,rows,mode,collapsed,mappings).catch(e=>console.error('[quotation-import] unhandled job error',e&&e.message?e.message:e));});
        return;
      }
      const existing=existingSqlite(collapsed),c=counts(rows,collapsed,existing,mode);
      const no_quote=rows.filter(r=>r.quote_price===0).length;
      const writeRows=mode==='overwrite'?collapsed:collapsed.filter(r=>!existing.has(keyOf(r)));
      const now=nowIso();
      transaction(()=>{
        saveMappingsSqlite(mappings,now);
        bulkWriteSqlite(writeRows,mode,importId,now);
        applyMappingsSqlite(mappings,now);
      });
      return res.json({success:true,import_id:importId,status:'completed',phase:'completed',percent:100,total_count:rows.length,processed_count:rows.length,...c,no_quote,message:'导入完成'});
    }catch(e){
      const body={error:e.message,errors:e.errors||undefined,code:e.code,import_id:importId,status:'blocked'};
      return res.status(e.status||500).json(body);
    }
  }));
};
