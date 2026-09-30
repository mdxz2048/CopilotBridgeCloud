import type { FastifyInstance } from 'fastify';
import { db, sitePageViews } from '@bridge/db';
import { desc, gte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { admin, ApiError } from './core.js';
import { config } from './config.js';

const page = z.enum(['/', '/pricing', '/download', '/login', '/register']);

export function registerSiteVisits(app: FastifyInstance) {
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
