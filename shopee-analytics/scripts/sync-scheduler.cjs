'use strict';

const path = require('path');
const { spawn } = require('child_process');
const { schedulerConfig, dueJobs, utcKeys } = require('../src/scheduler-utils');
const { createAnalyticsPool } = require('../src/pg');
const { isOfflineBaseline, isPilotGmvMax, isPilotOAuthBootstrap } = require('../src/deployment-mode');

function runNodeScript(scriptName, args = [], envExtra = {}) {
  const script = path.join(__dirname, scriptName);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      env: {
        ...process.env,
        ...envExtra,
      },
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(`${scriptName} exited with code ${code}`));
    });
  });
}

function runSync(mode) {
  return runNodeScript('sync-all-shops.cjs', [mode], {
    SHOPEE_ANALYTICS_ENABLE_SYNC_ALL_SHOPS: 'YES',
  });
}

async function processProductCardInbox() {
  if (process.env.SHOPEE_PRODUCT_CARD_INBOX_ENABLE !== 'YES') return;
  try {
    await runNodeScript('process-product-card-inbox.cjs', [], {
      SHOPEE_PRODUCT_CARD_INBOX_ENABLE: 'YES',
    });
  } catch (error) {
    console.error(JSON.stringify({
      event: 'product-card-inbox-failure',
      failedAt: new Date().toISOString(),
      error: error && error.message ? error.message : String(error),
    }));
  }
}

async function runDailySkillAnalysis() {
  try {
    await runNodeScript('run-daily-skill-reports.cjs');
  } catch (error) {
    console.error(JSON.stringify({
      event: 'skill-daily-failure',
      failedAt: new Date().toISOString(),
      error: error && error.message ? error.message : String(error),
    }));
  }
}

async function runIdleWorker({
  poolFactory = createAnalyticsPool,
  keepAlive = true,
  event,
  deploymentMode,
  detail,
} = {}) {
  const pool = poolFactory();
  try {
    await pool.query('SELECT 1');
  } finally {
    await pool.end();
  }

  console.log(JSON.stringify({ event, deploymentMode, detail }));
  if (!keepAlive) return;

  const timer = setInterval(() => {}, 60_000);
  const stop = signal => {
    console.log(JSON.stringify({ event: `${event}-stop`, signal }));
    clearInterval(timer);
    process.exit(0);
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
}

async function runOfflineBaselineWorker(options = {}) {
  return runIdleWorker({
    ...options,
    event: 'offline-baseline-worker-idle',
    deploymentMode: 'OFFLINE_BASELINE',
    detail: 'PostgreSQL reachable; sync scheduler, Product Card import, and Skill reports are disabled.',
  });
}

async function runPilotOAuthBootstrapWorker(options = {}) {
  return runIdleWorker({
    ...options,
    event: 'pilot-oauth-bootstrap-worker-idle',
    deploymentMode: 'PILOT_GMV_MAX',
    detail: 'OAuth bootstrap enabled; recurring Shopee sync, Product Card import, and Skill reports remain disabled until a GMV Max campaign allowlist is configured.',
  });
}

async function main() {
  if (isOfflineBaseline()) {
    await runOfflineBaselineWorker();
    return;
  }
  if (isPilotOAuthBootstrap()) {
    await runPilotOAuthBootstrapWorker();
    return;
  }
  if (isPilotGmvMax()) {
    await runIdleWorker({
      event: 'pilot-gmv-max-worker-idle',
      deploymentMode: 'PILOT_GMV_MAX',
      detail: 'Recurring sync remains disabled; run the explicitly scoped formal GMS command for a controlled sync.',
    });
    return;
  }

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
      await processProductCardInbox();
      if (job.mode === 'daily' && !isPilotGmvMax()) await runDailySkillAnalysis();
    } catch (error) {
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

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = { main, runOfflineBaselineWorker, runPilotOAuthBootstrapWorker };
