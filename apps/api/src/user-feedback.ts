import type { FastifyInstance } from 'fastify';
import { auditLogs, db, userFeedback, users } from '@bridge/db';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { FeedbackInputSchema, FeedbackListQuerySchema, FeedbackUpdateSchema } from '../../../packages/contract/src/feedback.js';
import { actor, admin, ApiError } from './core.js';
import { decryptSecret, encryptSecret } from './security.js';

function present(row: typeof userFeedback.$inferSelect) {
  const text = z.object({title:z.string(),content:z.string()}).parse(JSON.parse(decryptSecret(row)));
  return {id:row.id,kind:row.kind,status:row.status,...text,createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString()};
}
export function registerUserFeedback(app: FastifyInstance) {
  app.post('/api/v1/me/feedback', {bodyLimit:24*1024}, async (req, reply) => {
    reply.header('Cache-Control','no-store');
    const a = await actor(req), input = FeedbackInputSchema.parse(req.body);
    return db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`feedback:${a.user.id}`},0))`);
      const [old] = await tx.select().from(userFeedback).where(and(eq(userFeedback.userId,a.user.id),eq(userFeedback.clientId,input.clientId))).limit(1);
      if (old) {
        const value=present(old);
        if(value.kind!==input.kind||value.title!==input.title||value.content!==input.content)throw new ApiError(409,'IDEMPOTENCY_CONFLICT','此提交编号已用于另一条反馈。');
        return {feedback:value};
      }
      const [count] = await tx.select({total:sql<number>`count(*)`}).from(userFeedback).where(and(eq(userFeedback.userId,a.user.id),gte(userFeedback.createdAt,new Date(Date.now()-86400000))));
      if(Number(count.total)>=10)throw new ApiError(429,'RATE_LIMITED','24 小时内最多提交 10 条反馈，请稍后再试。');
      const [row] = await tx.insert(userFeedback).values({userId:a.user.id,clientId:input.clientId,kind:input.kind,
        ...encryptSecret(JSON.stringify({title:input.title,content:input.content}))}).returning();
      reply.code(201); return {feedback:present(row)};
    });
  });
  app.get('/api/v1/me/feedback', async (req,reply) => {
    reply.header('Cache-Control','no-store');
    const a=await actor(req), q=FeedbackListQuerySchema.parse(req.query);
    const where=and(eq(userFeedback.userId,a.user.id),q.status==='all'?undefined:eq(userFeedback.status,q.status));
    const [rows,[count]]=await Promise.all([db.select().from(userFeedback).where(where).orderBy(desc(userFeedback.createdAt),desc(userFeedback.id)).limit(20).offset((q.page-1)*20),
      db.select({total:sql<number>`count(*)`}).from(userFeedback).where(where)]);
    return {data:rows.map(present),total:Number(count.total),page:q.page,pageSize:20};
  });
  app.get('/api/v1/admin/feedback', async (req,reply) => {
    reply.header('Cache-Control','no-store');
    await admin(req); const q=FeedbackListQuerySchema.parse(req.query);
    const where=q.status==='all'?undefined:eq(userFeedback.status,q.status);
    const [rows,[count]]=await Promise.all([db.select({feedback:userFeedback,email:users.email}).from(userFeedback).innerJoin(users,eq(users.id,userFeedback.userId)).where(where)
      .orderBy(desc(userFeedback.createdAt),desc(userFeedback.id)).limit(20).offset((q.page-1)*20),db.select({total:sql<number>`count(*)`}).from(userFeedback).where(where)]);
    return {data:rows.map(row=>({...present(row.feedback),email:row.email,userId:row.feedback.userId})),total:Number(count.total),page:q.page,pageSize:20};
  });
  app.patch('/api/v1/admin/feedback/:id', async (req,reply) => {
    reply.header('Cache-Control','no-store');
    const a=await admin(req), id=z.uuid().parse((req.params as {id:string}).id), input=FeedbackUpdateSchema.parse(req.body);
    return db.transaction(async tx=>{
      const [old]=await tx.select().from(userFeedback).where(eq(userFeedback.id,id)).for('update').limit(1);
      if(!old)throw new ApiError(404,'NOT_FOUND');
      if(old.updatedAt.toISOString()!==new Date(input.expectedUpdatedAt).toISOString())throw new ApiError(409,'IDEMPOTENCY_CONFLICT','反馈状态已被修改，请刷新后重试。');
      const [row]=await tx.update(userFeedback).set({status:input.status,updatedAt:new Date(Math.max(Date.now(),old.updatedAt.getTime()+1))}).where(eq(userFeedback.id,id)).returning();
      await tx.insert(auditLogs).values({actorId:a.user.id,action:'USER_FEEDBACK_UPDATED',targetType:'FEEDBACK',targetId:id,metadata:{previous:old.status,status:row.status}});
      return {feedback:present(row)};
    });
  });
}
