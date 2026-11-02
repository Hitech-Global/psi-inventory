'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'..');
const perf=fs.readFileSync(path.join(root,'app-perf.js'),'utf8');
const app=fs.readFileSync(path.join(root,'app.js'),'utf8');

function deferred(){
  let resolve,reject;
  const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}
function response(data){return {ok:true,status:200,json:async()=>data};}
function cacheHarness(){
  const requests=[];
  const window={};
  const fetch=(url)=>{const d=deferred();requests.push({url,...d});return d.promise;};
  vm.runInNewContext(perf,{window,fetch,Map,Set,Promise,URLSearchParams,setTimeout,clearTimeout});
  assert(window.AppStore,'AppStore must initialize');
  return {store:window.AppStore,requests};
}

(async()=>{
  // A pre-write, in-flight GET must not be reused or reinsert itself into cache after a PUT.
  {
    const {store,requests}=cacheHarness();
    const old=store.ref('skus');
    assert.equal(requests.length,1);
    store.onMutation('PUT','/api/skus/sku-1',{product_name:'Changed'});
    const fresh=store.ref('skus');
    assert.equal(requests.length,2,'post-write GET must start a new request');
    requests[1].resolve(response([{id:'sku-1',product_name:'Changed'}]));
    assert.equal((await fresh)[0].product_name,'Changed');
    requests[0].resolve(response([{id:'sku-1',product_name:'Old'}]));
    assert.equal((await old)[0].product_name,'Old');
    assert.equal((await store.ref('skus'))[0].product_name,'Changed','old response must not overwrite newer cache');
    assert.equal(requests.length,2);
  }
  // Session clear must also reject stale in-flight cache writes (different logged-in user).
  {
    const {store,requests}=cacheHarness();
    const pending=store.ref('skus');
    store.clearSession();
    requests[0].resolve(response([{id:'private-old'}]));
    await pending;
    const newUser=store.ref('skus');
    assert.equal(requests.length,2,'logout must prevent old-user reference cache reuse');
    requests[1].resolve(response([{id:'new-user'}]));
    assert.equal((await newUser)[0].id,'new-user');
  }
  // The SKU page's save-specific refresh bypasses the reference cache, but ordinary
  // filter operations retain their fast shared GET route.
  {
    const begin=app.indexOf('let _skuLoadSeq=0;');
    const end=app.indexOf('\nfunction toggleAllSku(',begin);
    assert(begin>=0&&end>begin);
    const source=app.slice(begin,end);
    const table={innerHTML:''};
    const stubs={};
    const document={getElementById:id=>id==='sku-table'?table:stubs[id]||null};
    const window={};
    const calls=[];
    const oldData=[{id:'id-1',sku_code:'SKU-1',product_name:'Old',status:'normal',lifecycle_status:'stable'}];
    const newData=[{id:'id-1',sku_code:'SKU-1',product_name:'Updated',status:'normal',lifecycle_status:'stable'}];
    const context={
      document,window,URLSearchParams,
      api:async url=>{calls.push('api '+url);return oldData;},
      apiRaw:async url=>{calls.push('apiRaw '+url);return newData;},
      t:(_key,fallback)=>fallback,
      esc:x=>String(x||''),hasPermission:()=>false,updateSkuBatchBar(){},showFlash(){},
    };
    vm.runInNewContext(source+'\nglobalThis.__loadSKUs=loadSKUs;',context,{timeout:1000});
    assert.equal(await context.__loadSKUs(),true);
    assert(table.innerHTML.includes('Old'));
    assert.equal(await context.__loadSKUs(true),true);
    assert(table.innerHTML.includes('Updated'),'save refresh must repaint the table using fresh server data');
    assert.equal(window._skuData[0].product_name,'Updated');
    assert.deepEqual(calls,['api /api/skus','apiRaw /api/skus']);
  }
  // Save confirmation comes AFTER the force-fresh render, not before it.
  {
    const begin=app.indexOf('async function saveSKU(id){');
    const end=app.indexOf('\nasync function deleteSKU(',begin);
    assert(begin>=0&&end>begin);
    const source=app.slice(begin,end);
    const events=[];
    const form={querySelectorAll:(_selector,callback)=>{
      [{name:'sku_code',value:'SKU-1'},{name:'product_name',value:'Updated'}].forEach(callback);
    }};
    const document={querySelector:selector=>{
      assert.equal(selector,'.form-grid');
      return form;
    }};
    const fn=new Function('document','api','closeModal','loadSKUs','showToast','t',
      source+';return saveSKU;')(
      document,async(url,method,body)=>{
        events.push('saved');
        assert.equal(method,'PUT');
        assert.equal(url,'/api/skus/id-1');
        assert.equal(body.product_name,'Updated');
      },
      ()=>events.push('closed'),
      async(force)=>{assert.equal(force,true);events.push('refreshed');return true;},
      (_msg,kind)=>events.push('toast:'+kind),
      (_key,fallback)=>fallback
    );
    await fn('id-1');
    assert.deepEqual(events,['saved','closed','refreshed','toast:success']);
  }
  // The edit form must not promise to change SKU identity when the server's PUT
  // intentionally disallows that column due to linked business documents.
  assert.match(app, /id&&f\.n==='sku_code'\?' readonly title="SKU编码不可直接修改，以免影响关联单据"'/);

  console.log('sku-master-save-refresh: PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
