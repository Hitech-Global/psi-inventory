'use strict';
function parseCategories(value){if(Array.isArray(value))return value.map(x=>String(x||'').trim()).filter(Boolean);try{const p=JSON.parse(value||'[]');return Array.isArray(p)?p.map(x=>String(x||'').trim()).filter(Boolean):[];}catch(_e){return[];}}
function createPriceSystemQuotationSync(deps){
 const {query,run,genId}=deps;
 function createSnapshotVersion(schemeId,actor,note){
  const schemeRows=query('SELECT * FROM price_system_schemes WHERE id = ?',[schemeId]).rows;
  const scheme=schemeRows[0];if(!scheme)return null;
  const fields=query('SELECT * FROM price_system_fields WHERE scheme_id = ? ORDER BY sort_order, field_name',[schemeId]).rows;
  const values=query('SELECT sku_code, field_key, value, currency FROM price_system_values WHERE scheme_id = ? ORDER BY sku_code, field_key',[schemeId]).rows;
  const landingCosts=query('SELECT * FROM price_system_landing_costs WHERE scheme_id = ? ORDER BY sku_code',[schemeId]).rows;
  const srpValues=query('SELECT * FROM price_system_srp_values WHERE scheme_id = ? ORDER BY sku_code',[schemeId]).rows;
  const previousRows=query('SELECT MAX(version_no) AS max_version FROM price_system_versions WHERE scheme_id = ?',[schemeId]).rows;
  const versionNo=Number(previousRows[0]&&previousRows[0].max_version||0)+1;
  run('INSERT INTO price_system_versions (id, scheme_id, version_no, snapshot_json, note, created_by, created_by_name) VALUES (?, ?, ?, ?, ?, ?, ?)',[genId('psv'),schemeId,versionNo,JSON.stringify({scheme,fields,values,landingCosts,srpValues}),String(note||''),String(actor&&actor.id||''),String(actor&&actor.name||'')]);
  return versionNo;
 }
 return function syncPriceSystemQuotationForKeys(keys,actor,reason){
  const byBrand=new Map();
  (Array.isArray(keys)?keys:[]).forEach(raw=>{const sku=String(raw&&raw.sku_code||'').trim(),brand=String(raw&&raw.brand||'').trim();if(!sku||!brand)return;const k=brand.toLowerCase();if(!byBrand.has(k))byBrand.set(k,{brand,skuCodes:new Set()});byBrand.get(k).skuCodes.add(sku);});
  const summary={schemes_updated:0,sku_updated:0,sku_cleared:0,versions:[]};
  for(const {brand,skuCodes} of byBrand.values()){
   const schemes=query("SELECT ps.* FROM price_system_schemes ps WHERE ps.status='active' AND LOWER(TRIM(ps.brand))=LOWER(TRIM(?)) AND EXISTS (SELECT 1 FROM price_system_fields pf WHERE pf.scheme_id=ps.id AND pf.is_active=1 AND COALESCE(pf.sync_quotation,0)=1) ORDER BY ps.country,ps.platform,ps.shop_name",[brand]).rows;
   if(!schemes.length)continue;
   const requested=Array.from(skuCodes),skuRows=[];
   for(let i=0;i<requested.length;i+=300){const part=requested.slice(i,i+300);skuRows.push(...query("SELECT sku_code, brand, category FROM skus WHERE LOWER(TRIM(brand))=LOWER(TRIM(?)) AND UPPER(TRIM(sku_code)) IN ("+part.map(()=>'?').join(',')+") AND LOWER(TRIM(COALESCE(status,'normal'))) NOT IN ('stopped','discontinued','inactive','停产','已停产','eol','end_of_life') AND LOWER(TRIM(COALESCE(lifecycle_status,''))) NOT IN ('stopped','discontinued','停产','已停产','eol','end_of_life')",[brand].concat(part)).rows);}
   if(!skuRows.length)continue;
   const skuByKey=new Map(skuRows.map(r=>[String(r.sku_code||'').trim().toUpperCase(),r]));
   const codes=Array.from(skuByKey.values()).map(r=>String(r.sku_code||'').trim()),latest=new Map();
   for(let i=0;i<codes.length;i+=300){const part=codes.slice(i,i+300);const rows=query("SELECT q.id,COALESCE(NULLIF(TRIM(q.psi_sku_code),''),q.sku_code) AS matched_sku_code,q.quote_price,q.currency,q.quote_date,q.created_at FROM quotation_prices q INNER JOIN skus sm ON UPPER(TRIM(sm.sku_code))=UPPER(TRIM(COALESCE(NULLIF(TRIM(q.psi_sku_code),''),q.sku_code))) AND LOWER(TRIM(sm.brand))=LOWER(TRIM(q.brand)) WHERE LOWER(TRIM(q.brand))=LOWER(TRIM(?)) AND UPPER(TRIM(COALESCE(NULLIF(TRIM(q.psi_sku_code),''),q.sku_code))) IN ("+part.map(()=>'?').join(',')+") AND COALESCE(q.match_status,'matched')<>'unlinked' AND LOWER(TRIM(COALESCE(sm.status,'normal'))) NOT IN ('stopped','discontinued','inactive','停产','已停产','eol','end_of_life') AND LOWER(TRIM(COALESCE(sm.lifecycle_status,''))) NOT IN ('stopped','discontinued','停产','已停产','eol','end_of_life') ORDER BY q.quote_date DESC,q.created_at DESC,q.id DESC",[brand].concat(part)).rows;rows.forEach(r=>{const k=String(r.matched_sku_code||'').trim().toUpperCase();if(k&&!latest.has(k))latest.set(k,r);});}
   for(const scheme of schemes){
    const fields=query('SELECT * FROM price_system_fields WHERE scheme_id=? AND is_active=1 AND COALESCE(sync_quotation,0)=1 ORDER BY sort_order,field_name',[scheme.id]).rows;if(!fields.length)continue;
    const existing=new Map();
    for(let i=0;i<codes.length;i+=300){const part=codes.slice(i,i+300);query('SELECT sku_code,field_key,value,currency FROM price_system_values WHERE scheme_id=? AND sku_code IN ('+part.map(()=>'?').join(',')+')',[scheme.id].concat(part)).rows.forEach(r=>existing.set(String(r.sku_code||'').trim().toUpperCase()+'|'+r.field_key,r));}
    let updated=0,cleared=0;
    fields.forEach(field=>{const categories=parseCategories(field.applicable_categories);skuByKey.forEach((sku,key)=>{const category=String(sku.category||'').trim()||'未分类';if(categories.length&&!categories.includes(category))return;const quote=latest.get(key)||null;const value=quote&&Number(quote.quote_price)>0?Number(quote.quote_price):null;const currency=value==null?'':String(quote.currency||'').trim().toUpperCase();const old=existing.get(key+'|'+field.field_key)||null;const oldValue=old&&old.value!=null&&old.value!==''?Number(old.value):null;const oldCurrency=String(old&&old.currency||'').trim().toUpperCase();if(oldValue===value&&oldCurrency===currency)return;if(value==null&&!old)return;run("INSERT INTO price_system_values (id,scheme_id,sku_code,field_key,value,currency,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(scheme_id,sku_code,field_key) DO UPDATE SET value=excluded.value,currency=excluded.currency,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP",[genId('psv'),scheme.id,sku.sku_code,field.field_key,value,currency,actor&&actor.id||'system']);if(value==null)cleared++;else updated++;});});
    if(updated||cleared){const note=String(reason||'Quotation auto sync')+': updated '+updated+' SKU(s), cleared '+cleared+' SKU(s) without a current quote';const versionNo=createSnapshotVersion(scheme.id,actor||{id:'system',name:'System'},note);summary.schemes_updated++;summary.sku_updated+=updated;summary.sku_cleared+=cleared;summary.versions.push({scheme_id:scheme.id,version_no:versionNo,updated,cleared});}
   }
  }
  return summary;
 };
}
module.exports={createPriceSystemQuotationSync};
