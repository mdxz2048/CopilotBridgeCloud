import type { FastifyInstance } from 'fastify';
import { db, sitePageViews, siteDownloadStats, systemSettings } from '@bridge/db';
import { desc, gte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { admin, ApiError } from './core.js';
import { config } from './config.js';

const page = z.enum(['/', '/pricing', '/download', '/login', '/register']);

export async function recordClientDownload(release:{version:string;platform:string;arch:string}) {
  const day=new Date().toISOString().slice(0,10);
  await db.insert(siteDownloadStats).values({day,version:release.version,platform:release.platform,arch:release.arch,downloads:1})
    .onConflictDoUpdate({target:[siteDownloadStats.day,siteDownloadStats.version,siteDownloadStats.platform,siteDownloadStats.arch],set:{downloads:sql`${siteDownloadStats.downloads}+1`}});
}

export function registerSiteVisits(app: FastifyInstance) {
  app.get('/api/v1/admin/site/summary',async req=>{
    await admin(req);
    const today=new Date().toISOString().slice(0,10),since=new Date(Date.now()-29*86400000).toISOString().slice(0,10);
    const [views,downloads,rows,start]=await Promise.all([
      db.select({total:sql<number>`coalesce(sum(${sitePageViews.views}),0)`,today:sql<number>`coalesce(sum(${sitePageViews.views}) filter(where ${sitePageViews.day}=${today}),0)`,last30Days:sql<number>`coalesce(sum(${sitePageViews.views}) filter(where ${sitePageViews.day}>=${since}),0)`}).from(sitePageViews),
      db.select({total:sql<number>`coalesce(sum(${siteDownloadStats.downloads}),0)`,today:sql<number>`coalesce(sum(${siteDownloadStats.downloads}) filter(where ${siteDownloadStats.day}=${today}),0)`,last30Days:sql<number>`coalesce(sum(${siteDownloadStats.downloads}) filter(where ${siteDownloadStats.day}>=${since}),0)`}).from(siteDownloadStats),
      db.select({day:siteDownloadStats.day,version:siteDownloadStats.version,platform:siteDownloadStats.platform,arch:siteDownloadStats.arch,downloads:siteDownloadStats.downloads}).from(siteDownloadStats).where(gte(siteDownloadStats.day,since)).orderBy(desc(siteDownloadStats.day),siteDownloadStats.version),
      db.select({value:systemSettings.value}).from(systemSettings).where(sql`${systemSettings.key}='admin_telemetry_started'`).limit(1),
    ]);
    const totals=(row:{total:number;today:number;last30Days:number})=>({total:Number(row.total),today:Number(row.today),last30Days:Number(row.last30Days)});
    return {pageViews:totals(views[0]),downloads:{...totals(downloads[0]),data:rows},trackingSince:(start[0]?.value as {startedAt?:string}|undefined)?.startedAt??null,timezone:'UTC',uniqueVisitorsAvailable:false};
  });
  app.post('/api/v1/site/page-view', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (req.headers.origin !== config.PUBLIC_BASE_URL) throw new ApiError(403, 'CSRF_REJECTED');
    const { path } = z.object({ path: page }).parse(req.body);
    const day = new Date().toISOString().slice(0, 10);
    await db.insert(sitePageViews).values({ day, page: path, views: 1 })
      .onConflictDoUpdate({ target: [sitePageViews.day, sitePageViews.page], set: { views: sql`${sitePageViews.views} + 1` } });
    return reply.code(204).send();
  });
  app.get('/api/v1/admin/site/page-views', async req => {
    await admin(req);
    const cutoff = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    return { metric: 'page_views', uniqueVisitorsAvailable: false,
      data: await db.select({ day: sitePageViews.day, page: sitePageViews.page, views: sitePageViews.views })
        .from(sitePageViews).where(gte(sitePageViews.day, cutoff)).orderBy(desc(sitePageViews.day), sitePageViews.page).limit(150) };
  });
}
