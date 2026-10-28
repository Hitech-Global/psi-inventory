'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const server = fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
const appSource = fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');

function setup() {
  const routes={};
  const users=[{id:'admin',username:'root',name:'Root',role_id:'role_admin',auth_source:'feishu',
    status:'active',feishu_union_id:'on_admin',email:''},
    {id:'local',username:'breakglass',name:'Recovery',role_id:'role_admin',auth_source:'local',
    status:'active',feishu_union_id:'',email:''}];
  const writes=[],logs=[];
  const context={
    app:{
      get:(url,guard,handler)=>routes['GET '+url]=handler,
      post:(url,guard,handler)=>routes['POST '+url]=handler,
      put:(url,guard,handler)=>routes['PUT '+url]=handler,
      delete:(url,guard,handler)=>routes['DELETE '+url]=handler,
    },
    requireApiPermission:()=>()=>{},
    asyncHandler:fn=>fn,
    genId:()=> 'generated-'+users.length,
    normalizeLanguage:lang=>lang||'zh',
    logOperation:o=>logs.push(o),
    queryOne:(sql,params)=>{
      if(/WHERE username=\?/i.test(sql)&&/id !=/.test(sql)) return users.find(u=>u.username===params[0]&&u.id!==params[1])||null;
      if(/WHERE username\s*=\s*\?/i.test(sql))return users.find(u=>u.username===params[0])||null;
      if(/WHERE feishu_union_id=\?/i.test(sql))return users.find(u=>u.feishu_union_id===params[0])||null;
      if(/WHERE id\s*=\s*\?/i.test(sql))return users.find(u=>u.id===params[0])||null;
      throw Error('unhandled queryOne: '+sql);
    },
    query:(sql)=>{
      if(/FROM user_data_scope/.test(sql))return {rows:[]};
      if(/FROM users/.test(sql))return {rows:users.filter(u=>u.status!=='deleted').map(u=>({...u}))};
      throw Error('unexpected query: '+sql);
    },
    run:(sql,params)=>{
      writes.push({sql,params});
      if(/INSERT INTO users/.test(sql)) {
        users.push({id:params[0],username:params[1],name:params[2],role_id:params[3],
          status:params[4],email:params[5],auth_source:'feishu',feishu_union_id:params[6],
          language_preference:params[7]});
      }
      if(/UPDATE users SET status='deleted'/.test(sql)) {
        const u=users.find(x=>x.id===params[0]);u.status='deleted';u.role_id=null;
      }
      if(/UPDATE users SET username=/.test(sql)) {
        const u=users.find(x=>x.id===params[6]);u.username=params[0];u.name=params[1];
        u.role_id=params[2];u.status=params[3];
      }
      return {changes:1};
    },
  };
  vm.runInNewContext(server,context,{filename:'server.js'});
  async function call(method,pathName,{body={},uid='admin',params}={}) {
    const fn=routes[method+' '+pathName];
    assert.ok(fn,'route not loaded '+method+' '+pathName);
    const response={
      code:200,result:undefined,
      status(code){this.code=code;return this;},
      json(payload){this.result=payload;return this;}
    };
    await fn({body,currentUserId:uid,currentUserName:'Root',params:params||{}},response);
    return response;
  }
  return {routes,users,writes,logs,call};
}
test('create user: requires Feishu union ID; pending without role, no password and audit',async()=>{
  const x=setup();
  let r=await x.call('POST','/api/users',{body:{name:'Alice',username:'alice',email:'alice@company.com',feishu_union_id:'on_alice'}});
  assert.equal(r.code,200);
  assert.equal(r.result.status,'pending');
  assert.equal(r.result.role_id,null);
  const created=x.users.find(u=>u.username==='alice');
  assert.equal(created.auth_source,'feishu');
  assert.equal(created.feishu_union_id,'on_alice');
  assert.equal(created.status,'pending');
  assert.equal(x.logs[0].operation_type,'create_user');
  assert.equal(x.logs[0].new_values.status,'pending');
  assert.ok(!JSON.stringify(x.logs[0]).includes('on_alice'),'audit must not leak Union ID');
  for(const body of [
    {name:'NoID',username:'no-id'},
    {name:'Local',username:'local2',feishu_union_id:'on_1',auth_source:'local'},
    {name:'Admin',username:'admin2',feishu_union_id:'on_2',role_id:'role_admin'},
    {name:'Direct',username:'direct',feishu_union_id:'on_3',status:'active'},
    {name:'Pwd',username:'pw',feishu_union_id:'on_4',password:'123'},
    {name:'Custom',username:'xx',feishu_union_id:'on_5',id:'user_admin'},
  ]) {
    r=await x.call('POST','/api/users',{body});
    assert.equal(r.code,400,JSON.stringify(body));
  }
  r=await x.call('POST','/api/users',{body:{name:'Dup',username:'alice',feishu_union_id:'on_other'}});
  assert.equal(r.code,409);
  r=await x.call('POST','/api/users',{body:{name:'Dup',username:'bob',feishu_union_id:'on_alice'}});
  assert.equal(r.code,409);
});
test('delete: soft-removes normal user and revokes all sessions, preserving historical identity',async()=>{
  const x=setup();
  x.users.push({id:'employee',username:'employee',name:'Employee',status:'active',auth_source:'feishu',role_id:'role_viewer',feishu_union_id:'on_emp'});
  const r=await x.call('DELETE','/api/users/:id',{params:{id:'employee'}});
  assert.equal(r.code,200);
  assert.equal(x.users.find(u=>u.id==='employee').status,'deleted');
  assert.equal(x.users.length,3,'must not delete history-linked user row');
  assert.ok(x.writes.some(o=>/DELETE FROM sessions/.test(o.sql)));
  assert.ok(x.writes.some(o=>/DELETE FROM persistent_logins/.test(o.sql)));
  assert.equal(x.logs.at(-1).operation_type,'remove_user');
  assert.equal(x.logs.at(-1).old_values.username,'employee');
  assert.ok(x.writes.every(o=>!/DELETE FROM users/.test(o.sql)));
  const listed=await x.call('GET','/api/users');
  assert.ok(listed.result.every(u=>u.id!=='employee'));
  assert.ok(listed.result.every(u=>u.feishu_union_id!=='on_admin'),'mask Feishu IDs');
  const again=await x.call('DELETE','/api/users/:id',{params:{id:'employee'}});
  assert.equal(again.code,404);
  const recreate=await x.call('POST','/api/users',{body:{name:'Employee',username:'newemp',feishu_union_id:'on_emp'}});
  assert.equal(recreate.code,409,'removed identity cannot silently re-register');
});
test('protect self/admin/break-glass and forbid revival via PUT',async()=>{
  const x=setup();
  x.users.push({id:'target',username:'target',name:'Target',status:'deleted',auth_source:'feishu',role_id:null,feishu_union_id:'on_target'});
  for(const id of ['admin','local']){
    const response=await x.call('DELETE','/api/users/:id',{params:{id}});
    assert.equal(response.code,400,'should protect '+id);
  }
  const self=await x.call('DELETE','/api/users/:id',{params:{id:'target'},uid:'target'});
  assert.equal(self.code,400);
  const r=await x.call('PUT','/api/users/:id',{params:{id:'target'},body:{username:'target',name:'Target',status:'active'}});
  assert.equal(r.code,409);
  const bad=await x.call('PUT','/api/users/:id',{params:{id:'admin'},body:{username:'root',name:'Root',status:'deleted'}});
  assert.equal(bad.code,400);
});
test('UI exposes add/remove actions and has required Union ID + confirmation',()=>{
  for(const phrase of ['openManagedUserCreate','submitManagedUserCreate','removeManagedUser',
     'feishu_union_id','new-user-submit','renderUsers()','user.remove.confirm']) {
     assert.ok(appSource.includes(phrase),'missing UI '+phrase);
  }
  assert.ok(/role_id!==?['"]role_admin/.test(appSource));
});
