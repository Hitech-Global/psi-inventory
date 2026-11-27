'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const app = read('app.js');
const server = read('server.js');
const pg = read('db-pg.js');
const sqlite = read('db-sqlite.js');
const i18n = read('i18n.js');

test('PI schema stores trade mode, VAT and domestic CI claim for both drivers', () => {
  for (const source of [pg, sqlite]) {
    assert.match(source, /trade_mode TEXT DEFAULT 'international'/);
    assert.match(source, /vat_amount (?:NUMERIC\(18,4\)|REAL) DEFAULT 0/);
    assert.match(source, /domestic_ci_id TEXT DEFAULT ''/);
  }
});

test('PI defaults to international and includes domestic VAT in its total and deposit basis', () => {
  assert.match(server, /d\.trade_mode \|\| 'international'/);
  assert.match(server, /const vatAmount = tradeMode === 'domestic' \? vatInput : 0/);
  assert.match(server, /totalAmount \+= vatAmount/);
  assert.match(server, /const nextVatAmount = nextTradeMode === 'domestic' \? vatInput : 0/);
  assert.match(server, /prospectiveGoodsTotal \+ nextVatAmount/);
  assert.match(server, /totalAmount \+= nextVatAmount/);
});

test('domestic PI can only generate one CI with all confirmed SKU quantities', () => {
  assert.match(server, /国内贸易 PI 必须整单一次性生成 CI/);
  assert.match(server, /requestedQty !== expected\.qty/);
  assert.match(server, /国内贸易 PI 只能一次性生成一张 CI，批次必须为 1/);
  assert.match(server, /domestic_ci_id = \?/);
  assert.match(server, /domesticImportRow/);
  assert.match(server, /domestic_ci_id = '' WHERE id = \? AND domestic_ci_id = \?/);
});

test('CI carries the full VAT amount and includes it in payable and detail totals', () => {
  assert.match(server, /const ciVatAmount = domesticPis\.reduce/);
  assert.match(server, /trade_mode, vat_amount, clearance_type/);
  assert.match(server, /goodsAmount \+ ciVatAmount - totalShouldDeduct/);
  assert.match(server, /goods_amount \+ COALESCE\(vat_amount, 0\).*AS total_amount/);
  assert.match(server, /piCiTotalAmount = piGoodsAmount \+ piVatAmount/);
});

test('PI and CI forms expose VAT only for domestic trade and lock CI quantity to full shipment', () => {
  assert.match(app, /id="npi-trade-mode"/);
  assert.match(app, /id="npi-vat-group"/);
  assert.match(app, /id="npi-vat-total-preview"/);
  assert.match(app, /onPITradeModeChange\(\)/);
  assert.match(app, /vat_amount:tradeMode==='domestic'/);
  assert.match(app, /isDomestic\?'disabled/);
  assert.match(app, /ci_total_amount/);
});

test('PI and CI trade-mode labels are translated in Chinese, English and Indonesian', () => {
  for (const lang of ['zh', 'en', 'id']) {
    assert.match(i18n, new RegExp('I18N\\.dict\\.' + lang + '\\["pi\\.trade_mode"\\]'));
    assert.match(i18n, new RegExp('I18N\\.dict\\.' + lang + '\\["pi\\.vat_amount"\\]'));
    assert.match(i18n, new RegExp('I18N\\.dict\\.' + lang + '\\["ci\\.detail\\.vat_amount"\\]'));
  }
});
