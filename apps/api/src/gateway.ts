import type { FastifyInstance } from 'fastify';
import { aiRequests, db, deviceSessions, devices, modelSessions, providerAccounts, usageRecords, users } from '@bridge/db';
import { and, eq, gte, lt, sql, sum } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ResponseRequestSchema } from '@bridge/contract';
import { actor, allowedModels, ApiError, currentSubscription, requireEntitlement, subscriptionError } from './core.js';
import { usageCredit } from './logic.js';
import { providerFor, type CanonicalRequest, type CanonicalResult } from './provider.js';
import { activeRateVersion, preflightPoints, settleAiRequest } from './metering.js';
import { walletSummary } from './wallet.js';
import { hashRiskSignal } from './referral.js';
import type { BillingPolicy } from './rating.js';
import { currentBillingMode, type BillingMode } from './billing-mode.js';
import { integrationMockAllowed } from './logic.js';
import { CopilotFailure } from './copilot-provider.js';

function responseBody(id: string, model: string, result: CanonicalResult, billing?: { points: number; points_rated: number; points_charged: number; remaining_points: number; request_id: string; billing_mode: Exclude<BillingMode, 'OFF'> }) {
  return { id, object: 'response', status: 'completed', model, output: result.output,
    usage: { input_tokens: result.inputTokens, output_tokens: result.outputTokens, total_tokens: result.inputTokens + result.outputTokens, ...billing } };
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
    const mode = currentBillingMode();
    const connectionHeader = req.headers['x-provider-connection-id'];
    if (connectionHeader !== undefined && typeof connectionHeader !== 'string') throw new ApiError(400, 'INVALID_PROVIDER_CONNECTION');
    const connectionId = connectionHeader ? z.uuid().parse(connectionHeader) : null;
    if (connectionId && (mode === 'OFF' || ent.provider.code === 'MOCK')) throw new ApiError(409, 'PROVIDER_CONNECTION_UNAVAILABLE');
    const [connection] = connectionId ? await db.select().from(providerAccounts).where(and(eq(providerAccounts.id, connectionId), eq(providerAccounts.userId, a.user.id),
      eq(providerAccounts.providerId, ent.provider.id), eq(providerAccounts.ownership, 'BYOS'), eq(providerAccounts.status, 'ACTIVE'))).limit(1) : [];
    if (connectionId && !connection) throw new ApiError(403, 'PROVIDER_AUTH_REQUIRED');
    const billingPolicy: BillingPolicy = connection ? 'BYOS_USAGE' : 'MANAGED_USAGE';
    const meteredMock = ent.provider.code === 'MOCK' && mode === 'SHADOW' && integrationMockAllowed(ent.provider.code, a.user.email,
      process.env.INTEGRATION_MOCK_ENABLED === 'true', process.env.INTEGRATION_MOCK_TEST_EMAIL);
    const settlementMode = mode !== 'OFF' && (ent.provider.code !== 'MOCK' || meteredMock) ? mode : null;
    const v2Rate = settlementMode === 'ENFORCED' ? (await preflightPoints(a.user.id, ent.provider.id, ent.model.id, billingPolicy)).rate
      : settlementMode === 'SHADOW' ? await activeRateVersion(ent.provider.id, ent.model.id, billingPolicy) : null;
    if (settlementMode === 'SHADOW' && !v2Rate) throw new ApiError(503, 'RATE_CARD_UNAVAILABLE');
    const weight = Number(ent.model.usageWeight);
    const reserveTokens = Math.min(1024, Math.max(1, ent.plan.monthlyTokenLimit));
    const reserveCredit = usageCredit(reserveTokens, weight);
    const responseId = `resp_${randomUUID().replaceAll('-', '')}`;
    const { record, v2RequestId } = await db.transaction(async tx => {
      await tx.execute(sql`select id from users where id = ${a.user.id} for update`);
      const [totals] = await tx.select({ tokens: sum(usageRecords.totalTokens), credit: sum(usageRecords.usageCredit), running: sql<number>`count(*) filter (where ${usageRecords.status} = 'RUNNING')`, rpm: sql<number>`count(*) filter (where ${usageRecords.createdAt} >= now() - interval '1 minute')` }).from(usageRecords)
        .where(and(eq(usageRecords.userId, a.user.id), gte(usageRecords.createdAt, ent.subscription.currentPeriodStart), lt(usageRecords.createdAt, ent.subscription.currentPeriodEnd)));
      if (Number(totals.tokens ?? 0) + reserveTokens > ent.plan.monthlyTokenLimit || Number(totals.credit ?? 0) + reserveCredit > Number(ent.plan.monthlyUsageCreditLimit)) throw new ApiError(429, 'MONTHLY_QUOTA_EXCEEDED');
      if (Number(totals.running) >= ent.plan.maxConcurrentRequests || Number(totals.rpm) >= ent.plan.requestsPerMinute) throw new ApiError(429, 'RATE_LIMITED');
      const [newRecord] = await tx.insert(usageRecords).values({ userId: a.user.id, deviceId: a.device!.id, planId: ent.plan.id, providerId: ent.provider.id, modelId: ent.model.id, status: 'RUNNING', totalTokens: reserveTokens, usageCredit: String(reserveCredit) }).returning();
      const [request] = settlementMode ? await tx.insert(aiRequests).values({ responseId, userId: a.user.id, deviceId: a.device!.id,
        providerId: ent.provider.id, modelId: ent.model.id, providerAccountId: connection?.id ?? null, billingPolicy, rateCardVersionId: v2Rate?.id ?? null,
        legacyUsageRecordId: newRecord.id, status: 'STARTED', startedAt: new Date() }).returning() : [];
      await tx.insert(deviceSessions).values({ userId: a.user.id, deviceId: a.device!.id, lastSeenAt: new Date(), lastIpHash: hashRiskSignal(req.ip), requestCount: 1 })
        .onConflictDoUpdate({ target: deviceSessions.deviceId, set: { lastSeenAt: new Date(), lastIpHash: hashRiskSignal(req.ip), requestCount: sql`${deviceSessions.requestCount} + 1` } });
      await tx.update(devices).set({ lastSeenAt: new Date(), updatedAt: new Date() }).where(eq(devices.id, a.device!.id));
      return { record: newRecord, v2RequestId: request?.id };
    });
    const started = Date.now();
    if (v2RequestId) reply.header('X-Bridge-AI-Request-Id', v2RequestId);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ent.provider.timeoutMs);
    let ended = false;
    let clientDisconnected = false;
    let observedResult: CanonicalResult | undefined;
    let copilotStreamOpened = false;
    reply.raw.on('close', () => {
      if (!ended && !reply.raw.writableEnded) {
        clientDisconnected = true; controller.abort();
        if (v2RequestId) void db.update(aiRequests).set({ status: 'CLIENT_DISCONNECTED' })
          .where(and(eq(aiRequests.id, v2RequestId), eq(aiRequests.status, 'COMPLETED')))
          .catch(() => req.log.warn({ requestId: v2RequestId }, 'could not mark disconnected V2 request'));
      }
    });
    try {
      const [existing] = await db.select().from(modelSessions).where(and(eq(modelSessions.userId, a.user.id), eq(modelSessions.deviceId, a.device!.id), eq(modelSessions.clientThreadId, threadId), gte(modelSessions.expiresAt, new Date()))).limit(1);
      const adapter = await providerFor(ent.provider.id, ent.provider.code, connection ? { id: connection.id, userId: a.user.id } : undefined);
      if (body.stream && ent.provider.code === 'COPILOT') {
        reply.hijack();
        reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive', 'X-Accel-Buffering': 'no', ...(v2RequestId ? { 'X-Bridge-AI-Request-Id': v2RequestId } : {}) });
        copilotStreamOpened = true;
        writeEvent(reply.raw, 'response.created', { response: { id: responseId, status: 'in_progress', model: body.model } });
        writeEvent(reply.raw, 'response.output_item.added', { response_id: responseId, output_index: 0,
          item: { type: 'message', role: 'assistant', content: [] } });
      }
      const onTextDelta = copilotStreamOpened ? (delta: string) => {
        if (!reply.raw.destroyed && !reply.raw.writableEnded)
          writeEvent(reply.raw, 'response.output_text.delta', { response_id: responseId, output_index: 0, delta });
      } : undefined;
      const result = !connection && existing?.modelId === ent.model.id && existing.providerSessionId
        ? await adapter.resumeSession(body, ent.model.providerModelId, existing.providerSessionId, controller.signal, onTextDelta)
        : await adapter.createResponse(body, ent.model.providerModelId, controller.signal, onTextDelta);
      observedResult = result;
      const total = result.inputTokens + result.outputTokens;
      const credit = usageCredit(total, weight);
      const event = v2RequestId && settlementMode ? await settleAiRequest(v2RequestId, clientDisconnected ? 'CLIENT_DISCONNECTED' : 'COMPLETED', {
        usage: { inputTokens: result.inputTokens, outputTokens: result.outputTokens, cachedInputTokens: result.cachedInputTokens,
          reasoningTokens: result.reasoningTokens, imageInput: result.imageInput, imageOutput: result.imageOutput, toolCalls: result.toolCalls },
        providerReportedUsage: result.providerReportedUsage, providerCost: result.providerCost === undefined ? undefined : String(result.providerCost),
        providerCurrency: result.providerCurrency,
      }, settlementMode) : null;
      await db.transaction(async tx => {
        await tx.update(usageRecords).set({ status: 'COMPLETED', inputTokens: result.inputTokens, outputTokens: result.outputTokens, totalTokens: total, usageCredit: String(credit), providerCost: result.providerCost === undefined ? null : String(result.providerCost), costKind: result.costKind, durationMs: Date.now() - started, completedAt: new Date() }).where(eq(usageRecords.id, record.id));
        await tx.insert(modelSessions).values({ userId: a.user.id, deviceId: a.device!.id, clientThreadId: threadId, providerId: ent.provider.id, modelId: ent.model.id, providerSessionId: result.providerSessionId ?? responseId, expiresAt: new Date(Date.now() + 3600000) })
          .onConflictDoUpdate({ target: [modelSessions.userId, modelSessions.deviceId, modelSessions.clientThreadId], set: { providerId: ent.provider.id, modelId: ent.model.id, providerSessionId: result.providerSessionId ?? responseId, lastActiveAt: new Date(), expiresAt: new Date(Date.now() + 3600000), state: {} } });
      });
      const balance = event ? (await walletSummary(a.user.id)).balance : 0;
      const response = responseBody(responseId, body.model, result, event && v2RequestId
        ? { points: event.pointsCharged, points_rated: event.pointsRated, points_charged: event.pointsCharged,
          remaining_points: balance, request_id: v2RequestId, billing_mode: settlementMode! } : undefined);
      if (!body.stream) { ended = true; return response; }
      if (copilotStreamOpened) {
        if (!reply.raw.destroyed && !reply.raw.writableEnded) {
          writeEvent(reply.raw, 'response.output_item.done', { response_id: responseId, output_index: 0, item: result.output[0] });
          writeEvent(reply.raw, 'response.completed', { response });
          reply.raw.write('data: [DONE]\n\n');
          ended = true;
          reply.raw.end();
        }
        return;
      }
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
      if (v2RequestId) {
        try {
          await settleAiRequest(v2RequestId, clientDisconnected ? 'CLIENT_DISCONNECTED' : 'PROVIDER_ERROR', observedResult ? {
            usage: { inputTokens: observedResult.inputTokens, outputTokens: observedResult.outputTokens, cachedInputTokens: observedResult.cachedInputTokens,
              reasoningTokens: observedResult.reasoningTokens, imageInput: observedResult.imageInput, imageOutput: observedResult.imageOutput, toolCalls: observedResult.toolCalls },
            providerReportedUsage: observedResult.providerReportedUsage,
          } : {}, settlementMode!);
        } catch (settlementError) { req.log.error({ settlementErrorType: settlementError instanceof Error ? settlementError.name : 'UnknownError', requestId: v2RequestId }, 'V2 settlement failed'); }
      }
      const failure = error instanceof CopilotFailure ? error : controller.signal.aborted
        ? new CopilotFailure(504, 'GATEWAY_TIMEOUT') : new CopilotFailure(503, 'PROVIDER_UNAVAILABLE');
      await db.update(usageRecords).set({ status: controller.signal.aborted ? 'ABORTED' : 'FAILED', totalTokens: 0, usageCredit: '0',
        errorCode: failure.code, durationMs: Date.now() - started, completedAt: new Date() }).where(eq(usageRecords.id, record.id));
      if (copilotStreamOpened) {
        if (!reply.raw.destroyed && !reply.raw.writableEnded) {
          writeEvent(reply.raw, 'response.failed', { response: { id: responseId, status: 'failed' },
            error: { code: failure.code, message: failure.code, request_id: v2RequestId ?? req.id } });
          reply.raw.write('data: [DONE]\n\n');
          ended = true;
          reply.raw.end();
        }
        return;
      }
      throw new ApiError(failure.status, failure.code);
    } finally { clearTimeout(timeout); }
  });
}
