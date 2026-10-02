'use strict';

const path = require('path');

function parseInboxFileName(fileName) {
  const base = path.basename(String(fileName || ''));
  const shop = base.match(/^shop-(\d+)__/i);
  const dates = base.match(/(20\d{2})(\d{2})(\d{2})[^0-9]+(20\d{2})(\d{2})(\d{2})/);
  if (!shop || !dates) return null;

  const shopId = Number(shop[1]);
  if (!Number.isSafeInteger(shopId) || shopId <= 0) return null;

  return {
    shopId,
    startDate: `${dates[1]}-${dates[2]}-${dates[3]}`,
    endDate: `${dates[4]}-${dates[5]}-${dates[6]}`,
  };
}

function isProductCardFile(fileName) {
  return /\.(xlsx|xls)$/i.test(String(fileName || ''));
}

module.exports = { parseInboxFileName, isProductCardFile };
