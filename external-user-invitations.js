'use strict';
// External invitations use their own credentials: a Feishu custom app cannot authenticate foreign-tenant users.
// Do not grant business permissions by possession of the invitation URL alone.
const crypto = require('crypto');
const INVITE_MS = 7 * 24 * 3600 * 1000;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const hashToken = value => crypto.createHash('sha256').update(value).digest('hex');
const validEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
const validPassword = value => typeof value === 'string' && value.length >= 12 && value.length <= 128
  && /[a-z]/.test(value) && /[A-Z]/.test(value) && /[0-9]/.test(value);

function ensureSchema(run) {
  run(`CREATE TABLE IF NOT EXISTS external_user_invites (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    recipient_name TEXT NOT NULL,
    recipient_email TEXT NOT NULL,
    issued_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT NOT NULL DEFAULT '',
    user_id TEXT NOT NULL DEFAULT '',
    revoked_at TEXT NOT NULL DEFAULT ''
  )`);
  run('CREATE INDEX IF NOT EXISTS idx_external_invite_email ON external_user_invites(recipient_email)');
  // Prevent two distinct invitations from concurrently creating accounts for the same email.
  run("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_external_email ON users(LOWER(email)) WHERE auth_source='external' AND status<>'deleted'");
}
function register(app, deps) {
  const { queryOne, run, transaction, genId, hashPassword, verifyPassword,
    createSessionForUser, auditLogin, requireApiPermission } = deps;
  const failures = new Map();
  function jsonError(res, status, message) { return res.status(status).json({ error: message }); }
  function readInvite(token) {
    if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null;
    return queryOne('SELECT * FROM external_user_invites WHERE token_hash=?', [hashToken(token)]);
  }
  function inviteValid(row) {
    return row && !row.used_at && !row.revoked_at && new Date(row.expires_at).getTime() > Date.now();
  }
  function sameOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return true;
    try { return new URL(origin).host === req.get('host') && new URL(origin).protocol === req.protocol+':'; }
    catch (_) { return false; }
  }
  app.post('/api/users/external-invitations', requireApiPermission('user_manage'), (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!name || name.length > 128 || !validEmail(email)) return jsonError(res, 400, '请填写姓名和有效邮箱');
    const exists = queryOne("SELECT id FROM users WHERE LOWER(email)=? AND auth_source='external' AND status<>'deleted'", [email]);
    if (exists) return jsonError(res, 409, '此邮箱已存在外部用户，请在用户管理中处理');
    const token = crypto.randomBytes(32).toString('base64url');
    const now = new Date().toISOString();
    const expiry = new Date(Date.now()+INVITE_MS).toISOString();
    run('INSERT INTO external_user_invites (id,token_hash,recipient_name,recipient_email,issued_by,created_at,expires_at) VALUES (?,?,?,?,?,?,?)',
      [genId('extinvite'),hashToken(token),name,email,req.currentUserId,now,expiry]);
    // The only plaintext token exposure is this administrator response. Never log it.
    res.set('Cache-Control','no-store').json({token,expires_at:expiry,name,email});
  });
  // Public invite endpoints: invitation token is in JSON request bodies, never query strings.
  app.post('/api/auth/external/invite-info', (req,res) => {
    if (!sameOrigin(req)) return jsonError(res,403,'请求来源不正确');
    const inv = readInvite(req.body?.token);
    if (!inviteValid(inv)) return jsonError(res,404,'邀请链接无效、已使用或已过期，请联系管理员重新邀请');
    res.set('Cache-Control','no-store').json({name:inv.recipient_name,email:inv.recipient_email,expires_at:inv.expires_at});
  });
  app.post('/api/auth/external/claim', (req,res) => {
    if (!sameOrigin(req)) return jsonError(res,403,'请求来源不正确');
    const token = req.body?.token;
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = req.body?.password;
    const inv = readInvite(token);
    if (!inviteValid(inv)) return jsonError(res,404,'邀请已使用或过期，请联系管理员重新邀请');
    if (email !== inv.recipient_email) return jsonError(res,400,'邮箱须与管理员邀请的邮箱一致');
    if (!validPassword(password)) return jsonError(res,400,'密码至少12位，需包含大写、小写字母及数字');
    const userId = genId('external');
    try {
      transaction(() => {
        const now = new Date().toISOString();
        const claimed = run("UPDATE external_user_invites SET used_at=?,user_id=? WHERE token_hash=? AND used_at='' AND revoked_at=''",
          [now,userId,hashToken(token)]);
        if (claimed.changes !== 1) throw new Error('INVITE_ALREADY_USED');
        const duplicate = queryOne("SELECT id FROM users WHERE LOWER(email)=? AND auth_source='external' AND status<>'deleted'",[email]);
        if (duplicate) throw new Error('DUPLICATE_EXTERNAL_USER');
        run("INSERT INTO users (id,username,name,role_id,status,email,auth_source,password_hash) VALUES (?,?,?,?,?,?,?,?)",
          [userId,'external_'+crypto.randomBytes(10).toString('hex'),inv.recipient_name,null,'pending',email,'external',hashPassword(password)]);
      });
    } catch (e) {
      if (e.message === 'DUPLICATE_EXTERNAL_USER') return jsonError(res,409,'此邮箱已注册，请使用外部账号登录');
      if (e.message === 'INVITE_ALREADY_USED') return jsonError(res,409,'邀请已被使用');
      console.error('[external invite claim]',e.name || 'Error');
      return jsonError(res,500,'邀请领取失败，请联系管理员');
    }
    res.set('Cache-Control','no-store').json({success:true,status:'pending'});
  });
  app.post('/api/auth/external/login', (req,res) => {
    if (!sameOrigin(req)) return jsonError(res,403,'请求来源不正确');
    const email = typeof req.body?.email==='string'?req.body.email.trim().toLowerCase():'';
    const password = req.body?.password;
    if (!validEmail(email) || typeof password !== 'string' || password.length>128) return jsonError(res,400,'邮箱或密码错误');
    const ip = (req.headers['x-forwarded-for']||req.ip||'').toString().split(',')[0];
    const key = ip+'|'+hashToken(email);
    // Small login-specific lockout, independent of break-glass emergency account.
    const failed = failures.get(key) || {count:0,until:0};
    if (failed.until>Date.now()) return jsonError(res,429,'尝试次数过多，请稍后重试');
    const user = queryOne("SELECT * FROM users WHERE LOWER(email)=? AND auth_source='external' AND status<>'deleted' ORDER BY created_at DESC LIMIT 1",[email]);
    const ok = user && verifyPassword(password,user.password_hash);
    if (!ok) {
      failed.count+=1;
      if (failed.count>=5){ failed.count=0;failed.until=Date.now()+15*60*1000; }
      failures.set(key,failed);
      auditLogin(user?.id||null,email,'external',false,'invalid_credentials');
      return jsonError(res,401,'邮箱或密码错误');
    }
    failures.delete(key);
    if (user.status==='disabled') return jsonError(res,403,'账号已停用，请联系管理员');
    if (user.status!=='active' && user.status!=='pending') return jsonError(res,403,'账号不可登录');
    createSessionForUser(res,user,req.headers['user-agent'],ip);
    auditLogin(user.id,user.username,'external',true,'');
    res.json({id:user.id,username:user.username,name:user.name,role_id:user.role_id,
      status:user.status,auth_source:'external',language_preference:user.language_preference});
  });
}
module.exports={ensureSchema,register};
