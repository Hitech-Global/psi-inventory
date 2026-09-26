'use strict';

const { addDays } = require('./sync-cycle-utils');

function isoDate(value, name = 'date') {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`${name} must be YYYY-MM-DD`);
  const parsed = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    throw new Error(`${name} is invalid`);
  }
  return text;
}

function daysInclusive(startDate, endDate) {
  const start = new Date(`${isoDate(startDate, 'startDate')}T00:00:00Z`);
  const end = new Date(`${isoDate(endDate, 'endDate')}T00:00:00Z`);
  if (start > end) throw new Error('startDate must be <= endDate');
  return Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
}

function chunkDateRange(startDate, endDate, chunkDays) {
  const start = isoDate(startDate, 'startDate');
  const end = isoDate(endDate, 'endDate');
  if (!Number.isSafeInteger(chunkDays) || chunkDays <= 0 || chunkDays > 366) {
    throw new Error('chunkDays must be 1..366');
  }
  if (start > end) throw new Error('startDate must be <= endDate');

  const chunks = [];
  let cursor = start;
  while (cursor <= end) {
    const candidateEnd = addDays(cursor, chunkDays - 1);
    const chunkEnd = candidateEnd > end ? end : candidateEnd;
    chunks.push({ startDate: cursor, endDate: chunkEnd });
    cursor = addDays(chunkEnd, 1);
  }
  return chunks;
}

function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(parts.map(part => [part.type, part.value]));
}

function zonedMidnightEpoch(iso, timeZone) {
  const [year, month, day] = isoDate(iso).split('-').map(Number);
  const target = Date.UTC(year, month - 1, day, 0, 0, 0);
  let guess = target;

  for (let i = 0; i < 4; i += 1) {
    const parts = zonedParts(new Date(guess), timeZone);
    const represented = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    const delta = target - represented;
    guess += delta;
    if (delta === 0) break;
  }

  const verify = zonedParts(new Date(guess), timeZone);
  const actual = `${verify.year}-${verify.month}-${verify.day}`;
  if (actual !== iso || verify.hour !== '00' || verify.minute !== '00') {
    throw new Error(`Could not resolve local midnight for ${iso} in ${timeZone}`);
  }
  return Math.floor(guess / 1000);
}

function localDateRangeEpoch(startDate, endDate, timeZone) {
  if (!timeZone) throw new Error('timeZone is required');
  const start = isoDate(startDate, 'startDate');
  const end = isoDate(endDate, 'endDate');
  if (start > end) throw new Error('startDate must be <= endDate');
  return {
    timeFrom: zonedMidnightEpoch(start, timeZone),
    timeTo: zonedMidnightEpoch(addDays(end, 1), timeZone) - 1,
  };
}

function parseSources(value) {
  const allowed = new Set([
    'shop-info',
    'campaigns',
    'gms',
    'orders',
    'returns',
    'shop-bi',
    'products',
    'promotions',
    'roi',
  ]);
  const requested = String(value || '')
    .split(',')
    .map(x => x.trim().toLowerCase())
    .filter(Boolean);
  const sources = requested.length
    ? Array.from(new Set(requested))
    : Array.from(allowed);

  for (const source of sources) {
    if (!allowed.has(source)) throw new Error(`Unsupported backfill source: ${source}`);
  }
  return sources;
}

function completedThrough(state, requestedStartDate, requestedEndDate) {
  if (!state || !state.cursor) return null;
  const cursor = state.cursor;
  if (
    cursor.requestedStartDate !== requestedStartDate ||
    cursor.requestedEndDate !== requestedEndDate
  ) return null;
  return cursor.completedThrough || null;
}

module.exports = {
  isoDate,
  daysInclusive,
  chunkDateRange,
  zonedMidnightEpoch,
  localDateRangeEpoch,
  parseSources,
  completedThrough,
};
