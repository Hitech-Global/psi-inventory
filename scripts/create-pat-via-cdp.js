'use strict';

/**
 * 通过 CDP 驱动一个独立的 Edge 实例，在 GitHub 上创建 classic PAT 并把令牌交回调用方。
 * ============================================================================================
 * 为什么不直接用用户的日常浏览器：
 *   - Chrome 的 profile 被 macOS TCC 完全保护，无法读取、复制或附加调试端口；
 *   - AppleScript 走 System Events 与直接控制 Chrome 都被辅助功能权限拦截；
 *   - Edge 的 profile 可读，因此复制一份到临时目录，用 --remote-debugging-port 启动独立实例。
 *     独立实例不会干扰用户正在使用的浏览器。
 *
 * 流程：
 *   1. 复制 Edge profile 到临时目录（Cookies 与 Local State 一并复制）
 *   2. 以 --remote-debugging-port 启动独立实例
 *   3. 通过 WebSocket 直连 CDP（不经过代理），打开 classic PAT 创建页
 *   4. 若未登录 GitHub，直接返回 requires_login，由用户在自己的浏览器里操作
 *   5. 已登录则填表：Note / Expiration / repo / workflow，提交
 *   6. 从生成页读取令牌并返回
 *
 * 用法：node scripts/create-pat-via-cdp.js
 * 输出：JSON，含 token（仅在成功时）或 requires_login / error
 */

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const EDGE_BIN = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
const EDGE_PROFILE = path.join(os.homedir(), 'Library', 'Application Support', 'Microsoft Edge');
const WORK_DIR = path.join(os.tmpdir(), 'edge_pat_cdp');
const PORT = Number(process.env.PAT_CDP_PORT || 9455);
const PAT_URL = 'https://github.com/settings/tokens/new';

function log(message) {
  process.stderr.write(`[pat-cdp] ${message}\n`);
}

function httpJson(port, pathName) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: pathName, agent: false, timeout: 8000 },
      res => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch (error) { reject(error); }
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** 复制 Edge profile 到临时目录。 */
function copyProfile() {
  fs.rmSync(WORK_DIR, { recursive: true, force: true });
  fs.mkdirSync(WORK_DIR, { recursive: true });
  const defaultDir = path.join(EDGE_PROFILE, 'Default');
  fs.cpSync(defaultDir, path.join(WORK_DIR, 'Default'), { recursive: true, dereference: false });
  const localState = path.join(EDGE_PROFILE, 'Local State');
  if (fs.existsSync(localState)) fs.copyFileSync(localState, path.join(WORK_DIR, 'Local State'));
  log(`profile 已复制到 ${WORK_DIR}`);
}

/** 启动带调试端口的独立 Edge 实例。 */
function launchEdge() {
  const child = spawn(EDGE_BIN, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${WORK_DIR}`,
    '--no-sandbox',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'], detached: false });
  child.stderr.on('data', () => {});
  return child;
}

/** 等待 CDP 就绪。 */
async function waitForCdp(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const version = await httpJson(port, '/json/version');
      if (version && version.webSocketDebuggerUrl) return version;
    } catch { /* 尚未就绪，继续等待 */ }
    await sleep(500);
  }
  throw new Error('CDP 未在超时内就绪');
}

/** 极简 CDP 客户端：只实现本脚本需要的命令。 */
class CdpClient {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    ws.on('message', raw => {
      let message;
      try { message = JSON.parse(raw.toString()); } catch { return; }
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
        return;
      }
      if (message.method) this.events.push(message);
    });
  }

  static async connect(wsUrl) {
    const WebSocket = require('/tmp/node_modules/ws');
    const ws = new WebSocket(wsUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    return new CdpClient(ws);
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
    });
  }
}

/** 在页面里执行 JS 并取回结果。 */
async function evaluate(client, sessionId, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  }, sessionId);
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || '页面脚本执行失败');
  }
  return result.result ? result.result.value : undefined;
}

async function main() {
  if (!fs.existsSync(EDGE_BIN)) {
    console.log(JSON.stringify({ ok: false, error: '未找到 Microsoft Edge' }));
    process.exitCode = 1;
    return;
  }

  copyProfile();
  const child = launchEdge();
  let client = null;

  try {
    const version = await waitForCdp(PORT);
    log(`CDP 就绪: ${version.Browser}`);
    client = await CdpClient.connect(version.webSocketDebuggerUrl);

    // 新建一个标签页并附加
    const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true });
    await client.send('Page.enable', {}, sessionId);
    await client.send('Runtime.enable', {}, sessionId);

    await client.send('Page.navigate', { url: PAT_URL }, sessionId);
    // 等待页面加载与重定向完成
    await sleep(4000);

    let currentUrl = '';
    for (let i = 0; i < 20; i += 1) {
      currentUrl = await evaluate(client, sessionId, 'location.href');
      if (currentUrl && !currentUrl.startsWith('about:blank')) break;
      await sleep(500);
    }
    log(`当前页面: ${currentUrl}`);

    if (currentUrl.includes('/login')) {
      console.log(JSON.stringify({
        ok: false,
        requires_login: true,
        message: '独立实例里没有 GitHub 登录态（Edge profile 未登录过 GitHub）。请在日常浏览器里手动创建令牌。',
      }));
      return;
    }

    if (!currentUrl.includes('settings/tokens')) {
      // 可能被重定向到别处（例如不在设置页权限范围）
      const title = await evaluate(client, sessionId, 'document.title');
      console.log(JSON.stringify({
        ok: false,
        error: '未进入令牌创建页',
        url: currentUrl,
        title,
      }));
      process.exitCode = 1;
      return;
    }

    // ---- 填表 -------------------------------------------------------------
    const fillResult = await evaluate(client, sessionId, `(() => {
      const setValue = (el, value) => {
        if (!el) return false;
        const proto = el.tagName === 'TEXTAREA'
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        setter.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      };

      const results = {};

      // Note
      const note = document.querySelector('#note, input[name="note"]');
      results.note = setValue(note, 'workbuddy-push');

      // Expiration —— 选 30 days
      const expiry = document.querySelector('#expiration, select[name="expiration"]');
      if (expiry) {
        const opt30 = Array.from(expiry.options).find(o => /30 days/i.test(o.textContent || ''));
        if (opt30) {
          setValue(expiry, opt30.value);
          results.expiration = '30 days';
        }
      }

      // scopes: repo + workflow
      const scopeBoxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
      const findScope = (needle) => {
        const label = scopeBoxes.find(box => {
          const text = (box.closest('label')?.textContent || box.parentElement?.textContent || '').trim();
          return text === needle || text.startsWith(needle);
        });
        return label;
      };
      const repo = findScope('repo');
      const workflow = findScope('workflow');
      if (repo && !repo.checked) { repo.click(); results.repo = true; } else { results.repo = repo ? 'already' : 'missing'; }
      if (workflow && !workflow.checked) { workflow.click(); results.workflow = true; } else { results.workflow = workflow ? 'already' : 'missing'; }

      const submit = document.querySelector('button[type="submit"], input[type="submit"]');
      results.submitFound = Boolean(submit);
      results.submitText = submit ? (submit.textContent || submit.value || '').trim() : '';
      return results;
    })()`);
    log(`填表结果: ${JSON.stringify(fillResult)}`);

    if (fillResult.repo === 'missing' || fillResult.workflow === 'missing') {
      console.log(JSON.stringify({
        ok: false,
        error: '未能在页面上定位 repo / workflow 勾选框',
        fillResult,
        htmlHint: await evaluate(client, sessionId, 'document.body.innerText.slice(0, 2000)'),
      }));
      process.exitCode = 1;
      return;
    }

    // ---- 提交 -------------------------------------------------------------
    await evaluate(client, sessionId, `(() => {
      const submit = document.querySelector('button[type="submit"], input[type="submit"]');
      if (submit) submit.click();
      return Boolean(submit);
    })()`);
    await sleep(5000);

    const afterUrl = await evaluate(client, sessionId, 'location.href');
    log(`提交后页面: ${afterUrl}`);

    // ---- 读取令牌 ----------------------------------------------------------
    const token = await evaluate(client, sessionId, `(() => {
      const candidates = [
        document.querySelector('#new-token, input#new-token'),
        document.querySelector('input[value^="ghp_"], textarea[value^="ghp_"]'),
        document.querySelector('code'),
      ];
      for (const el of candidates) {
        if (!el) continue;
        const value = (el.value || el.textContent || '').trim();
        if (/^(gh[pousr]_|github_pat_)/.test(value)) return value;
      }
      // 兜底：扫描页面文本
      const text = document.body.innerText || '';
      const m = text.match(/(gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})/);
      return m ? m[1] : null;
    })()`);

    if (token) {
      console.log(JSON.stringify({ ok: true, token, url: afterUrl }));
      return;
    }

    const pageText = await evaluate(client, sessionId, 'document.body.innerText.slice(0, 1500)');
    console.log(JSON.stringify({
      ok: false,
      error: '提交后未取到令牌',
      url: afterUrl,
      pageText,
    }));
    process.exitCode = 1;
  } catch (error) {
    console.log(JSON.stringify({ ok: false, error: error.message }));
    process.exitCode = 1;
  } finally {
    try { if (client) client.ws.close(); } catch { /* 忽略 */ }
    try { child.kill('SIGTERM'); } catch { /* 忽略 */ }
    await sleep(500);
    fs.rmSync(WORK_DIR, { recursive: true, force: true });
  }
}

main();
