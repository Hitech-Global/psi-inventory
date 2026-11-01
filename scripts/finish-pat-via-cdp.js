'use strict';

/**
 * 通过已运行的 Edge CDP 实例创建 classic PAT 并把令牌取回。
 * 依赖 scripts/create-pat-via-cdp.js 启动的实例（或任何暴露 CDP 的 Edge）。
 *
 * 用法：node scripts/finish-pat-via-cdp.js [cdpPort]
 * 输出：JSON，含 token 或 error
 */

const http = require('http');
const WebSocket = require('/tmp/node_modules/ws');

const PORT = Number(process.argv[2] || process.env.PAT_CDP_PORT || 9455);

function log(message) {
  process.stderr.write(`[pat-cdp] ${message}\n`);
}

function httpJson(port, pathName) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: pathName, agent: false, timeout: 8000 }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (error) { reject(error); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
  });
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    ws.on('message', raw => {
      let message;
      try { message = JSON.parse(raw.toString()); } catch { return; }
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
      }
    });
  }

  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    return new Cdp(ws);
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

async function evaluate(client, sessionId, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true, userGesture: true,
  }, sessionId);
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || '脚本执行失败');
  }
  return result.result ? result.result.value : undefined;
}

async function main() {
  const targets = await httpJson(PORT, '/json/list');
  const page = targets.find(t => t.type === 'page' && t.url.includes('github.com'));
  if (!page) {
    console.log(JSON.stringify({
      ok: false,
      error: '找不到 GitHub 页面',
      pages: targets.filter(t => t.type === 'page').map(t => t.url),
    }));
    process.exitCode = 1;
    return;
  }
  log(`目标页面: ${page.url}`);

  const client = await Cdp.connect(page.webSocketDebuggerUrl);
  const { sessionId } = await client.send('Target.attachToTarget', { targetId: page.id, flatten: true });
  await client.send('Runtime.enable', {}, sessionId);
  await client.send('Page.enable', {}, sessionId);

  const currentUrl = await evaluate(client, sessionId, 'location.href');
  log(`当前: ${currentUrl}`);

  if (currentUrl.includes('/login')) {
    console.log(JSON.stringify({
      ok: false, requires_login: true,
      message: '该实例没有 GitHub 登录态',
    }));
    process.exitCode = 1;
    return;
  }

  // ---- 先看清页面结构，避免盲填 --------------------------------------------
  const probe = await evaluate(client, sessionId, `(() => {
    const inputs = Array.from(document.querySelectorAll('input')).map(i => ({
      id: i.id, name: i.name, type: i.type,
      checked: i.checked,
      label: (i.closest('label')?.textContent || '').trim().slice(0, 40),
    }));
    const selects = Array.from(document.querySelectorAll('select')).map(s => ({
      id: s.id, name: s.name,
      options: Array.from(s.options).map(o => ({ v: o.value, t: o.textContent.trim() })).slice(0, 12),
    }));
    const buttons = Array.from(document.querySelectorAll('button[type="submit"], input[type="submit"]'))
      .map(b => ({ tag: b.tagName, id: b.id, text: (b.textContent || b.value || '').trim() }));
    return { inputs, selects, buttons, title: document.title };
  })()`);
  log(`表单结构: ${JSON.stringify(probe).slice(0, 1200)}`);

  // ---- 填表 -----------------------------------------------------------------
  const fill = await evaluate(client, sessionId, `(() => {
    const setValue = (el, value) => {
      if (!el) return false;
      const proto = el.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    };
    const out = {};

    // Note 字段的 id 是 oauth_access_description
    const note = document.querySelector('#oauth_access_description, input[name="oauth_access[description]"]');
    // 用带时间戳的名字，便于区分并撤销；重名时 GitHub 会自动加后缀。
    const noteValue = 'workbuddy-push-' + new Date().toISOString().slice(0, 10);
    out.noteValue = noteValue;
    out.note = setValue(note, noteValue);

    // Expiration：classic PAT 默认 30 天，用页面上的自定义日期输入框显式设为 30 天后，
    // 避免依赖站点默认值随时间变化。
    const custom = document.querySelector('#oauth_access_custom_expires_at, input[name="oauth_access[custom_expires_at]"]');
    if (custom) {
      const d = new Date();
      d.setDate(d.getDate() + 30);
      const iso = d.toISOString().slice(0, 10);
      setValue(custom, iso);
      out.expiresAt = iso;
    } else {
      const expiry = document.querySelector('select[name="oauth_access[default_expires_at]"]');
      if (expiry) {
        const opt = Array.from(expiry.options).find(o => /30 days/i.test(o.textContent || ''));
        if (opt) { setValue(expiry, opt.value); out.expiration = opt.textContent.trim(); }
      }
    }

    // scope 勾选框：name 均为 oauth_access[scopes][]，靠 label 文本区分。
    // label 文本含大量空白与说明，取第一行非空内容作为 scope 名。
    const scopeName = (box) => {
      const raw = (box.closest('label')?.textContent || box.parentElement?.textContent || '');
      const firstLine = raw.split('\\n').map(s => s.trim()).find(Boolean) || '';
      return firstLine.trim();
    };
    const boxes = Array.from(document.querySelectorAll('input[name="oauth_access[scopes][]"]'));
    out.scopeCount = boxes.length;
    for (const scope of ['repo', 'workflow']) {
      const box = boxes.find(b => scopeName(b) === scope);
      if (!box) { out[scope] = 'missing'; continue; }
      if (!box.checked) { box.click(); out[scope] = 'checked'; } else { out[scope] = 'already'; }
    }

    const submit = document.querySelector('button[type="submit"], input[type="submit"]');
    out.submitText = submit ? (submit.textContent || submit.value || '').trim() : null;
    return out;
  })()`);
  log(`填表: ${JSON.stringify(fill)}`);

  if (fill.repo === 'missing' || fill.workflow === 'missing') {
    console.log(JSON.stringify({
      ok: false,
      error: '未定位到 repo / workflow 勾选框',
      fill,
      probe,
    }));
    process.exitCode = 1;
    return;
  }

  // ---- 提交 -----------------------------------------------------------------
  // 只点创建表单自己的提交按钮。GitHub 的令牌列表页每行都带一个
  // "I understand, delete this token" 按钮，那是删除确认框，点它会误入删除流程。
  const submitted = await evaluate(client, sessionId, `(() => {
    const form = document.querySelector('form[action*="/settings/tokens"], form#new_oauth_access');
    const scope = form || document;
    const buttons = Array.from(scope.querySelectorAll('button[type="submit"], input[type="submit"]'));
    const safe = buttons.filter(b => {
      const text = (b.textContent || b.value || '').trim().toLowerCase();
      return !/delete|revoke|删除/.test(text);
    });
    const target = safe[0];
    if (!target) return { ok: false, candidates: buttons.map(b => (b.textContent || b.value || '').trim()) };
    const text = (target.textContent || target.value || '').trim();
    target.click();
    return { ok: true, text };
  })()`);
  log(`提交: ${JSON.stringify(submitted)}`);
  if (!submitted.ok) {
    console.log(JSON.stringify({ ok: false, error: '未找到安全的提交按钮', submitted }));
    process.exitCode = 1;
    return;
  }
  await sleep(6000);

  const afterUrl = await evaluate(client, sessionId, 'location.href');
  log(`提交后: ${afterUrl}`);

  // ---- 取令牌 ---------------------------------------------------------------
  // 创建成功后 GitHub 会跳到 /settings/tokens 并弹出一次性展示框，
  // 令牌在 #new-token 这个 textarea/input 里。
  const token = await evaluate(client, sessionId, `(() => {
    const direct = document.querySelector('#new-token, input#new-token, textarea#new-token');
    if (direct) {
      const v = (direct.value || direct.textContent || '').trim();
      if (/^(gh[pousr]_|github_pat_)/.test(v)) return v;
    }
    const anyInput = Array.from(document.querySelectorAll('input, textarea'))
      .map(el => (el.value || '').trim())
      .find(v => /^(gh[pousr]_|github_pat_)[A-Za-z0-9_]{30,}$/.test(v));
    if (anyInput) return anyInput;
    const text = document.body.innerText || '';
    const m = text.match(/(gh[pousr]_[A-Za-z0-9_]{30,}|github_pat_[A-Za-z0-9_]{30,})/);
    return m ? m[1] : null;
  })()`);

  if (token) {
    console.log(JSON.stringify({ ok: true, token, url: afterUrl }));
    return;
  }

  const pageText = await evaluate(client, sessionId, 'document.body.innerText.slice(0, 1200)');
  console.log(JSON.stringify({ ok: false, error: '提交后未取到令牌', url: afterUrl, pageText }));
  process.exitCode = 1;
}

main().catch(error => {
  console.log(JSON.stringify({ ok: false, error: error.message }));
  process.exitCode = 1;
});
