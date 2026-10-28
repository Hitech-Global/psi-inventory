'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const moduleUnderTest=require('../external-user-invitations');
function fixture(){
 const routes=new Map(),guards=new Map(),invites=[],users=[],sessions=[],audit=[];
 const db={
  queryOne(sql,params){
   if(sql.includes('FROM external_user_invites'))return invites.find(x=>x.token_hash===params[0])||null;
   if(sql.includes('FROM users')&&sql.includes('LOWER(email)')){
     const found=users.filter(u=>u.email===params[0]&&u.auth_source==='external'&&u.status!=='deleted');
     return (sql.includes('ORDER BY')?found.slice(-1)[0]:found[0])||null;
   }
   throw Error('Unexpected SQL '+sql);
  },
  run(sql,params){
   if(sql.startsWith('CREATE '))return {changes:0};
   if(sql.startsWith('INSERT INTO external_user_invites')){
    invites.push({id:params[0],token_hash:params[1],recipient_name:params[2],recipient_email:params[3],issued_by:params[4],created_at:params[5],expires_at:params[6],used_at:'',user_id:'',revoked_at:''});
    return {changes:1};
   }
   if(sql.startsWith('UPDATE external_user_invites')){
    const i=invites.find(x=>x.token_hash===params[2]&&!x.used_at&&!x.revoked_at);
    if(!i)return {changes:0};i.used_at=params[0];i.user_id=params[1];return {changes:1};
   }
   if(sql.startsWith('INSERT INTO users')){
    users.push({id:params[0],username:params[1],name:params[2],role_id:params[3],status:params[4],email:params[5],auth_source:params[6],password_hash:params[7]});
    return {changes:1};
   }
   throw Error('Unexpected write '+sql);
  }
 };
 const transactions=[];
 moduleUnderTest.ensureSchema(db.run);
 moduleUnderTest.register({
  post:(url,guard,handler)=>{routes.set(url,handler||guard); guards.set(url,handler?guard:null);}
 },{
  ...db,
  transaction:(fn)=>{const inviteSnapshot=invites.map(x=>({...x}));const userSnapshot=users.map(x=>({...x}));
   try{transactions.push('begin');const value=fn();transactions.push('commit');return value;}
   catch(e){invites.splice(0,invites.length,...inviteSnapshot);users.splice(0,users.length,...userSnapshot);transactions.push('rollback');throw e;}
  },
  genId:prefix=>prefix+'_'+(invites.length+users.length+1),
  hashPassword:pw=>'hashed_'+pw,
  verifyPassword:(plain,hash)=>hash==='hashed_'+plain,
  createSessionForUser:(res,user)=>{sessions.push(user.id);res.cookie('session','mock');},
  auditLogin:(...params)=>audit.push(params),
  requireApiPermission:perm=>{assert.equal(perm,'user_manage');return ()=>{};}
 });
 async function call(url,body={},options={}){
  const r={code:200,value:null,headers:{},cookies:{},
   status(v){this.code=v;return this;},
   set(name,value){this.headers[name]=value;return this;},
   cookie(name,value){this.cookies[name]=value;return this;},
   json(v){this.value=v;return this;}};
  const req={body,headers:{origin:'https://psi-inventory.onrender.com'},protocol:'https',
   ip:'127.0.0.1',get:()=> 'psi-inventory.onrender.com',currentUserId:'admin',
   ...(options.req||{})};
  await routes.get(url)(req,r);
  return r;
 }
 return {call,users,invites,sessions,audit,guards,transactions};
}
const BASE='/api/auth/external';
test('invite landing page parses and uses URL fragment (not URL query)',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const html=fs.readFileSync(path.join(__dirname,'..','external-invite.html'),'utf8');
 const inline=html.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(inline,'invite landing page JS present');
 new Function(inline[1]);
 assert.match(inline[1],/location\.hash/);
 assert.match(inline[1],/history\.replaceState/);
 assert.ok(html.includes('/api/auth/external/claim'));
 const index=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
 assert.ok(index.includes('external-login-form'),'external users can re-login');
 const app=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
 assert.ok(app.includes('copyExternalInviteLink'),'admin has copy button');
 assert.ok(app.includes('navigator.clipboard.writeText'));
});

test('schema enforces external email uniqueness in real SQLite syntax',()=>{
 const {DatabaseSync}=require('node:sqlite');
 const db=new DatabaseSync(':memory:');
 try{
  db.exec('CREATE TABLE users (id TEXT PRIMARY KEY,email TEXT,auth_source TEXT,status TEXT)');
  const run=(sql,params=[])=>params.length?{changes:db.prepare(sql).run(...params).changes}:(db.exec(sql),{changes:0});
  moduleUnderTest.ensureSchema(run);
  moduleUnderTest.ensureSchema(run); // idempotency
  run("INSERT INTO users (id,email,auth_source,status) VALUES (?,?,?,?)",['a','Test@Example.com','external','active']);
  assert.throws(()=>run("INSERT INTO users (id,email,auth_source,status) VALUES (?,?,?,?)",['b','test@example.com','external','pending']));
  // An internal Feishu user with the same address does not collide with the external identity.
  run("INSERT INTO users (id,email,auth_source,status) VALUES (?,?,?,?)",['c','test@example.com','feishu','active']);
 }finally{db.close();}
});
test('invite generation exposes only one-time token, never creates an active user',async()=>{
 const x=fixture();
 assert.ok(x.guards.has('/api/users/external-invitations'),'creation must have admin permission guard');
 const r=await x.call('/api/users/external-invitations',{name:'External Contact',email:'EXAMPLE@Outside.com'});
 assert.equal(r.code,200);
 assert.match(r.value.token,/^[A-Za-z0-9_-]{43}$/);
 assert.equal(x.invites.length,1);
 assert.equal(x.users.length,0);
 assert.ok(!JSON.stringify(x.invites).includes(r.value.token),'persist only token hash');
 assert.equal(x.invites[0].recipient_email,'example@outside.com');
 assert.ok(new Date(r.value.expires_at)>new Date());
});
test('claim is single-use, identity remains pending with no role; login pending is still gated',async()=>{
 const x=fixture();
 const issued=await x.call('/api/users/external-invitations',{name:'王丹辰',email:'wang@example.com'});
 const token=issued.value.token;
 assert.equal((await x.call(BASE+'/invite-info',{token})).code,200);
 const weak=await x.call(BASE+'/claim',{token,email:'wang@example.com',password:'weak'});
 assert.equal(weak.code,400);
 const wrong=await x.call(BASE+'/claim',{token,email:'other@example.com',password:'StrongPassword123'});
 assert.equal(wrong.code,400);
 const result=await x.call(BASE+'/claim',{token,email:'WANG@EXAMPLE.COM',password:'StrongPassword123'});
 assert.equal(result.code,200);
 assert.equal(x.users.length,1);
 assert.equal(x.users[0].status,'pending');
 assert.equal(x.users[0].role_id,null);
 assert.equal(x.users[0].auth_source,'external');
 assert.equal(x.users[0].password_hash,'hashed_StrongPassword123');
 assert.equal((await x.call(BASE+'/claim',{token,email:'wang@example.com',password:'StrongPassword123'})).code,404);
 assert.equal((await x.call(BASE+'/invite-info',{token})).code,404);
 const login=await x.call(BASE+'/login',{email:'wang@example.com',password:'StrongPassword123'});
 assert.equal(login.code,200);
 assert.equal(login.value.status,'pending');
 assert.equal(x.sessions.length,1);
 x.users[0].status='active';x.users[0].role_id='role_viewer';
 assert.equal((await x.call(BASE+'/login',{email:'wang@example.com',password:'StrongPassword123'})).value.status,'active');
});
test('expired, revoked, invalid, duplicate and origin-mismatched claims fail safely',async()=>{
 const x=fixture();
 const issued=await x.call('/api/users/external-invitations',{name:'Guest',email:'guest@example.com'});
 assert.equal((await x.call(BASE+'/invite-info',{token:'short'})).code,404);
 assert.equal((await x.call(BASE+'/invite-info',{token:issued.value.token},{req:{headers:{origin:'https://evil.example'}}})).code,403);
 x.invites[0].expires_at=new Date(Date.now()-1000).toISOString();
 assert.equal((await x.call(BASE+'/claim',{token:issued.value.token,email:'guest@example.com',password:'StrongPassword123'})).code,404);
 x.invites[0].expires_at=new Date(Date.now()+100000).toISOString();
 x.invites[0].revoked_at=new Date().toISOString();
 assert.equal((await x.call(BASE+'/claim',{token:issued.value.token,email:'guest@example.com',password:'StrongPassword123'})).code,404);
});
test('wrong external credentials do not mint a session and deleted external user cannot log in',async()=>{
 const x=fixture();
 const t=(await x.call('/api/users/external-invitations',{name:'A',email:'a@example.com'})).value.token;
 await x.call(BASE+'/claim',{token:t,email:'a@example.com',password:'StrongPassword123'});
 assert.equal((await x.call(BASE+'/login',{email:'a@example.com',password:'wrong'})).code,401);
 assert.equal(x.sessions.length,0);
 x.users[0].status='deleted';
 assert.equal((await x.call(BASE+'/login',{email:'a@example.com',password:'StrongPassword123'})).code,401);
 assert.equal(x.sessions.length,0);
});
