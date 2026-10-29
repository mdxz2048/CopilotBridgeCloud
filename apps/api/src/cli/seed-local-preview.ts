import {randomUUID} from 'node:crypto';
import {db,pool,users,plans,subscriptions,devices,deviceBillingPeriods,systemSettings,userFeedback,providers,models,rateCards,rateCardVersions} from '@bridge/db';
import {eq} from 'drizzle-orm';
import {hashPassword,encryptSecret} from '../security.js';
import {applyWalletChange} from '../wallet.js';

const target=new URL(process.env.DATABASE_URL??'');
if(process.env.LOCAL_PREVIEW!=='true'||target.hostname!=='127.0.0.1'||target.pathname!=='/bridge_local_preview')throw Error('REFUSE_NON_LOCAL_PREVIEW_DATABASE');
const password=process.env.LOCAL_PREVIEW_PASSWORD;
if(!password||password.length<12)throw Error('LOCAL_PREVIEW_PASSWORD_REQUIRED');
const [seeded]=await db.select().from(systemSettings).where(eq(systemSettings.key,'local_preview_seed_v1')).limit(1);
if(!seeded){
 const now=new Date(),day=86400000,passwordHash=await hashPassword(password);
 await db.transaction(async tx=>{
  const [plan]=await tx.insert(plans).values({code:'PAYG',name:'按量使用 · 本地预览',description:'仅用于本机功能预览，不连接付费模型',monthlyPrice:'0',maxDevices:5,monthlyTokenLimit:2000000000,monthlyUsageCreditLimit:'2000000000',maxConcurrentRequests:10,requestsPerMinute:0,rolloverPolicy:'UNLIMITED'}).returning();
  const accounts=[['admin@example.test','ADMIN','ACTIVE',200000],['user@example.test','USER','ACTIVE',1500000],['locked@example.test','USER','DISABLED',50000],['empty@example.test','USER','ACTIVE',0],['a-long-preview-email-for-layout@example.test','USER','ACTIVE',325000]];
  for(const [email,role,status,balance] of accounts){
   const [user]=await tx.insert(users).values({email:String(email),role:String(role),status:String(status),passwordHash}).returning();
   await tx.insert(subscriptions).values({userId:user.id,planId:plan.id,status:'ACTIVE',startedAt:now,currentPeriodStart:new Date(now.getTime()-30*day),currentPeriodEnd:new Date(now.getTime()+30*day)});
   if(Number(balance)>0)await applyWalletChange(tx,{userId:user.id,points:Number(balance),type:'ADMIN_ADJUSTMENT',referenceType:'LOCAL_PREVIEW',referenceId:user.id,idempotencyKey:`local-preview-credit:${user.id}`,metadata:{reason:'仅用于本地界面预览的合成余额'}});
   if(email!=='user@example.test')continue;
   await applyWalletChange(tx,{userId:user.id,points:50000,type:'REFERRAL_REWARD',referenceType:'LOCAL_PREVIEW',referenceId:user.id,idempotencyKey:`local-preview-reward:${user.id}`,expiresAt:new Date(now.getTime()+7*day)});
   const [device]=await tx.insert(devices).values({userId:user.id,deviceId:randomUUID(),deviceName:'演示工作电脑',platform:'Windows',osVersion:'11',appVersion:'0.3.31',lastSeenAt:new Date(now.getTime()-day)}).returning();
   for(let i=0;i<24;i++){
    const points=500+i*25,endedAt=new Date(now.getTime()-(i+1)*3600000);
    await applyWalletChange(tx,{userId:user.id,points:-points,type:'USAGE',referenceType:'LOCAL_PREVIEW',referenceId:`period-${i}`,idempotencyKey:`local-preview-consumption:${user.id}:${i}`});
    await tx.insert(deviceBillingPeriods).values({userId:user.id,deviceId:device.id,deviceName:device.deviceName,bindingId:device.deviceId,kind:'NORMAL',startedAt:new Date(endedAt.getTime()-1800000),endedAt,chargedPoints:points});
   }
   for(const [kind,title,content,status] of [['FEATURE','希望支持按设备筛选扣费','演示反馈：希望更快找到另一台电脑的消费记录。','OPEN'],['ISSUE','小窗口使用体验','演示反馈：希望进一步精简小窗口下的提示。','IN_PROGRESS'],['OTHER','界面反馈','演示反馈：新的账户分组更容易阅读。','RESOLVED']])await tx.insert(userFeedback).values({userId:user.id,clientId:randomUUID(),kind,status,...encryptSecret(JSON.stringify({title,content}))});
  }
  await tx.insert(systemSettings).values({key:'local_preview_seed_v1',value:{seededAt:now.toISOString(),synthetic:true}});
 });
}
const [consumptionSeed]=await db.select().from(systemSettings).where(eq(systemSettings.key,'local_preview_consumption_v2')).limit(1);
if(!consumptionSeed){
 const [user]=await db.select().from(users).where(eq(users.email,'user@example.test'));
 const owned=await db.select().from(devices).where(eq(devices.userId,user.id));
 const current=owned.find(d=>d.deviceName!=='演示工作电脑')??owned[0];
 const historical=owned.find(d=>d.id!==current.id)??current;
 const [provider]=await db.insert(providers).values({code:'local-'+randomUUID().slice(0,24),name:'本地合成用量 · 不连接上游'}).returning();
 const [model]=await db.insert(models).values({providerId:provider.id,providerModelId:'local-only',publicId:'local-demo-'+randomUUID(),displayName:'GPT-6.1 · 本地演示'}).returning();
 const [card]=await db.insert(rateCards).values({providerId:provider.id,modelId:model.id,billingPolicy:'MANAGED_USAGE'}).returning();
 const [rate]=await db.insert(rateCardVersions).values({rateCardId:card.id,version:1,status:'ACTIVE',inputRate:'10',cachedInputRate:'5',outputRate:'30',reasoningRate:'40'}).returning();
 const {createAiRequest,settleAiRequest}=await import('../metering.js');
 for(let i=0;i<25;i++){
  const d=i<23?current:historical;
  const request=await createAiRequest({responseId:'resp_local_'+randomUUID(),userId:user.id,deviceId:d.id,providerId:provider.id,modelId:model.id,billingPolicy:'MANAGED_USAGE',rateCardVersionId:rate.id});
  await settleAiRequest(request.id,i===22?'CLIENT_DISCONNECTED':'COMPLETED',i===22?{usageUnavailable:true}:{usage:{inputTokens:1000*(1+i%3),cachedInputTokens:200,outputTokens:500,reasoningTokens:100}});
 }
 await db.insert(systemSettings).values({key:'local_preview_consumption_v2',value:{synthetic:true,seededAt:new Date().toISOString()}});
}
console.log('Local preview accounts and synthetic consumption ready. No upstream credentials configured.');
await pool.end();
