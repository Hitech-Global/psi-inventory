'use strict';

function positiveInt(value, fallback, min, max, name) {
  const parsed = value === undefined || value === null || value === ''
    ? fallback
    : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be ${min}..${max}`);
  }
  return parsed;
}

function schedulerConfig(env = process.env) {
  return {
    hourlyMinute: positiveInt(
      env.SHOPEE_SYNC_HOURLY_MINUTE,
      10,
      0,
      59,
      'SHOPEE_SYNC_HOURLY_MINUTE',
    ),
    dailyUtcHour: positiveInt(
      env.SHOPEE_SYNC_DAILY_UTC_HOUR,
      2,
      0,
      23,
      'SHOPEE_SYNC_DAILY_UTC_HOUR',
    ),
    dailyUtcMinute: positiveInt(
      env.SHOPEE_SYNC_DAILY_UTC_MINUTE,
      30,
      0,
      59,
      'SHOPEE_SYNC_DAILY_UTC_MINUTE',
    ),
    runOnStart: env.SHOPEE_SYNC_RUN_ON_START === 'YES',
  };
}

function utcKeys(now = new Date()) {
  const date = now.toISOString().slice(0, 10);
  const hour = String(now.getUTCHours()).padStart(2, '0');
  return {
    date,
    hourKey: `${date}T${hour}`,
    minute: now.getUTCMinutes(),
    hour: now.getUTCHours(),
  };
}

function dueJobs(now, config, state) {
  const keys = utcKeys(now);
  const jobs = [];

  const dailyDue =
    keys.hour === config.dailyUtcHour &&
    keys.minute >= config.dailyUtcMinute &&
    state.lastDailyDate !== keys.date;

  if (dailyDue) {
    jobs.push({ mode: 'daily', key: keys.date });
    return jobs;
  }

  const hourlyDue =
    keys.minute >= config.hourlyMinute &&
    state.lastHourlyKey !== keys.hourKey;

  if (hourlyDue) jobs.push({ mode: 'hourly', key: keys.hourKey });
  return jobs;
}

module.exports = { schedulerConfig, utcKeys, dueJobs };
