import type { FastifyInstance } from 'fastify';
import { auditLogs, db, systemSettings, usageEvents } from '@bridge/db';
import { and, desc, eq, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { admin } from './core.js';
import { ApiError } from './errors.js';
import { config } from './config.js';

// A separate audit decision never rewrites immutable usage or invents supplier cost.
export const unresolvedBillingReview = sql`not exists (select 1 from ${systemSettings} where ${systemSettings.key} = 'billing_review:' || ${usageEvents.id}::text and ${systemSettings.value}->>'resolution' = 'platform_waived' and ${systemSettings.value}->>'usageEventId' = ${usageEvents.id}::text)`;

export async function registerBillingReview(app: FastifyInstance) {
  app.get('/api/v1/admin/usage-events/review', async req => {
    await admin(req);
    const {userId}=z.object({userId:z.uuid().optional()}).parse(req.query);
    const events=await db.select({id:usageEvents.id,requestId:usageEvents.requestId,userId:usageEvents.userId,billingStatus:usageEvents.billingStatus,pointsCharged:usageEvents.pointsCharged,inputTokens:usageEvents.inputTokens,outputTokens:usageEvents.outputTokens,createdAt:usageEvents.createdAt}).from(usageEvents)
      .where(and(userId?eq(usageEvents.userId,userId):undefined,or(eq(usageEvents.billingStatus,'METERING_ERROR'),eq(usageEvents.billingStatus,'UNRATED')),unresolvedBillingReview)).orderBy(desc(usageEvents.createdAt)).limit(200);
    return {data:events.map(event=>({...event,supplierCostKnown:false,reviewRequired:true}))};
  });
  app.post('/api/v1/admin/usage-events/:id/review', async req => {
    const actor=await admin(req);
    if(req.headers.origin!==config.PUBLIC_BASE_URL) throw new ApiError(403,'CSRF_REJECTED');
    const id=z.uuid().parse((req.params as {id:string}).id);
    const {reason}=z.object({resolution:z.literal('platform_waived'),reason:z.string().trim().min(1).max(500)}).strict().parse(req.body);
    return db.transaction(async tx=>{
      const [event]=await tx.select().from(usageEvents).where(eq(usageEvents.id,id)).for('update').limit(1);
      if(!event)throw new ApiError(404,'NOT_FOUND');
      if(!['METERING_ERROR','UNRATED'].includes(event.billingStatus))throw new ApiError(409,'PROTOCOL_INVALID','此用量记录不需要核对。');
      const key='billing_review:'+id;
      const [existing]=await tx.select().from(systemSettings).where(eq(systemSettings.key,key)).limit(1);
      if(existing)return {review:existing.value,alreadyReviewed:true};
      const review={usageEventId:id,resolution:'platform_waived',actorId:actor.user.id,reason,reviewedAt:new Date().toISOString(),supplierCostKnown:false};
      await tx.insert(systemSettings).values({key,value:review});
      await tx.insert(auditLogs).values({actorId:actor.user.id,action:'USAGE_BILLING_REVIEWED',targetType:'USAGE_EVENT',targetId:id,metadata:review});
      return {review,alreadyReviewed:false};
    });
  });
}
