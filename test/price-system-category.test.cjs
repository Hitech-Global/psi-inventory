'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCategories, isCategoryApplicable } = require('../price-system-api');
const { primaryQuotationCategory } = require('../quotation-category');

test('empty category rules apply to every SKU', () => {
  assert.deepEqual(parseCategories('[]'), []);
  assert.equal(isCategoryApplicable({ applicable_categories: '[]' }, { category: 'Mouse' }), true);
  assert.equal(isCategoryApplicable({ applicable_categories: [] }, { category: '' }), true);
});

test('category rules only apply to selected SKU categories', () => {
  const field = { applicable_categories: JSON.stringify(['Main Unit', 'Mounts']) };
  assert.equal(isCategoryApplicable(field, 'Main Unit'), true);
  assert.equal(isCategoryApplicable(field, 'Mounts'), true);
  assert.equal(isCategoryApplicable(field, 'Accessories'), false);
  assert.equal(isCategoryApplicable(field, ''), false);
});

test('price system uses the same primary category as quotation management', () => {
  assert.equal(primaryQuotationCategory('Mouse', 'External SSD'), 'Mouse');
  assert.equal(primaryQuotationCategory('', 'External SSD'), 'SSD');
  assert.equal(primaryQuotationCategory('', 'SO-DIMM'), 'DRAM');
  assert.equal(primaryQuotationCategory('', 'MicroSDXC'), 'Memory Card');
  assert.equal(primaryQuotationCategory('未分类', 'USB3.2+TypeC'), 'USB Flash');
  assert.equal(primaryQuotationCategory('', ''), '未分类');
});

test('category applicability uses the resolved quotation primary category', () => {
  const field = { applicable_categories: JSON.stringify(['SSD', 'DRAM']) };
  assert.equal(isCategoryApplicable(field, primaryQuotationCategory('', 'External SSD')), true);
  assert.equal(isCategoryApplicable(field, primaryQuotationCategory('', 'SO-DIMM')), true);
  assert.equal(isCategoryApplicable(field, primaryQuotationCategory('', 'Mouse')), false);
});
