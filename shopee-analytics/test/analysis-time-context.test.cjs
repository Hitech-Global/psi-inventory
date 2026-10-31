'use strict';

const assert = require('assert');
const { buildLearningTimeline } = require('../src/analysis-package');
const { buildAnalysisTimeContext } = require('../src/analysis-time-context');

const historyRows = [];
for (let day = 14; day <= 28; day += 1) {
  historyRows.push({
    eventDate:`2026-09-${String(day).padStart(2,'0')}`,
    impression:1000, clicks:50, expense:100,
    direct_order:day >= 21 ? 5 : 4,
    direct_gmv:day >= 21 ? 450 : 320,
    broad_order:day >= 21 ? 6 : 5,
    broad_gmv:day >= 21 ? 500 : 350,
  });
}

const timeline = buildLearningTimeline([{
  operationType:'CAMPAIGN_SETTING_CHANGE', actorType:'SELLER',
  before:{ targetRoas:8 }, after:{ targetRoas:7 },
  effectiveDate:'2026-09-21', effectiveTime:'14:30:00',
  effectiveFrom:'2026-09-21T14:30:00+07:00',
}]);
const context = buildAnalysisTimeContext({
  historyRows,
  learningTimeline:timeline,
  endDate:'2026-09-28',
  weeklyOrderReference:25,
});
assert.strictEqual(context.learningEpoch.available, true);
assert.strictEqual(context.learningEpoch.startDate, '2026-09-21');
assert.strictEqual(context.learningEpoch.calendarDays, 8);
assert.strictEqual(context.learningEpoch.directOrders, 40);
assert.strictEqual(context.learningEpoch.maturityFloorMet, true);
assert.deepStrictEqual(context.learningEpoch.promoDates, ['2026-09-25']);

assert.strictEqual(context.beforeAfter.available, true);
assert.strictEqual(context.beforeAfter.transitionDate, '2026-09-21');
assert.deepStrictEqual(context.beforeAfter.prePeriod, { startDate:'2026-09-14', endDate:'2026-09-20' });
assert.deepStrictEqual(context.beforeAfter.postPeriod, { startDate:'2026-09-22', endDate:'2026-09-28' });
assert.deepStrictEqual(context.beforeAfter.promo.preDates, []);
assert.deepStrictEqual(context.beforeAfter.promo.postDates, ['2026-09-25']);
assert.strictEqual(context.beforeAfter.normalDays.preDayCount, 7);
assert.strictEqual(context.beforeAfter.normalDays.postDayCount, 6);
assert.strictEqual(context.beforeAfter.normalDays.balancedDayCount, 6);
assert.strictEqual(context.beforeAfter.promoContaminated, true);

console.log('shopee analysis time context tests: ok');
