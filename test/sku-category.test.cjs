'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  redragonCategoryForSku,
  netacCategoryFromQuotationType,
  resolveSkuMasterCategory
} = require('../sku-category');

test('Redragon SKU prefixes resolve to the requested product categories', () => {
  const cases = [
    ['RDGS515', '音箱'],
    ['RDH130', '耳机'],
    ['RDM724B', '游戏鼠标'],
    ['RDK724GBGRGBPRO', '游戏键盘'],
    ['RDBM2995', '办公鼠标'],
    ['RDBK7366', '办公键盘'],
    ['RDP029', '鼠标垫'],
    ['RDG710', '游戏手柄']
  ];
  cases.forEach(([sku, category]) => assert.equal(redragonCategoryForSku('Redragon', sku), category, sku));
});

test('Redragon matching is case-insensitive and longest-prefix-first', () => {
  assert.equal(redragonCategoryForSku('redragon', 'rdgs520'), '音箱');
  assert.equal(redragonCategoryForSku('REDRAGON', 'RDG710'), '游戏手柄');
  assert.equal(redragonCategoryForSku('Redragon', 'RDBM4049'), '办公鼠标');
});

test('unknown Redragon prefixes are not guessed and retain an existing manual category', () => {
  assert.equal(redragonCategoryForSku('Redragon', 'RDBS7543'), '');
  assert.equal(redragonCategoryForSku('Redragon', 'RDS107RGBBA'), '');
  assert.equal(redragonCategoryForSku('Redragon', 'M916-STD-1K'), '');
  assert.equal(resolveSkuMasterCategory({ brand: 'Redragon', skuCode: 'RDBS7543', currentCategory: '' }), '');
  assert.equal(resolveSkuMasterCategory({ brand: 'Redragon', skuCode: 'RDBS7543', currentCategory: '人工分类' }), '人工分类');
});

test('Netac category follows quotation management primary-category normalization', () => {
  const cases = [
    ['External SSD', 'SSD'],
    ['SO-DIMM 260-Pin DDR4 / NB', 'DRAM'],
    ['MicroSDXC', 'Memory Card'],
    ['Flash Card Reader', 'Card Reader'],
    ['SSD Enclosure', 'Accessories'],
    ['USB3.2+TypeC', 'USB Flash'],
    ['TWS', 'Audio'],
    ['Keyboard', 'Keyboard'],
    ['Mouse', 'Mouse'],
    ['USB3.0 External HDD', 'HDD']
  ];
  cases.forEach(([type, category]) => assert.equal(netacCategoryFromQuotationType(type), category, type));
});

test('Netac keeps the existing category when there is no usable quotation category', () => {
  assert.equal(resolveSkuMasterCategory({ brand: 'Netac', skuCode: 'NT01', currentCategory: '', quotationType: '' }), '');
  assert.equal(resolveSkuMasterCategory({ brand: 'Netac', skuCode: 'NT01', currentCategory: 'SSD', quotationType: '未分类' }), 'SSD');
  assert.equal(resolveSkuMasterCategory({ brand: 'Netac', skuCode: 'NT01', currentCategory: 'Old', quotationType: 'External SSD' }), 'SSD');
});
