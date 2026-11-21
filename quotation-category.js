'use strict';

function primaryQuotationCategory(masterCategory, importedType) {
  const master = String(masterCategory || '').trim();
  if (master && master !== '未分类') return master;
  const type = String(importedType || '').trim();
  if (!type) return '未分类';
  const v = type.toLowerCase();
  if (/dram|dimm|ddr[345]/i.test(v)) return 'DRAM';
  if (/microsd|sdhc|sdxc|cfexpress|memory\s*card/i.test(v)) return 'Memory Card';
  if (/card\s*reader/i.test(v)) return 'Card Reader';
  if (/ssd\s*enclosure|usb\s*hub|mini\s*pc\s*hub|data\s*cable|charging\s*cable|power\s*bank/i.test(v)) return 'Accessories';
  if (/ssd/i.test(v)) return 'SSD';
  if (/hdd|hard\s*drive/i.test(v)) return 'HDD';
  if (/usb|write\s*protect\s*drive/i.test(v)) return 'USB Flash';
  if (/tws|headset|headphone|earphone|earbud/i.test(v)) return 'Audio';
  if (/keyboard/i.test(v)) return 'Keyboard';
  if (/mouse/i.test(v)) return 'Mouse';
  return type;
}

module.exports = { primaryQuotationCategory };
