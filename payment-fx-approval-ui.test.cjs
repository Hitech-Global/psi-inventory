'use strict';

/**
 * Payment FX approval-modal UI contract tests（静态字符串契约，不启动浏览器/服务）
 *
 * 背景：真正的付款入口是 审批中心 → viewPayment(id,'finance') 的“通过并付款”modal
 * （pay-final-* 元素 + financeApprove / financeConfirmPay 提交），
 * 而不是 confirmPaid() 的 pay-settle-* modal。
 * 本文件锁死：FX 展示接在真实审批 modal、两个 modal 共用同一套 FX helper、
 * goods 不触发 FX、以及前端 FX 永不进入结算 payload。
 *
 * TEST A — approval modal FX wiring
 * TEST B — shared FX helper（ctx.dateInputId / ctx.amountInputId，非 hardcode）
 * TEST C — goods guard
 * TEST D — settlement truth boundary（payload 无 fxRate/localRate/localAmount）
 * TEST E — stale request guard
 * TEST F — 实际付款金额变化联动本币金额
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP_JS = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');

// 取顶层函数体：从声明处切到下一个顶层 function 声明为止
function fnBody(name) {
  const declRe = new RegExp('^(?:async\\s+)?function\\s+' + name + '\\s*\\(', 'm');
  const m = declRe.exec(APP_JS);
  assert.ok(m, 'app.js must declare top-level function ' + name + '()');
  const start = m.index;
  const nextRe = /^(?:async\s+)?function\s+\w+\s*\(/mg;
  nextRe.lastIndex = start + m[0].length;
  const next = nextRe.exec(APP_JS);
  return APP_JS.slice(start, next ? next.index : APP_JS.length);
}

function countDecl(name) {
  const re = new RegExp('^(?:async\\s+)?function\\s+' + name + '\\s*\\(', 'mg');
  return (APP_JS.match(re) || []).length;
}

const FX_TRUTH_TOKENS = ['fxRate', 'localRate', 'localAmount', 'fx_rate', 'local_rate', 'local_amount'];

describe('Payment FX approval-modal UI contract', () => {

  test('TEST A — approval modal (viewPayment finance/final) FX wiring', () => {
    const vp = fnBody('viewPayment');

    // A1 真实审批 modal 存在实际付款日期输入 pay-final-date，且绑定 onPayDateChanged()
    const dateInputRe = /<input[^>]*id="pay-final-date"[^>]*onchange="onPayDateChanged\(\)"[^>]*>/;
    assert.ok(dateInputRe.test(vp),
      'viewPayment final-payment modal must render pay-final-date with onchange="onPayDateChanged()"');

    // A2 FX 展示容器存在于同一 modal
    assert.ok(/id="pay-fx-display"/.test(vp),
      'viewPayment final-payment modal must contain #pay-fx-display');

    // A3 FX 容器必须紧跟在“实际付款日期”输入之后（UI 要求：日期下面直接显示 FX）
    const dateIdx = vp.indexOf('id="pay-final-date"');
    const fxIdx = vp.indexOf('id="pay-fx-display"');
    assert.ok(dateIdx > -1 && fxIdx > dateIdx,
      '#pay-fx-display must be rendered after the pay-final-date input');
    assert.ok(fxIdx - dateIdx < 400,
      '#pay-fx-display must sit immediately below pay-final-date (got gap ' + (fxIdx - dateIdx) + ' chars)');

    // A4 _finalPayCtx 必须带上本 modal 的 element id 与 prId / paymentCategory
    const ctxRe = /window\._finalPayCtx\s*=\s*\{[^;]*dateInputId\s*:\s*'pay-final-date'[^;]*amountInputId\s*:\s*'pay-final-amount'[^;]*\}/;
    assert.ok(ctxRe.test(vp),
      "viewPayment _finalPayCtx must include dateInputId:'pay-final-date' and amountInputId:'pay-final-amount'");
    assert.ok(/window\._finalPayCtx\s*=\s*\{[^;]*prId\s*:\s*id[^;]*\}/.test(vp),
      'viewPayment _finalPayCtx must carry prId for the payment-fx resolve endpoint');
    assert.ok(/window\._finalPayCtx\s*=\s*\{[^;]*paymentCategory\s*:/.test(vp),
      'viewPayment _finalPayCtx must carry paymentCategory for the goods guard');

    // A5 真实提交路径确认：审批 modal 由 financeApprove / financeConfirmPay 读取 pay-final-*
    const fa = fnBody('financeApprove');
    const fc = fnBody('financeConfirmPay');
    assert.ok(/getElementById\('pay-final-amount'\)/.test(fa) && /getElementById\('pay-final-date'\)/.test(fa),
      'financeApprove must read pay-final-amount / pay-final-date (this is the real approval modal)');
    assert.ok(/getElementById\('pay-final-amount'\)/.test(fc) && /getElementById\('pay-final-date'\)/.test(fc),
      'financeConfirmPay must read pay-final-amount / pay-final-date');
  });

  test('TEST B — one shared FX helper drives both payment modals', () => {
    // B1 helper 只能有一份实现，禁止两套复制
    assert.equal(countDecl('onPayDateChanged'), 1, 'onPayDateChanged() must be declared exactly once (shared helper)');
    assert.equal(countDecl('renderPayFxDisplay'), 1, 'renderPayFxDisplay() must be declared exactly once (shared helper)');

    const dc = fnBody('onPayDateChanged');
    const rp = fnBody('renderPayFxDisplay');

    // B2 日期输入来自 ctx.dateInputId，不再 hardcode pay-settle-date
    assert.ok(/getElementById\(\s*ctx\.dateInputId/.test(dc),
      'onPayDateChanged must resolve the date input via ctx.dateInputId');
    assert.ok(!/getElementById\(\s*['"]pay-settle-date['"]\s*\)/.test(dc),
      'onPayDateChanged must not hardcode getElementById(\'pay-settle-date\')');
    assert.ok(!/getElementById\(\s*['"]pay-final-date['"]\s*\)/.test(dc),
      'onPayDateChanged must not hardcode getElementById(\'pay-final-date\') either');

    // B3 金额输入来自 ctx.amountInputId，不再 hardcode pay-settle-amount
    assert.ok(/getElementById\(\s*ctx\.amountInputId/.test(rp),
      'renderPayFxDisplay must resolve the amount input via ctx.amountInputId');
    assert.ok(!/getElementById\(\s*['"]pay-settle-amount['"]\s*\)/.test(rp),
      'renderPayFxDisplay must not hardcode getElementById(\'pay-settle-amount\')');
    assert.ok(!/getElementById\(\s*['"]pay-final-amount['"]\s*\)/.test(rp),
      'renderPayFxDisplay must not hardcode getElementById(\'pay-final-amount\') either');

    // B4 resolver endpoint 用 ctx.prId
    assert.ok(/ctx\.prId/.test(dc) && /payment-fx\/resolve/.test(dc),
      'onPayDateChanged must POST /api/payment-requests/{ctx.prId}/payment-fx/resolve');

    // B5 旧 confirmPaid modal 也必须提供自己的 element id（共用 helper 的另一半契约）
    const cp = fnBody('confirmPaid');
    const cpCtxRe = /window\._finalPayCtx\s*=\s*\{[^;]*dateInputId\s*:\s*'pay-settle-date'[^;]*amountInputId\s*:\s*'pay-settle-amount'[^;]*\}/;
    assert.ok(cpCtxRe.test(cp),
      "confirmPaid _finalPayCtx must include dateInputId:'pay-settle-date' and amountInputId:'pay-settle-amount'");
    assert.ok(/id="pay-fx-display"/.test(cp), 'confirmPaid modal must still contain #pay-fx-display');
  });

  test('TEST C — goods payment never triggers FX resolve / FX blocker', () => {
    const dc = fnBody('onPayDateChanged');

    // C1 helper 层：goods 直接 return，不发请求
    const guardRe = /if\s*\(\s*ctx\.paymentCategory\s*===\s*['"]goods['"]\s*\)\s*\{?\s*return\s*;?/;
    assert.ok(guardRe.test(dc), 'onPayDateChanged must early-return for paymentCategory === "goods"');
    const guardIdx = dc.search(guardRe);
    const fetchIdx = dc.indexOf('payment-fx/resolve');
    assert.ok(guardIdx > -1 && fetchIdx > guardIdx,
      'goods guard must precede the payment-fx resolve call');

    // C2 审批 modal auto-trigger 仅 non-goods
    const vp = fnBody('viewPayment');
    const autoRe = /payment_category\s*!==\s*['"]goods['"][\s\S]{0,120}?onPayDateChanged\(\)/;
    assert.ok(autoRe.test(vp),
      'viewPayment auto-trigger must be guarded by payment_category !== "goods"');
    // viewPayment 中每一处 onPayDateChanged() 自动调用都必须落在 goods guard 内
    const vpAuto = vp.match(/[^\n]*onPayDateChanged\(\)[^\n]*/g) || [];
    const vpAutoCalls = vpAuto.filter(function (line) { return !/onchange="onPayDateChanged\(\)"/.test(line); });
    assert.ok(vpAutoCalls.length >= 1, 'viewPayment must auto-resolve FX once the modal is rendered');
    vpAutoCalls.forEach(function (line) {
      assert.ok(/payment_category\s*!==\s*['"]goods['"]/.test(line),
        'every viewPayment auto onPayDateChanged() call must be goods-guarded: ' + line.trim());
    });

    // C3 confirmPaid auto-trigger 同样受 goods guard 保护
    const cp = fnBody('confirmPaid');
    const cpAuto = (cp.match(/[^\n]*onPayDateChanged\(\)[^\n]*/g) || [])
      .filter(function (line) { return !/onchange="onPayDateChanged\(\)"/.test(line); });
    cpAuto.forEach(function (line) {
      assert.ok(/payment_category\s*!==\s*['"]goods['"]/.test(line),
        'confirmPaid auto onPayDateChanged() call must be goods-guarded: ' + line.trim());
    });
  });

  test('TEST D — settlement truth boundary: no frontend FX in submit payloads', () => {
    ['financeApprove', 'financeConfirmPay', 'saveConfirmedPayment'].forEach(function (name) {
      const body = fnBody(name);
      FX_TRUTH_TOKENS.forEach(function (tok) {
        assert.ok(body.indexOf(tok) === -1,
          name + '() must not reference "' + tok + '" — settlement rate is backend exactSettlementRate() DB fact');
      });
      assert.ok(!/_finalPayCtx\.fx/.test(body),
        name + '() must not read FX values off window._finalPayCtx');
      assert.ok(!/pay-fx-display/.test(body),
        name + '() must not read the FX display element');
    });
  });

  test('TEST E — stale FX request guard', () => {
    const dc = fnBody('onPayDateChanged');

    assert.ok(/var\s+requestedDate\s*=/.test(dc), 'onPayDateChanged must snapshot requestedDate before awaiting');
    const reqIdx = dc.indexOf('requestedDate');
    const awaitIdx = dc.indexOf('await api(');
    assert.ok(reqIdx > -1 && awaitIdx > reqIdx, 'requestedDate must be captured before the await');

    // success 与 error 两条路径都必须重新读取当前 date input 并比对后才更新
    const compares = dc.match(/!==\s*requestedDate/g) || [];
    assert.ok(compares.length >= 2,
      'both success and error paths must re-check current date input against requestedDate (got ' + compares.length + ')');
    const tailAfterAwait = dc.slice(awaitIdx);
    assert.ok(/dateInput\.value/.test(tailAfterAwait),
      'stale guard must re-read dateInput.value after the await, not reuse the stale local');

    // 比对通过之前不允许写 ctx.fxRate / 渲染
    const firstCompare = dc.indexOf('!==requestedDate') > -1
      ? dc.indexOf('!==requestedDate')
      : dc.search(/!==\s*requestedDate/);
    const assignIdx = dc.indexOf('ctx.fxRate=r.rate');
    assert.ok(assignIdx > firstCompare,
      'ctx.fxRate must only be assigned after the stale-date comparison');
    assert.ok(dc.indexOf('renderPayFxDisplay()') > firstCompare,
      'renderPayFxDisplay() must only run after the stale-date comparison');
  });

  test('TEST F — amount change re-renders local-currency amount', () => {
    const ac = fnBody('onPayAmountChanged');
    assert.ok(/renderPayFxDisplay\(\)/.test(ac),
      'onPayAmountChanged must call renderPayFxDisplay() so 本币金额 follows 实际付款金额');

    // 两个 modal 的金额输入都要绑定 onPayAmountChanged
    const vp = fnBody('viewPayment');
    const cp = fnBody('confirmPaid');
    assert.ok(/<input[^>]*id="pay-final-amount"[^>]*oninput="onPayAmountChanged\(\)"/.test(vp),
      'pay-final-amount must bind oninput="onPayAmountChanged()"');
    assert.ok(/id="pay-settle-amount"[^>]*oninput="onPayAmountChanged\(\)"/.test(cp),
      'pay-settle-amount must bind oninput="onPayAmountChanged()"');

    // 展示层用 ctx.fxRate × 当前输入金额，纯 UX
    const rp = fnBody('renderPayFxDisplay');
    assert.ok(/currentAmt\s*\*\s*ctx\.fxRate/.test(rp),
      'renderPayFxDisplay must compute display-only localAmount = currentAmt * ctx.fxRate');
  });

});
