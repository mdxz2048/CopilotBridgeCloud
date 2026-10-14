import type { FastifyInstance } from 'fastify';
import { FailureDiagnosticSchema } from '@bridge/contract';
import { auditLogs,db,failureDiagnostics,systemSettings } from '@bridge/db';
import { and,eq,desc,sql } from 'drizzle-orm';
import { z } from 'zod';
import { actor,admin } from './core.js';
import { ApiError } from './errors.js';
import { config } from './config.js';
import { encryptSecret,decryptSecret } from './security.js';

export const DIAGNOSTIC_MAX_BYTES=128*1024;
const secretKey=/^key$|authorization|headers?|cookies?|password|passwd|secret|credentials?|token|api[_-]?key|dpop|publickeyjwk|encrypted_content|file_data|base64|binary/i;
export function sanitizeDiagnostic(value:unknown,depth=0,flags={truncated:false}):unknown {
  if(depth>8){flags.truncated=true;return '[DEPTH_LIMIT]';}
  if(typeof value==='string'){
    let text=value;
    if(/^[\s]*[\[{]/.test(text)){try{const parsed=JSON.parse(text);if(parsed&&typeof parsed==='object'){
      text=JSON.stringify(sanitizeDiagnostic(parsed,depth+1,flags));if(text.length>16384)flags.truncated=true;return text.slice(0,16384);
    }}catch{/* Plain tool text stays text. */}}
    text=text.replace(/data:[^\s"']+;base64,[a-zA-Z0-9+/=]+/g,'[BINARY_REMOVED]')
    .replace(/\b(?:Bearer\s+\S+|sk-[a-zA-Z0-9_-]{8,}|eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+)/gi,'[SECRET_REMOVED]')
    .replace(/\b((?:[a-z0-9]+_)*(?:password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|cookie))["']?\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,"';}]+)/gi,'$1=[SECRET_REMOVED]')
    .replace(/([?&](?:key|token|signature|sig|credential|x-amz-[\w-]+)=)[^&\s"']+/gi,'$1[SECRET_REMOVED]')
    .replace(/[a-zA-Z0-9+/]{512,}={0,2}/g,'[BINARY_REMOVED]');
    if(text.length>16384)flags.truncated=true;return text.slice(0,16384);
  }
  if(Array.isArray(value)){if(value.length>64)flags.truncated=true;return value.slice(0,64).map(item=>sanitizeDiagnostic(item,depth+1,flags));}
  if(value&&typeof value==='object'){const entries=Object.entries(value);if(entries.length>128||entries.some(([key])=>key.length>128))flags.truncated=true;
    return Object.fromEntries(entries.slice(0,128).map(([key,item])=>[key.slice(0,128),secretKey.test(key)?'[REDACTED]':sanitizeDiagnostic(item,depth+1,flags)]));}
  return value;
}
export async function pruneFailureDiagnostics(tx:Pick<typeof db,'execute'>) {
  await tx.execute(sql`delete from ${failureDiagnostics} where created_at < now() - interval '14 days'`);
  await tx.execute(sql`delete from ${failureDiagnostics} where id in (select id from ${failureDiagnostics} order by created_at desc,id desc offset 1000)`);
  await tx.execute(sql`delete from ${failureDiagnostics} where id in (select id from (select id,sum(payload_bytes) over(order by created_at desc,id desc) as bytes from ${failureDiagnostics}) bounded where bytes>134217728)`);
}
export async function cleanFailureDiagnostics(){
  await db.transaction(async tx=>{await tx.execute(sql`select pg_advisory_xact_lock(81903317)`);await pruneFailureDiagnostics(tx);});
}
export function diagnosticModelNames(payload:{request?:{forwarded?:{model?:unknown};desktop?:{model?:unknown}}}){
  const model=payload.request?.forwarded?.model,clientModel=payload.request?.desktop?.model;
  return {model:typeof model==='string'?model.slice(0,200):null,clientModel:typeof clientModel==='string'?clientModel.slice(0,200):null};
}
function metadata(row:typeof failureDiagnostics.$inferSelect){
  const payload=JSON.parse(decryptSecret(row.payload));
  return {id:row.id,userId:row.userId,userEmail:row.userEmail,deviceId:row.deviceId,appVersion:row.appVersion,traceId:row.traceId,stage:row.stage,errorCode:row.errorCode,
    error:payload.error,...diagnosticModelNames(payload),requestId:payload.requestId??null,responseId:payload.responseId??null,threadId:payload.threadId??null,
    occurredAt:row.occurredAt,receivedAt:row.createdAt,truncated:Boolean(payload.truncated),payloadBytes:row.payloadBytes};
}
export async function registerDiagnostics(app:FastifyInstance){
  // Timer never logs private contents; startup and every upload also enforce bounds.
  const clean=()=>cleanFailureDiagnostics().catch(()=>app.log.warn('diagnostic retention cleanup failed'));
  await clean();const timer=setInterval(clean,3600000);timer.unref();app.addHook('onClose',async()=>clearInterval(timer));
  app.post('/api/v1/diagnostics/failures',{bodyLimit:DIAGNOSTIC_MAX_BYTES},async req=>{
    const auth=await actor(req);
    if(auth.web||!auth.device||req.headers['x-device-id']!==auth.device.deviceId)throw new ApiError(401,'DEVICE_PROOF_INVALID');
    const body=FailureDiagnosticSchema.parse(req.body);
    if(Math.abs(Date.now()-new Date(body.occurredAt).getTime())>14*86400000)throw new ApiError(400,'VALIDATION_ERROR','失败时间必须在最近十四天内。');
    if(body.ownerUserId!==auth.user.id)throw new ApiError(403,'FORBIDDEN');
    if(Buffer.byteLength(JSON.stringify(body))>DIAGNOSTIC_MAX_BYTES)throw new ApiError(413,'PAYLOAD_TOO_LARGE');
    body.appVersion=auth.device.appVersion.slice(0,64);
    const flags={truncated:false};const sanitized=sanitizeDiagnostic(body,0,flags) as Record<string,unknown>;
    sanitized.truncated=Boolean(body.truncated||flags.truncated);
    const payload=encryptSecret(JSON.stringify(sanitized));
    return db.transaction(async tx=>{
      await tx.execute(sql`select pg_advisory_xact_lock(81903317)`);
      await pruneFailureDiagnostics(tx);
      const [existing]=await tx.select().from(failureDiagnostics).where(eq(failureDiagnostics.id,body.id)).limit(1);
      if(existing){if(existing.userId!==auth.user.id)throw new ApiError(403,'FORBIDDEN');return {id:body.id,received:true,duplicate:true};}
      // One durable rolling-window counter per user survives report deletion/eviction.
      const key='diagnostic_rate:'+auth.user.id;
      const [rateRow]=await tx.select().from(systemSettings).where(eq(systemSettings.key,key)).limit(1);
      const value=rateRow?.value as {startedAt?:number;count?:number}|undefined;
      const window=value?.startedAt&&Date.now()-value.startedAt<3600000?{startedAt:value.startedAt,count:Number(value.count??0)}:{startedAt:Date.now(),count:0};
      if(window.count>=30)throw new ApiError(429,'RATE_LIMITED','失败报告上传次数已达每小时上限。');
      await tx.insert(systemSettings).values({key,value:{...window,count:window.count+1}}).onConflictDoUpdate({target:systemSettings.key,set:{value:{...window,count:window.count+1}}});
      await tx.insert(failureDiagnostics).values({id:body.id,userId:auth.user.id,deviceId:auth.device!.id,userEmail:auth.user.email,appVersion:body.appVersion,traceId:body.traceId,stage:body.stage,
        errorCode:String(sanitizeDiagnostic(body.error.code)),occurredAt:new Date(body.occurredAt),payload,payloadBytes:Buffer.byteLength(JSON.stringify(payload))});
      await pruneFailureDiagnostics(tx);
      return {id:body.id,received:true,duplicate:false};
    });
  });
  app.get('/api/v1/admin/diagnostics/failures',async req=>{
    await admin(req);
    const query=z.object({email:z.string().trim().max(320).optional(),code:z.string().trim().max(100).optional(),page:z.coerce.number().int().min(1).max(1000).default(1)}).parse(req.query);
    const where=and(query.email?eq(failureDiagnostics.userEmail,query.email):undefined,query.code?eq(failureDiagnostics.errorCode,query.code):undefined,sql`${failureDiagnostics.createdAt}>now()-interval '14 days'`);
    const rows=await db.select().from(failureDiagnostics).where(where).orderBy(desc(failureDiagnostics.createdAt)).limit(25).offset((query.page-1)*25);
    const count=await db.select({count:sql<number>`count(*)::integer`}).from(failureDiagnostics).where(where);
    return {data:rows.map(metadata),total:count[0]?.count??0,page:query.page,pageSize:25};
  });
  app.get('/api/v1/admin/diagnostics/failures/:id',async req=>{
    await admin(req);const id=z.uuid().parse((req.params as {id:string}).id);
    const [row]=await db.select().from(failureDiagnostics).where(and(eq(failureDiagnostics.id,id),sql`${failureDiagnostics.createdAt}>now()-interval '14 days'`)).limit(1);
    if(!row)throw new ApiError(404,'NOT_FOUND');
    return {report:{...metadata(row),payload:JSON.parse(decryptSecret(row.payload))}};
  });
  app.delete('/api/v1/admin/diagnostics/failures/:id',async req=>{
    const auth=await admin(req);if(req.headers.origin!==config.PUBLIC_BASE_URL)throw new ApiError(403,'CSRF_REJECTED');
    const id=z.uuid().parse((req.params as {id:string}).id);
    return db.transaction(async tx=>{
      const deleted=await tx.delete(failureDiagnostics).where(eq(failureDiagnostics.id,id)).returning({id:failureDiagnostics.id});
      if(!deleted.length)throw new ApiError(404,'NOT_FOUND');
      await tx.insert(auditLogs).values({actorId:auth.user.id,action:'DIAGNOSTIC_DELETED',targetType:'FAILURE_DIAGNOSTIC',targetId:id,metadata:{}});
      return {id,deleted:true};
    });
  });
}
