import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

const enabled=Boolean(process.env.V2_TEST_DATABASE_URL);
describe.skipIf(!enabled)('Admin redesign PostgreSQL integration',()=>{
 let database:typeof import('@bridge/db');
 let app:Awaited<ReturnType<typeof import('./server.js').createServer>>;
 let owner:typeof import('@bridge/db').users.$inferSelect;
 let adminUser:typeof import('@bridge/db').users.$inferSelect;
 let device:typeof import('@bridge/db').devices.$inferSelect;
 let planId:string;
 let releaseId:string;
 let missingReleaseId:string;
 let directory:string;
 let headers:Record<string,string>;
 let userHeaders:Record<string,string>;
 let insertedTrackingStart=false;
 const password='Synthetic-admin-redesign-123!';
 const version=`987.1.${Math.floor(Math.random()*100000000)}`;
 const missingVersion=`987.2.${Math.floor(Math.random()*100000000)}`;
 const eq=async()=> (await import('drizzle-orm')).eq;
 async function cookie(userId:string){
  const {newRefresh,hashRefresh}=await import('./security.js');const token=newRefresh();
  await database.db.insert(database.webSessions).values({userId,tokenHash:hashRefresh(token),expiresAt:new Date(Date.now()+300000)});
  return {cookie:`bridge_session=${token}`,origin:process.env.PUBLIC_BASE_URL!};
 }
 async function events(){
  const response=await app.inject({url:`/api/v1/admin/online-events?email=${encodeURIComponent(owner.email)}&page=1&pageSize=30`,headers});
  expect(response.statusCode,response.body).toBe(200);
  return response.json() as {data:Array<{source:string;email:string;ipAddress:string;deviceName:string;platform:string;appVersion:string;createdAt:string}>;total:number;page:number;pageSize:number};
 }
 async function downloadCount(){
  const rows=await database.db.select().from(database.siteDownloadStats).where((await eq())(database.siteDownloadStats.version,version));
  return rows.reduce((sum,row)=>sum+row.downloads,0);
 }
 beforeAll(async()=>{
  const url=process.env.V2_TEST_DATABASE_URL!;
  if(!new URL(url).pathname.startsWith('/bridge_v2_test_'))throw Error('REFUSE_NON_TEST_DATABASE');
  process.env.DATABASE_URL=url;
  process.env.ACCESS_SECRET??='a'.repeat(64);process.env.REFRESH_TOKEN_PEPPER??='b'.repeat(64);process.env.PROVIDER_MASTER_KEY??='c'.repeat(64);
  process.env.PUBLIC_BASE_URL??='http://localhost:3001';process.env.LOG_LEVEL='silent';
  process.env.STAGED_EMAIL_REGISTRATION_ENABLED='false';process.env.TRUSTED_PROXY_HOPS='0';
  directory=await mkdtemp(join(tmpdir(),'bridge-admin-redesign-'));process.env.RELEASE_STORAGE_DIR=directory;
  database=await import('@bridge/db');const {db,users,devices,plans,subscriptions,releases}=database;
  const existingStart=await db.select().from(database.systemSettings).where((await eq())(database.systemSettings.key,'admin_telemetry_started'));
  if(!existingStart.length){await db.insert(database.systemSettings).values({key:'admin_telemetry_started',value:{startedAt:new Date().toISOString()}});insertedTrackingStart=true;}
  const passwordHash=await(await import('./security.js')).hashPassword(password);
  [owner]=await db.insert(users).values({email:`admin-redesign-${randomUUID()}@example.test`,passwordHash}).returning();
  [adminUser]=await db.insert(users).values({email:`admin-redesign-admin-${randomUUID()}@example.test`,passwordHash,role:'ADMIN'}).returning();
  const [plan]=await db.insert(plans).values({code:`AR_${randomUUID().replaceAll('-','').slice(0,20)}`,name:'Admin redesign fixture',monthlyPrice:'0',maxDevices:5,monthlyTokenLimit:1000000,monthlyUsageCreditLimit:'1000000',maxConcurrentRequests:10,requestsPerMinute:100}).returning();planId=plan.id;
  const now=new Date();await db.insert(subscriptions).values({userId:owner.id,planId,status:'ACTIVE',startedAt:now,currentPeriodStart:now,currentPeriodEnd:new Date(now.getTime()+86400000)});
  [device]=await db.insert(devices).values({userId:owner.id,deviceId:randomUUID(),deviceName:'管理验收设备',platform:'Windows',osVersion:'11',appVersion:'999.0.0',lastSeenAt:now}).returning();
  const [release]=await db.insert(releases).values({version,channel:'stable',platform:'windows',arch:'x64',downloadUrl:'https://example.test/synthetic.exe',sha256:'a'.repeat(64),published:true}).returning();releaseId=release.id;
  const [missing]=await db.insert(releases).values({version:missingVersion,channel:'stable',platform:'windows',arch:'x64',downloadUrl:'https://example.test/missing.exe',sha256:'b'.repeat(64),published:true}).returning();missingReleaseId=missing.id;
  await writeFile(join(directory,`${releaseId}.exe`),Buffer.from('MZ synthetic installer fixture'));
  app=await(await import('./server.js')).createServer();headers=await cookie(adminUser.id);userHeaders=await cookie(owner.id);
 });
 afterAll(async()=>{
  await app?.close();
  if(database&&owner&&adminUser){
   const {db,auditLogs,users,devices,subscriptions,plans,webSessions,refreshTokens,deviceProofs,releases,siteDownloadStats}=database;
   const {inArray}=await import('drizzle-orm');const whereEq=await eq();const ids=[owner.id,adminUser.id];
   const ownedDevices=await db.select({id:devices.id}).from(devices).where(whereEq(devices.userId,owner.id));
   await db.delete(database.userFeedback).where(inArray(database.userFeedback.userId,ids));
   // Ledger rows are immutable. Keep their synthetic owners until the disposable database is dropped.
   const ownedWallets=await db.select({userId:database.wallets.userId}).from(database.wallets).where(inArray(database.wallets.userId,ids));
   const retainedUserIds=ownedWallets.map(row=>row.userId);
   await db.delete(auditLogs).where(inArray(auditLogs.actorId,ids));
   await db.delete(webSessions).where(inArray(webSessions.userId,ids));await db.delete(refreshTokens).where(inArray(refreshTokens.userId,ids));
   if(ownedDevices.length)await db.delete(deviceProofs).where(inArray(deviceProofs.deviceId,ownedDevices.map(d=>d.id)));
   await db.delete(subscriptions).where(whereEq(subscriptions.userId,owner.id));await db.delete(devices).where(whereEq(devices.userId,owner.id));
   if(retainedUserIds.length)await db.update(users).set({status:'DELETED'}).where(inArray(users.id,retainedUserIds));
   const deletableIds=ids.filter(id=>!retainedUserIds.includes(id));if(deletableIds.length)await db.delete(users).where(inArray(users.id,deletableIds));await db.delete(plans).where(whereEq(plans.id,planId));
   await db.delete(releases).where(inArray(releases.id,[releaseId,missingReleaseId]));await db.delete(siteDownloadStats).where(inArray(siteDownloadStats.version,[version,missingVersion]));
   if(insertedTrackingStart)await db.delete(database.systemSettings).where(whereEq(database.systemSettings.key,'admin_telemetry_started'));
  }
  if(directory){const target=resolve(directory);if(!target.startsWith(resolve(tmpdir())+String.fromCharCode(92))&&!target.startsWith(resolve(tmpdir())+'/'))throw Error('REFUSE_UNSAFE_TEMP_CLEANUP');await rm(target,{recursive:true,force:true});}
  await database?.pool.end();
 });

 it('requires Admin for online history and website statistics',async()=>{
  for(const path of ['/api/v1/admin/online-events','/api/v1/admin/site/summary']){
   expect((await app.inject({url:path})).statusCode).toBe(401);
   expect((await app.inject({url:path,headers:userHeaders})).statusCode).toBe(403);
  }
 });

 it('stores private user feedback once, isolates owners and audits concurrent admin updates',async()=>{
  const input={clientId:randomUUID(),kind:'FEATURE',title:'增加扣费筛选',content:'希望按设备筛选消费扣费记录。'};
  const {applyWalletChange}=await import('./wallet.js');
  await database.db.transaction(async tx=>{
   await applyWalletChange(tx,{userId:owner.id,points:10000,type:'ADMIN_ADJUSTMENT',referenceType:'TEST',referenceId:owner.id,idempotencyKey:`feedback-credit:${owner.id}`});
   await applyWalletChange(tx,{userId:owner.id,points:5000,type:'REFERRAL_REWARD',referenceType:'TEST',referenceId:owner.id,idempotencyKey:`feedback-expired:${owner.id}`,expiresAt:new Date(Date.now()-1000)});
  });
  const usersResponse=await app.inject({url:`/api/v1/admin/users?search=${encodeURIComponent(owner.email)}`,headers});
  expect(usersResponse.statusCode).toBe(200);
  expect(usersResponse.json().data).toEqual([expect.objectContaining({id:owner.id,balance:10000,planName:'Admin redesign fixture',onlineDevices:1,authorizedDevices:1})]);
  const submit=(payload=input,customHeaders=userHeaders)=>app.inject({method:'POST',url:'/api/v1/me/feedback',headers:customHeaders,payload});
  expect((await submit(input,{})).statusCode).toBe(401);
  expect((await submit(input,{...userHeaders,origin:'https://untrusted.example.test'})).statusCode).toBe(403);
  expect((await submit({...input,content:'短'})).statusCode).toBe(400);
  const response=await submit();expect(response.statusCode).toBe(201);expect(response.headers['cache-control']).toBe('no-store');const value=response.json().feedback;
  expect(value).toMatchObject({kind:'FEATURE',status:'OPEN',title:input.title,content:input.content});
  expect((await submit()).json().feedback.id).toBe(value.id);
  expect((await submit({...input,title:'另一条意见'})).statusCode).toBe(409);
  const {db,userFeedback}=database;const whereEq=await eq();
  const [stored]=await db.select().from(userFeedback).where(whereEq(userFeedback.id,value.id));
  expect(JSON.stringify(stored)).not.toContain(input.content);expect(JSON.stringify(stored)).not.toContain(input.title);
  expect((await app.inject({url:'/api/v1/me/feedback',headers})).json().data).toHaveLength(0);
  expect((await app.inject({url:'/api/v1/me/feedback',headers:userHeaders})).json().data).toHaveLength(1);
  expect((await app.inject({url:'/api/v1/admin/feedback',headers:userHeaders})).statusCode).toBe(403);
  const change={method:'PATCH' as const,url:`/api/v1/admin/feedback/${value.id}`,payload:{status:'IN_PROGRESS',expectedUpdatedAt:value.updatedAt}};
  expect((await app.inject({...change,headers:userHeaders})).statusCode).toBe(403);
  const changed=await app.inject({...change,headers});expect(changed.statusCode).toBe(200);expect(changed.json().feedback.status).toBe('IN_PROGRESS');
  expect((await app.inject({...change,headers})).statusCode).toBe(409);
  expect((await app.inject({url:'/api/v1/admin/feedback?status=IN_PROGRESS',headers})).json().data.some((row:{id:string;email:string})=>row.id===value.id&&row.email===owner.email)).toBe(true);
  expect((await app.inject({url:'/api/v1/me/feedback?status=OPEN',headers:userHeaders})).json().total).toBe(0);
  for(let i=0;i<9;i++)expect((await submit({...input,clientId:randomUUID()})).statusCode).toBe(201);
  expect((await submit({...input,clientId:randomUUID()})).statusCode).toBe(429);
  expect((await submit()).statusCode).toBe(200);
  const audit=await db.select().from(database.auditLogs).where(whereEq(database.auditLogs.targetId,value.id));
  expect(audit).toHaveLength(1);expect(audit[0].metadata).toMatchObject({previous:'OPEN',status:'IN_PROGRESS'});
 });

 it('records successful web and App logins, ignores failures, and uses the trusted request IP',async()=>{
  const before=(await events()).total;
  const failed=await app.inject({method:'POST',url:'/api/v1/auth/login',remoteAddress:'192.0.2.40',headers:{origin:process.env.PUBLIC_BASE_URL!},payload:{email:owner.email,password:'wrong-password'}});
  expect(failed.statusCode).toBe(401);expect((await events()).total).toBe(before);
  const web=await app.inject({method:'POST',url:'/api/v1/auth/login',remoteAddress:'192.0.2.41',headers:{origin:process.env.PUBLIC_BASE_URL!,'x-forwarded-for':'203.0.113.99','user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0.0.0'},payload:{email:owner.email,password}});
  expect(web.statusCode,web.body).toBe(200);
  const publicKey=generateKeyPairSync('ec',{namedCurve:'prime256v1'}).publicKey.export({format:'jwk'});
  const desktop=await app.inject({method:'POST',url:'/api/v1/auth/login',remoteAddress:'192.0.2.42',payload:{email:owner.email,password,device:{deviceId:randomUUID(),deviceName:'登录验收设备',platform:'Windows',osVersion:'11',appVersion:'999.0.0',publicKeyJwk:publicKey}}});
  expect(desktop.statusCode,desktop.body).toBe(200);
  const current=await events();expect(current.total).toBe(before+2);
  expect(current.data).toEqual(expect.arrayContaining([expect.objectContaining({email:owner.email,source:'WEB_LOGIN',ipAddress:'192.0.2.41'}),expect.objectContaining({email:owner.email,source:'APP_LOGIN',ipAddress:'192.0.2.42',deviceName:'登录验收设备',platform:'Windows',appVersion:'999.0.0'})]));
  expect(JSON.stringify(current)).not.toContain('203.0.113.99');expect(JSON.stringify(current)).not.toContain(password);
  const first=(await app.inject({url:`/api/v1/admin/online-events?email=${encodeURIComponent(owner.email)}&page=1&pageSize=1`,headers})).json();
  const second=(await app.inject({url:`/api/v1/admin/online-events?email=${encodeURIComponent(owner.email)}&page=2&pageSize=1`,headers})).json();
  expect(first).toMatchObject({total:before+2,page:1,pageSize:1});expect(second.data[0].id).not.toBe(first.data[0].id);
  expect((await app.inject({url:'/api/v1/admin/audit',headers})).json().data.some((row:{action:string})=>row.action==='USER_ONLINE')).toBe(false);
  expect((await app.inject({url:'/api/v1/admin/online-events?email=absent%40example.test',headers})).json().total).toBe(0);
  expect((await app.inject({url:'/api/v1/admin/online-events?page=0',headers})).statusCode).toBe(400);
 });

 it('serializes concurrent reconnect heartbeats and leaves frequent polling out of online history',async()=>{
  const {heartbeatDevice}=await import('./online-events.js');const {db,devices}=database;const whereEq=await eq();
  const before=(await events()).total;
  await heartbeatDevice(device,'192.0.2.50');expect((await events()).total).toBe(before);
  await db.update(devices).set({lastSeenAt:new Date(Date.now()-6*60000)}).where(whereEq(devices.id,device.id));
  const [stale]=await db.select().from(devices).where(whereEq(devices.id,device.id));
  await Promise.all(Array.from({length:4},()=>heartbeatDevice(stale,'192.0.2.51')));
  const current=await events();expect(current.total).toBe(before+1);expect(current.data.filter(r=>r.source==='APP_RECONNECT')).toEqual([expect.objectContaining({deviceName:device.deviceName,ipAddress:'192.0.2.51'})]);
  await heartbeatDevice(stale,'192.0.2.52');expect((await events()).total).toBe(before+1);
  await db.update(devices).set({status:'REVOKED',lastSeenAt:new Date(Date.now()-6*60000)}).where(whereEq(devices.id,device.id));
  await heartbeatDevice(stale,'192.0.2.53');expect((await events()).total).toBe(before+1);
  await db.update(devices).set({status:'ACTIVE'}).where(whereEq(devices.id,device.id));
 });

 it('counts valid installer GET requests without counting HEAD, unknown or missing files',async()=>{
  const before=await downloadCount();const path=`/api/v1/releases/files/${releaseId}`;
  const head=await app.inject({method:'HEAD',url:path});expect(head.statusCode).toBe(200);expect(await downloadCount()).toBe(before);
  expect((await app.inject({url:`/api/v1/releases/files/${randomUUID()}`})).statusCode).toBe(404);
  expect((await app.inject({url:`/api/v1/releases/files/${missingReleaseId}`})).statusCode).toBe(503);expect(await downloadCount()).toBe(before);
  await database.db.update(database.releases).set({published:false}).where((await eq())(database.releases.id,releaseId));
  expect((await app.inject({url:path})).statusCode).toBe(404);expect(await downloadCount()).toBe(before);
  await database.db.update(database.releases).set({published:true}).where((await eq())(database.releases.id,releaseId));
  for(let n=1;n<=2;n++){const response=await app.inject({url:path});expect(response.statusCode,response.body).toBe(200);expect(response.rawPayload.toString()).toBe('MZ synthetic installer fixture');await expect.poll(downloadCount).toBe(before+n);}
  const summary=await app.inject({url:'/api/v1/admin/site/summary',headers});expect(summary.statusCode,summary.body).toBe(200);
  expect(summary.json()).toMatchObject({timezone:'UTC',uniqueVisitorsAvailable:false,downloads:{data:expect.arrayContaining([expect.objectContaining({version,platform:'windows',arch:'x64',downloads:before+2})])}});
  expect(summary.json().downloads.total).toBeGreaterThanOrEqual(before+2);expect(summary.json().trackingSince).not.toBeNull();
  const telemetry=await import('./site-visits.js');const failedCounter=vi.spyOn(telemetry,'recordClientDownload').mockRejectedValueOnce(new Error('fixture counter offline'));
  try{
   const response=await app.inject({url:path});expect(response.statusCode,response.body).toBe(200);expect(response.rawPayload.toString()).toBe('MZ synthetic installer fixture');
   await expect.poll(()=>failedCounter.mock.calls.length).toBe(1);expect(await downloadCount()).toBe(before+2);
  }finally{failedCounter.mockRestore();}
 });

 it('refuses enabled or historical DeepSeek removal, then removes only unused retired records',async()=>{
  const {removeUnusedDeepSeekModels}=await import('./model-cleanup.js');
  const {db,providers,models,modelInstances,modelSessions,usageRecords,aiRequests,rateCards,rateCardVersions,planModelAccess,userModelAccess,systemSettings,auditLogs}=database;
  const {inArray}=await import('drizzle-orm');const whereEq=await eq();
  const [provider]=await db.insert(providers).values({code:`DEEPSEEK_${randomUUID().replaceAll('-','').slice(0,12).toUpperCase()}`,name:'Cleanup fixture'}).returning();
  const [retired]=await db.insert(models).values({providerId:provider.id,providerModelId:'deepseek-reasoner',publicId:'deepseek/deepseek-reasoner',displayName:'Retired fixture',enabled:true}).returning();
  const [flash]=await db.insert(models).values({providerId:provider.id,providerModelId:'deepseek-flash',publicId:'deepseek/deepseek-flash',displayName:'Flash control',enabled:true}).returning();
  const [oldArchive]=await db.select().from(systemSettings).where(whereEq(systemSettings.key,'archived_models'));
  try{
   await expect(removeUnusedDeepSeekModels(adminUser.id)).rejects.toThrow('REFUSE_ENABLED_MODEL_REMOVAL');
   await db.update(models).set({enabled:false}).where(whereEq(models.id,retired.id));
   const [instance]=await db.insert(modelInstances).values({modelId:retired.id,providerId:provider.id,providerModelId:retired.providerModelId}).returning();
   const [card]=await db.insert(rateCards).values({providerId:provider.id,modelId:retired.id,billingPolicy:'MANAGED_USAGE'}).returning();
   const [rate]=await db.insert(rateCardVersions).values({rateCardId:card.id,version:1,status:'ACTIVE',inputRate:'1',outputRate:'2'}).returning();
   await db.insert(planModelAccess).values({planId,modelId:retired.id});await db.insert(userModelAccess).values({userId:owner.id,modelId:retired.id,access:'ALLOW'});
   await db.insert(systemSettings).values({key:`model_markup:${retired.id}`,value:{multiplier:1,revision:0}});
   const archiveValue={...((oldArchive?.value??{}) as Record<string,unknown>),ids:[...((oldArchive?.value as {ids?:string[]}|undefined)?.ids??[]),retired.id]};
   await db.insert(systemSettings).values({key:'archived_models',value:archiveValue}).onConflictDoUpdate({target:systemSettings.key,set:{value:archiveValue}});
   const [session]=await db.insert(modelSessions).values({userId:owner.id,deviceId:device.id,providerId:provider.id,modelId:retired.id,instanceId:instance.id,clientThreadId:randomUUID(),expiresAt:new Date(Date.now()+60000)}).returning();
   await expect(removeUnusedDeepSeekModels(adminUser.id)).rejects.toThrow('REFUSE_MODEL_WITH_HISTORY');
   expect(await db.select().from(modelInstances).where(whereEq(modelInstances.id,instance.id))).toHaveLength(1);
   expect(await db.select().from(rateCardVersions).where(whereEq(rateCardVersions.id,rate.id))).toHaveLength(1);
   await db.delete(modelSessions).where(whereEq(modelSessions.id,session.id));
   const [usage]=await db.insert(usageRecords).values({userId:owner.id,deviceId:device.id,planId,providerId:provider.id,modelId:retired.id,status:'COMPLETED',totalTokens:1}).returning();
   await expect(removeUnusedDeepSeekModels(adminUser.id)).rejects.toThrow('REFUSE_MODEL_WITH_HISTORY');await db.delete(usageRecords).where(whereEq(usageRecords.id,usage.id));
   const [request]=await db.insert(aiRequests).values({responseId:`resp_${randomUUID().replaceAll('-','')}`,userId:owner.id,deviceId:device.id,providerId:provider.id,modelId:flash.id,rateCardVersionId:rate.id,billingPolicy:'MANAGED_USAGE'}).returning();
   await expect(removeUnusedDeepSeekModels(adminUser.id)).rejects.toThrow('REFUSE_RATE_WITH_HISTORY');await db.delete(aiRequests).where(whereEq(aiRequests.id,request.id));
   expect(await removeUnusedDeepSeekModels(adminUser.id)).toEqual({removed:['deepseek/deepseek-reasoner']});
   expect(await db.select().from(models).where(whereEq(models.id,retired.id))).toHaveLength(0);
   expect(await db.select().from(models).where(whereEq(models.id,flash.id))).toMatchObject([{enabled:true,publicId:'deepseek/deepseek-flash'}]);
   for(const table of [modelInstances,rateCards,planModelAccess,userModelAccess])expect(await db.select().from(table).where(whereEq(table.modelId,retired.id))).toHaveLength(0);
   expect(await db.select().from(rateCardVersions).where(whereEq(rateCardVersions.id,rate.id))).toHaveLength(0);
   expect(await db.select().from(systemSettings).where(whereEq(systemSettings.key,`model_markup:${retired.id}`))).toHaveLength(0);
   const [archive]=await db.select().from(systemSettings).where(whereEq(systemSettings.key,'archived_models'));expect((archive.value as {ids:string[]}).ids).not.toContain(retired.id);
   const audit=await db.select().from(auditLogs).where(whereEq(auditLogs.targetId,retired.id));expect(audit).toEqual(expect.arrayContaining([expect.objectContaining({action:'MODEL_RECORDS_REMOVED',metadata:expect.objectContaining({historicalRowsDeleted:0})})]));
  }finally{
   const modelIds=[retired.id,flash.id];
   await db.delete(modelSessions).where(inArray(modelSessions.modelId,modelIds));await db.delete(aiRequests).where(inArray(aiRequests.modelId,modelIds));await db.delete(usageRecords).where(inArray(usageRecords.modelId,modelIds));
   const remainingCards=await db.select({id:rateCards.id}).from(rateCards).where(inArray(rateCards.modelId,modelIds));
   if(remainingCards.length)await db.delete(rateCardVersions).where(inArray(rateCardVersions.rateCardId,remainingCards.map(c=>c.id)));
   await db.delete(rateCards).where(inArray(rateCards.modelId,modelIds));await db.delete(planModelAccess).where(inArray(planModelAccess.modelId,modelIds));await db.delete(userModelAccess).where(inArray(userModelAccess.modelId,modelIds));await db.delete(modelInstances).where(inArray(modelInstances.modelId,modelIds));await db.delete(models).where(inArray(models.id,modelIds));await db.delete(providers).where(whereEq(providers.id,provider.id));
   await db.delete(systemSettings).where(whereEq(systemSettings.key,`model_markup:${retired.id}`));
   if(oldArchive)await db.update(systemSettings).set({value:oldArchive.value,updatedAt:oldArchive.updatedAt}).where(whereEq(systemSettings.key,'archived_models'));else await db.delete(systemSettings).where(whereEq(systemSettings.key,'archived_models'));
  }
 });
});
