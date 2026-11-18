'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  patchAppSource,
  patchIndexSource,
  APP_MARKER,
  APP_CACHE_VERSION
} = require('../scripts/logistics-detail-loading-hotfix.cjs');

const app = [
  'async function viewLogDetail(id){',
  '  try{',
  "    const l=await api('/api/logistics-batches/'+id);",
  '    let plData=null;',
  "    if(l.pl_id){plData=await api('/api/packing-lists/'+l.pl_id);}",
  "    const plItems=(plData&&plData.items)||[];",
  "    openModal('detail','body');",
  "  }catch(e){showToast(e.message,'danger')}",
  '}',
  'async function backfillArrival(batchId){',
  '}'
].join('\n');

const once = patchAppSource(app);
const twice = patchAppSource(once);
assert.equal(twice, once, 'logistics detail loading patch must be idempotent');
assert.ok(once.includes(APP_MARKER), 'loading marker must be installed');
assert.ok(
  once.indexOf('openModal(__logLoadingTitle') < once.indexOf("api('/api/logistics-batches/'+id)"),
  'loading modal must open before the logistics API request'
);
assert.match(once, /data-request-id=/, 'loading shell must carry a request token');
assert.match(once, /classList\.contains\('show'\)/, 'closed or replaced modals must not be reopened by stale requests');
assert.match(once, /api\('\/api\/packing-lists\/'\+l\.pl_id\)/, 'PL detail must still load after logistics detail');
assert.match(once, /function retryLogDetail\(\)/, 'failed requests must expose a retry action');
assert.match(once, /Unable to load logistics details/, 'English error state must be explicit');
assert.match(once, /Loading logistics details/, 'English loading text must be available');
assert.match(once, /Memuat detail logistik/, 'Indonesian loading text must be available');
assert.match(once, /Gagal memuat detail logistik/, 'Indonesian error text must be available');
assert.ok(once.includes('\u6b63\u5728\u52a0\u8f7d\u7269\u6d41\u8be6\u60c5'), 'Chinese loading text must be available');
assert.ok(once.includes('\u7269\u6d41\u8be6\u60c5\u52a0\u8f7d\u5931\u8d25'), 'Chinese error state must be explicit');
assert.match(once, /aria-busy="true"/, 'loading state must be announced to assistive technology');
assert.match(once, /aria-busy','false'/, 'error state must clear aria-busy');
new Function('window','document','getLang','openModal','api','esc',once);

const html = '<!doctype html><html><head><script src="app.js?v=old"></script></head><body></body></html>';
const htmlOnce = patchIndexSource(html);
const htmlTwice = patchIndexSource(htmlOnce);
assert.equal(htmlTwice, htmlOnce, 'cache-bust patch must be idempotent');
assert.ok(htmlOnce.includes('app.js?v=' + APP_CACHE_VERSION), 'cache version must be present');
assert.match(htmlOnce, /app\.js\?v=20261118-4/, 'frontend cache version must be bumped');

const repoRoot = path.join(__dirname, '..');
const liveApp = fs.readFileSync(path.join(repoRoot, 'app.js'), 'utf8');
const liveIndex = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
assert.ok(liveApp.includes(APP_MARKER), 'live logistics detail handler must include immediate loading');
assert.match(liveApp, /window\.__logDetailRetry=/, 'live handler must retain a retry target');
assert.match(liveApp, /log-detail-loading/, 'live handler must use the logistics-specific loading node');
assert.ok(liveIndex.includes('ci-detail-loading'), 'existing Mac-style CI loading styles must be present for reuse');
assert.match(liveIndex, /app\.js\?v=20261118-4/, 'live frontend must be cache-busted');

console.log('logistics-detail-loading hotfix: PASS');


const vm = require('node:vm');
async function verifyRuntimeLoadingAndErrorStates() {
  const fnStart = liveApp.indexOf('function retryLogDetail(){');
  const fnEnd = liveApp.indexOf('async function backfillArrival(batchId){', fnStart);
  assert.ok(fnStart >= 0 && fnEnd > fnStart, 'live logistics detail function block must be extractable');
  const fnSource = liveApp.slice(fnStart, fnEnd);

  let loadingNode = null;
  let opened = null;
  const overlay = { classList: { contains: name => name === 'show' } };
  const pendingContext = {
    window: {},
    document: {
      querySelector: () => loadingNode,
      getElementById: () => overlay
    },
    getLang: () => 'zh',
    openModal: (title, body, footer, size) => {
      opened = { title, body, footer, size };
      loadingNode = { className: 'ci-detail-loading log-detail-loading', setAttribute() {}, innerHTML: '' };
    },
    api: () => new Promise(() => {}),
    esc: value => String(value)
  };
  vm.createContext(pendingContext);
  vm.runInContext(fnSource + '\nglobalThis.__viewLogDetailTest=viewLogDetail;', pendingContext);
  pendingContext.__viewLogDetailTest('batch-loading');
  assert.ok(opened, 'loading modal must be opened synchronously on click');
  assert.ok(opened.body.includes('\u6b63\u5728\u52a0\u8f7d\u7269\u6d41\u8be6\u60c5'), 'loading message must be visible before the API resolves');
  assert.equal(opened.size, 'modal-ci-create', 'loading must retain the existing logistics detail modal size');

  let errorNode = null;
  const errorContext = {
    window: {},
    document: {
      querySelector: () => errorNode,
      getElementById: () => overlay
    },
    getLang: () => 'zh',
    openModal: (title, body, footer, size) => {
      errorNode = { className: '', attrs: {}, innerHTML: '', setAttribute(key, value) { this.attrs[key] = value; } };
    },
    api: () => Promise.reject(new Error('network unavailable')),
    esc: value => String(value)
  };
  vm.createContext(errorContext);
  vm.runInContext(fnSource + '\nglobalThis.__viewLogDetailTest=viewLogDetail;', errorContext);
  await errorContext.__viewLogDetailTest('batch-error');
  assert.match(errorNode.className, /ci-detail-error-state/, 'failed loading must switch to the visible error state');
  assert.ok(errorNode.innerHTML.includes('retryLogDetail()'), 'failed loading must expose a retry action');
  assert.ok(errorNode.innerHTML.includes('network unavailable'), 'failed loading must show the actual error message');
}
verifyRuntimeLoadingAndErrorStates().then(() => {
  console.log('logistics detail runtime loading/error states: PASS');
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
