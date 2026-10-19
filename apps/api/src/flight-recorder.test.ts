import { describe,it,expect } from 'vitest';
import { randomBytes,randomUUID } from 'node:crypto';
import { mkdtemp,readFile,readdir,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FlightRecorder,redactFlight } from './flight-recorder.js';

async function fixture(options:Partial<ConstructorParameters<typeof FlightRecorder>[0]>={}){
  const directory=await mkdtemp(join(tmpdir(),'bridge-flight-'));let now=1_800_000_000_000;
  const key=randomBytes(32),recorder=new FlightRecorder({directory,key,now:()=>now,...options});await recorder.flush();
  const user=randomUUID(),other=randomUUID(),request=randomUUID();
  return {directory,key,recorder,user,other,request,advance:(ms:number)=>{now+=ms;},cleanup:()=>rm(directory,{recursive:true,force:true})};
}
async function records(recorder:FlightRecorder,id:string){const values=[];for await(const line of recorder.download(id))values.push(JSON.parse(line));return values;}
describe('five minute per-user flight recorder',()=>{
  it('retains complete tools and text, freezes all same-user conversations and excludes another user',async()=>{
    const f=await fixture();try{
      const body={tools:Array.from({length:200},(_,i)=>({type:'function',name:'tool_'+i,parameters:{type:'object'}})),input:[{role:'user',content:'SAFE_DOCUMENT_'+ '中文文本'.repeat(30000)}]};
      f.recorder.start({userId:f.user,requestId:f.request,traceId:'trace-fixture'},body);f.recorder.associate(f.request,'ai-fixture');
      f.recorder.record(f.request,'upstream_event',{type:'response.output_item.added',item:{name:'exec_command'}});
      const second=randomUUID();f.recorder.start({userId:f.user,requestId:second},{input:'SECOND_CONVERSATION'});
      f.recorder.start({userId:f.other,requestId:randomUUID()},{input:'OTHER_USER_PRIVATE'});
      const id=await f.recorder.freeze(f.user,{source:'client_feedback',code:'INVALID_SERVER_RESPONSE',requestId:'ai-fixture',failureId:'failure-fixture'});expect(id).toBeTruthy();
      const values=await records(f.recorder,id!);const text=JSON.stringify(values);
      expect(text).toContain('tool_199');expect(text).toContain('SAFE_DOCUMENT_');expect(text).toContain('SECOND_CONVERSATION');expect(text).not.toContain('OTHER_USER_PRIVATE');
      const request=values.find(v=>v.kind==='request'&&v.requestId===f.request);expect(request.data.input[0].content).toBe(body.input[0].content);
      const inventory=values.find(v=>v.kind==='tool_inventory'&&v.requestId===f.request);expect(inventory.data.tools).toHaveLength(200);
      const files=await readdir(f.directory);for(const name of files){const bytes=await readFile(join(f.directory,name));expect(bytes.includes(Buffer.from('SAFE_DOCUMENT'))).toBe(false);expect(bytes.includes(Buffer.from('tool_199'))).toBe(false);}
      expect(f.recorder.find(f.user,'ai-fixture')).toBe(id);expect(f.recorder.find(f.other,'ai-fixture')).toBeUndefined();
    }finally{await f.cleanup();}
  });
  it('drops old completed requests but retains an active request anchor and only recent reply events',async()=>{
    const f=await fixture();try{
      f.recorder.start({userId:f.user,requestId:f.request},{input:'ACTIVE_ANCHOR'});f.recorder.record(f.request,'upstream_event',{text:'OLD_EVENT'});
      const complete=randomUUID();f.recorder.start({userId:f.user,requestId:complete},{input:'OLD_COMPLETED'});f.recorder.finish(complete);
      f.advance(301000);f.recorder.record(f.request,'upstream_event',{text:'RECENT_EVENT'});
      const id=await f.recorder.freeze(f.user,{source:'server',code:'FAILED',requestId:f.request});const text=JSON.stringify(await records(f.recorder,id!));
      expect(text).toContain('ACTIVE_ANCHOR');expect(text).toContain('RECENT_EVENT');expect(text).not.toContain('OLD_EVENT');expect(text).not.toContain('OLD_COMPLETED');
      expect((await f.recorder.list())[0].gaps).not.toContain('server_started_within_window');
    }finally{await f.cleanup();}
  });
  it('coalesces server and client errors for one request, persists across restart and expires snapshots',async()=>{
    const f=await fixture({retentionMs:1000});try{
      f.recorder.start({userId:f.user,requestId:f.request},{input:'synthetic'});f.recorder.associate(f.request,'ai-id');
      const first=await f.recorder.freeze(f.user,{source:'server',code:'CLIENT_DISCONNECTED',requestId:f.request});
      const second=await f.recorder.freeze(f.user,{source:'client_feedback',code:'INVALID_SERVER_RESPONSE',requestId:'ai-id',failureId:'diag-id'});expect(second).toBe(first);
      const restored=new FlightRecorder({directory:f.directory,key:f.key,now:()=>1_800_000_000_000,retentionMs:1000});await restored.flush();expect((await restored.list())[0].causes).toHaveLength(2);
      f.advance(1001);await f.recorder.clean();expect(await f.recorder.list()).toHaveLength(0);expect(await readdir(f.directory)).toHaveLength(0);
    }finally{await f.cleanup();}
  });
  it('marks capacity gaps and preserves the small independent tool inventory',async()=>{
    const f=await fixture({perUserBytes:2000,totalBytes:10000});try{
      f.recorder.start({userId:f.user,requestId:f.request},{tools:[{type:'function',name:'KEEP_TOOL'}],input:randomBytes(1200).toString('hex')});
      for(let i=0;i<20;i++)f.recorder.record(f.request,'upstream_event',{text:randomBytes(200).toString('hex')});
      const id=await f.recorder.freeze(f.user,{source:'server',code:'FAILED',requestId:f.request});const manifest=(await f.recorder.list())[0];
      expect(manifest.gaps).toContain('capacity_eviction');expect(JSON.stringify(await records(f.recorder,id!))).toContain('KEEP_TOOL');
    }finally{await f.cleanup();}
  });
  it('cleans old snapshot files by count without removing unrelated files',async()=>{
    const f=await fixture({maxSnapshots:2});try{
      for(let i=0;i<3;i++){const request=randomUUID();f.recorder.start({userId:f.user,requestId:request},{input:'fixture'+i});await f.recorder.freeze(f.user,{source:'server',code:'FAIL',requestId:request});f.advance(1);}
      expect(await f.recorder.list()).toHaveLength(2);expect((await readdir(f.directory)).filter(n=>n.endsWith('.manifest.enc'))).toHaveLength(2);
    }finally{await f.cleanup();}
  });
  it('does not throw into generation when snapshot storage is unavailable',async()=>{
    const f=await fixture();await f.cleanup();
    f.recorder.start({userId:f.user,requestId:f.request},{input:'synthetic'});
    expect(await f.recorder.freeze(f.user,{source:'server',code:'FAIL',requestId:f.request})).toBeNull();expect(f.recorder.status().failedWrites).toBeGreaterThan(0);
  });
  it('removes credentials and attachment bytes while preserving nested tool argument JSON',()=>{
    const value={headers:{authorization:'Bearer HIDDEN'},password:'HIDDEN',input:'safe code',arguments:JSON.stringify({cmd:'safe',apiKey:'HIDDEN'}),file_data:'HIDDEN',text:'API_KEY="HIDDEN" Bearer HIDDEN'};
    const redacted=JSON.stringify(redactFlight(value));expect(redacted).not.toContain('HIDDEN');expect(redacted).toContain('safe code');expect(redacted).toContain('safe');
  });
});
