import { randomUUID } from 'node:crypto';
import { advanceDeviceBilling } from './device-billing.js';
import type {FastifyInstance} from 'fastify';
import {isIP} from 'node:net';
import {db,auditLogs,devices,users} from '@bridge/db';
import {and,desc,eq,ilike,sql} from 'drizzle-orm';
import {z} from 'zod';
import {admin} from './core.js';

type Source='WEB_LOGIN'|'APP_LOGIN'|'APP_RECONNECT'|'APP_START';
type Tx=Parameters<Parameters<typeof db.transaction>[0]>[0];
type Device=typeof devices.$inferSelect;
function onlineMetadata({device,ip,source,userAgent=''}:{device?:Device;ip:string;source:Source;userAgent?:string}) {
  const platform=/Android/i.test(userAgent)?'Android':/iPhone|iPad/i.test(userAgent)?'iOS':/Windows/i.test(userAgent)?'Windows':/Macintosh|Mac OS/i.test(userAgent)?'macOS':/Linux/i.test(userAgent)?'Linux':'网页';
  const browser=/Edg\//.test(userAgent)?'Edge':/Firefox\//.test(userAgent)?'Firefox':/Chrome\//.test(userAgent)?'Chrome':/Safari\//.test(userAgent)?'Safari':'浏览器';
  return {source,deviceId:device?.deviceId??null,authMethod:source==='WEB_LOGIN'||source==='APP_LOGIN'?'PASSWORD':'TOKEN',deviceName:device?.deviceName??`${platform} · ${browser}`,platform:device?.platform??platform,
    osVersion:device?.osVersion??'',appVersion:device?.appVersion??'',ipAddress:isIP(ip)?ip:null};
}
export async function recordOnlineEvent(input:{userId:string;device?:Device;ip:string;source:Source;userAgent?:string;loginSessionId?:string},tx:Tx|typeof db=db):Promise<void> {
  // Standalone callers must receive the same atomic boundary as login transactions.
  if (tx === db) return db.transaction(inner => recordOnlineEvent(input, inner));
  const id = randomUUID();
  const boundary = input.device ? await advanceDeviceBilling(tx as Tx, input.userId, input.device, id) : null;
  await tx.insert(auditLogs).values({id,actorId:input.userId,action:'USER_ONLINE',targetType:input.device?'DEVICE':'USER',
    targetId:input.device?.id??input.userId,createdAt:boundary?.at??new Date(),
    metadata:{...onlineMetadata(input),...(boundary?{previousBilling:boundary.previous}:{}),...(input.loginSessionId?{loginSessionId:input.loginSessionId}:{})}});
}
export async function heartbeatDevice(device:Device,ip:string) {
  if(device.lastSeenAt&&Date.now()-device.lastSeenAt.getTime()<60000)return;
  await db.transaction(async tx=>{
    const [current]=await tx.select().from(devices).where(eq(devices.id,device.id)).for('update').limit(1);
    const now=new Date();
    if(!current||current.status!=='ACTIVE'||(current.lastSeenAt&&now.getTime()-current.lastSeenAt.getTime()<60000))return;
    await tx.update(devices).set({lastSeenAt:now}).where(eq(devices.id,device.id));
    if(!current.lastSeenAt||now.getTime()-current.lastSeenAt.getTime()>=300000){
      await recordOnlineEvent({userId:current.userId,device:current,ip,source:'APP_RECONNECT'},tx);
    }
  });
}
export function registerOnlineEvents(app:FastifyInstance) {
  app.get('/api/v1/admin/online-events',async req=>{
    await admin(req);
    const query=z.object({email:z.string().trim().max(320).optional(),page:z.coerce.number().int().min(1).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(30)}).parse(req.query);
    const where=and(eq(auditLogs.action,'USER_ONLINE'),query.email?ilike(users.email,`%${query.email}%`):undefined);
    const [count]=await db.select({total:sql<number>`count(*)`}).from(auditLogs).innerJoin(users,eq(users.id,auditLogs.actorId)).where(where);
    const rows=await db.select({id:auditLogs.id,email:users.email,metadata:auditLogs.metadata,createdAt:auditLogs.createdAt})
      .from(auditLogs).innerJoin(users,eq(users.id,auditLogs.actorId)).where(where).orderBy(desc(auditLogs.createdAt),desc(auditLogs.id)).limit(query.pageSize).offset((query.page-1)*query.pageSize);
    return {data:rows.map(row=>({id:row.id,email:row.email,createdAt:row.createdAt,
      billingRecorded:Object.hasOwn(row.metadata,'previousBilling'),previousBilling:row.metadata.previousBilling??null,source:String(row.metadata.source??'APP_RECONNECT'),deviceId:typeof row.metadata.deviceId==='string'?row.metadata.deviceId:null,authMethod:typeof row.metadata.authMethod==='string'?row.metadata.authMethod:null,deviceName:String(row.metadata.deviceName??'未知设备'),platform:String(row.metadata.platform??''),
      osVersion:String(row.metadata.osVersion??''),appVersion:String(row.metadata.appVersion??''),ipAddress:typeof row.metadata.ipAddress==='string'?row.metadata.ipAddress:null})),
      total:Number(count.total),page:query.page,pageSize:query.pageSize};
  });
}
