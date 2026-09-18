'use strict';

function isoDate(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function buildShopeeSeaEventCalendar(year) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error('Invalid year');
  const rows = [];
  for (let month = 1; month <= 12; month += 1) {
    rows.push({
      eventDate: isoDate(year, month, month),
      eventType: 'DOUBLE_DAY',
      intensity: 'MAX',
      note: `${month}.${month} Shopee SEA Double Day`,
    });
    rows.push({
      eventDate: isoDate(year, month, 25),
      eventType: 'PAYDAY_25',
      intensity: 'HIGH',
      note: 'Shopee SEA monthly 25th campaign',
    });
  }
  return rows.sort((a, b) => a.eventDate.localeCompare(b.eventDate));
}

function toEventDateSet(rows) {
  return new Set((rows || []).map(row => row.eventDate || row.event_date).filter(Boolean));
}

module.exports = { buildShopeeSeaEventCalendar, toEventDateSet };
