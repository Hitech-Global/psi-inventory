'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { primaryQuotationCategory } = require('../quotation-category');

test('SKU master top-level category takes priority over supplier quote type', () => {
  assert.equal(primaryQuotationCategory('Mouse', 'External SSD'), 'Mouse');
  assert.equal(primaryQuotationCategory('SSD', 'SO-DIMM'), 'SSD');
});

test('legacy quote types are normalized to the same primary categories as quotation management', () => {
  assert.equal(primaryQuotationCategory('', 'External SSD'), 'SSD');
  assert.equal(primaryQuotationCategory('', 'SO-DIMM'), 'DRAM');
  assert.equal(primaryQuotationCategory('', 'MicroSDXC'), 'Memory Card');
  assert.equal(primaryQuotationCategory('', 'USB3.2+TypeC'), 'USB Flash');
  assert.equal(primaryQuotationCategory('', 'SSD Enclosure'), 'Accessories');
  assert.equal(primaryQuotationCategory('', 'Wireless Mouse'), 'Mouse');
});

test('empty master and quote categories resolve to Unclassified', () => {
  assert.equal(primaryQuotationCategory('', ''), '未分类');
  assert.equal(primaryQuotationCategory('未分类', ''), '未分类');
});
