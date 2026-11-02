'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'..','po-plan-ui.js'),'utf8');
const start=source.indexOf('function bindPOFacetOutsideClose(){');
const end=source.indexOf('\nfunction selectedPOFacets',start);
assert(start>=0&&end>start,'outside-click handler must exist');
const handlerSource=source.slice(start,end);
assert.match(source,/ensureCss\(\);\s*bindPOFacetOutsideClose\(\);/,'PO page must install the handler');

let registeredType=null,registeredHandler=null,registrations=0;
const facets=[];
const document={
  addEventListener(type,handler){
    registeredType=type;
    registeredHandler=handler;
    registrations++;
  },
  querySelectorAll(selector){
    assert.equal(selector,'.pp-facet[open]');
    return facets.filter(f=>f.open);
  }
};
vm.runInNewContext(
  'let _poFacetOutsideHandlerBound=false;\n'+handlerSource+'\nbindPOFacetOutsideClose();\nbindPOFacetOutsideClose();',
  {document}
);
assert.equal(registeredType,'click','handler should close on ordinary outside clicks');
assert.equal(registrations,1,'handler should be registered only once');

const brand={open:true};
const country={open:true};
facets.push(brand,country);
registeredHandler({target:{closest:selector=>{
  assert.equal(selector,'.pp-facet');
  return brand;
}}});
assert.equal(brand.open,true,'clicking inside current facet should keep it open for multi-select');
assert.equal(country.open,false,'clicking one facet should close other open facets');

country.open=true;
registeredHandler({target:{closest:()=>country}});
assert.equal(brand.open,false,'opening another facet should close the previous one');
assert.equal(country.open,true,'the clicked facet should remain open');

registeredHandler({target:{closest:()=>null}});
assert.equal(brand.open,false);
assert.equal(country.open,false,'clicking anywhere outside all facets should close the dropdown');

console.log('po-plan-facet-outside-close: PASS');
