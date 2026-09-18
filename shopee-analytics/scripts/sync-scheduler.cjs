'use strict';

const path = require('path');
const { spawn } = require('child_process');
const { schedulerConfig, dueJobs, utcKeys } = require('../src/scheduler-utils');

function runSync(mode) {
  const script = path.join(__dirname, 'sync-all-shops.cjs');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, mode], {
      env: {
        ...process.env,
        SHOPEE_ANALYTICS_ENABLE_SYNC_ALL_SHOPS: 'YES',
      },
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(`sync-all-shops ${mode} exited with code ${code}`));
    });
  });
}

async function main() {
  const config = schedulerConfig();
  const state = {
    lastHourlyKey: null,
    lastDailyDate: null,
    running: false,
  };

  console.log(JSON.stringify({
    event: 'scheduler-start',
    hourlyMinuteUtc: config.hourlyMinute,
    dailyUtc: `${String(config.dailyUtcHour).padStart(2, '0')}:${String(config.dailyUtcMinute).padStart(2, '0')}`,
    runOnStart: config.runOnStart,
  }));

  const execute = async job => {
    if (state.running) return;
    state.running = true;
    const startedAt = new Date();
    try {
      console.log(JSON.stringify({
        event: 'sync-start',
        mode: job.mode,
        scheduledKey: job.key,
        startedAt: startedAt.toISOString(),
      }));
      await runSync(job.mode);
      if (job.mode === 'daily') {
        state.lastDailyDate = job.key;
        state.lastHourlyKey = utcKeys(startedAt).hourKey;
      } else {
        state.lastHourlyKey = job.key;
      }
      console.log(JSON.stringify({
        event: 'sync-success',
        mode: job.mode,
        completedAt: new Date().toISOString(),
      }));
    } catch (error) {
      // Mark the slot as attempted so a persistent API error does not hot-loop every
      // 30 seconds. The next normal schedule slot will retry.
      if (job.mode === 'daily') state.lastDailyDate = job.key;
      else state.lastHourlyKey = job.key;
      console.error(JSON.stringify({
        event: 'sync-failure',
        mode: job.mode,
        failedAt: new Date().toISOString(),
        error: error && error.message ? error.message : String(error),
      }));
    } finally {
      state.running = false;
    }
  };

  if (config.runOnStart) {
    await execute({
      mode: 'hourly',
      key: utcKeys(new Date()).hourKey,
    });
  }

  const tick = () => {
    if (state.running) return;
    const jobs = dueJobs(new Date(), config, state);
    if (jobs.length) execute(jobs[0]);
  };

  tick();
  const timer = setInterval(tick, 30000);

  const stop = signal => {
    console.log(JSON.stringify({ event: 'scheduler-stop', signal }));
    clearInterval(timer);
    process.exit(0);
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
