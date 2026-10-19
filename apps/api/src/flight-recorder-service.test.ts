import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {randomUUID} from 'node:crypto';import Fastify,{type FastifyRequest,type FastifyReply} from 'fastify';
vi.hoisted(()=>{process.env.DATABASE_URL??='postgres://test:test@localhost/test';process.env.ACCESS_SECRET??='a'.repeat(64);process.env.REFRESH_TOKEN_PEPPER??='b'.repeat(64);process.env.PROVIDER_MASTER_KEY??='c'.repeat(64);process.env.PUBLIC_BASE_URL??='http://localhost:3001';});
const state=vi.hoisted(()=>({authorized:true,audits:[] as unknown[]}));
vi.mock('./core.js',()=>({admin:async()=>{if(!state.authorized)throw Object.assign(new Error('FORBIDDEN'),{statusCode:403});return {user:{id:'synthetic-admin'}};}}));
vi.mock('@bridge/db',()=>({db:{insert:()=>({values:async(value:unknown)=>{state.audits.push(value);}})},auditLogs:{}}));

describe('flight recorder Fastify wiring',()=>{
 let directory:string,app:ReturnType<typeof Fastify>,service:typeof import('./flight-recorder-service.js');
 const user=randomUUID(),other=randomUUID();let requestId:string,snapshotId:string;
 beforeAll(async()=>{
  directory=await mkdtemp(join(tmpdir(),'bridge-flight-routes-'));process.env.FLIGHT_RECORDER_ENABLED='true';process.env.FLIGHT_RECORDER_DIR=directory;
  service=await import('./flight-recorder-service.js');app=Fastify({genReqId:()=>randomUUID()});await service.registerFlightRecorder(app);
  app.post('/synthetic-model',async(req:FastifyRequest,reply:FastifyReply)=>{requestId=req.id;service.beginFlight(req,user);service.associateFlight(req,'synthetic-ai');service.recordFlight(req,'upstream_event',{type:'response.output_item.added',item:{name:'exec_command'}});return reply.send({status:'completed'});});
  app.post('/synthetic-error',async(req:FastifyRequest)=>{service.beginFlight(req,other);throw Object.assign(new Error('synthetic error'),{statusCode:400,code:'TEST_FAILED'});});
 });
 afterAll(async()=>{await app?.close();await rm(directory,{recursive:true,force:true});delete process.env.FLIGHT_RECORDER_ENABLED;delete process.env.FLIGHT_RECORDER_DIR;});
 it('creates a server snapshot from a local client failure even when upstream HTTP succeeded',async()=>{
  const response=await app.inject({method:'POST',url:'/synthetic-model',payload:{tools:[{type:'function',name:'functions__exec'}],input:'SAFE_TEST_TEXT'}});expect(response.statusCode).toBe(200);
  const id=await service.captureClientFlight(user,{requestId:'synthetic-ai',traceId:'trace',failureId:randomUUID(),code:'INVALID_SERVER_RESPONSE'});expect(id).toBeTruthy();snapshotId=id!;
  const list=await app.inject({url:'/api/v1/admin/diagnostics/flight-snapshots'});expect(list.statusCode).toBe(200);expect(list.json().data).toHaveLength(1);expect(list.json().data[0].requests[0].requestId).toBe(requestId);
  const download=await app.inject({url:`/api/v1/admin/diagnostics/flight-snapshots/${id}/download`});expect(download.statusCode).toBe(200);expect(download.headers['cache-control']).toBe('no-store');expect(download.headers['content-disposition']).toContain('attachment');
  const frames=download.body.trim().split('\n').map((line:string)=>JSON.parse(line)) as Array<{kind:string;data:any}>;expect(frames.some(f=>f.kind==='http_response'&&f.data.status==='completed')).toBe(true);expect(frames.some(f=>f.kind==='upstream_event'&&f.data.item.name==='exec_command')).toBe(true);
  expect(state.audits).toHaveLength(1);
 });
 it('rejects unauthenticated exports and preserves per-user list filters',async()=>{
  state.authorized=false;expect((await app.inject({url:`/api/v1/admin/diagnostics/flight-snapshots/${snapshotId}/download`})).statusCode).toBe(403);state.authorized=true;
  const list=await app.inject({url:`/api/v1/admin/diagnostics/flight-snapshots?userId=${other}`});expect(list.json().data).toHaveLength(0);
  expect((await app.inject({url:'/api/v1/admin/diagnostics/flight-snapshots/not-a-uuid/download'})).statusCode).not.toBe(200);
 });
 it('automatically snapshots server-side request errors',async()=>{
  expect((await app.inject({method:'POST',url:'/synthetic-error',payload:{input:'OTHER_SYNTHETIC'}})).statusCode).toBe(400);
  const list=await app.inject({url:`/api/v1/admin/diagnostics/flight-snapshots?userId=${other}`});expect(list.json().data).toHaveLength(1);expect(list.json().data[0].causes[0].code).toBe('TEST_FAILED');
 });
});
