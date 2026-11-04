'use strict';

module.exports=function installPOPlan(deps){
  const {app,query,queryOne,run,transaction,genId,asyncHandler,requireApiPermission,updateInventoryTransitDataAsync}=deps;
  const { generatePONumber } = require('./po-number');
  const now=()=>new Date().toISOString();
  const num=v=>Number(v)||0;
  const planStatus=(po)=>{
    if(String(po.po_status||'')==='cancelled') return 'closed';
    const planned=num(po.planned_qty), transferred=num(po.transferred_qty);
    if(planned>0&&transferred>=planned) return 'completed';
    if(transferred>0) return 'partial';
    return 'open';
  };
  const refreshTransit=()=>{try{if(typeof updateInventoryTransitDataAsync==='function')updateInventoryTransitDataAsync().catch(e=>console.warn('[PO-PLAN] transit refresh failed:',e&&e.message));}catch(_e){}};
  const normalizeItems=(items)=>{
    if(!Array.isArray(items)||!items.length){const e=new Error('PO至少需要1个SKU');e.status=400;throw e;}
    const out=[],seen=new Set();
    for(const raw of items){
      const sku=String(raw&&raw.sku_code||'').trim();
      const qty=Math.trunc(Number(raw&&raw.po_qty));
      if(!sku){const e=new Error('SKU不能为空');e.status=400;throw e;}
      if(!Number.isFinite(qty)||qty<=0){const e=new Error('PO数量必须为大于0的整数（SKU: '+sku+'）');e.status=400;throw e;}
      const key=sku.toUpperCase();
      if(seen.has(key)){const e=new Error('同一PO内SKU不可重复：'+sku);e.status=400;throw e;}
      seen.add(key);out.push({id:raw.id?String(raw.id):'',sku_code:sku,po_qty:qty,remark:String(raw.remark||'')});
    }
    return out;
  };
  function skuPriceMap(items,currency){
    const skus=[...new Set(items.map(x=>x.sku_code))];
    if(!skus.length)return new Map();
    const col=currency==='USD'?'purchase_price_usd':'purchase_price_rmb';
    const rows=query(`SELECT sku_code,${col} AS price FROM skus WHERE sku_code IN (${skus.map(()=>'?').join(',')})`,skus).rows;
    const map=new Map(rows.map(r=>[String(r.sku_code),Number(r.price)||0]));
    const missing=skus.filter(s=>!map.has(s));
    if(missing.length){const e=new Error('SKU不存在：'+missing.join('、'));e.status=400;throw e;}
    return map;
  }

  function latestQuotationMap(brand,items){
    const skus=[...new Set((items||[]).map(x=>String(x.sku_code||'').trim().toUpperCase()).filter(Boolean))];
    if(!skus.length)return new Map();
    const rows=query(
      'SELECT sku_code,quote_price,currency,quote_date,created_at,id FROM quotation_prices WHERE LOWER(TRIM(brand))=LOWER(?) AND UPPER(TRIM(sku_code)) IN ('+skus.map(()=>'?').join(',')+') ORDER BY quote_date DESC,created_at DESC,id DESC',
      [String(brand||'').trim(),...skus]
    ).rows;
    const out=new Map();
    for(const row of rows){
      const key=String(row.sku_code||'').trim().toUpperCase();
      if(key&&!out.has(key))out.set(key,row);
    }
    return out;
  }
  const round4=value=>Math.round((Number(value)+Number.EPSILON)*10000)/10000;
  function resolvePOPricing(brand,items,currency,rawRate){
    const target=String(currency||'RMB').trim().toUpperCase();
    const master=skuPriceMap(items,target),latest=latestQuotationMap(brand,items),quoted=[];
    for(const it of items){
      const q=latest.get(String(it.sku_code||'').trim().toUpperCase());
      if(q&&num(q.quote_price)>0){
        const source=String(q.currency||'').trim().toUpperCase();
        if(!source){const e=new Error('SKU '+it.sku_code+' 的最新FOB报价缺少币种，请先补齐报价管理');e.status=409;throw e;}
        quoted.push({sku_code:it.sku_code,currency:source});
      }
    }
    const currencies=[...new Set(quoted.map(x=>x.currency))].sort();
    const currencyMismatch=currencies.length>1;
    const quoteCurrency=currencies.length===1?currencies[0]:'';
    const rateRequired=!!quoteCurrency&&quoteCurrency!==target;
    const parsedRate=Number(rawRate);
    const rateValid=!rateRequired||(Number.isFinite(parsedRate)&&parsedRate>0);
    const exchangeRate=rateRequired?(rateValid?parsedRate:null):1;
    const mismatchItems=currencyMismatch?quoted.map(x=>({sku_code:x.sku_code,currency:x.currency})):[];
    const rows=items.map(it=>{
      const key=String(it.sku_code||'').trim().toUpperCase(),q=latest.get(key);
      if(q&&num(q.quote_price)>0){
        const finalPrice=!currencyMismatch&&rateValid?round4(num(q.quote_price)*exchangeRate):null;
        return {
          sku_code:it.sku_code,po_qty:it.po_qty,price_source:'quotation',
          quote_unit_price:num(q.quote_price),quote_currency:String(q.currency||'').trim().toUpperCase(),
          quote_date:String(q.quote_date||'').slice(0,10),master_unit_price:null,
          unit_price:finalPrice,amount:finalPrice==null?null:round4(finalPrice*it.po_qty)
        };
      }
      const finalPrice=round4(master.get(it.sku_code)||0);
      return {
        sku_code:it.sku_code,po_qty:it.po_qty,price_source:'sku_master',
        quote_unit_price:null,quote_currency:'',quote_date:'',master_unit_price:finalPrice,
        unit_price:finalPrice,amount:round4(finalPrice*it.po_qty)
      };
    });
    const snapshotKey=JSON.stringify(rows.map(row=>[row.sku_code,row.price_source,row.quote_unit_price,row.quote_currency,row.quote_date,row.master_unit_price]));
    const canCreate=!currencyMismatch&&rateValid;
    const totalAmount=canCreate?round4(rows.reduce((sum,row)=>sum+num(row.amount),0)):null;
    return {
      currency:target,quote_currency:quoteCurrency,quote_currencies:currencies,
      exchange_rate:exchangeRate,rate_required:rateRequired,rate_valid:rateValid,
      currency_mismatch:currencyMismatch,currency_mismatch_items:mismatchItems,
      rows,total_amount:totalAmount,can_create:canCreate,snapshot_key:snapshotKey
    };
  }

  function recalcPO(id){
    const a=queryOne('SELECT COALESCE(SUM(po_qty),0) AS planned,COALESCE(SUM(transferred_pi_qty),0) AS transferred,COALESCE(SUM(po_amount),0) AS amount FROM purchase_order_items WHERE po_id=?',[id])||{};
    let status='approved';
    if(num(a.planned)>0&&num(a.transferred)>=num(a.planned))status='transferred_pi';
    else if(num(a.transferred)>0)status='partial_pi';
    run('UPDATE purchase_orders SET total_amount=?,po_status=?,approval_status=?,updated_at=? WHERE id=?',[num(a.amount),status,'approved',now(),id]);
  }

  app.get('/api/po-plans',requireApiPermission('po_view'),asyncHandler((req,res)=>{
    const status=String(req.query.status||''),keyword=String(req.query.keyword||'').trim().toLowerCase();
    // Repeated query params support multi-select facets; one value remains
    // backward compatible with existing single-value callers.
    const facetValues=raw=>[...new Set((Array.isArray(raw)?raw:[raw]).map(v=>String(v||'').trim()).filter(v=>v&&v.length<=128))].slice(0,50);
    const brands=facetValues(req.query.brand),countries=facetValues(req.query.country);
    let sql=`SELECT po.*,
      COUNT(poi.id) AS item_count,
      COALESCE(SUM(poi.po_qty),0) AS planned_qty,
      COALESCE(SUM(poi.transferred_pi_qty),0) AS transferred_qty,
      COALESCE(SUM(poi.po_qty-poi.transferred_pi_qty),0) AS remaining_qty
      FROM purchase_orders po LEFT JOIN purchase_order_items poi ON poi.po_id=po.id WHERE 1=1`;
    const ps=[];
    if(brands.length){sql+=' AND LOWER(TRIM(po.brand)) IN ('+brands.map(()=>'?').join(',')+')';ps.push(...brands.map(v=>v.toLocaleLowerCase()));}
    if(countries.length){sql+=' AND LOWER(TRIM(po.country)) IN ('+countries.map(()=>'?').join(',')+')';ps.push(...countries.map(v=>v.toLocaleLowerCase()));}
    if(keyword){sql+=' AND (LOWER(po.po_no) LIKE ? OR LOWER(po.supplier_name) LIKE ? OR LOWER(po.brand) LIKE ? OR LOWER(po.country) LIKE ?)';const q='%'+keyword+'%';ps.push(q,q,q,q);}
    sql+=' GROUP BY po.id ORDER BY po.po_date DESC,po.created_at DESC';
    let rows=query(sql,ps).rows.map(r=>({...r,item_count:num(r.item_count),planned_qty:num(r.planned_qty),transferred_qty:num(r.transferred_qty),remaining_qty:num(r.remaining_qty),plan_status:planStatus(r)}));
    if(status)rows=rows.filter(r=>r.plan_status===status);
    res.json(rows);
  }));

  app.get('/api/po-plans/available',requireApiPermission('po_view'),asyncHandler((req,res)=>{
    const brand=String(req.query.brand||'').trim(),country=String(req.query.country||'').trim();
    let sql=`SELECT po.id,po.po_no,po.supplier_id,po.supplier_name,po.brand,po.country,po.target_warehouse,po.currency,po.po_date,
      COUNT(poi.id) AS item_count,COALESCE(SUM(poi.po_qty),0) AS planned_qty,COALESCE(SUM(poi.transferred_pi_qty),0) AS transferred_qty,
      COALESCE(SUM(poi.po_qty-poi.transferred_pi_qty),0) AS remaining_qty
      FROM purchase_orders po JOIN purchase_order_items poi ON poi.po_id=po.id
      WHERE po.po_status<>'cancelled'`;
    const ps=[];
    if(brand){sql+=' AND po.brand=?';ps.push(brand);}
    if(country){sql+=' AND po.country=?';ps.push(country);}
    sql+=' GROUP BY po.id HAVING COALESCE(SUM(poi.po_qty-poi.transferred_pi_qty),0)>0 ORDER BY po.po_date DESC,po.created_at DESC';
    res.json(query(sql,ps).rows.map(r=>({...r,item_count:num(r.item_count),planned_qty:num(r.planned_qty),transferred_qty:num(r.transferred_qty),remaining_qty:num(r.remaining_qty),plan_status:num(r.transferred_qty)>0?'partial':'open'})));
  }));

  app.get('/api/po-plans/:id',requireApiPermission('po_view'),asyncHandler((req,res)=>{
    const po=queryOne('SELECT * FROM purchase_orders WHERE id=?',[req.params.id]);
    if(!po)return res.status(404).json({error:'PO不存在'});
    const items=query('SELECT * FROM purchase_order_items WHERE po_id=? ORDER BY created_at,id',[req.params.id]).rows.map(i=>({...i,planned_qty:num(i.po_qty),transferred_qty:num(i.transferred_pi_qty),remaining_qty:Math.max(0,num(i.po_qty)-num(i.transferred_pi_qty))}));
    const planned=items.reduce((s,i)=>s+i.planned_qty,0),transferred=items.reduce((s,i)=>s+i.transferred_qty,0);
    res.json({...po,items,planned_qty:planned,transferred_qty:transferred,remaining_qty:Math.max(0,planned-transferred),plan_status:planStatus({...po,planned_qty:planned,transferred_qty:transferred})});
  }));

  app.post('/api/po-plans/price-preview',requireApiPermission('po_create'),asyncHandler((req,res)=>{
    try{
      const d=req.body||{},brand=String(d.brand||'').trim(),currency=String(d.currency||'RMB').trim().toUpperCase();
      if(!brand)return res.status(400).json({error:'请选择品牌'});
      if(!['RMB','USD'].includes(currency))return res.status(400).json({error:'PO最终币种仅支持RMB或USD'});
      const items=normalizeItems(d.items);
      res.json(resolvePOPricing(brand,items,currency,d.exchange_rate));
    }catch(e){res.status(e.status||500).json({error:e.message});}
  }));

  app.post('/api/po-plans',requireApiPermission('po_create'),asyncHandler((req,res)=>{
    try{
      const d=req.body||{},items=normalizeItems(d.items),supplier=String(d.supplier_name||'').trim(),brand=String(d.brand||'').trim(),country=String(d.country||'').trim(),warehouse=String(d.target_warehouse||'').trim(),currency=String(d.currency||'RMB').toUpperCase();
      if(!supplier||!brand||!country||!warehouse)return res.status(400).json({error:'供应商、品牌、国家、仓库不能为空'});
      if(!['RMB','USD'].includes(currency))return res.status(400).json({error:'PO最终币种仅支持RMB或USD'});
      const pricing=resolvePOPricing(brand,items,currency,d.exchange_rate);
      if(pricing.currency_mismatch){
        const detail=pricing.currency_mismatch_items.map(x=>x.sku_code+'（'+x.currency+'）').join('、');
        const e=new Error('本张PO的最新FOB报价币种不一致：'+detail+'。请先统一报价币种后再创建。');e.status=409;throw e;
      }
      if(d.quote_currency!==undefined&&String(d.quote_currency||'').trim().toUpperCase()!==pricing.quote_currency){
        const e=new Error('报价币种已发生变化，请刷新最新报价预览后再创建PO');e.status=409;throw e;
      }
      if(d.price_snapshot_key!==undefined&&String(d.price_snapshot_key||'')!==pricing.snapshot_key){
        const e=new Error('报价或SKU主数据价格已更新，请刷新价格预览后再创建PO');e.status=409;throw e;
      }
      if(!pricing.can_create){
        const e=new Error('请填写有效汇率：1 '+pricing.quote_currency+' = X '+currency);e.status=400;throw e;
      }
      const poDate=String(d.po_date||now().slice(0,10)),id=genId('po'),poNo=generatePONumber(country,poDate),ts=now();
      transaction(()=>{
        run('INSERT INTO purchase_orders(id,po_no,supplier_id,supplier_name,brand,country,target_warehouse,po_date,expected_delivery,currency,total_amount,created_by,created_by_name,po_status,approval_status,from_suggestion,remark,po_quote_currency,po_exchange_rate,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          [id,poNo,d.supplier_id||'',supplier,brand,country,warehouse,poDate,d.expected_delivery||'',currency,0,d.created_by||'',d.created_by_name||'','approved','approved',d.from_suggestion||0,d.remark||'',pricing.quote_currency||'',pricing.exchange_rate||1,ts,ts]);
        let total=0;
        for(const price of pricing.rows){
          const it=items.find(x=>String(x.sku_code).toUpperCase()===String(price.sku_code).toUpperCase());
          const amount=num(price.amount);total+=amount;
          run('INSERT INTO purchase_order_items(id,po_id,po_no,sku_code,po_qty,unit_price,po_amount,quote_unit_price,quote_currency,quote_date,price_source,transferred_pi_qty,untransferred_pi_qty,forecast_turnover_months,remark,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            [genId('poi'),id,poNo,it.sku_code,it.po_qty,num(price.unit_price),amount,price.quote_unit_price,price.quote_currency||'',price.quote_date||'',price.price_source,0,it.po_qty,0,it.remark,ts]);
        }
        run('UPDATE purchase_orders SET total_amount=? WHERE id=?',[round4(total),id]);
      });
      refreshTransit();res.json({success:true,id,po_no:poNo,po_status:'approved',approval_status:'approved',currency,quote_currency:pricing.quote_currency,exchange_rate:pricing.exchange_rate,total_amount:pricing.total_amount});
    }catch(e){res.status(e.status||500).json({error:e.message});}
  }));

  app.put('/api/po-plans/:id',requireApiPermission('po_create'),asyncHandler((req,res)=>{
    try{
      const id=req.params.id,d=req.body||{},po=queryOne('SELECT * FROM purchase_orders WHERE id=?',[id]);
      if(!po)return res.status(404).json({error:'PO不存在'});
      if(po.po_status==='cancelled')return res.status(409).json({error:'已关闭PO不能编辑，请重新开启新的采购计划'});
      const items=normalizeItems(d.items),existing=query('SELECT * FROM purchase_order_items WHERE po_id=?',[id]).rows,byId=new Map(existing.map(x=>[String(x.id),x]));
      const prices=skuPriceMap(items,po.currency),seen=new Set(),ts=now();
      for(const it of items){
        const ex=it.id?byId.get(it.id):null;
        if(ex){
          seen.add(String(ex.id));
          const transferred=num(ex.transferred_pi_qty);
          if(String(ex.sku_code)!==it.sku_code&&transferred>0){const e=new Error('SKU '+ex.sku_code+' 已转PI，不能更换SKU');e.status=409;throw e;}
          if(it.po_qty<transferred){const e=new Error(`SKU ${ex.sku_code} 计划数量不能低于已转PI数量 ${transferred}`);e.status=409;throw e;}
        }
      }
      for(const ex of existing){if(!seen.has(String(ex.id))&&num(ex.transferred_pi_qty)>0){const e=new Error(`SKU ${ex.sku_code} 已转PI ${num(ex.transferred_pi_qty)} 件，不能删除；可将计划数量调整为已转PI数量`);e.status=409;throw e;}}
      transaction(()=>{
        const fields=[],vals=[];
        for(const f of ['brand','country','target_warehouse','expected_delivery','remark'])if(d[f]!==undefined){fields.push(f+'=?');vals.push(d[f]);}
        if(fields.length){fields.push('updated_at=?');vals.push(ts,id);run('UPDATE purchase_orders SET '+fields.join(',')+' WHERE id=?',vals);}
        const remove=existing.filter(x=>!seen.has(String(x.id))&&num(x.transferred_pi_qty)===0).map(x=>x.id);
        if(remove.length)run('DELETE FROM purchase_order_items WHERE id IN ('+remove.map(()=>'?').join(',')+')',remove);
        for(const it of items){
          const ex=it.id?byId.get(it.id):null;
          if(ex){const price=String(ex.sku_code)===it.sku_code?num(ex.unit_price):(prices.get(it.sku_code)||0),transferred=num(ex.transferred_pi_qty),amount=it.po_qty*price;run('UPDATE purchase_order_items SET sku_code=?,po_qty=?,unit_price=?,po_amount=?,untransferred_pi_qty=?,remark=? WHERE id=?',[it.sku_code,it.po_qty,price,amount,it.po_qty-transferred,it.remark,it.id]);}
          else{const price=prices.get(it.sku_code)||0,amount=it.po_qty*price;run(`INSERT INTO purchase_order_items(id,po_id,po_no,sku_code,po_qty,unit_price,po_amount,transferred_pi_qty,untransferred_pi_qty,forecast_turnover_months,remark,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,[genId('poi'),id,po.po_no,it.sku_code,it.po_qty,price,amount,0,it.po_qty,0,it.remark,ts]);}
        }
        recalcPO(id);
      });
      refreshTransit();res.json({success:true,...queryOne('SELECT * FROM purchase_orders WHERE id=?',[id])});
    }catch(e){res.status(e.status||500).json({error:e.message});}
  }));

  app.post('/api/po-plans/:id/close',requireApiPermission('po_create'),asyncHandler((req,res)=>{
    const po=queryOne('SELECT id FROM purchase_orders WHERE id=?',[req.params.id]);if(!po)return res.status(404).json({error:'PO不存在'});
    run('UPDATE purchase_orders SET po_status=?,approval_status=?,updated_at=? WHERE id=?',['cancelled','approved',now(),req.params.id]);refreshTransit();res.json({success:true});
  }));

  app.delete('/api/po-plans/:id',requireApiPermission('po_create'),asyncHandler((req,res)=>{
    const po=queryOne('SELECT id,po_no FROM purchase_orders WHERE id=?',[req.params.id]);if(!po)return res.status(404).json({error:'PO不存在'});
    const used=queryOne('SELECT COALESCE(SUM(transferred_pi_qty),0) AS n FROM purchase_order_items WHERE po_id=?',[req.params.id]);
    const pis=queryOne('SELECT COUNT(*) AS n FROM proforma_invoices WHERE related_po_id=?',[req.params.id]);
    if(num(used&&used.n)>0||num(pis&&pis.n)>0)return res.status(409).json({error:'该PO已有PI使用记录，不能删除；请关闭PO以保留历史链路'});
    transaction(()=>{run('DELETE FROM purchase_order_items WHERE po_id=?',[req.params.id]);run('DELETE FROM purchase_orders WHERE id=?',[req.params.id]);});refreshTransit();res.json({success:true});
  }));
};
