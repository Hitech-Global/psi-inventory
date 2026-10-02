'use strict';

const { sumSourceAwarePerformance } = require('./source-aware-metrics');
const { buildShopeeSeaEventCalendar } = require('./event-calendar');

const SNAPSHOT_KEYS = [
  'impressions','clicks','ctr','addToCart','addToCartRate','expense','cpc',
  'directOrders','directCvr','directGmv','directRoas','directAcos',
  'broadOrders','broadCvr','broadGmv','broadRoas','broadAcos',
];

function isoDay(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
}

function rowDay(row = {}) {
  return isoDay(row.date ?? row.event_date ?? row.eventDate);
}

function addDays(value, days) {
  const d = new Date(`${value}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysInclusive(startDate, endDate) {
  if (!startDate || !endDate || startDate > endDate) return 0;
  return Math.round((new Date(`${endDate}T00:00:00Z`) - new Date(`${startDate}T00:00:00Z`)) / 86400000) + 1;
}

function snapshot(rows = []) {
  const p = sumSourceAwarePerformance(rows);
  return Object.fromEntries(SNAPSHOT_KEYS.map(key => [key, p[key] === undefined ? null : p[key]]));
}

function rowsBetween(rows, startDate, endDate) {
  return (rows || []).filter(row => {
    const day = rowDay(row);
    return day && day >= startDate && day <= endDate;
  });
}

function distinctDays(rows = []) {
  return [...new Set(rows.map(rowDay).filter(Boolean))].sort();
}

function promoMapForRange(startDate, endDate) {
  const map = new Map();
  if (!startDate || !endDate) return map;
  for (let year = Number(startDate.slice(0, 4)); year <= Number(endDate.slice(0, 4)); year += 1) {
    for (const event of buildShopeeSeaEventCalendar(year)) {
      if (event.eventDate >= startDate && event.eventDate <= endDate) map.set(event.eventDate, event);
    }
  }
  return map;
}

function normalRows(rows, promoMap) {
  return (rows || []).filter(row => !promoMap.has(rowDay(row)));
}

function rowsForDays(rows, days) {
  const allowed = new Set(days);
  return (rows || []).filter(row => allowed.has(rowDay(row)));
}

function eventDate(event) {
  return event && (event.effectiveDate || isoDay(event.effectiveFrom));
}

function latestByDate(events = []) {
  return [...events].filter(row => eventDate(row)).sort((a, b) => {
    const dateOrder = eventDate(a).localeCompare(eventDate(b));
    if (dateOrder) return dateOrder;
    return String(a.effectiveTime || a.effectiveFrom || '').localeCompare(String(b.effectiveTime || b.effectiveFrom || ''));
  }).pop() || null;
}

function comparisonEvent(timeline = {}) {
  return latestByDate((timeline.events || []).filter(row =>
    ['CONFIRMED_RESET','LEARNING_IMPACT','RESET_CANDIDATE'].includes(row.resetClass)));
}

function epochEvent(timeline = {}) {
  return latestByDate([
    timeline.latestEpochStart,
    timeline.latestConfirmedReset,
  ].filter(Boolean));
}

function cleanPostStart(event) {
  const date = eventDate(event);
  if (!date) return null;
  return String(event.effectiveTime || '').startsWith('00:00:00') ? date : addDays(date, 1);
}

function promoSegments(rows, promoMap) {
  return [...promoMap.values()].map(event => ({
    date: event.eventDate,
    eventType: event.eventType,
    performance: snapshot(rowsForDays(rows, [event.eventDate])),
  })).filter(row => distinctDays(rowsForDays(rows, [row.date])).length > 0);
}

function buildBeforeAfter({ historyRows = [], timeline = {}, endDate }) {
  const event = comparisonEvent(timeline);
  const changeDate = eventDate(event);
  const postStart = cleanPostStart(event);
  if (!event || !changeDate || !postStart || postStart > endDate) {
    return { available: false, reason: event ? 'NO_FULL_POST_CHANGE_DAY' : 'NO_MATERIAL_OPERATION' };
  }

  const postCalendarDays = daysInclusive(postStart, endDate);
  const preEnd = addDays(changeDate, -1);
  const preStart = addDays(preEnd, -postCalendarDays + 1);
  const preRows = rowsBetween(historyRows, preStart, preEnd);
  const postRows = rowsBetween(historyRows, postStart, endDate);
  const promoMap = promoMapForRange(preStart, endDate);
  const preNormal = normalRows(preRows, promoMap);
  const postNormal = normalRows(postRows, promoMap);
  const preNormalDays = distinctDays(preNormal);
  const postNormalDays = distinctDays(postNormal);
  const balancedDays = Math.min(preNormalDays.length, postNormalDays.length);
  const preBalancedDays = balancedDays ? preNormalDays.slice(-balancedDays) : [];
  const postBalancedDays = balancedDays ? postNormalDays.slice(-balancedDays) : [];

  return {
    available: true,
    event,
    transitionDate: changeDate,
    prePeriod: { startDate: preStart, endDate: preEnd },
    postPeriod: { startDate: postStart, endDate },
    allDays: {
      preDataDays: distinctDays(preRows).length,
      postDataDays: distinctDays(postRows).length,
      pre: snapshot(preRows), post: snapshot(postRows),
    },
    normalDays: {
      preDayCount: preNormalDays.length,
      postDayCount: postNormalDays.length,
      balancedDayCount: balancedDays,
      pre: snapshot(preNormal), post: snapshot(postNormal),
      balancedPre: snapshot(rowsForDays(preRows, preBalancedDays)),
      balancedPost: snapshot(rowsForDays(postRows, postBalancedDays)),
      preDates: preNormalDays,
      postDates: postNormalDays,
      balancedPreDates: preBalancedDays,
      balancedPostDates: postBalancedDays,
    },
    promo: {
      preDates: [...promoMap.keys()].filter(date => date >= preStart && date <= preEnd),
      postDates: [...promoMap.keys()].filter(date => date >= postStart && date <= endDate),
      preSegments: promoSegments(preRows, promoMap),
      postSegments: promoSegments(postRows, promoMap),
    },
    promoContaminated: [...promoMap.keys()].some(date => date >= preStart && date <= preEnd) ||
      [...promoMap.keys()].some(date => date >= postStart && date <= endDate),
  };
}

function buildEpoch({ historyRows = [], timeline = {}, endDate, weeklyOrderReference = 25 }) {
  const event = epochEvent(timeline);
  const startDate = eventDate(event);
  if (!event || !startDate || startDate > endDate) return { available: false, reason: 'NO_EPOCH_START' };
  const rows = rowsBetween(historyRows, startDate, endDate);
  const promoMap = promoMapForRange(startDate, endDate);
  const performance = snapshot(rows);
  const calendarDays = daysInclusive(startDate, endDate);
  const dataDays = distinctDays(rows).length;
  return {
    available: true,
    startEvent: event,
    startDate,
    endDate,
    calendarDays,
    dataDays,
    directOrders: Number(performance.directOrders || 0),
    weeklyOrderReference: Number(weeklyOrderReference || 25),
    maturityFloorMet: calendarDays >= 7 && Number(performance.directOrders || 0) >= Number(weeklyOrderReference || 25),
    promoDates: [...promoMap.keys()],
    performance,
  };
}

function buildAnalysisTimeContext({ historyRows = [], learningTimeline = {}, endDate, weeklyOrderReference = 25 }) {
  const beforeAfter = buildBeforeAfter({ historyRows, timeline: learningTimeline, endDate });
  const learningEpoch = buildEpoch({ historyRows, timeline: learningTimeline, endDate, weeklyOrderReference });
  return {
    learningEpoch,
    beforeAfter,
    sourceDisambiguationRequired: learningTimeline.requiresSourceDisambiguation === true,
    stabilityJudgmentBlocked: learningTimeline.requiresSourceDisambiguation === true,
    systemOptimizationEvents: (learningTimeline.events || []).filter(row => row.resetClass === 'SYSTEM_OPTIMIZATION'),
  };
}

module.exports = {
  isoDay,
  addDays,
  daysInclusive,
  snapshot,
  buildBeforeAfter,
  buildEpoch,
  buildAnalysisTimeContext,
};
