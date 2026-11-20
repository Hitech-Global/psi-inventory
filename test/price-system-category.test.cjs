'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCategories, isCategoryApplicable } = require('../price-system-api');

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
