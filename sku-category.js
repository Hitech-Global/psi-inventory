'use strict';

const { primaryQuotationCategory } = require('./quotation-category');

// Longest prefixes must be checked first: RDGS is a speaker family, not an RDG gamepad.
const REDRAGON_CATEGORY_RULES = Object.freeze([
  ['RDBM', '办公鼠标'],
  ['RDBK', '办公键盘'],
  ['RDGS', '音箱'],
  ['RDH', '耳机'],
  ['RDM', '游戏鼠标'],
  ['RDK', '游戏键盘'],
  ['RDP', '鼠标垫'],
  ['RDG', '游戏手柄']
]);

function redragonCategoryForSku(brand, skuCode) {
  if (String(brand || '').trim().toLowerCase() !== 'redragon') return '';
  const code = String(skuCode || '').trim().toUpperCase();
  const rule = REDRAGON_CATEGORY_RULES.find(([prefix]) => code.startsWith(prefix));
  return rule ? rule[1] : '';
}

function netacCategoryFromQuotationType(productType) {
  const type = String(productType || '').trim();
  if (!type || type === '未分类') return '';
  const category = primaryQuotationCategory('', type);
  return category && category !== '未分类' ? category : '';
}

function resolveSkuMasterCategory({ brand, skuCode, currentCategory, quotationType }) {
  const brandKey = String(brand || '').trim().toLowerCase();
  if (brandKey === 'redragon') {
    return redragonCategoryForSku(brand, skuCode) || String(currentCategory || '').trim();
  }
  if (brandKey === 'netac') {
    return netacCategoryFromQuotationType(quotationType) || String(currentCategory || '').trim();
  }
  return String(currentCategory || '').trim();
}

module.exports = {
  REDRAGON_CATEGORY_RULES,
  redragonCategoryForSku,
  netacCategoryFromQuotationType,
  resolveSkuMasterCategory
};
