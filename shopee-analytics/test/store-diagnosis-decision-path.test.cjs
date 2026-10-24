'use strict';

const fs=require('fs');
const path=require('path');
const assert=require('assert');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'web','index.html'),'utf8');
const app=fs.readFileSync(path.join(root,'web','app.js'),'utf8');
const router=fs.readFileSync(path.join(root,'src','http-router.js'),'utf8');
const query=fs.readFileSync(path.join(root,'src','query-repository.js'),'utf8');
const diagnosis=fs.readFileSync(path.join(root,'src','portfolio-diagnosis.js'),'utf8');
for(const id of ['storeBiStatus','storeGrowthVerdict','storeGrowthDrivers','storeAdMixStatus','storeAdMix','storeAdMixNote','storeSkuContribution']) assert(html.includes('id=\"'+id+'\"'),'missing '+id);
for(const label of ['经营结果','增长来源','广告 vs 非广告','SKU 贡献与异常','系统结论与下一步']) assert(html.includes(label),'missing stage '+label);
assert(app.includes("moneyOrDash(metrics.sales"),'missing BI null-safe rendering');
assert(app.includes("if (!availability.shopBi)"),'missing BI availability branch');
assert(app.includes("不计算广告占比和非广告销售"),'missing attribution safety copy');
assert(router.includes('dataAvailability:'),'detail route must expose availability');
assert(router.includes('skuContribution: skuContributionSummary'),'detail route must expose SKU contribution');
assert(query.includes('COUNT(*)::int AS bi_days'),'portfolio query must expose BI coverage');
assert(query.includes('shopBiAvailable: shopBiDays > 0'),'portfolio rows must expose BI availability');
assert(diagnosis.includes("'SHOP_BI_MISSING'"),'diagnosis must flag missing BI instead of stable/zero');

const { storeDetailMetrics, addSkuPeriodComparison, skuContributionSummary } = require('../src/http-router');
const normalizedMissing = storeDetailMetrics({
  shopBiAvailable:false, shopBiDays:0, adDataAvailable:true, adDays:7,
  sales:0, orders:0, productClicks:0, productViews:0, unitsSold:0,
  adExpense:16977597, broadGmv:129081256, estimatedNaturalSales:-129081256,
  adAttributionExceedsBiSales:true, adSpendRatioLimit:0.15,
});
assert.strictEqual(normalizedMissing.sales,null);
assert.strictEqual(normalizedMissing.orders,null);
assert.strictEqual(normalizedMissing.productClicks,null);
assert.strictEqual(normalizedMissing.estimatedNaturalSales,null);
assert.strictEqual(normalizedMissing.adAttributionExceedsBiSales,null);
assert.strictEqual(normalizedMissing.adExpense,16977597);
assert.strictEqual(normalizedMissing.broadGmv,129081256);
const compared=addSkuPeriodComparison([{itemId:1,totalSales:120},{itemId:2,totalSales:50}],[{itemId:1,totalSales:100},{itemId:2,totalSales:80}]);
assert.strictEqual(compared[0].salesDelta,20);
assert.strictEqual(compared[1].salesDelta,-30);
const contribution=skuContributionSummary(compared);
assert.strictEqual(contribution.growth[0].itemId,1);
assert.strictEqual(contribution.drag[0].itemId,2);

console.log('store diagnosis decision-path contract: ok');
