'use strict';
const fs = require('fs');

const path = 'app.js';
let src = fs.readFileSync(path, 'utf8');
const oldBlock = "  var data=await rpFetchCached(rpBaseUrl());\n  if(!data) data=[];";
const newBlock = "  // RP-SNAPSHOT: report/export must read the same L0 snapshot rows as the visible page.\n  // Using the legacy rpFetchCached(rpBaseUrl()) creates a second row array that loadRp() no longer enriches,\n  // causing false _totalC/_channelC 'not ready' errors even while the monthly table is already rendered.\n  var _snapOk=await rpEnsureSnapshotReady();\n  if(!_snapOk) throw new Error(t('forecast.data_unavailable','订单预测数据未就绪，请重新加载后重试'));\n  var data=rpLocalSnapshotRows();\n  if(!data) data=[];";
const matches = src.split(oldBlock).length - 1;
if (matches < 1) {
  throw new Error('legacy report/export data-source block not found');
}
src = src.split(oldBlock).join(newBlock);
fs.writeFileSync(path, src);
console.log(`rp review/export snapshot source fix applied to ${matches} block(s)`);
