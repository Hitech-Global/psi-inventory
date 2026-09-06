'use strict';

/**
 * 库存总表汇率自动维护 — 最小回归测试（CASE A-E + 当天重复不重拉）
 *
 * 锁定此前 bug：只要库里存在旧日期汇率，新的一天就永不重新获取，必须点【刷新】。
 * 现在契约：
 *   A. 当天汇率全部存在 → 直接读 DB，不请求外部 provider
 *   B. 当天某币种缺失 → 自动调用 provider 并写入当天记录
 *   C. 当天缺失 + provider 失败 → 回退最近一次成功汇率
 *   D. fallback 返回真实历史日期（不伪装成今天）
 *   E. provider 失败 → 函数不抛错（路由层不会 500）
 *   + 当天已有记录再次调用 → 不重复请求 provider、不重复插入
 *
 * 直测导出的纯函数 resolveInventoryCurrencyRates（不依赖 HTTP / 鉴权 / 外部网络）。
 * provider 通过 fetchImpl 注入，DB 用 :memory: 隔离。
 */

process.env.DB_DRIVER = 'sqlite';
process.env.DB_PATH = ':memory:';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { query, queryOne, run, getDB } = require('./db');
const { resolveInventoryCurrencyRates } = require('./server');

const TODAY = '2026-09-06';
const YESTERDAY = '2026-09-05';

function setupExchangeRatesTable() {
  getDB().exec(`
    CREATE TABLE IF NOT EXISTS exchange_rates (
      id TEXT PRIMARY KEY,
      from_currency TEXT NOT NULL,
      to_currency TEXT NOT NULL,
      rate NUMERIC,
      rate_date TEXT NOT NULL,
      rate_type TEXT DEFAULT 'realtime',
      created_at TEXT DEFAULT ''
    );
  `);
  // :memory: 连接为进程级单例，跨用例共享 → 每个用例开始前清空，保证隔离
  getDB().exec('DELETE FROM exchange_rates');
}

// 1 外币 = X 人民币（foreignToRmb）。测试里按 foreignToRmb 入库，函数换算回 1 CNY = X 外币。
function seedRate(curr, rateDate, foreignToRmb, rateType = 'realtime') {
  run('INSERT INTO exchange_rates (id, from_currency, to_currency, rate, rate_date, rate_type) VALUES (?, ?, ?, ?, ?, ?)',
    ['seed_' + curr + '_' + rateDate, curr, 'RMB', foreignToRmb, rateDate, rateType]);
}

function countTodayRows() {
  return query("SELECT * FROM exchange_rates WHERE rate_date = ? AND rate_type = 'realtime'", [TODAY]).rows.length;
}

// 成功 provider：返回 CNY→IDR/THB/MYR
function successFetch() {
  return async () => ({ json: async () => ({ rates: { IDR: 2200, THB: 5, MYR: 0.65 } }) });
}
// 失败 provider：直接抛错
function failingFetch() {
  return async () => { throw new Error('provider timeout'); };
}

const CURRENCIES = ['IDR', 'THB', 'MYR'];

test('A. 当天汇率全部存在 → 不请求外部 provider', async () => {
  setupExchangeRatesTable();
  seedRate('IDR', TODAY, 1 / 2200);
  seedRate('THB', TODAY, 1 / 5);
  seedRate('MYR', TODAY, 1 / 0.65);
  let calls = 0;
  const fetchImpl = async () => { calls++; return { json: async () => ({ rates: {} }) }; };

  const r = await resolveInventoryCurrencyRates({ currencies: CURRENCIES, today: TODAY, fetchImpl });

  assert.equal(calls, 0, 'provider 不应被调用');
  assert.equal(r.used_fallback, false);
  assert.equal(r.rate_date, TODAY);
  assert.equal(r.rates.IDR.date, TODAY);
  assert.equal(r.rates.THB.date, TODAY);
  assert.equal(r.rates.MYR.date, TODAY);
});

test('B. 当天缺失 + provider 成功 → 写入当天记录', async () => {
  setupExchangeRatesTable();
  let calls = 0;
  const fetchImpl = async () => { calls++; return successFetch()(); };

  const r = await resolveInventoryCurrencyRates({ currencies: CURRENCIES, today: TODAY, fetchImpl });

  assert.equal(calls, 1, 'provider 应被调用一次');
  assert.equal(r.used_fallback, false);
  assert.equal(r.rate_date, TODAY);
  assert.equal(countTodayRows(), 3, '应写入 3 条当天 realtime 记录');
  assert.equal(r.rates.IDR.date, TODAY);
  assert.ok(r.rates.IDR.rate > 0);
});

test('C+D. 当天缺失 + provider 失败 → 回退最近成功汇率并返回真实历史日期', async () => {
  setupExchangeRatesTable();
  // 仅有昨天的成功记录，可回退
  seedRate('IDR', YESTERDAY, 1 / 2190);
  seedRate('THB', YESTERDAY, 1 / 4.98);
  seedRate('MYR', YESTERDAY, 1 / 0.64);
  let calls = 0;
  const fetchImpl = async () => { calls++; return failingFetch()(); };

  const r = await resolveInventoryCurrencyRates({ currencies: CURRENCIES, today: TODAY, fetchImpl });

  assert.equal(calls, 1, 'provider 应被调用一次（然后失败）');
  assert.equal(r.used_fallback, true, '应标记 used_fallback');
  assert.equal(r.rate_date, YESTERDAY, '回退日期必须是真实历史日期，不能伪装成今天');
  assert.equal(r.rates.IDR.date, YESTERDAY);
  assert.equal(r.rates.THB.date, YESTERDAY);
  assert.equal(r.rates.MYR.date, YESTERDAY);
  assert.equal(countTodayRows(), 0, 'provider 失败不应写入当天记录');
});

test('E. provider 失败 → 函数不抛错（路由层不会 500）', async () => {
  setupExchangeRatesTable();
  seedRate('IDR', YESTERDAY, 1 / 2190);
  const fetchImpl = failingFetch();
  // 不抛错即通过；且仍能返回可用结果
  const r = await resolveInventoryCurrencyRates({ currencies: ['IDR'], today: TODAY, fetchImpl });
  assert.ok(r && typeof r === 'object');
  assert.equal(r.used_fallback, true);
  assert.equal(r.rates.IDR.date, YESTERDAY);
});

test('当天已有记录再次调用 → 不重复请求 provider、不重复插入', async () => {
  setupExchangeRatesTable();
  let calls = 0;
  const fetchImpl = async () => { calls++; return successFetch()(); };
  // 第一次：缺失 → 获取并写入
  await resolveInventoryCurrencyRates({ currencies: CURRENCIES, today: TODAY, fetchImpl });
  const afterFirst = countTodayRows();
  // 第二次：当天已存在 → 直接读 DB
  const r = await resolveInventoryCurrencyRates({ currencies: CURRENCIES, today: TODAY, fetchImpl });
  assert.equal(calls, 1, '第二次不应再次请求 provider');
  assert.equal(countTodayRows(), afterFirst, '不应重复插入当天记录');
  assert.equal(r.used_fallback, false);
  assert.equal(r.rate_date, TODAY);
});
