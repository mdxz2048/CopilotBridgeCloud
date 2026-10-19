import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {createHash,generateKeyPairSync,randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SignJWT} from 'jose';
import {and,eq} from 'drizzle-orm';

describe.skipIf(!process.env.V2_TEST_DATABASE_URL)('Flight recorder isolated PostgreSQL',()=>{
 let data:typeof import('@bridge/db'),app:Awaited<ReturnType<typeof import('./server.js').createServer>>,directory:string;
 let userId:string,deviceId:string,token:string,adminHeaders:Record<string,string>,userHeaders:Record<string,string>;
 const origin='http://localhost:3001',key=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
 const jwk=key.publicKey.export({format:'jwk'}) as {kty:'EC';crv:'P-256';x:string;y:string};
 beforeAll(async()=>{
  const url=process.env.V2_TEST_DATABASE_URL!;if(!new URL(url).pathname.startsWith('/bridge_v2_test_'))throw Error('REFUSE_NON_TEST_DATABASE');
  directory=await mkdtemp(join(tmpdir(),'bridge-flight-db-'));
  Object.assign(process.env,{DATABASE_URL:url,NODE_ENV:'test',PUBLIC_BASE_URL:origin,LOG_LEVEL:'silent',FLIGHT_RECORDER_ENABLED:'true',FLIGHT_RECORDER_DIR:directory,STAGED_EMAIL_REGISTRATION_ENABLED:'false'});
  process.env.ACCESS_SECRET??='a'.repeat(64);process.env.REFRESH_TOKEN_PEPPER??='b'.repeat(64);process.env.PROVIDER_MASTER_KEY??='c'.repeat(64);
  data=await import('@bridge/db');const security=await import('./security.js');
  async function fixture(role:'USER'|'ADMIN'){
   const [user]=await data.db.insert(data.users).values({email:`flight-${randomUUID()}@example.test`,passwordHash:'synthetic',role}).returning();
   const cookie=security.newRefresh();await data.db.insert(data.webSessions).values({userId:user.id,tokenHash:security.hashRefresh(cookie),expiresAt:new Date(Date.now()+300000)});
   return {user,headers:{cookie:`bridge_session=${cookie}`,origin}};
  }
  const u=await fixture('USER'),a=await fixture('ADMIN');userId=u.user.id;adminHeaders=a.headers;userHeaders=u.headers;
  const [device]=await data.db.insert(data.devices).values({userId,deviceId:randomUUID(),deviceName:'Synthetic recorder test',platform:'Windows',appVersion:'999.0.0',publicKeyJwk:jwk}).returning();deviceId=device.deviceId;
  token=await security.issueAccess(userId,device.id);app=await(await import('./server.js')).createServer();
 });
 afterAll(async()=>{await app?.close();await data?.pool.end();if(directory)await rm(directory,{recursive:true,force:true});delete process.env.FLIGHT_RECORDER_ENABLED;delete process.env.FLIGHT_RECORDER_DIR;});
 async function post(path:string,payload:Record<string,unknown>){
  const hash=(s:string)=>createHash('sha256').update(s).digest('base64url');
  const dpop=await new SignJWT({htm:'POST',htu:origin+path,iat:Math.floor(Date.now()/1000),jti:randomUUID(),ath:hash(token),bth:hash(JSON.stringify(payload))}).setProtectedHeader({typ:'dpop+jwt',alg:'ES256',jwk}).sign(key.privateKey);
  return app.inject({method:'POST',url:path,payload,headers:{host:'localhost:3001',authorization:`Bearer ${token}`,'x-device-id':deviceId,dpop}});
 }
 it('captures an authenticated gateway failure and links signed client feedback to an audited admin-only export',async()=>{
  // Missing thread ID fails before entitlement/routing: no provider request or billing.
  const result=await post('/v1/responses',{model:'synthetic',input:'SYNTHETIC_RECORDER_CHECK',tools:[{type:'function',name:'functions__exec',parameters:{type:'object'}}]});
  expect(result.statusCode,result.body).toBe(400);expect(result.json().error.code).toBe('CLIENT_THREAD_ID_REQUIRED');
  const requestId=result.json().error.requestId,failureId=randomUUID();
  const report=await post('/api/v1/diagnostics/failures',{id:failureId,ownerUserId:userId,occurredAt:new Date().toISOString(),appVersion:'999.0.0',traceId:randomUUID(),requestId,stage:'cloud_http',error:{code:'CLIENT_THREAD_ID_REQUIRED',message:'Synthetic check'},request:{},reply:{}});
  expect(report.statusCode,report.body).toBe(200);
  const detail=await app.inject({url:`/api/v1/admin/diagnostics/failures/${failureId}`,headers:adminHeaders});expect(detail.statusCode,detail.body).toBe(200);
  const snapshotId=detail.json().report.snapshotId;expect(snapshotId).toBeTruthy();const path=`/api/v1/admin/diagnostics/flight-snapshots/${snapshotId}/download`;
  expect((await app.inject({url:path})).statusCode).toBe(401);expect((await app.inject({url:path,headers:userHeaders})).statusCode).toBe(403);
  const download=await app.inject({url:path,headers:adminHeaders});expect(download.statusCode,download.body).toBe(200);expect(download.headers['cache-control']).toBe('no-store');
  const frames=download.body.trim().split('\n').map(line=>JSON.parse(line));
  expect(frames.some(f=>f.kind==='tool_inventory'&&f.data.tools[0].name==='functions__exec')).toBe(true);
  expect(frames.some(f=>f.kind==='request'&&f.data.input==='SYNTHETIC_RECORDER_CHECK')).toBe(true);
  expect(frames[0].data.causes.some((c:{source:string})=>c.source==='client_feedback')).toBe(true);
  const audit=await data.db.select().from(data.auditLogs).where(and(eq(data.auditLogs.targetId,snapshotId),eq(data.auditLogs.action,'FLIGHT_SNAPSHOT_DOWNLOADED')));expect(audit).toHaveLength(1);
  expect(await data.db.select().from(data.aiRequests)).toHaveLength(0);
 });
});
