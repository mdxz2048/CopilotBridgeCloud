import type { FastifyInstance, FastifyRequest } from 'fastify';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { z } from 'zod';
import { db, auditLogs } from '@bridge/db';
import { admin } from './core.js';
import { config } from './config.js';
import { ApiError } from './errors.js';
import { FlightRecorder } from './flight-recorder.js';

let recorder:FlightRecorder|undefined;
const identities=new WeakMap<FastifyRequest,{userId:string;requestId:string}>();
export function getFlightRecorder():FlightRecorder|undefined {
  if(process.env.FLIGHT_RECORDER_ENABLED==='false'||(process.env.NODE_ENV==='test'&&process.env.FLIGHT_RECORDER_ENABLED!=='true'))return undefined;
  return recorder??=new FlightRecorder({directory:resolve(process.env.FLIGHT_RECORDER_DIR??join(process.env.RELEASE_STORAGE_DIR??join(homedir(),'.bridge-cloud','releases'),'flight-recorder')),
    key:Buffer.from(config.PROVIDER_MASTER_KEY,'hex')});
}
export function beginFlight(req:FastifyRequest,userId:string,deviceId?:string):void {
  try{
    identities.set(req,{userId,requestId:req.id});
    getFlightRecorder()?.start({userId,deviceId,requestId:req.id,
      traceId:typeof req.headers['x-bridge-trace-id']==='string'?req.headers['x-bridge-trace-id']:undefined,
      threadId:typeof req.headers['x-client-thread-id']==='string'?req.headers['x-client-thread-id']:undefined},req.body);
  }catch{/* Recorder failures never fail model requests. */}
}
export function recordFlight(req:FastifyRequest,kind:string,value:unknown):void {try{getFlightRecorder()?.record(req.id,kind,value);}catch{}}
export function associateFlight(req:FastifyRequest,...ids:Array<string|null|undefined>):void {try{for(const id of ids)if(id)getFlightRecorder()?.associate(req.id,id);}catch{}}
export function failFlight(req:FastifyRequest,source:string,code:string):void {
  try{const identity=identities.get(req);if(!identity)return;recordFlight(req,'failure',{source,code});void getFlightRecorder()?.freeze(identity.userId,{source,code,requestId:req.id}).catch(()=>{});}catch{}
}
export async function captureClientFlight(userId:string,cause:{requestId?:string;traceId?:string;failureId:string;code:string}):Promise<string|null> {
  try{return await getFlightRecorder()?.freeze(userId,{...cause,source:'client_feedback'})??null;}catch{return null;}
}
export function flightSnapshotId(userId:string,requestId?:string,traceId?:string){try{return getFlightRecorder()?.find(userId,requestId,traceId)??null;}catch{return null;}}

export async function registerFlightRecorder(app:FastifyInstance){
  const service=getFlightRecorder();
  if(service)await service.flush();
  const timer=setInterval(()=>{if(service)void service.flush().then(()=>service.clean()).catch(()=>app.log.warn({event:'flight_recorder_cleanup_failed'},'diagnostic cleanup failed'));},60000);timer.unref();
  app.addHook('onClose',async()=>{clearInterval(timer);await service?.flush();});
  app.addHook('onError',async(req,_reply,error)=>{if(identities.has(req)){recordFlight(req,'http_error',{code:(error as {code?:string}).code,message:error.message});failFlight(req,'http_error',typeof (error as {code?:string}).code==='string'?(error as {code:string}).code:'REQUEST_ERROR');}});
  app.addHook('onSend',async(req,_reply,payload)=>{
    if(identities.has(req)&&typeof payload==='string'){try{recordFlight(req,'http_response',JSON.parse(payload));}catch{recordFlight(req,'http_response',payload);}}
    return payload;
  });
  app.addHook('onResponse',async req=>{if(identities.has(req))service?.finish(req.id);});
  app.get('/api/v1/admin/diagnostics/flight-snapshots',async req=>{
    await admin(req);const query=z.object({userId:z.uuid().optional()}).parse(req.query);
    return {enabled:Boolean(service),...(service?.status()??{}),data:await service?.list(query.userId)??[]};
  });
  app.get('/api/v1/admin/diagnostics/flight-snapshots/:id',async req=>{
    await admin(req);const id=z.uuid().parse((req.params as {id:string}).id),manifest=(await service?.list())?.find(m=>m.id===id);
    if(!manifest)throw new ApiError(404,'NOT_FOUND');return {snapshot:manifest};
  });
  app.get('/api/v1/admin/diagnostics/flight-snapshots/:id/download',async(req,reply)=>{
    const operator=await admin(req);const id=z.uuid().parse((req.params as {id:string}).id),manifest=(await service?.list())?.find(m=>m.id===id);
    if(!manifest||!service)throw new ApiError(404,'NOT_FOUND');
    await db.insert(auditLogs).values({actorId:operator.user.id,action:'FLIGHT_SNAPSHOT_DOWNLOADED',targetType:'FLIGHT_SNAPSHOT',targetId:id,metadata:{userId:manifest.userId,recordCount:manifest.recordCount}});
    reply.header('Content-Type','application/x-ndjson; charset=utf-8').header('Content-Disposition',`attachment; filename="flight-${id}.ndjson"`).header('Cache-Control','no-store').header('X-Content-Type-Options','nosniff');
    return reply.send(Readable.from(service.download(id)));
  });
}
