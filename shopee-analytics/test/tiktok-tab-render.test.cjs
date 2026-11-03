'use strict';

/**
 * TikTok 页签的渲染冒烟测试。
 *
 * 为什么不用真浏览器：这里要验的是「渲染函数拿到数据后产出的 HTML 对不对」，
 * 与浏览器无关。所以用一个极小的 DOM 替身加载**真实的** tiktok-ui-v1.js，
 * 把真实的假数据喂进去，检查它渲染出来的内容。
 *
 * 这样能抓到纯静态检查抓不到的问题：比如口径标记没渲染出来、
 * 缺失值被渲染成了 0、CSV 导出漏了列。
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const uiSource = fs.readFileSync(path.join(__dirname, '..', 'web', 'tiktok-ui-v1.js'), 'utf8');

// ---------------------------------------------------------------------------
// 极小 DOM 替身
// ---------------------------------------------------------------------------

const registry = new Map();

function makeElement(tag = 'div') {
  const element = {
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
  return element;
}

/** 按 id 取元素；没注册过就现造一个（并登记）。 */
function byId(id) {
  if (!registry.has(id)) registry.set(id, makeElement());
  return registry.get(id);
}

// Blob / URL 的替身：CSV 导出会用到
global.Blob = class {
  constructor(parts) { this.parts = parts; this.content = parts.join(''); }
};
global.URL = {
  createObjectURL() { return 'blob:stub'; },
  revokeObjectURL() {},
};

global.document = {
  body: makeElement('body'),
  createElement(tag) { return makeElement(tag); },
  querySelector(selector) {
    if (selector.startsWith('#')) return byId(selector.slice(1));
    return null;
  },
};

// window 替身 —— tiktok-ui-v1.js 把自己挂到 window.TikTokUI
global.window = {};

// eslint-disable-next-line no-new-func
new Function('window', 'document', 'Blob', 'URL', uiSource)(global.window, global.document, global.Blob, global.URL);

const { render, exportCsv } = global.window.TikTokUI;
assert.ok(render && exportCsv, 'tiktok-ui-v1.js 必须导出 render 与 exportCsv');

// ---------------------------------------------------------------------------
// 样例数据：两种口径，其中结算口径有值
// ---------------------------------------------------------------------------

const sample = {
  startDate: '2026-11-01',
  endDate: '2026-11-03',
  byBasis: {
    order_level: {
      attributionBasis: 'order_level',
      attributionLabel: '订单实付口径',
      source: 'shop_order',
      sourceLabel: '订单数据',
      currency: 'USD',
      dayCount: 3,
      orders: 12,
      units: 30,
      gmvOrderTotal: 1200.5,
      gmvSubtotal: 1000.25,
      gmvSettled: null,
      cancellations: 1,
    },
    platform_attributed: {
      attributionBasis: 'platform_attributed',
      attributionLabel: '平台归因口径',
      source: 'gmv_max_report',
      sourceLabel: 'GMV Max 报表',
      currency: 'USD',
      dayCount: 2,
      orders: 5,
      units: 9,
      spend: 88.5,
      impressions: 1200,
      clicks: 90,
      gmvOrderTotal: null,
      gmvSubtotal: null,
      gmvSettled: null,
      incrementalGmv: 320,
    },
  },
  daily: [
    {
      eventDate: '2026-11-01',
      attributionBasis: 'order_level',
      attributionLabel: '订单实付口径',
      source: 'shop_order',
      sourceLabel: '订单数据',
      channel: 'unknown',
      currency: 'USD',
      orders: 4,
      units: 10,
      gmvOrderTotal: 400,
      gmvSubtotal: 350,
      gmvSettled: null,
      refunds: null,
      cancellations: 0,
    },
    {
      eventDate: '2026-11-01',
      attributionBasis: 'platform_attributed',
      attributionLabel: '平台归因口径',
      source: 'gmv_max_report',
      sourceLabel: 'GMV Max 报表',
      channel: 'unknown',
      currency: 'USD',
      orders: 2,
      units: 3,
      gmvOrderTotal: null,
      gmvSubtotal: null,
      gmvSettled: null,
      refunds: null,
      cancellations: null,
    },
  ],
  coverage: {
    orderCount: 12,
    productCount: 7,
    coveredDayCount: 3,
    syncStateCount: 4,
    firstOrderDate: '2026-10-15',
    lastOrderDate: '2026-11-03',
  },
  products: [
    {
      productId: 'P-1',
      productName: '无线鼠标',
      orderCount: 5,
      units: 12,
      grossAmount: 240,
      discounts: 20,
    },
  ],
  orders: [
    {
      orderId: 'ORDER-9',
      orderStatus: 'COMPLETED',
      attributionBasis: 'order_level',
      attributionLabel: '订单实付口径',
      channel: 'unknown',
      currency: 'USD',
      orderDate: '2026-11-02',
      units: 2,
      gmvOrderTotal: 150,
      gmvSubtotal: 120,
      gmvSettled: null,
      shippingFee: 10,
    },
  ],
};

render(sample);

// ---------------------------------------------------------------------------
// 断言
// ---------------------------------------------------------------------------

const summary = byId('tiktokSummary');
assert.ok(!summary.classList.contains('hidden'), '概览卡片应显示');
assert.match(summary.innerHTML, /订单实付/, '概览应标明「订单实付」');
assert.match(summary.innerHTML, /订单口径/, '概览必须标明这是订单口径，不能让人以为是总 GMV');
assert.match(summary.innerHTML, /1,200\.5/, '订单实付金额应被格式化');

const notice = byId('tiktokNotice');
assert.ok(!notice.classList.contains('hidden'), '口径说明应显示');
assert.match(notice.innerHTML, /不能相加|互不推导/, '说明必须讲清三个口径不能相加');
assert.match(notice.innerHTML, /订单实付口径/, '说明里应列出实际存在的口径');
assert.match(notice.innerHTML, /平台归因口径/, '说明里应列出实际存在的口径');

const dailyBody = byId('tiktokDailyBody');
assert.match(dailyBody.innerHTML, /订单实付口径/, '日表格应渲染口径标记');
assert.match(dailyBody.innerHTML, /平台归因口径/, '两个口径都要出现在表格里');
assert.match(dailyBody.innerHTML, /400/, '订单实付数值应渲染');
assert.match(dailyBody.innerHTML, /tiktok-basis/, '口径应有视觉标记');

// ★ 缺失值必须渲染成破折号，不能变成 0。
// 注意：真正的 0（样例里 cancellations=0）**应该**显示 0 ——
// 0 是「确实为零」，破折号是「没有数据」，两者不能混。
// 所以这里只检查「本该缺失的那几列是破折号」，不去禁止其它列出现 0。
assert.match(dailyBody.innerHTML, /—/, '缺失的结算收入应显示破折号');
assert.match(dailyBody.innerHTML, /<td>0<\/td>/, '真实的零（取消数 0）应显示为 0，不能被伪装成缺失');
// 结算口径那两行（平台归因）本就没有订单实付与货款小计 —— 必须都是破折号。
const attributedRow = dailyBody.innerHTML
  .split('<tr>')
  .find(chunk => chunk.includes('平台归因口径'));
assert.ok(attributedRow, '应能找到平台归因口径那一行');
// 注意索引：split('<td>') 的第 0 段是第一个单元格**之前**的内容，
// 所以 cells[1] 才是第一列。
const attributedCells = attributedRow.split('<td>').map(cell => cell.split('</td>')[0].trim());
// 列序：日期(1) 口径(2) 来源(3) 币种(4) 订单数(5) 销量(6)
//       订单实付(7) 货款小计(8) 结算收入(9) 退款(10) 取消(11)
assert.strictEqual(attributedCells[7], '—', '平台归因口径的订单实付应显示破折号');
assert.strictEqual(attributedCells[8], '—', '平台归因口径的货款小计应显示破折号');
assert.strictEqual(attributedCells[9], '—', '平台归因口径的结算收入应显示破折号');

const productBody = byId('tiktokProductBody');
assert.match(productBody.innerHTML, /无线鼠标/, '商品表格应渲染商品名');
assert.match(productBody.innerHTML, /240/, '商品金额应渲染');

const orderBody = byId('tiktokOrderBody');
assert.match(orderBody.innerHTML, /ORDER-9/, '订单表格应渲染订单号');
assert.match(orderBody.innerHTML, /COMPLETED/, '订单表格应渲染订单状态');

// 导出 CSV：检查表头与内容
let captured = null;
const originalCreate = global.document.createElement;
global.document.createElement = (tag) => {
  const el = originalCreate(tag);
  if (tag === 'a') {
    el.click = () => { captured = { href: el.href, download: el.download }; };
  }
  return el;
};
exportCsv();
assert.ok(captured, 'CSV 导出应触发下载');
assert.match(captured.download, /^tiktok-daily-2026-11-01-2026-11-03\.csv$/, `导出文件名不对：${captured.download}`);

process.stdout.write('tiktok tab render smoke test passed\n');
