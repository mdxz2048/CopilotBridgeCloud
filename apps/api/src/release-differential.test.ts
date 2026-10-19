import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify, {type FastifyError, type FastifyRequest, type FastifyReply} from 'fastify';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { ApiError } from './errors.js';
import { installerRange, validateBlockmap } from './release-differential.js';

const state=vi.hoisted(()=>({release:null as any,authorized:true}));
vi.mock('@bridge/db',()=>{
  const chain:any={from:()=>chain,where:()=>chain,for:()=>chain,limit:async()=>state.release?[state.release]:[]};
  const db:any={select:()=>chain,insert:()=>({values:async()=>{}}),transaction:async(fn:any)=>fn(db)};
  return {db,releases:{id:'id',version:'version',channel:'channel',platform:'platform',arch:'arch',published:'published'},auditLogs:{}};
});
vi.mock('drizzle-orm',()=>({eq:()=>true,and:()=>true}));
vi.mock('./core.js',()=>({ApiError,admin:async()=>{if(!state.authorized)throw new ApiError(403,'FORBIDDEN');return {user:{id:'admin'}};}}));
vi.mock('./config.js',()=>({config:{PUBLIC_BASE_URL:'https://example.test'}}));
vi.mock('./official-client.js',()=>({registerOfficialClient:()=>{}}));
vi.mock('./site-visits.js',()=>({recordClientDownload:async()=>{}}));

const checksum='A'.repeat(24);
const map=(sizes=[3,6])=>gzipSync(JSON.stringify({version:'2',files:[{name:'file',offset:0,sizes,checksums:sizes.map(()=>checksum)}]}));
describe('differential release validation',()=>{
  it('requires bounded gzip v2 maps covering the entire installer',()=>{
    expect(validateBlockmap(map(),9)).toEqual({blocks:2,installerSize:9});
    for(const bytes of [Buffer.from('invalid'),map([3,5]),map([0,9]),gzipSync(JSON.stringify({version:'1',files:[]})),gzipSync(Buffer.alloc(17*1024*1024))])expect(()=>validateBlockmap(bytes,9)).toThrow('INVALID_RELEASE_BLOCKMAP');
    for(const file of [
      {name:'other',offset:0,sizes:[9],checksums:[checksum]},
      {name:'file',offset:1,sizes:[9],checksums:[checksum]},
      {name:'file',offset:0,sizes:Array(100001).fill(1),checksums:Array(100001).fill(checksum)},
    ])expect(()=>validateBlockmap(gzipSync(JSON.stringify({version:'2',files:[file]})),file.sizes.length===100001?100001:9)).toThrow('INVALID_RELEASE_BLOCKMAP');
  });
  it('parses inclusive/open/suffix ranges and rejects malformed or multi ranges',()=>{
    expect(installerRange('bytes=1-3',undefined,'"hash"',9)).toEqual({start:1,end:3});
    expect(installerRange('bytes=6-',undefined,'"hash"',9)).toEqual({start:6,end:8});
    expect(installerRange('bytes=-2',undefined,'"hash"',9)).toEqual({start:7,end:8});
    for(const range of ['bytes=9-','bytes=3-1','bytes=-0','bytes=0-1,3-4','bytes=-','bytes=99999999999999999999-'])expect(installerRange(range,undefined,'"hash"',9)).toBe(false);
    expect(installerRange('bytes=1-2','W/"hash"','"hash"',9)).toBeNull();
  });
});

describe('actual Fastify release routes with isolated files and mocked authorization/database',()=>{
  let directory:string, app:ReturnType<typeof Fastify>;
  const id='12345678-1234-4234-8234-123456789012';
  beforeAll(async()=>{
    directory=await mkdtemp(join(tmpdir(),'bridge-release-'));
    process.env.RELEASE_STORAGE_DIR=directory;
    await writeFile(join(directory,`${id}.exe`),'MZpayload');
    app=Fastify();
    app.setErrorHandler((error:FastifyError,_req:FastifyRequest,reply:FastifyReply)=>reply.code((error as any).status??error.statusCode??500).send({message:error.message}));
    const {registerReleaseFiles}=await import('./release-files.js');registerReleaseFiles(app);
  });
  afterAll(async()=>{await app.close();await rm(directory,{recursive:true,force:true});delete process.env.RELEASE_STORAGE_DIR;});
  it('keeps full downloads working and serves exact ranges with validators',async()=>{
    state.release={id,published:true,platform:'windows',arch:'x64',version:'0.3.26',sha256:'f'.repeat(64)};
    const url=`/api/v1/releases/files/${id}`;
    const full=await app.inject({url});expect(full.statusCode).toBe(200);expect(full.body).toBe('MZpayload');expect(full.headers['accept-ranges']).toBe('bytes');
    const partial=await app.inject({url,headers:{range:'bytes=2-5','if-range':full.headers.etag as string}});expect(partial.statusCode).toBe(206);expect(partial.body).toBe('payl');expect(partial.headers['content-range']).toBe('bytes 2-5/9');
    const stale=await app.inject({url,headers:{range:'bytes=2-5','if-range':'"old"'}});expect(stale.statusCode).toBe(200);expect(stale.body).toBe(full.body);
    const invalid=await app.inject({url,headers:{range:'bytes=9-'}});expect(invalid.statusCode).toBe(416);expect(invalid.headers['content-range']).toBe('bytes */9');
  });
  it('protects draft maps, bounds uploads and exposes only published maps',async()=>{
    const url=`/api/v1/releases/files/${id}/blockmap`, upload=`/api/v1/admin/releases/${id}/blockmap`;
    state.release.published=false;
    expect((await app.inject({url})).statusCode).toBe(404);
    state.authorized=false;expect((await app.inject({method:'PUT',url:upload,headers:{'content-type':'application/octet-stream'},payload:map()})).statusCode).toBe(403);state.authorized=true;
    expect((await app.inject({method:'PUT',url:upload,headers:{'content-type':'application/octet-stream'},payload:map([3,5])})).statusCode).toBe(400);
    expect((await app.inject({method:'PUT',url:upload,headers:{'content-type':'application/octet-stream'},payload:Buffer.alloc(2*1024*1024+1)})).statusCode).toBe(413);
    expect((await app.inject({method:'PUT',url:upload,headers:{'content-type':'application/octet-stream'},payload:map()})).statusCode).toBe(200);
    expect(await readFile(join(directory,`${id}.exe.blockmap`))).toEqual(map());
    state.release.published=true;
    const result=await app.inject({url});expect(result.statusCode).toBe(200);expect(result.rawPayload).toEqual(map());
    expect((await app.inject({method:'PUT',url:upload,headers:{'content-type':'application/octet-stream'},payload:map()})).statusCode).toBe(409);
    const version=await app.inject({url:'/api/v1/releases/by-version/0.3.26'});expect(version.statusCode).toBe(200);expect(version.json().release.version).toBe('0.3.26');
    state.release=null;expect((await app.inject({url})).statusCode).toBe(404);
  });
});
