'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCategories, isCategoryApplicable, primaryCategoryMapForSkus } = require('../price-system-api');
const { primaryQuotationCategory } = require('../quotation-category');

test('price system categories are sourced only from SKU master data', () => {
  const categories = primaryCategoryMapForSkus([
    { sku_code: 'RDM724B', category: '游戏鼠标' },
    { sku_code: 'NT01Z11-001T-32SL', category: 'SSD' },
    { sku_code: 'UNKNOWN', category: '' }
  ]);
  assert.equal(categories.get('RDM724B'), '游戏鼠标');
  assert.equal(categories.get('NT01Z11-001T-32SL'), 'SSD');
  assert.equal(categories.get('UNKNOWN'), '未分类');
});

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


test('formula rules are bound to exact categories and do not fall back to the legacy formula', () => {
  const field = {
    field_type: 'formula',
    formula: '99% * srp',
    formula_rules: JSON.stringify({ Accessories: '8.5% * srp', SSD: 'MIN(7.2% * srp,80000)' }),
    applicable_categories: []
  };
  assert.equal(isCategoryApplicable(field, 'Accessories'), true);
  assert.equal(isCategoryApplicable(field, 'SSD'), true);
  assert.equal(isCategoryApplicable(field, 'Memory Card'), false);
  assert.equal(isCategoryApplicable(field, ''), false);
});
