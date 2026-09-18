'use strict';

function localIsoDate(date, timeZone) {
  if (!timeZone) throw new Error('timeZone is required');
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) throw new Error('Invalid date');
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error('Invalid ISO date');
  d.setUTCDate(d.getUTCDate() + Number(days));
  return d.toISOString().slice(0, 10);
}

function startOfUtcDayEpoch(isoDate) {
  return Math.floor(new Date(`${isoDate}T00:00:00Z`).getTime() / 1000);
}

function endOfUtcDayEpoch(isoDate) {
  return Math.floor(new Date(`${isoDate}T23:59:59Z`).getTime() / 1000);
}

function parseCampaignIds(value) {
  return Array.from(new Set(String(value || '')
    .split(',')
    .map(x => Number(x.trim()))
    .filter(Number.isSafeInteger)));
}

function mergeCampaignIds(known, seeded) {
  return Array.from(new Set([...(known || []), ...(seeded || [])])).sort((a, b) => a - b);
}

module.exports = {
  localIsoDate,
  addDays,
  startOfUtcDayEpoch,
  endOfUtcDayEpoch,
  parseCampaignIds,
  mergeCampaignIds,
};
