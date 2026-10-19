import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { mkdir, open, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const WINDOW = 5 * 60_000;
const RAW_LIMIT = 16 * 1024 * 1024;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
type Frame = { at:number; bytes:Buffer; anchor:boolean; kind:string };
export type FlightIdentity = { userId:string; requestId:string; deviceId?:string; traceId?:string; threadId?:string };
type RequestRecord = FlightIdentity & { aliases:string[]; startedAt:number; lastAt:number; active:boolean; frames:Frame[]; gaps:string[]; bytes:number };
export type SnapshotCause = { source:string; code:string; requestId?:string; traceId?:string; failureId?:string };
export type FlightManifest = { id:string; userId:string; createdAt:number; windowStart:number; windowEnd:number; expiresAt:number; bytes:number;
  recordCount:number; requests:Array<FlightIdentity & {aliases:string[];startedAt:number;active:boolean}>; causes:SnapshotCause[]; gaps:string[]; processStartedAt:number };
type Options = { directory:string; key:Buffer; now?:()=>number; perUserBytes?:number; totalBytes?:number; snapshotBytes?:number; retentionMs?:number; maxSnapshots?:number; perUserSnapshots?:number; warn?:()=>void };

/** Redact credentials and binary attachments, but retain text and tool definitions without the old 128 KiB excerpt limit. */
export function redactFlight(value:unknown, depth=0):unknown {
  if(depth>40)return {omitted:'depth_limit'};
  if(Array.isArray(value))return value.map(item=>redactFlight(item,depth+1));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,
    /^(?:headers?|authorization|cookies?|dpop|credentials?|password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|token|private[_-]?key|encrypted_content)$/i.test(key)?'[REDACTED]':
    /^(?:file_data|image_data|image_url|audio_data|b64_json|base64|binary)$/i.test(key)?'[BINARY_OMITTED]':redactFlight(item,depth+1)]));
  if(typeof value!=='string')return value;
  if(value.length<=RAW_LIMIT&&/^\s*[\[{]/.test(value)){try{return JSON.stringify(redactFlight(JSON.parse(value),depth+1));}catch{/* Plain strings stay strings. */}}
  return value.replace(/\bBearer\s+[^\s"',;]+|\bsk-[A-Za-z0-9_-]{8,}|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/gi,'[SECRET_REMOVED]')
    .replace(/((?:[a-z0-9]+_)*(?:password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|cookie))["']?\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,"';}]+)/gi,'$1=[SECRET_REMOVED]')
    .replace(/data:[^\s"']+;base64,[A-Za-z0-9+/=]+/gi,'[BINARY_OMITTED]')
    .replace(/([?&](?:key|token|signature|sig|credential|x-amz-[\w-]+)=)[^&\s"']+/gi,'$1[SECRET_REMOVED]');
}

/** Encrypted, bounded five-minute RAM ring. Only fault snapshots are written to disk. */
export class FlightRecorder {
  private requests = new Map<string,RequestRecord>();
  private manifests = new Map<string,FlightManifest>();
  private pending = Promise.resolve();
  private readonly ready:Promise<void>;
  private readonly now:()=>number;
  private readonly startedAt:number;
  private failedWrites=0;
  private lastPruned=0;
  private queuedBytes=0;
  private evictionGaps=new Map<string,number>();
  constructor(private readonly options:Options){
    if(options.key.length!==32)throw new Error('Invalid flight recorder encryption key');
    this.now=options.now??Date.now;this.startedAt=this.now();
    this.ready=this.load().catch(()=>this.warn());
  }
  private warn(){this.failedWrites++;this.options.warn?.();}
  private seal(value:unknown):Buffer {
    const text=JSON.stringify(value);if(Buffer.byteLength(text)>RAW_LIMIT)throw new Error('record_limit');
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.options.key,iv);
    const bytes=Buffer.concat([cipher.update(gzipSync(text)),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),bytes]);
  }
  private unseal(bytes:Buffer):unknown {
    const decipher=createDecipheriv('aes-256-gcm',this.options.key,bytes.subarray(0,12));decipher.setAuthTag(bytes.subarray(12,28));
    return JSON.parse(gunzipSync(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]),{maxOutputLength:RAW_LIMIT}).toString());
  }
  start(identity:FlightIdentity,body:unknown):void {
    try{
      if(!UUID.test(identity.userId)||!UUID.test(identity.requestId))return;
      this.prune();const at=this.now();
      this.requests.set(identity.requestId,{...identity,aliases:[identity.requestId],startedAt:at,lastAt:at,active:true,frames:[],gaps:[],bytes:0});
      const raw=body&&typeof body==='object'?body as Record<string,unknown>:{};
      // Separate, prioritized tool inventory survives oversized conversation records.
      this.record(identity.requestId,'tool_inventory',{tools:raw.tools??[],tool_choice:raw.tool_choice},true);
      this.record(identity.requestId,'request',body,true);
    }catch{this.warn();}
  }
  associate(requestId:string,alias:string):void {const request=this.requests.get(requestId);if(request&&typeof alias==='string'&&alias.length<=200&&!request.aliases.includes(alias))request.aliases.push(alias);}
  record(requestId:string,kind:string,data:unknown,anchor=false):void {
    try{
      const request=this.requests.get(requestId);if(!request)return;const at=this.now();request.lastAt=at;
      const bytes=this.seal({at,kind,requestId,data:redactFlight(data)});
      if(bytes.length>(this.options.perUserBytes??8*1024*1024)){request.gaps.push('record_exceeds_user_budget');return;}
      request.frames.push({at,bytes,anchor,kind});request.bytes+=bytes.length;this.prune();
    }catch{const request=this.requests.get(requestId);if(request&&!request.gaps.includes('record_limit_or_encoding'))request.gaps.push('record_limit_or_encoding');this.warn();}
  }
  finish(requestId:string):void {const request=this.requests.get(requestId);if(request){request.active=false;request.lastAt=this.now();}this.prune();}
  private prune(force=false):void {
    const cutoff=this.now()-WINDOW;
    const usage=()=>{const users=new Map<string,number>();let total=0;for(const r of this.requests.values()){users.set(r.userId,(users.get(r.userId)??0)+r.bytes);total+=r.bytes;}return {users,total};};
    let current=usage();
    if(!force&&this.now()-this.lastPruned<1000&&this.requests.size<=1024&&current.total<=(this.options.totalBytes??32*1024*1024)&&[...current.users.values()].every(size=>size<=(this.options.perUserBytes??8*1024*1024)))return;
    this.lastPruned=this.now();
    for(const [user,at] of this.evictionGaps)if(at<cutoff)this.evictionGaps.delete(user);
    for(const [id,request] of this.requests){
      if(request.lastAt<cutoff&&!request.active){this.requests.delete(id);continue;}
      request.frames=request.frames.filter(frame=>frame.anchor||frame.at>=cutoff);
      request.bytes=request.frames.reduce((sum,f)=>sum+f.bytes.length,0);
    }
    current=usage();
    while(this.requests.size>1024||current.total>(this.options.totalBytes??32*1024*1024)||[...current.users.values()].some(size=>size>(this.options.perUserBytes??8*1024*1024))){
      const over=[...current.users].find(([,size])=>size>(this.options.perUserBytes??8*1024*1024))?.[0];
      const request=[...this.requests.values()].filter(r=>!over||r.userId===over).sort((a,b)=>a.lastAt-b.lastAt)[0];if(!request)break;
      let index=request.frames.findIndex(frame=>!frame.anchor);
      if(index<0)index=request.frames.findIndex(frame=>frame.kind!=='tool_inventory');
      this.evictionGaps.set(request.userId,this.now());
      if(index>=0){const [removed]=request.frames.splice(index,1);request.bytes-=removed.bytes.length;if(!request.gaps.includes('capacity_eviction'))request.gaps.push('capacity_eviction');}
      else this.requests.delete(request.requestId);
      current=usage();
    }
  }
  freeze(userId:string,cause:SnapshotCause):Promise<string|null> {
    // Capture immutable buffers before asynchronous disk work or retention can evict them.
    this.prune(true);const now=this.now(),cutoff=now-WINDOW;
    const selected=[...this.requests.values()].filter(r=>r.userId===userId&&(r.lastAt>=cutoff||r.active));
    const request=selected.find(r=>r.aliases.includes(cause.requestId??'')||Boolean(cause.traceId&&r.traceId===cause.traceId));
    const existing=[...this.manifests.values()].find(m=>m.userId===userId&&m.expiresAt>now&&m.requests.some(r=>r.aliases.some(alias=>request?.aliases.includes(alias)||alias===cause.requestId)));
    if(existing){
      if(!existing.causes.some(c=>c.source===cause.source&&c.code===cause.code&&c.failureId===cause.failureId)&&existing.causes.length<32)existing.causes.push(cause);
      return this.enqueue(async()=>{await this.saveManifest(existing);return existing.id;});
    }
    let frames=selected.flatMap(r=>r.frames.filter(f=>f.anchor||f.at>=cutoff)).sort((a,b)=>a.at-b.at).map(f=>f.bytes);
    const gaps=[...new Set(selected.flatMap(r=>r.gaps))];
    if(this.evictionGaps.has(userId))gaps.push('capacity_eviction');
    const selectedBytes=frames.reduce((n,b)=>n+b.length,0);
    if(this.queuedBytes+selectedBytes>(this.options.totalBytes??32*1024*1024)){frames=[];gaps.push('snapshot_queue_limit');}
    const queuedBytes=frames.reduce((n,b)=>n+b.length,0);this.queuedBytes+=queuedBytes;
    if(this.startedAt>cutoff)gaps.push('server_started_within_window');if(cause.requestId&&!request)gaps.push('reported_request_not_in_buffer');
    const manifest:FlightManifest={id:randomUUID(),userId,createdAt:now,windowStart:cutoff,windowEnd:now,expiresAt:now+(this.options.retentionMs??86400000),bytes:frames.reduce((n,b)=>n+b.length+4,0),recordCount:frames.length,
      requests:selected.map(({userId,requestId,deviceId,traceId,threadId,aliases,startedAt,active})=>({userId,requestId,deviceId,traceId,threadId,aliases:[...aliases],startedAt,active})),causes:[cause],gaps,processStartedAt:this.startedAt};
    this.manifests.set(manifest.id,manifest);
    return this.enqueue(async()=>{
      const temporary=join(this.options.directory,manifest.id+'.records.part');let file;
      try{
        file=await open(temporary,'wx',0o600);
        for(const bytes of frames){const length=Buffer.alloc(4);length.writeUInt32BE(bytes.length);await file.writeFile(length);await file.writeFile(bytes);}
        await file.sync();await file.close();file=undefined;await rename(temporary,join(this.options.directory,manifest.id+'.records.enc'));await this.saveManifest(manifest);await this.clean();return manifest.id;
      }catch{this.warn();this.manifests.delete(manifest.id);return null;}
      finally{this.queuedBytes-=queuedBytes;await file?.close().catch(()=>{});await unlink(temporary).catch(()=>{});}
    });
  }
  private enqueue<T>(operation:()=>Promise<T>):Promise<T|null> {const result=this.pending.then(()=>this.ready).then(operation).catch(()=>{this.warn();return null;});this.pending=result.then(()=>{});return result;}
  private async saveManifest(manifest:FlightManifest){const path=join(this.options.directory,manifest.id+'.manifest.enc');await writeFile(path+'.part',this.seal(manifest),{mode:0o600});await rename(path+'.part',path);}
  private async load(){
    await mkdir(this.options.directory,{recursive:true,mode:0o700});
    for(const name of await readdir(this.options.directory))if(/^[a-f0-9-]{36}\.manifest\.enc$/.test(name)){
      try{const manifest=this.unseal(await readFile(join(this.options.directory,name))) as FlightManifest;if(UUID.test(manifest.id)&&manifest.id+'.manifest.enc'===name&&(await stat(join(this.options.directory,manifest.id+'.records.enc'))).isFile())this.manifests.set(manifest.id,manifest);}catch{this.warn();}
    }
    await this.clean();
  }
  async clean(){
    const ordered=[...this.manifests.values()].sort((a,b)=>b.createdAt-a.createdAt);let bytes=0,count=0;const users=new Map<string,number>();
    for(const manifest of ordered){if(manifest.expiresAt<=this.now()||count>=(this.options.maxSnapshots??20)||(users.get(manifest.userId)??0)>=(this.options.perUserSnapshots??3)||bytes+manifest.bytes>(this.options.snapshotBytes??128*1024*1024)){
      this.manifests.delete(manifest.id);await unlink(join(this.options.directory,manifest.id+'.records.enc')).catch(()=>{});await unlink(join(this.options.directory,manifest.id+'.manifest.enc')).catch(()=>{});
    }else{bytes+=manifest.bytes;count++;users.set(manifest.userId,(users.get(manifest.userId)??0)+1);}}
    const names=await readdir(this.options.directory);
    for(const name of names){const match=/^([a-f0-9-]{36})\.(records\.enc|records\.part|manifest\.enc\.part)$/.exec(name);if(!match||!UUID.test(match[1]))continue;
      if(!this.manifests.has(match[1])&&(await stat(join(this.options.directory,name))).mtimeMs<this.now()-WINDOW)await unlink(join(this.options.directory,name)).catch(()=>{});
    }
    this.prune(true);
  }
  async list(userId?:string){await this.flush();return [...this.manifests.values()].filter(m=>m.expiresAt>this.now()&&(!userId||m.userId===userId)).sort((a,b)=>b.createdAt-a.createdAt);}
  find(userId:string,requestId?:string,traceId?:string){return [...this.manifests.values()].filter(m=>m.userId===userId&&m.expiresAt>this.now()).find(m=>m.requests.some(r=>r.aliases.includes(requestId??'')||Boolean(traceId&&r.traceId===traceId)))?.id;}
  async *download(id:string):AsyncGenerator<string>{
    await this.flush();const manifest=this.manifests.get(id);if(!UUID.test(id)||!manifest||manifest.expiresAt<=this.now())throw new Error('SNAPSHOT_NOT_FOUND');
    yield JSON.stringify({kind:'manifest',data:manifest})+'\n';
    const file=await open(join(this.options.directory,id+'.records.enc'),'r');
    try{let offset=0;for(let i=0;i<manifest.recordCount;i++){
      const header=Buffer.alloc(4);if((await file.read(header,0,4,offset)).bytesRead!==4)throw new Error('SNAPSHOT_TRUNCATED');offset+=4;
      const size=header.readUInt32BE();if(size<28||size>16*1024*1024)throw new Error('SNAPSHOT_RECORD_INVALID');const bytes=Buffer.alloc(size);let read=0;
      while(read<size){const result=await file.read(bytes,read,size-read,offset+read);if(!result.bytesRead)throw new Error('SNAPSHOT_TRUNCATED');read+=result.bytesRead;}offset+=size;yield JSON.stringify(this.unseal(bytes))+'\n';
    }}finally{await file.close();}
  }
  async flush(){await this.ready;await this.pending;}
  status(){return {windowSeconds:300,retentionHours:(this.options.retentionMs??86400000)/3600000,bufferRequests:this.requests.size,snapshots:this.manifests.size,failedWrites:this.failedWrites};}
}
