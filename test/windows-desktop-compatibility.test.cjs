'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const css=(html.match(/<style>([\s\S]*?)<\/style>/i)||[])[1]||'';
assert.ok(css,'application stylesheet must be present');
assert.match(css,/--sidebar-width:\s*220px/);
assert.match(css,/--sidebar-collapsed-width:\s*54px/);
assert.match(css, /\.app-shell\{height:100vh;height:100dvh;min-height:0\}/);
assert.match(css, /\.topbar,.topnav\{min-width:0\}/);
assert.match(css,/scrollbar-gutter:stable/);
assert.match(css, /\.modal-pi\.pi-sidebar-expanded\{left:calc\(var\(--sidebar-width\) \+ 14px\);right:14px;width:auto\}/);
assert.match(css, /\.modal-pi\.pi-sidebar-collapsed\{left:calc\(var\(--sidebar-collapsed-width\) \+ 14px\);right:14px;width:auto\}/);
assert.match(css, /\.payment-category-columns\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
assert.match(css,/@media\(max-width:1340px\)/);
assert.match(css,/@media\(max-width:980px\)/);
assert.match(css,/@media\(max-width:720px\)/);
assert.match(css, /\.form-grid\{grid-template-columns:minmax\(0,1fr\)\}/);
assert.match(app,/var layoutViewport=document\.documentElement;/);
assert.match(app,/layoutViewport\.clientWidth/);
const start=app.indexOf('function initFreezeLineDrag(');
const end=app.indexOf('\nfunction openRpReview(',start);
assert.ok(start>=0&&end>start,'freeze drag function boundaries exist');
const fnSource=app.slice(start,end)+'\nglobalThis.__testInitFreezeLineDrag=initFreezeLineDrag;';
assert.match(fnSource,/addEventListener\('pointerdown'/);
assert.match(fnSource,/addEventListener\('pointermove'/);
assert.match(fnSource,/addEventListener\('pointerup'/);
assert.match(fnSource,/addEventListener\('pointercancel'/);
assert.doesNotMatch(fnSource,/addEventListener\('mousedown'/);

function fakeElement(){
  const listeners={};
  const classes=new Set();
  return {
    listeners,style:{},parentNode:null,children:[],
    classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x)},
    addEventListener(type,fn){(listeners[type]||(listeners[type]=[])).push(fn);},
    removeEventListener(type,fn){listeners[type]=(listeners[type]||[]).filter(x=>x!==fn);},
    dispatch(type,event){(listeners[type]||[]).slice().forEach(fn=>fn(event));},
    appendChild(child){child.parentNode=this;this.children.push(child);},
    removeChild(child){this.children=this.children.filter(x=>x!==child);child.parentNode=null;},
    remove(){if(this.parentNode)this.parentNode.removeChild(this);},
    setPointerCapture(id){this.captured=id;},
    hasPointerCapture(id){return this.captured===id;},
    releasePointerCapture(id){if(this.captured===id)this.captured=null;}
  };
}
function makeContext(){
  const docListeners={};
  const line=fakeElement(),container=fakeElement();
  container.scrollLeft=0;
  container.getBoundingClientRect=()=>({left:100});
  const document={
    body:{style:{userSelect:'text'}},
    createElement:()=>fakeElement(),
    addEventListener(type,fn){(docListeners[type]||(docListeners[type]=[])).push(fn);},
    removeEventListener(type,fn){docListeners[type]=(docListeners[type]||[]).filter(x=>x!==fn);},
    dispatch(type,event){(docListeners[type]||[]).slice().forEach(fn=>fn(event));},
    docListeners
  };
  const winListeners={};
  const window={
    addEventListener(type,fn){(winListeners[type]||(winListeners[type]=[])).push(fn);},
    removeEventListener(type,fn){winListeners[type]=(winListeners[type]||[]).filter(x=>x!==fn);}
  };
  const calls=[];
  const context={document,window,setFreezeColKey:(tab,key)=>calls.push(['freeze',tab,key]),applyChannelFreezeColumns:(...args)=>calls.push(['apply',...args])};
  vm.runInNewContext(fnSource,context,{timeout:1000});
  context.__testInitFreezeLineDrag(line,container,'online',['sku','model','month'],[100,150,200],[0,100,250]);
  return {line,container,document,window,calls};
}
{
  const x=makeContext();
  x.line.dispatch('pointerdown',{pointerId:7,pointerType:'mouse',isPrimary:true,button:0,clientX:360,preventDefault(){},stopPropagation(){}});
  assert.equal(x.document.body.style.userSelect,'none');
  x.document.dispatch('pointermove',{pointerId:7,clientX:360});
  x.document.dispatch('pointerup',{pointerId:7,clientX:360});
  assert.deepEqual(x.calls.map(c=>c.slice(0,3)),[['freeze','online','model'],['apply','online',['sku','model','month']]]);
  assert.equal(x.document.body.style.userSelect,'text','prior selection style is restored');
  assert.equal(x.line.classList.contains('dragging'),false);
  assert.equal(x.container.children.length,0);
  assert.equal(x.document.docListeners.pointermove.length,0);
}
{
  const x=makeContext();
  x.line.dispatch('pointerdown',{pointerId:8,pointerType:'pen',isPrimary:true,button:0,clientX:360,preventDefault(){},stopPropagation(){}});
  x.document.dispatch('pointercancel',{pointerId:8});
  assert.equal(x.calls.length,0,'cancelled pointer must not change frozen columns');
  assert.equal(x.document.body.style.userSelect,'text');
  assert.equal(x.container.children.length,0);
}
{
  const x=makeContext();
  x.line.dispatch('pointerdown',{pointerId:9,pointerType:'touch',isPrimary:true,button:0,clientX:360,preventDefault(){},stopPropagation(){}});
  x.document.dispatch('keydown',{key:'Escape'});
  assert.equal(x.calls.length,0,'Escape cancels pointer drag');
  assert.equal(x.document.body.style.userSelect,'text');
}
console.log('windows-desktop-compatibility: PASS');
