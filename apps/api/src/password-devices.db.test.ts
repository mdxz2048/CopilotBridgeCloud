import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {eq,and} from 'drizzle-orm';
const mail=vi.hoisted(()=>vi.fn());
vi.mock('nodemailer',()=>({default:{createTransport:()=>({sendMail:mail})}}));
describe.skipIf(!process.env.V2_TEST_DATABASE_URL)('Password recovery and device replacement PostgreSQL',()=>{
 let app:Awaited<ReturnType<typeof import('./server.js').createServer>>,data:typeof import('@bridge/db');
 let counter=1;const password='Original-password-123!',next='Changed-password-456!';
 const origin='http://localhost:3000';
 const post=(url:string,payload:object,headers:Record<string,string>={origin})=>app.inject({method:'POST',url,payload,headers,remoteAddress:`192.0.2.${counter++}`});
 async function user(role='USER'){
  const [u]=await data.db.insert(data.users).values({email:`password-${randomUUID()}@example.test`,role,passwordHash:await(await import('./security.js')).hashPassword(password)}).returning();
  return u;
 }
 async function cookie(id:string){const {newRefresh,hashRefresh}=await import('./security.js');const t=newRefresh();await data.db.insert(data.webSessions).values({userId:id,tokenHash:hashRefresh(t),expiresAt:new Date(Date.now()+3600000)});return {cookie:`bridge_session=${t}`,origin};}
 async function subscribed(){const u=await user();const [p]=await data.db.insert(data.plans).values({code:`T_${randomUUID().slice(0,20)}`,name:'Fixture',monthlyPrice:'0',maxDevices:1,monthlyTokenLimit:10000,monthlyUsageCreditLimit:'10000',maxConcurrentRequests:10,requestsPerMinute:100}).returning();const now=new Date();await data.db.insert(data.subscriptions).values({userId:u.id,planId:p.id,status:'ACTIVE',startedAt:now,currentPeriodStart:now,currentPeriodEnd:new Date(Date.now()+86400000)});return u;}
 function info(){return {deviceId:randomUUID(),deviceName:'测试电脑',platform:'Windows',osVersion:'11',appVersion:'999.0.0',publicKeyJwk:generateKeyPairSync('ec',{namedCurve:'P-256'}).publicKey.export({format:'jwk'})};}
 async function issue(u:{email:string}){mail.mockClear();const r=await post('/api/v1/auth/forgot-password',{email:u.email,turnstileToken:'test'});expect(r.statusCode,r.body).toBe(202);const sent=mail.mock.lastCall![0];expect(sent.subject).toBe('【Copilot Bridge】重置登录密码');expect(sent.text).toContain('30 分钟');return sent.text.match(/#token=([\w-]+)/)![1] as string;}
 beforeAll(async()=>{
  if(!new URL(process.env.V2_TEST_DATABASE_URL!).pathname.startsWith('/bridge_v2_test_'))throw Error('REFUSE_NON_TEST_DATABASE');
  Object.assign(process.env,{DATABASE_URL:process.env.V2_TEST_DATABASE_URL,NODE_ENV:'test',PUBLIC_BASE_URL:origin,ACCESS_SECRET:'a'.repeat(64),REFRESH_TOKEN_PEPPER:'b'.repeat(64),PROVIDER_MASTER_KEY:'c'.repeat(64),STAGED_EMAIL_REGISTRATION_ENABLED:'true',TURNSTILE_SITE_KEY:'public',TURNSTILE_SECRET_KEY:'secret',TURNSTILE_EXPECTED_HOSTNAME:'localhost',SMTP_HOST:'smtp.example.test',SMTP_USER:'test',SMTP_PASSWORD:'test',SMTP_FROM:'verify@example.test',SMTP_PORT:'587',LOG_LEVEL:'silent'});
  vi.stubGlobal('fetch',vi.fn(async(_url:unknown,init:{body:URLSearchParams})=>new Response(JSON.stringify({success:true,hostname:'localhost',action:init.body.get('response')==='login'?'web_login':'password_reset'}))));
  mail.mockImplementation(async(m:{to:string})=>({accepted:[m.to]}));
  data=await import('@bridge/db');app=await(await import('./server.js')).createServer();
 });
 afterAll(async()=>{await app?.close();await data?.pool.end();vi.unstubAllGlobals();});
 it('rejects missing captcha and untrusted origin before sending mail; unknown email returns generic acceptance',async()=>{
  const u=await user();mail.mockClear();
  expect((await post('/api/v1/auth/forgot-password',{email:u.email})).statusCode).toBe(403);
  expect((await post('/api/v1/auth/forgot-password',{email:u.email,turnstileToken:'x'},{origin:'https://evil.test'})).statusCode).toBe(403);
  expect(mail).not.toHaveBeenCalled();
  const r=await post('/api/v1/auth/forgot-password',{email:`unknown-${randomUUID()}@example.test`,turnstileToken:'x'});expect(r.statusCode).toBe(202);expect(r.json()).toEqual({accepted:true});expect(mail).not.toHaveBeenCalled();
 });
 it('stores hashed tokens, rate limits repeated mail, resets once and invalidates cookies and access JWT versions',async()=>{
  const u=await subscribed(),headers=await cookie(u.id),device=info();const login=await post('/api/v1/auth/login',{email:u.email,password,device},{});expect(login.statusCode,login.body).toBe(200);
  const token=await issue(u);const [row]=await data.db.select().from(data.passwordResets).where(eq(data.passwordResets.userId,u.id));expect(JSON.stringify(row)).not.toContain(token);
  expect((await post('/api/v1/auth/forgot-password',{email:u.email,turnstileToken:'x'})).statusCode).toBe(429);
  const results=await Promise.all([1,2].map(()=>post('/api/v1/auth/reset-password',{token,password:next})));expect(results.map(r=>r.statusCode).sort()).toEqual([200,400]);
  expect((await app.inject({url:'/api/v1/auth/me',headers})).statusCode).toBe(401);
  expect((await app.inject({url:'/api/v1/auth/me',headers:{authorization:`Bearer ${login.json().accessToken}`}})).json().error.code).toBe('DEVICE_REVOKED');
  const [d]=await data.db.select().from(data.devices).where(eq(data.devices.id,login.json().device.id));expect(d.status).toBe('REVOKED');expect(d.authVersion).toBeGreaterThan(login.json().device.authVersion??0);
  const old=await post('/api/v1/auth/login',{email:u.email,password,device},{});expect(old.statusCode).toBe(401);
  const newLogin=await post('/api/v1/auth/login',{email:u.email,password:next,device},{});expect(newLogin.statusCode,newLogin.body).toBe(200);expect(newLogin.json().device.id).toBe(d.id);
  expect((await app.inject({url:'/api/v1/auth/me',headers:{authorization:`Bearer ${login.json().accessToken}`}})).json().error.code).toBe('DEVICE_REVOKED');
  expect((await post('/api/v1/auth/refresh',{refreshToken:login.json().refreshToken},{})).statusCode).toBe(401);
 });
 it('rejects expired links and mail failures do not produce a usable reset',async()=>{
  const u=await user(),token=await issue(u);await data.db.update(data.passwordResets).set({expiresAt:new Date(Date.now()-1000)}).where(eq(data.passwordResets.userId,u.id));
  expect((await post('/api/v1/auth/reset-password',{token,password:next})).json().error.code).toBe('PASSWORD_RESET_INVALID');
  const other=await user();mail.mockRejectedValueOnce(Error('smtp failure'));expect((await post('/api/v1/auth/forgot-password',{email:other.email,turnstileToken:'x'})).statusCode).toBe(503);
  const [row]=await data.db.select().from(data.passwordResets).where(eq(data.passwordResets.userId,other.id));expect(row.state).toBe('FAILED');
 });
 it('requires current password and revokes all sessions on user change, including previously issued reset links',async()=>{
  const u=await user(),headers=await cookie(u.id),token=await issue(u);
  expect((await post('/api/v1/auth/change-password',{currentPassword:'wrong',password:next},headers)).json().error.code).toBe('CURRENT_PASSWORD_INVALID');
  expect((await post('/api/v1/auth/change-password',{currentPassword:password,password},headers)).json().error.code).toBe('PASSWORD_UNCHANGED');
  expect((await post('/api/v1/auth/change-password',{currentPassword:password,password:next},headers)).statusCode).toBe(200);
  expect((await app.inject({url:'/api/v1/auth/me',headers})).statusCode).toBe(401);
  expect((await post('/api/v1/auth/reset-password',{token,password:'Another-password-789!'})).statusCode).toBe(400);
 });
 it('allows only admin reset, never returns or audits the password, and invalidates active devices',async()=>{
  const u=await subscribed(),admin=await user('ADMIN'),h=await cookie(admin.id),uh=await cookie(u.id),device=info();await post('/api/v1/auth/login',{email:u.email,password,device},{});
  expect((await post(`/api/v1/admin/users/${u.id}/reset-password`,{password:next},uh)).statusCode).toBe(403);
  const r=await post(`/api/v1/admin/users/${u.id}/reset-password`,{password:next},h);expect(r.statusCode).toBe(200);expect(r.body).not.toContain(next);
  const logs=await data.db.select().from(data.auditLogs).where(and(eq(data.auditLogs.targetId,u.id),eq(data.auditLogs.action,'PASSWORD_RESET')));expect(logs).toHaveLength(1);expect(JSON.stringify(logs)).not.toContain(next);
  const [d]=await data.db.select().from(data.devices).where(eq(data.devices.userId,u.id));expect(d.status).toBe('REVOKED');expect(d.authVersion).toBeGreaterThan(0);
 });
 it('reveals device choices only after valid credentials, atomically replaces own device, and permits explicit re-login',async()=>{
  const u=await subscribed(),first=info(),second=info();const r=await post('/api/v1/auth/login',{email:u.email,password,device:first},{});expect(r.statusCode).toBe(200);const id=r.json().device.id;
  const bad=await post('/api/v1/auth/login',{email:u.email,password:'wrong',device:second},{});expect(bad.statusCode).toBe(401);expect(bad.json().error.details).toBeUndefined();
  const full=await post('/api/v1/auth/login',{email:u.email,password,device:second},{});expect(full.statusCode).toBe(409);expect(full.json().error.details.devices[0].id).toBe(id);
  const other=await subscribed(),od=info();const foreign=await post('/api/v1/auth/login',{email:other.email,password,device:od},{});
  expect((await post('/api/v1/auth/login',{email:u.email,password,device:second,replaceDeviceId:foreign.json().device.id},{})).statusCode).toBe(404);
  const replaced=await post('/api/v1/auth/login',{email:u.email,password,device:second,replaceDeviceId:id},{});expect(replaced.statusCode,replaced.body).toBe(200);
  expect((await app.inject({url:'/api/v1/auth/me',headers:{authorization:`Bearer ${r.json().accessToken}`}})).json().error.code).toBe('DEVICE_REVOKED');
  expect((await post('/api/v1/auth/refresh',{refreshToken:r.json().refreshToken},{})).statusCode).toBe(401);
  const h=await cookie(u.id);expect((await app.inject({method:'DELETE',url:`/api/v1/devices/${replaced.json().device.id}`,headers:h})).statusCode).toBe(200);
  expect((await post('/api/v1/auth/login',{email:u.email,password,device:first},{})).statusCode).toBe(200);
 });
 it('serializes concurrent enrollments at the device cap and keeps administrator BLOCKED devices blocked',async()=>{
  const u=await subscribed(),a=info(),b=info();const results=await Promise.all([a,b].map(device=>post('/api/v1/auth/login',{email:u.email,password,device},{})));
  expect(results.map(r=>r.statusCode).sort()).toEqual([200,409]);
  const good=results.find(r=>r.statusCode===200)!.json().device;await data.db.update(data.devices).set({status:'BLOCKED'}).where(eq(data.devices.id,good.id));
  const target=good.deviceId===a.deviceId?a:b;expect((await post('/api/v1/auth/login',{email:u.email,password,device:target},{})).json().error.code).toBe('DEVICE_REVOKED');
 });
});
