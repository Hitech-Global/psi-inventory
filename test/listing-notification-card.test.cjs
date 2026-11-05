'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {cardToFallbackText}=require('../wac-notification');

const root=path.join(__dirname,'..');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const start=server.indexOf('const LISTING_BLOCK_FIELDS = {');
const end=server.indexOf('// 从物流单主表 + 关联 CI 装载',start);
assert.ok(start>=0&&end>start,'Listing notification card builder source must exist');
const builderSource=server.slice(start,end);

function buildCard(batchNo,ctx,lang='zh',mode='manual',statusChange=null,appBaseUrl=''){
  const sandbox={
    process:{env:{APP_BASE_URL:appBaseUrl}},
    countryLabel:(language,country)=>language==='en'&&country==='印度尼西亚'?'Indonesia':country,
    listingStatusLabel:(language,status)=>({
      zh:{pending_plan:'待安排',preparing:'准备中',ready:'已就绪',listed:'已上架'},
      en:{pending_plan:'Pending Plan',preparing:'Preparing',ready:'Ready',listed:'Listed'}
    }[language]||{})[status]||status,
    logisticsDisplayStatusLabel:(language,status)=>({
      zh:{in_transit:'待出运',customs_clearance:'清关中'},
      en:{in_transit:'In Transit',customs_clearance:'Customs Clearance'}
    }[language]||{})[status]||status
  };
  vm.createContext(sandbox);
  vm.runInContext(builderSource+'\nthis.__buildListingNotifyCard=buildListingNotifyCard;',sandbox);
  return JSON.parse(JSON.stringify(sandbox.__buildListingNotifyCard(batchNo,ctx,lang,mode,statusChange)));
}
function cell(row,index){
  const column=row.columns[index];
  return column.elements.map(element=>element.content||'').join(' ').replace(/^\*\*|\*\*$/g,'');
}
function rows(card){
  return card.body.elements.filter(element=>element.tag==='column_set');
}
const sample={
  id:'logistics-id-1',brand:'Redragon',country:'印度尼西亚',warehouse:'Bekasi Warehouse',
  batch_total_quantity:4160,related_ci_total_quantity:5880,total_cartons:77,
  total_weight:709.19,total_cbm:4.06,related_ci:'HIT20260912-1',
  listing_status:'preparing',current_owners:'张哲源Mei、Leo'
};

test('Listing notification card uses a compact two-column row layout for all 12 business fields',()=>{
  const card=buildCard('SZIS0015360',sample);
  assert.equal(card.schema,'2.0');
  assert.equal(card.config.update_multi,true);
  assert.ok(!Object.prototype.hasOwnProperty.call(card,'elements'),'Card 2.0 content must live under body.elements');
  const fieldRows=rows(card);
  assert.equal(fieldRows.length,12);
  assert.deepEqual(fieldRows.map(row=>cell(row,0)),[
    '物流批次','品牌','批次总数量','关联CI','关联CI总数量','国家','仓库',
    '总箱数','总重量','总体积','当前负责人','当前状态'
  ]);
  assert.deepEqual(fieldRows.map(row=>cell(row,1)),[
    'SZIS0015360','Redragon','4160 PCS','HIT20260912-1','5880 PCS','印度尼西亚',
    'Bekasi Warehouse','77 箱','709.19 KG','4.06 CBM','张哲源Mei、Leo','准备中'
  ]);
  assert.ok(fieldRows.every(row=>row.flex_mode==='none'&&row.columns.length===2));
  assert.ok(fieldRows.every(row=>row.columns[0].weight===1&&row.columns[1].weight===3));
});

test('Status change is displayed as a separate section with previous and new status rows',()=>{
  const card=buildCard('SZIS0015360',sample,'zh','manual',{
    statusType:'logistics',oldStatus:'in_transit',newStatus:'customs_clearance'
  });
  const elements=card.body.elements;
  const titleIndex=elements.findIndex(element=>element.tag==='markdown'&&element.content==='**状态更新**');
  assert.ok(titleIndex>=0);
  assert.equal(elements[titleIndex+1].tag,'column_set');
  assert.equal(cell(elements[titleIndex+1],0),'原状态');
  assert.equal(cell(elements[titleIndex+1],1),'待出运');
  assert.equal(cell(elements[titleIndex+2],0),'新状态');
  assert.equal(cell(elements[titleIndex+2],1),'清关中');
  assert.equal(rows(card).length,14);
});

test('English Listing cards preserve English labels and localized country/status values',()=>{
  const card=buildCard('SZIS0015360',sample,'en','manual');
  const fieldRows=rows(card);
  assert.equal(cell(fieldRows[0],0),'Logistics Batch');
  assert.equal(cell(fieldRows[1],0),'Brand');
  assert.equal(cell(fieldRows[5],1),'Indonesia');
  assert.equal(cell(fieldRows[11],1),'Preparing');
  assert.match(card.header.title.content,/Listing Preparation Reminder/);
});

test('Listing card detail button uses Card 2.0 open_url behavior and the existing app base URL',()=>{
  const card=buildCard('SZIS0015360',sample,'zh','manual',null,'https://psi-inventory.onrender.com/');
  const button=card.body.elements.find(element=>element.tag==='button');
  assert.ok(button);
  assert.equal(button.behaviors[0].type,'open_url');
  assert.equal(button.behaviors[0].default_url,'https://psi-inventory.onrender.com/?page=logistics&batch=logistics-id-1');
});

test('Card fallback renders every Listing row as a readable label-value pair including status changes',()=>{
  const card=buildCard('SZIS0015360',sample,'zh','manual',{
    statusType:'logistics',oldStatus:'in_transit',newStatus:'customs_clearance'
  });
  const fallback=cardToFallbackText(card);
  assert.ok(fallback.includes('物流批次 | SZIS0015360'));
  assert.ok(fallback.includes('品牌 | Redragon'));
  assert.ok(fallback.includes('批次总数量 | 4160 PCS'));
  assert.ok(fallback.includes('当前负责人 | 张哲源Mei、Leo'));
  assert.ok(fallback.includes('状态更新'));
  assert.ok(fallback.includes('原状态 | 待出运'));
  assert.ok(fallback.includes('新状态 | 清关中'));
  assert.ok(fallback.includes('请关注该物流单进度'));
  assert.ok(!fallback.includes('<font'));
  assert.ok(!fallback.includes('**'));
});
