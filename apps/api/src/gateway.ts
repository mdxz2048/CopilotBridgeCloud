import type { FastifyInstance } from 'fastify';
import { db, modelSessions, usageRecords, users } from '@bridge/db';
import { and, eq, gte, lt, sql, sum } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ResponseRequestSchema } from '@bridge/contract';
import { actor, allowedModels, ApiError, currentSubscription, requireEntitlement, subscriptionError } from './core.js';
import { usageCredit } from './logic.js';
import { providerFor, type CanonicalRequest, type CanonicalResult } from './provider.js';

function responseBody(id: string, model: string, result: CanonicalResult) {
  return { id, object: 'response', status: 'completed', model, output: result.output,
    usage: { input_tokens: result.inputTokens, output_tokens: result.outputTokens, total_tokens: result.inputTokens + result.outputTokens } };
}
function writeEvent(raw: NodeJS.WritableStream, type: string, data: unknown) {
  raw.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}
export async function registerGateway(app: FastifyInstance) {
  app.get('/v1/models', async req => {
    const a = await actor(req, true);
    const sub = await currentSubscription(a.user.id);
    if (!sub) throw await subscriptionError(a.user.id);
    const allowed = await allowedModels(a.user.id, sub.plan.id);
    return { object: 'list', data: allowed.map(({ model }) => ({ id: model.publicId, object: 'model', owned_by: model.publicId.split('/')[0], capabilities: { tools: model.supportsTools, vision: model.supportsVision, reasoning: model.supportsReasoning, streaming: model.supportsStreaming } })) };
  });
  app.post('/v1/responses', async (req, reply) => {
    const a = await actor(req, true);
    const threadId = req.headers['x-client-thread-id'];
    if (typeof threadId !== 'string' || !threadId.trim() || threadId.length > 200) throw new ApiError(400, 'CLIENT_THREAD_ID_REQUIRED');
    const body = ResponseRequestSchema.parse(req.body) as CanonicalRequest;
    const ent = await requireEntitlement(a.user.id, a.device!.id, body.model);
    const weight = Number(ent.model.usageWeight);
    const reserveTokens = Math.min(1024, Math.max(1, ent.plan.monthlyTokenLimit));
    const reserveCredit = usageCredit(reserveTokens, weight);
    const record = await db.transaction(async tx => {
      await tx.execute(sql`select id from users where id = ${a.user.id} for update`);
      const [totals] = await tx.select({ tokens: sum(usageRecords.totalTokens), credit: sum(usageRecords.usageCredit), running: sql<number>`count(*) filter (where ${usageRecords.status} = 'RUNNING')`, rpm: sql<number>`count(*) filter (where ${usageRecords.createdAt} >= now() - interval '1 minute')` }).from(usageRecords)
        .where(and(eq(usageRecords.userId, a.user.id), gte(usageRecords.createdAt, ent.subscription.currentPeriodStart), lt(usageRecords.createdAt, ent.subscription.currentPeriodEnd)));
      if (Number(totals.tokens ?? 0) + reserveTokens > ent.plan.monthlyTokenLimit || Number(totals.credit ?? 0) + reserveCredit > Number(ent.plan.monthlyUsageCreditLimit)) throw new ApiError(429, 'MONTHLY_QUOTA_EXCEEDED');
      if (Number(totals.running) >= ent.plan.maxConcurrentRequests || Number(totals.rpm) >= ent.plan.requestsPerMinute) throw new ApiError(429, 'RATE_LIMITED');
      const [newRecord] = await tx.insert(usageRecords).values({ userId: a.user.id, deviceId: a.device!.id, planId: ent.plan.id, providerId: ent.provider.id, modelId: ent.model.id, status: 'RUNNING', totalTokens: reserveTokens, usageCredit: String(reserveCredit) }).returning();
      return newRecord;
    });
    const started = Date.now();
    const responseId = `resp_${randomUUID().replaceAll('-', '')}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ent.provider.timeoutMs);
    let ended = false;
    reply.raw.on('close', () => { if (!ended) controller.abort(); });
    try {
      const [existing] = await db.select().from(modelSessions).where(and(eq(modelSessions.userId, a.user.id), eq(modelSessions.deviceId, a.device!.id), eq(modelSessions.clientThreadId, threadId), gte(modelSessions.expiresAt, new Date()))).limit(1);
      const adapter = await providerFor(ent.provider.id, ent.provider.code);
      const result = existing?.modelId === ent.model.id && existing.providerSessionId
        ? await adapter.resumeSession(body, ent.model.providerModelId, existing.providerSessionId, controller.signal)
        : await adapter.createResponse(body, ent.model.providerModelId, controller.signal);
      const total = result.inputTokens + result.outputTokens;
      const credit = usageCredit(total, weight);
      await db.transaction(async tx => {
        await tx.update(usageRecords).set({ status: 'COMPLETED', inputTokens: result.inputTokens, outputTokens: result.outputTokens, totalTokens: total, usageCredit: String(credit), providerCost: result.providerCost === undefined ? null : String(result.providerCost), costKind: result.costKind, durationMs: Date.now() - started, completedAt: new Date() }).where(eq(usageRecords.id, record.id));
        await tx.insert(modelSessions).values({ userId: a.user.id, deviceId: a.device!.id, clientThreadId: threadId, providerId: ent.provider.id, modelId: ent.model.id, providerSessionId: result.providerSessionId ?? responseId, expiresAt: new Date(Date.now() + 3600000) })
          .onConflictDoUpdate({ target: [modelSessions.userId, modelSessions.deviceId, modelSessions.clientThreadId], set: { providerId: ent.provider.id, modelId: ent.model.id, providerSessionId: result.providerSessionId ?? responseId, lastActiveAt: new Date(), expiresAt: new Date(Date.now() + 3600000), state: {} } });
      });
      const response = responseBody(responseId, body.model, result);
      if (!body.stream) { ended = true; return response; }
      reply.hijack();
      reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      writeEvent(reply.raw, 'response.created', { response: { id: responseId, status: 'in_progress', model: body.model } });
      result.output.forEach((item, index) => {
        writeEvent(reply.raw, 'response.output_item.added', { response_id: responseId, output_index: index, item });
        if (item.type === 'message') {
          const contents = item.content as Array<{ text?: string }>;
          for (const part of contents ?? []) if (part.text) writeEvent(reply.raw, 'response.output_text.delta', { response_id: responseId, output_index: index, delta: part.text });
        }
        writeEvent(reply.raw, 'response.output_item.done', { response_id: responseId, output_index: index, item });
      });
      writeEvent(reply.raw, 'response.completed', { response });
      reply.raw.write('data: [DONE]\n\n');
      ended = true;
      reply.raw.end();
    } catch (error) {
      await db.update(usageRecords).set({ status: controller.signal.aborted ? 'ABORTED' : 'FAILED', totalTokens: 0, usageCredit: '0', errorCode: controller.signal.aborted ? 'GATEWAY_TIMEOUT' : 'PROVIDER_UNAVAILABLE', durationMs: Date.now() - started, completedAt: new Date() }).where(eq(usageRecords.id, record.id));
      throw new ApiError(controller.signal.aborted ? 504 : 503, controller.signal.aborted ? 'GATEWAY_TIMEOUT' : 'PROVIDER_UNAVAILABLE');
    } finally { clearTimeout(timeout); }
  });
}
