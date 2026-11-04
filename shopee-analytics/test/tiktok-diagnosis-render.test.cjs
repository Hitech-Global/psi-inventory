'use strict';

/**
 * TikTok 诊断结论的前端渲染冒烟。
 *
 * 为什么单独测渲染：诊断结论最要紧的性质是「读者能分出哪句是数、哪句是判断」。
 * 这个性质只存在于最终产出的 HTML 里 —— 后端返回对了，但如果前端把两类结论
 * 渲染成同一个样子，读者照样会被误导。所以必须验到 HTML 这一层。
 *
 * 这里加载**真实的** tiktok-ui-v1.js，用一个极小的 DOM 替身渲染，
 * 再检查产出的标记与样式类。
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const uiSource = fs.readFileSync(path.join(__dirname, '..', 'web', 'tiktok-ui-v1.js'), 'utf8');

const registry = new Map();

function makeElement(tag = 'div') {
  return {
    tagName: tag.toUpperCase(),
    innerHTML: '',
    className: '',
    textContent: '',
    classList: {
      _set: new Set(),
      add(name) { this._set.add(name); },
      remove(name) { this._set.delete(name); },
      toggle(name, force) {
        if (force === undefined) {
          if (this._set.has(name)) this._set.delete(name); else this._set.add(name);
        } else if (force) this._set.add(name);
        else this._set.delete(name);
      },
      contains(name) { return this._set.has(name); },
    },
    addEventListener() {},
    appendChild() {},
    removeChild() {},
    click() {},
  };
}

function byId(id) {
  if (!registry.has(id)) registry.set(id, makeElement());
  return registry.get(id);
}

global.Blob = class { constructor(parts) { this.content = parts.join(''); } };
global.URL = { createObjectURL() { return 'blob:stub'; }, revokeObjectURL() {} };
global.document = {
  body: makeElement('body'),
  createElement(tag) { return makeElement(tag); },
  querySelector(selector) { return selector.startsWith('#') ? byId(selector.slice(1)) : null; },
};
global.window = {};

// eslint-disable-next-line no-new-func
new Function('window', 'document', 'Blob', 'URL', uiSource)(
  global.window, global.document, global.Blob, global.URL,
);

const { renderDiagnosis } = global.window.TikTokUI;
assert.ok(renderDiagnosis, 'tiktok-ui-v1.js 必须导出 renderDiagnosis');

// ---------------------------------------------------------------------------
// 渲染
// ---------------------------------------------------------------------------

renderDiagnosis({
  signals: [
    {
      code: 'TIKTOK_ORDER_FACTS',
      severity: 'info',
      kind: 'data-fact',
      title: '订单实付口径',
      detail: '订单 10 笔，销量 25 件，订单实付 1,200。',
      action: null,
    },
    {
      code: 'TIKTOK_SETTLED_NET_ROAS',
      severity: 'warning',
      kind: 'ai-suggestion',
      title: '结算净 ROAS',
      detail: '每投入 1 元广告费，结算后净收益 1.82 元。',
      action: '收窄定向，把预算集中到已验证的商品上。',
    },
  ],
  unavailable: [
    {
      key: 'traffic-split',
      title: '流量结构（广告带来 vs 自然带来）',
      available: false,
      reason: 'TikTok Open API 的订单对象没有流量来源字段。',
      impact: '依赖 direct/broad 拆分的规则在 TikTok 侧不适用。',
    },
  ],
});

const signals = byId('tiktokSignals').innerHTML;
const unavailable = byId('tiktokUnavailable').innerHTML;

// ---------------------------------------------------------------------------
// 断言
// ---------------------------------------------------------------------------

// ★ 两类结论必须有不同的文字标签
assert.match(signals, /数据事实/, '必须标出「数据事实」');
assert.match(signals, /AI 推测建议/, '必须标出「AI 推测建议」');

// ★ 两类结论必须有不同的样式类 —— 读者靠颜色和边框就能分开
assert.match(signals, /class="tiktok-signal fact/, '数据事实应带 fact 样式类');
assert.match(signals, /class="tiktok-signal suggestion/, 'AI 推测应带 suggestion 样式类');

// 严重度要体现出来
assert.match(signals, /tiktok-signal suggestion warning/, '严重度应体现在样式类里');
assert.match(signals, /tiktok-signal fact info/, '事实类也应带严重度');

// 落地动作要有独立标记 —— 它是「要做什么」，与「是什么」分开
assert.match(signals, /落地动作/, '落地动作应有专门标记');
assert.match(signals, /收窄定向/, '动作内容应被渲染出来');

// 事实类没有动作时不应渲染空的动作块
assert.doesNotMatch(signals, /<p class="tiktok-signal-action">\s*<span>落地动作<\/span>\s*<\/p>/,
  '没有动作时不应渲染空的动作块');

// 能力边界：标题、原因、影响都要在
assert.match(unavailable, /流量结构/, '不可得项的标题应渲染');
assert.match(unavailable, /没有流量来源字段/, '不可得项的原因应渲染');
assert.match(unavailable, /不适用/, '不可得项的影响应渲染');
assert.match(unavailable, /拿不到/, '应明确说明这些是拿不到的');

// ★ 不可得项绝不能带上数值 —— 给了数值就等于编了一个数
const unavailableValues = unavailable.match(/>\s*-?[\d.]+\s*</g) || [];
assert.strictEqual(unavailableValues.length, 0, `不可得项不应带数值，实际出现 ${unavailableValues.join(',')}`);

// 容器不应被隐藏 —— 有内容时必须可见
assert.ok(!byId('tiktokSignals').classList.contains('hidden'), '有结论时信号容器应可见');
assert.ok(!byId('tiktokUnavailable').classList.contains('hidden'), '有能力边界时容器应可见');

// ---------------------------------------------------------------------------
// 空态：没有结论时不应留下空壳
// ---------------------------------------------------------------------------

renderDiagnosis({ signals: [], unavailable: [] });
assert.match(
  byId('tiktokDiagnosisNotice').innerHTML,
  /暂时没有可诊断的结论/,
  '没有结论时应给出说明，而不是留一个空面板',
);
assert.ok(byId('tiktokSignals').classList.contains('hidden'), '没有结论时信号容器应隐藏');

process.stdout.write('tiktok diagnosis render smoke test passed\n');
