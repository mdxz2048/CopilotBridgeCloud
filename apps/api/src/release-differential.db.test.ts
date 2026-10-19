import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {gzipSync} from 'node:zlib';

describe.skipIf(!process.env.V2_TEST_DATABASE_URL)('Differential distribution isolated PostgreSQL',()=>{
  let database:typeof import('@bridge/db'), app:Awaited<ReturnType<typeof import('./server.js').createServer>>;
  let directory:string, adminId:string, headers:Record<string,string>;
  const bytes=Buffer.from('MZpayload');
  const blockmap=gzipSync(JSON.stringify({version:'2',files:[{name:'file',offset:0,sizes:[9],checksums:['A'.repeat(24)]}]}));
  beforeAll(async()=>{
    const url=process.env.V2_TEST_DATABASE_URL!;
    if(!new URL(url).pathname.startsWith('/bridge_v2_test_'))throw Error('REFUSE_NON_TEST_DATABASE');
    process.env.DATABASE_URL=url;process.env.ACCESS_SECRET??='a'.repeat(64);process.env.REFRESH_TOKEN_PEPPER??='b'.repeat(64);process.env.PROVIDER_MASTER_KEY??='c'.repeat(64);
    process.env.PUBLIC_BASE_URL='http://localhost:3001';process.env.LOG_LEVEL='silent';process.env.STAGED_EMAIL_REGISTRATION_ENABLED='false';
    directory=await mkdtemp(join(tmpdir(),'bridge-release-db-'));process.env.RELEASE_STORAGE_DIR=directory;
    database=await import('@bridge/db');
    const [admin]=await database.db.insert(database.users).values({email:`release-${randomUUID()}@example.test`,passwordHash:'unused-in-cookie-fixture',role:'ADMIN'}).returning();adminId=admin.id;
    const {newRefresh,hashRefresh}=await import('./security.js');const token=newRefresh();
    await database.db.insert(database.webSessions).values({userId:adminId,tokenHash:hashRefresh(token),expiresAt:new Date(Date.now()+300000)});
    headers={cookie:`bridge_session=${token}`,origin:process.env.PUBLIC_BASE_URL};
    app=await(await import('./server.js')).createServer();
  });
  afterAll(async()=>{
    await app?.close();
    if(database){const {eq}=await import('drizzle-orm');await database.db.delete(database.auditLogs).where(eq(database.auditLogs.actorId,adminId));await database.db.delete(database.webSessions).where(eq(database.webSessions.userId,adminId));await database.db.delete(database.releases);await database.db.delete(database.users).where(eq(database.users.id,adminId));await database.pool.end();}
    if(directory){if(!resolve(directory).startsWith(resolve(tmpdir())+'/')&&!resolve(directory).startsWith(resolve(tmpdir())+'\\'))throw Error('REFUSE_UNSAFE_TEMP_CLEANUP');await rm(directory,{recursive:true,force:true});}
  });
  async function release(version:string,published=true,channel='stable',arch='x64'){
    const id=randomUUID();const [row]=await database.db.insert(database.releases).values({id,version,published,channel,arch,platform:'windows',downloadUrl:`http://localhost:3001/api/v1/releases/files/${id}`,sha256:'f'.repeat(64)}).returning();
    await writeFile(join(directory,`${id}.exe`),bytes);return row;
  }
  it('by-version filters actual database rows by published stable Windows x64',async()=>{
    const version='800.1.1';await release(version,false);await release(version,true,'beta');await release(version,true,'stable','arm64');
    expect((await app.inject({url:`/api/v1/releases/by-version/${version}`})).statusCode).toBe(404);
    const actual=await release(version);const result=await app.inject({url:`/api/v1/releases/by-version/${version}`});expect(result.statusCode,result.body).toBe(200);expect(result.json().release.id).toBe(actual.id);
    const {eq}=await import('drizzle-orm');await database.db.update(database.releases).set({published:false}).where(eq(database.releases.id,actual.id));
    expect((await app.inject({url:`/api/v1/releases/by-version/${version}`})).statusCode).toBe(404);
  });
  it('locks publication rows and refuses replacing a sidecar after publication wins',async()=>{
    const row=await release('800.1.2',false),url=`/api/v1/admin/releases/${row.id}/blockmap`;
    const upload={method:'PUT' as const,url,headers:{...headers,'content-type':'application/octet-stream'},payload:blockmap};
    expect((await app.inject(upload)).statusCode).toBe(200);
    const client=await database.pool.connect();
    try{
      await client.query('BEGIN');await client.query('SELECT id FROM releases WHERE id=$1 FOR UPDATE',[row.id]);
      let settled=false;const pending=app.inject(upload).then(result=>{settled=true;return result;});
      // Confirm PostgreSQL itself reports the request waiting on the publication row lock.
      let waiting=false;
      for(let attempt=0;attempt<100;attempt++){
        const result=await database.pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE '%releases%'");
        if(result.rows[0].n>0){waiting=true;break;}
        await new Promise(resolve=>setTimeout(resolve,10));
      }
      expect(waiting).toBe(true);expect(settled).toBe(false);
      await client.query('UPDATE releases SET published=true WHERE id=$1',[row.id]);await client.query('COMMIT');
      const denied=await pending;expect(denied.statusCode,denied.body).toBe(409);
      expect(await readFile(join(directory,`${row.id}.exe.blockmap`))).toEqual(blockmap);
      expect((await app.inject({url:`/api/v1/releases/files/${row.id}/blockmap`})).statusCode).toBe(200);
    }finally{await client.query('ROLLBACK');client.release();}
    const legacy=await release('800.1.3');
    const legacyUpload={...upload,url:`/api/v1/admin/releases/${legacy.id}/blockmap`};
    expect((await app.inject(legacyUpload)).statusCode).toBe(200);
    expect((await app.inject(legacyUpload)).statusCode).toBe(409);
    const {and,eq}=await import('drizzle-orm');
    const [audit]=await database.db.select().from(database.auditLogs).where(and(eq(database.auditLogs.targetId,legacy.id),eq(database.auditLogs.action,'RELEASE_BLOCKMAP_UPLOADED')));
    expect(audit.metadata).toMatchObject({publishedBackfill:true});
  });
  it('retains the newest three versions and prunes both installer and map only for obsolete managed releases',async()=>{
    await database.db.delete(database.releases);
    const rows=[];for(const version of ['900.1.9','900.1.11','900.1.2','900.1.10','900.1.1','900.1.8','900.1.7']){const row=await release(version);rows.push(row);await writeFile(join(directory,`${row.id}.exe.blockmap`),blockmap);}
    const draft=await release('900.9.9',false),beta=await release('900.9.8',true,'beta');
    const official=join(directory,'ChatGPT-Windows-x64.zip');await writeFile(official,'official sentinel');
    const {retainLatestPublishedRelease}=await import('./release-lifecycle.js');expect(await retainLatestPublishedRelease(rows[1].id,adminId)).toBe(4);
    const retained=await database.db.select().from(database.releases);
    expect(retained.filter(row=>row.published&&row.channel==='stable').map(row=>row.version).sort()).toEqual(['900.1.9','900.1.10','900.1.11'].sort());
    for(const row of rows){const keep=['900.1.9','900.1.10','900.1.11'].includes(row.version);for(const suffix of ['.exe','.exe.blockmap']){if(keep)expect((await stat(join(directory,row.id+suffix))).isFile()).toBe(true);else await expect(stat(join(directory,row.id+suffix))).rejects.toMatchObject({code:'ENOENT'});}}
    expect(retained.map(row=>row.id)).toEqual(expect.arrayContaining([draft.id,beta.id]));expect(await readFile(official,'utf8')).toBe('official sentinel');
    expect((await app.inject({url:'/api/v1/releases/by-version/900.1.9'})).statusCode).toBe(200);
    expect((await app.inject({url:'/api/v1/releases/by-version/900.1.2'})).statusCode).toBe(404);
  });
});
