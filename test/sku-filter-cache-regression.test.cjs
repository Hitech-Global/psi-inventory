'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
function section(from,to) {
  const a=source.indexOf(from), b=source.indexOf(to,a+from.length);
  assert.ok(a>=0 && b>a,'expected section not found: '+from);
  return source.slice(a,b);
}
test('reference cache routes only unfiltered master-data GETs',async()=>{
  const requests=[], refCalls=[];
  const window={AppStore:{
    _internal:{REF_ENDPOINTS:{skus:'/api/skus',warehouses:'/api/warehouses'}},
    ref:async key=>{refCalls.push(key);return [{id:'cached'}];}
  }};
  const c={window,apiRaw:async url=>{requests.push(url);return [{id:url}];},
    rpWarmInvalidateForMutation:()=>{}};
  vm.runInNewContext(section('function _refKeyForUrl(url)', '// --- 登录'),c);
  assert.equal(c._refKeyForUrl('/api/skus'),'skus');
  assert.equal(c._refKeyForUrl('/api/skus?keyword=M724'),null);
  assert.equal(c._refKeyForUrl('/api/skus?brand=Netac'),null);
  assert.equal(c._refKeyForUrl('/api/warehouses?country=ID'),null);
  await c.api('/api/skus');
  assert.deepEqual(refCalls,['skus']);
  for(const u of ['/api/skus?keyword=M724','/api/skus?brand=Netac','/api/skus?status=normal&lifecycle_status=stable']) {
    await c.api(u);
  }
  assert.deepEqual(requests,[
    '/api/skus?keyword=M724','/api/skus?brand=Netac',
    '/api/skus?status=normal&lifecycle_status=stable'
  ]);
});

function setup() {
  const requests=[];
  const fixtures=[
    {id:'1',sku_code:'M724',brand:'Redragon',product_name:'Gaming Mouse',status:'normal',lifecycle_status:'stable'},
    {id:'2',sku_code:'M816',brand:'Redragon',product_name:'RGB Mouse',status:'normal',lifecycle_status:'new_launch'},
    {id:'3',sku_code:'NT-U1',brand:'Netac',product_name:'USB Drive',status:'stopped',lifecycle_status:'clearance'}
  ];
  const elements={};
  for(const id of ['content-inner','sku-kw','sku-brand','sku-st','sku-lc','sku-table','sku-batch-bar']) {
    elements[id]={id,value:'',innerHTML:'',listeners:{},
      addEventListener(name,fn){this.listeners[name]=fn;}};
  }
  const document={getElementById:id=>elements[id]||null};
  const window={};
  const c={document,window,URLSearchParams,
    hasPermission:()=>false,
    ensureSkuImportMenu:()=>{},
    updateSkuBatchBar:()=>{},
    showFlash:err=>{throw new Error(err)},
    esc:x=>String(x??''),
    t:(_,fallback,vars)=>typeof fallback==='string'&&vars?
       fallback.replace(/\{(\w+)\}/g,(m,k)=>vars[k]??m):fallback,
    api:async url=>{
      requests.push(url);
      const params=new URL(url,'http://example.local').searchParams;
      return fixtures.filter(s=>{
        const kw=(params.get('keyword')||'').toLowerCase();
        return (!kw||[s.sku_code,s.product_name].some(v=>v.toLowerCase().includes(kw)))
          &&(!params.get('brand')||params.get('brand')===s.brand)
          &&(!params.get('status')||params.get('status')===s.status)
          &&(!params.get('lifecycle_status')||params.get('lifecycle_status')===s.lifecycle_status);
      });
    }
  };
  vm.runInNewContext(section('async function renderSKUs(){','function ensureSkuImportMenu(){')+
    '\n'+section('let _skuLoadSeq=0;','function toggleAllSku(cb){'),c);
  return {c,window,elements,requests};
}
test('brand/state/lifecycle change immediately filters SKU table',async()=>{
  const x=setup();
  await x.c.renderSKUs();
  await Promise.resolve();
  assert.equal(x.requests[0],'/api/skus');
  assert.equal(x.requests[1],'/api/skus');
  x.elements['sku-brand'].value='Netac';
  await x.elements['sku-brand'].listeners.change();
  assert.match(x.elements['sku-table'].innerHTML,/NT-U1/);
  assert.doesNotMatch(x.elements['sku-table'].innerHTML,/M724/);
  assert.equal(x.requests.at(-1),'/api/skus?brand=Netac');
  x.elements['sku-brand'].value='';
  x.elements['sku-st'].value='normal';
  await x.elements['sku-st'].listeners.change();
  assert.equal(x.requests.at(-1),'/api/skus?status=normal');
  assert.doesNotMatch(x.elements['sku-table'].innerHTML,/NT-U1/);
  x.elements['sku-lc'].value='new_launch';
  await x.elements['sku-lc'].listeners.change();
  assert.equal(x.requests.at(-1),'/api/skus?status=normal&lifecycle_status=new_launch');
  assert.doesNotMatch(x.elements['sku-table'].innerHTML,/M724/);
  assert.match(x.elements['sku-table'].innerHTML,/M816/);
});
test('SKU keyword search uses encoded query and combines with brand',async()=>{
  const x=setup();
  x.elements['sku-brand'].value='Redragon';
  x.elements['sku-kw'].value='M724';
  await x.c.loadSKUs();
  assert.equal(x.requests.at(-1),'/api/skus?keyword=M724&brand=Redragon');
  assert.match(x.elements['sku-table'].innerHTML,/M724/);
  assert.doesNotMatch(x.elements['sku-table'].innerHTML,/M816/);
  x.elements['sku-brand'].value='Netac';
  await x.c.loadSKUs();
  assert.doesNotMatch(x.elements['sku-table'].innerHTML,/M724/);
});
test('earlier slow result cannot overwrite later filter selection',async()=>{
  const x=setup(), resolvers=[];
  x.c.api=url=>new Promise(resolve=>resolvers.push({url,resolve}));
  x.elements['sku-brand'].value='Redragon';
  const old=x.c.loadSKUs();
  x.elements['sku-brand'].value='Netac';
  const newer=x.c.loadSKUs();
  resolvers[1].resolve([{id:'2',sku_code:'NETAC-NEW',brand:'Netac'}]);
  await newer;
  resolvers[0].resolve([{id:'1',sku_code:'REDRAGON-OLD',brand:'Redragon'}]);
  await old;
  assert.match(x.elements['sku-table'].innerHTML,/NETAC-NEW/);
  assert.doesNotMatch(x.elements['sku-table'].innerHTML,/REDRAGON-OLD/);
  assert.equal(x.window._skuData[0].brand,'Netac');
});
