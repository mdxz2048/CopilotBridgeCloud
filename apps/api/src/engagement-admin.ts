import type {FastifyInstance} from 'fastify';
import {db,systemSettings,auditLogs,plans} from '@bridge/db';
import {and,eq,sql} from 'drizzle-orm';
import {admin,ApiError} from './core.js';
import {config} from './config.js';
import {EngagementSchema,engagementPolicy} from './engagement-policy.js';
export function registerEngagementAdmin(app:FastifyInstance){
 app.get('/api/v1/admin/engagement',async req=>{await admin(req);return engagementPolicy();});
 app.put('/api/v1/admin/engagement',async req=>{const actor=await admin(req);if(req.headers.origin!==config.PUBLIC_BASE_URL)throw new ApiError(403,'CSRF_REJECTED');const draft=EngagementSchema.parse(req.body);return db.transaction(async tx=>{
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('engagement',0))`);const old=await engagementPolicy(tx);if(old.revision!==draft.revision)throw new ApiError(409,'IDEMPOTENCY_CONFLICT','活动或通知已被修改，请刷新后重试。');
  if(draft.campaign.enabled){const [plan]=await tx.select({id:plans.id}).from(plans).where(and(eq(plans.code,'PAYG'),eq(plans.enabled,true))).limit(1);if(!plan)throw new ApiError(400,'PLAN_REQUIRED','请先启用按量体验套餐，再开启邀请活动。');}
  const value={...draft,revision:old.revision+1};await tx.insert(systemSettings).values({key:'engagement',value}).onConflictDoUpdate({target:systemSettings.key,set:{value,updatedAt:new Date()}});
  await tx.insert(auditLogs).values({actorId:actor.user.id,action:'ENGAGEMENT_UPDATED',targetType:'SETTING',targetId:'engagement',metadata:{previousEnabled:old.campaign.enabled,enabled:value.campaign.enabled,rewardDays:7,notices:value.notices.length,revision:value.revision}});return value;
 });});
}
