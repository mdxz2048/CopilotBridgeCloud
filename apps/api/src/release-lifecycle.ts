import { db, releases, auditLogs } from '@bridge/db';
import { and, eq, ne, sql } from 'drizzle-orm';
import { unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { latestWindowsRelease } from './latest-release.js';
import { ApiError } from './errors.js';
import { config } from './config.js';

export const releaseStorage=resolve(process.env.RELEASE_STORAGE_DIR??join(homedir(),'.bridge-cloud','releases'));
export async function retainLatestPublishedRelease(id:string,actorId:string) {
  const obsolete=await db.transaction(async tx=>{
    await tx.execute(sql`select pg_advisory_xact_lock(189321773)`);
    const [entry]=await tx.select().from(releases).where(eq(releases.id,id)).limit(1);
    if(!entry?.published||entry.platform!=='windows'||entry.arch!=='x64'||entry.channel!=='stable')return [];
    const siblings=await tx.select().from(releases).where(and(eq(releases.platform,entry.platform),eq(releases.arch,entry.arch),eq(releases.channel,entry.channel),eq(releases.published,true)));
    const latest=latestWindowsRelease(siblings);
    if(!latest)throw new ApiError(400,'PROTOCOL_INVALID','正式版本号必须为 major.minor.patch。');
    // Keep a bounded bootstrap window for clients whose previous updater did not save a map.
    const ordered=[...siblings].sort((a,b)=>{
      const x=a.version.split('.').map(Number),y=b.version.split('.').map(Number);
      for(let i=0;i<3;i++)if(x[i]!==y[i])return y[i]-x[i];
      return b.createdAt.getTime()-a.createdAt.getTime();
    });
    const retained=ordered.slice(0,3).map(r=>ne(releases.id,r.id));
    const removed=await tx.delete(releases).where(and(eq(releases.platform,entry.platform),eq(releases.arch,entry.arch),eq(releases.channel,entry.channel),eq(releases.published,true),...retained)).returning();
    if(removed.length)await tx.insert(auditLogs).values({actorId,action:'RELEASES_PRUNED',targetType:'RELEASE',targetId:latest.id,metadata:{removedIds:removed.map(r=>r.id)}});
    return removed;
  });
  for(const entry of obsolete) {
    // Only delete our UUID installer files, never external URLs or official-client assets.
    if(!/^[a-f0-9-]{36}$/.test(entry.id)||entry.downloadUrl!==`${config.PUBLIC_BASE_URL}/api/v1/releases/files/${entry.id}`)continue;
    await unlink(join(releaseStorage,`${entry.id}.exe`)).catch((error:NodeJS.ErrnoException)=>{if(error.code!=='ENOENT')throw error;});
    await unlink(join(releaseStorage,`${entry.id}.exe.blockmap`)).catch((error:NodeJS.ErrnoException)=>{if(error.code!=='ENOENT')throw error;});
  }
  return obsolete.length;
}
