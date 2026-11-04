'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const uiSource = fs.readFileSync(path.join(__dirname, '..', 'web', 'tiktok-ui-v1.js'), 'utf8');
const registry = new Map();
function mk(t = 'div') {
  return {
    tagName: t.toUpperCase(), innerHTML: '', className: '', textContent: '',
    classList: { _s: new Set(), add(n) { this._s.add(n); }, remove(n) { this._s.delete(n); }, toggle(n, f) { f ? this._s.add(n) : this._s.delete(n); }, contains(n) { return this._s.has(n); } },
    addEventListener() {}, appendChild() {}, removeChild() {}, click() {},
  };
}
function byId(id) { if (!registry.has(id)) registry.set(id, mk()); return registry.get(id); }
global.Blob = class { constructor(p) { this.content = p.join(''); } };
global.URL = { createObjectURL() { return 'blob:x'; }, revokeObjectURL() {} };
global.document = { body: mk(), createElement: (t) => mk(t), querySelector(s) { return s.startsWith('#') ? byId(s.slice(1)) : null; } };
global.window = {};
new Function('window', 'document', 'Blob', 'URL', uiSource)(global.window, global.document, global.Blob, global.URL);
const UI = global.window.TikTokUI;

// 1) 广告诊断
UI.renderAdsDiagnosis({
  metrics: { platformRoas: 4, spendToAttributedGmv: 0.25, settledNetRoas: 3.65, attributedSpend: 200 },
  signals: [
    { code: 'A', severity: 'good', kind: 'data-fact', title: '平台归因 ROI（同源）', detail: '归因 GMV 800 ÷ 200 = 4.00。' },
    { code: 'B', severity: 'good', kind: 'ai-suggestion', title: '结算净 ROAS', detail: '结算净收益 730 ÷ 200 = 3.65。' },
  ],
  caliberNotes: [
    { key: 'platform-roas', title: '平台归因 ROI', formula: '归因 GMV ÷ 平台归因花费', source: '同一张 GMV Max 报表', note: '口径最干净。' },
    { key: 'spend-ratio', title: '花费占归因 GMV 比例', formula: '纯付费花费 ÷ 平台归因 GMV', source: '跨两张报表', note: '衡量投放强度。' },
  ],
});
const calibers = byId('tiktokAdsCalibers').innerHTML;
const adsSignals = byId('tiktokAdsDiagnosisSignals').innerHTML;
const adsSummary = byId('tiktokAdsDiagnosisSummary').innerHTML;
console.log('=== 广告诊断 ===');
assert.ok(calibers.includes('归因 GMV ÷ 平台归因花费'), `  口径说明含算式:`);
assert.ok(calibers.includes('跨两张报表'), `  口径说明含来源:`);
assert.ok(adsSignals.includes('数据事实') && adsSignals.includes('AI 推测建议'), `  两类结论标签:`);
assert.strictEqual((adsSummary.match(/kpi-card/g) || []).length, 4, '广告诊断概览应有 4 张卡片');

// 2) 健康
UI.renderHealth({
  overview: { spsScore: '72.5', spsTierText: '良好', peerPercentile: '62%', topIssues: [{ metricName: '迟发率' }] },
  metrics: [
    { metricName: '取消率', displayValue: '3.2%', level: 'good', statusLabel: '良好', score: '80', excellentThreshold: '2', poorThreshold: '5', topReason: '' },
    { metricName: '客服响应', displayValue: '—', level: 'unknown', statusLabel: '未知', score: null, excellentThreshold: null, poorThreshold: null, topReason: '' },
  ],
  status: { breachCount: 0, total: 2 },
  signals: [],
});
const healthBody = byId('tiktokHealthBody').innerHTML;
console.log('\n=== 店铺健康 ===');
assert.ok(healthBody.includes('—'), `  未知指标显示破折号:`);
assert.ok(healthBody.includes('未知'), `  未知状态标签:`);
assert.ok(byId('tiktokHealthHead').innerHTML.includes('优秀线'), `  达标线表头:`);
assert.ok(healthBody.includes('2'), `  达标线数值:`);

// 3) 达人
UI.renderCreators({
  rows: [{ creatorUserId: 'CR-1', nickname: '达人甲', followerCount: 125000, unitsSold: 430, gmv: 12345.67, currency: 'USD', gpm: 123.45, videoGmv: 8000, liveGmv: 4345.67, brandCollaborationCount: 8, categoryGmvDistribution: [{ category_id: 'C1' }] }],
  summary: { creatorCount: 1, gmv: 12345.67, unitsSold: 430, followerCount: 125000 },
});
const creatorBody = byId('tiktokCreatorsBody').innerHTML;
console.log('\n=== 达人概览 ===');
assert.ok(creatorBody.includes('达人甲'), `  达人名渲染:`);
assert.ok(creatorBody.includes('123.45'), `  GPM 渲染:`);
assert.ok(creatorBody.includes('125,000'), `  粉丝数渲染:`);

process.stdout.write('tiktok tabs render smoke test passed\n');
