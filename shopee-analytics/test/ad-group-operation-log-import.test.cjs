'use strict';

const assert = require('assert');
const {
  parseShopeeAdGroupFile,
  parseCsv,
  parseShopeeAdOperationReport,
  operationActor,
} = require('../src/shopee-ad-group-import');

const english = `Product Ads Campaign Level Operation Log- Shopee Indonesia\nShop Name,Netac Official Store\nShop ID,1326456001\nReport Creation Time,29/09/2026 11:23\nDate Period,31/08/2026 - 29/09/2026\nCampaign ID,494015552\n\nUpdate Time,Operator,Platform,Event Type,Details\n2026-09-24 15:47:32,netacofficialstore,PC,Create Campaign,"Ads Status: Ongoing\nTotal Budget: Unlimited\nDaily Budget: Rp500000\nStart Time: 2026-09-24\nGMV Max(Custom ROAS): 8.3\nChange Number of Products in Ad Group:: 3"\n`;
const en = parseShopeeAdGroupFile({ buffer: Buffer.from(english), filename: 'operation.csv' });
assert.strictEqual(en.preview.importType, 'OPERATION_LOG');
assert.strictEqual(en.preview.sourceShopId, 1326456001);
assert.strictEqual(en.preview.campaignId, 494015552);
assert.strictEqual(en.preview.operationCount, 1);
assert.strictEqual(en.preview.sellerOperationCount, 1);
assert.strictEqual(en.report.operations[0].actorType, 'SELLER');
assert.strictEqual(en.report.operations[0].operationType, 'CAMPAIGN_CREATED');
assert.strictEqual(en.report.operations[0].after.campaignBudget, 500000);
assert.strictEqual(en.report.operations[0].after.targetRoas, 8.3);
assert.strictEqual(en.report.operations[0].after.itemCount, 3);

const chinese = `\uFEFF商品广告活动级别操作记录- Shopee 马来西亚\n商店名称,Redragon Malaysia OS\n商店ID,1770037299\n报告创建时间,2026/09/29 11:23\n时间,2026/08/31 - 2026/09/29\n广告系列编号,174447481\n\n更新时间,操作员,平台,活动类型,详情\n2026-09-25 23:59:59,系统: 大促效果优化,其他,Campaign Surge Optimization Finished,\n2026-09-25 00:00:00,系统: 大促效果优化,其他,大促效果优化已启动,\n2026-09-22 10:00:00,redragonos3pf.my,电脑,Create Campaign,"广告状态: 正在进行\n总预算: 无限制\n每日预算: RM60.00\n结束时间: 无限制\n开始时间: 2026-09-22\n全站推广（目标ROAS）: 8.0\n极速起量: 关闭\n更改广告组中的商品数量：: 7\n版位: 全部\n商品创意: 打开"\n`;
const cn = parseShopeeAdGroupFile({ buffer: Buffer.from(chinese), filename: '操作记录.csv' });
assert.strictEqual(cn.preview.importType, 'OPERATION_LOG');
assert.strictEqual(cn.preview.sourceShopId, 1770037299);
assert.strictEqual(cn.preview.campaignId, 174447481);
assert.strictEqual(cn.preview.operationCount, 3);
assert.strictEqual(cn.preview.sellerOperationCount, 1);
assert.strictEqual(cn.preview.systemOperationCount, 2);
assert.strictEqual(cn.preview.unknownOperationCount, 0);
const surgeStart = cn.report.operations.find(row => row.operationType === 'CAMPAIGN_SURGE_OPTIMIZATION_STARTED');
const surgeFinish = cn.report.operations.find(row => row.operationType === 'CAMPAIGN_SURGE_OPTIMIZATION_FINISHED');
const cnCreate = cn.report.operations.find(row => row.operationType === 'CAMPAIGN_CREATED');
assert(surgeStart && surgeFinish && cnCreate);
assert.strictEqual(surgeStart.actorType, 'SHOPEE_SYSTEM');
assert.strictEqual(surgeFinish.actorType, 'SHOPEE_SYSTEM');
assert.strictEqual(cnCreate.actorType, 'SELLER');
assert.strictEqual(cnCreate.after.campaignBudget, 60);
assert.strictEqual(cnCreate.after.targetRoas, 8);
assert.strictEqual(cnCreate.after.itemCount, 7);
assert.strictEqual(operationActor({ Platform:'System', Operator:'', 'Event Type':'' }), 'SHOPEE_SYSTEM');
assert.strictEqual(operationActor({ Platform:'PC', Operator:'', 'Event Type':'' }), 'SELLER');
assert.strictEqual(operationActor({ Platform:'电脑', Operator:'', 'Event Type':'' }), 'SELLER');

const parsedDirect = parseShopeeAdOperationReport(parseCsv(chinese));
assert.strictEqual(parsedDirect.operations.length, 3);
console.log('shopee Ad Group operation log import tests: ok');
