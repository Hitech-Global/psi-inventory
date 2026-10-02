'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const { ShopeeQueryRepository }=require('../src/query-repository');
const root=path.join(__dirname,'..');
const ui=fs.readFileSync(path.join(root,'web/product-card-ui-v2.js'),'utf8');
const styles=fs.readFileSync(path.join(root,'web/styles.css'),'utf8');
const router=fs.readFileSync(path.join(root,'src/http-router.js'),'utf8');

for(const token of ['adLinkSearchInput','adLinkSearchClear','applyAdListFilters','productAdSearchText','groupAdSearchText','searchItems']) {
  assert(ui.includes(token), `missing Product Ads search token ${token}`);
}
assert(ui.includes("searchInput?.addEventListener('input'"), 'search must filter immediately on input');
assert(ui.includes("searchInput.value = ''"), 'clear button must clear the current search');
assert(styles.includes('.ad-link-search{'), 'search control must have compact toolbar styling');
assert(router.includes('listCampaignSearchItems'), 'campaign and product-ad list routes must expose item search metadata');

(async()=>{
  let captured=null;
  const repo=new ShopeeQueryRepository({pool:{async query(sql,params){
    captured={sql:String(sql),params};
    return {rows:[
      {campaign_id:'101',item_id:'9001',item_name:'Redragon M724 Wireless Mouse',item_sku:'M724-BK'},
      {campaign_id:'101',item_id:'9002',item_name:'Redragon M724 White',item_sku:'M724-WH'},
      {campaign_id:'202',item_id:'8123',item_name:'P500 ECO',item_sku:'P500'},
    ]};
  }}});
  const map=await repo.listCampaignSearchItems({shopId:1,endDate:'2026-09-29',campaignTypeNormalized:'MANUAL_PRODUCT_AD'});
  assert.deepStrictEqual(map.get(101),[
    {itemId:9001,itemName:'Redragon M724 Wireless Mouse',itemSku:'M724-BK'},
    {itemId:9002,itemName:'Redragon M724 White',itemSku:'M724-WH'},
  ]);
  assert.strictEqual(map.get(202)[0].itemId,8123);
  assert(captured.sql.includes('GROUP BY m.campaign_id'), 'search index must resolve campaign membership set-wise');
  assert(captured.sql.includes('LEFT JOIN shopee_products'), 'search index must include item name and SKU in one query');
  assert.deepStrictEqual(captured.params,[1,'2026-09-29','MANUAL_PRODUCT_AD']);
  console.log('Product Ads link search contract: ok');
})().catch(error=>{console.error(error);process.exitCode=1;});
