'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { processJob } = require('../src/ad-group-import-worker');

const csv = `Product Ads Campaign Level Operation Log- Shopee Indonesia\nShop Name,Netac Official Store\nShop ID,1326456001\nDate Period,31/08/2026 - 29/09/2026\nCampaign ID,494015552\n\nUpdate Time,Operator,Platform,Event Type,Details\n2026-09-24 15:47:32,operator,PC,Create Campaign,"Daily Budget: Rp500000\nStart Time: 2026-09-24\nGMV Max(Custom ROAS): 8.3\nChange Number of Products in Ad Group:: 3"\n`;

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shopee-op-worker-'));
  const filePath = path.join(tmp, 'operation.csv');
  fs.writeFileSync(filePath, csv);
  const succeeded = [];
  const jobRepository = { async succeed(id, payload) { succeeded.push({ id, payload }); } };
  const adPromotionRepository = { async withTransaction(fn) { return fn({ query: async () => ({ rows:[] }) }); } };
  const saved = [];
  const operationHistoryRepository = {
    async saveImportedOperations(args) { saved.push(args); return { inserted:1, skipped:0 }; },
  };
  const shopScopeRepository = { async find() { return { shopId:1326456001 }; } };
  try {
    const preview = await processJob({
      job:{ id:'p1', operation:'PREVIEW', filePath, filename:'operation.csv', targetShopId:1326456001, request:{ previewOnly:true } },
      jobRepository, adPromotionRepository, operationHistoryRepository, shopScopeRepository, tmpDir:tmp,
    });
    assert.strictEqual(preview.importType, 'OPERATION_LOG');
    assert.strictEqual(preview.operationCount, 1);
    assert.strictEqual(preview.sellerOperationCount, 1);
    assert.strictEqual(saved.length, 0);

    const imported = await processJob({
      job:{ id:'i1', operation:'IMPORT', filePath, filename:'operation.csv', targetShopId:1326456001, request:{} },
      jobRepository, adPromotionRepository, operationHistoryRepository, shopScopeRepository, tmpDir:tmp,
    });
    assert.strictEqual(imported.persisted, true);
    assert.strictEqual(imported.inserted, 1);
    assert.strictEqual(saved.length, 1);
    assert.strictEqual(saved[0].campaignId, 494015552);
    assert.strictEqual(saved[0].operations[0].actorType, 'SELLER');
    assert.strictEqual(succeeded.length, 2);
    console.log('shopee Ad Group operation worker tests: ok');
  } finally {
    fs.rmSync(tmp, { recursive:true, force:true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
