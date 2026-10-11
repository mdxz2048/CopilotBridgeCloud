import type { FastifyInstance } from 'fastify';
import { aiRequests, db, deviceSessions, devices, modelSessions, modelInstances, providerAccounts, usageRecords, users } from '@bridge/db';
import { and, eq, gte, lt, sql, sum } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ResponseRequestSchema } from '@bridge/contract';
import { actor, allowedModels, ApiError, currentSubscription, requireEntitlement, subscriptionError } from './core.js';
import { usageCredit } from './logic.js';
import { providerFor, isDeepSeekProvider, type CanonicalRequest, type CanonicalResult } from './provider.js';
import { activeRateVersion, hasObservedUpstreamTextDelta, interruptedStreamUsageUnavailable, preflightPoints, settleAiRequest } from './metering.js';
import { ratePoints } from './rating.js';
import { walletSummary } from './wallet.js';
import { hashRiskSignal } from './referral.js';
import type { BillingPolicy } from './rating.js';
import { currentBillingMode, type BillingMode } from './billing-mode.js';
import { integrationMockAllowed } from './logic.js';
import { CopilotFailure } from './copilot-provider.js';
import { currentRatePolicy } from './rate-policy.js';
import { ensureMoneyRate,upstreamBalance } from './money-policy.js';
import { currentUsage } from './core.js';
import { requestContext,requestCounts,requestMilestone,requestNativeMetrics } from './request-log.js';
import { nextContinuationState, pendingContinuation } from './tool-continuation.js';
import { chooseInstance,logicalCapabilities,responsesProfile } from './instance-router.js';
import { nativeReasoning, validateNativeRequest } from './native-responses.js';
import { once } from 'node:events';
import { encryptSecret, decryptSecret } from './security.js';

function responseBody(id: string, model: string, result: CanonicalResult, billing?: { points: number; points_rated: number; points_charged: number; remaining_points: number; request_id: string; billing_mode: Exclude<BillingMode, 'OFF'> }) {
  return { ...(result.nativeResponse ?? {}), id, object: 'response', status: result.status ?? 'completed', model, output: result.output,
    usage: { ...((result.nativeResponse?.usage as Record<string, unknown>) ?? {}), input_tokens: result.inputTokens, output_tokens: result.outputTokens, total_tokens: result.inputTokens + result.outputTokens, ...billing } };
}
function writeEvent(raw: NodeJS.WritableStream, type: string, data: unknown) {
  raw.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...(data as Record<string, unknown>) })}\n\n`);
}
export async function registerGateway(app: FastifyInstance) {
  const purgeExpiredHistory=()=>db.update(modelSessions).set({state:{}}).where(and(lt(modelSessions.expiresAt,new Date()),sql`${modelSessions.state} <> '{}'::jsonb`));
  const purgeTimer=setInterval(()=>{void purgeExpiredHistory().catch(()=>app.log.warn({event:'conversation_history_purge_failed'},'history cleanup needs attention'));},5*60_000);
  purgeTimer.unref();
  app.addHook('onClose',async()=>{clearInterval(purgeTimer);});
  app.get('/v1/models', async req => {
    const a = await actor(req, true);
    const sub = await currentSubscription(a.user.id);
    if (!sub) throw await subscriptionError(a.user.id);
    const allowed = await allowedModels(a.user.id, sub.plan.id);
    return { object: 'list', data: allowed.map(({ model, candidates }) => ({ id: model.publicId, object: 'model', owned_by: model.publicId.split('/')[0], capabilities:logicalCapabilities(candidates) })) };
  });
  app.post('/v1/responses',{bodyLimit:10*1024*1024}, async (req, reply) => {
    const a = await actor(req, true);
    requestMilestone(req,'authDone');
    const threadId = req.headers['x-client-thread-id'];
    if (typeof threadId !== 'string' || !threadId.trim() || threadId.length > 200) throw new ApiError(400, 'CLIENT_THREAD_ID_REQUIRED');
    const body = ResponseRequestSchema.parse(req.body) as CanonicalRequest;
    requestCounts(req,{requestBytes:Buffer.byteLength(JSON.stringify(req.body)),inputItemCount:Array.isArray(body.input)?body.input.length:1,toolCount:body.tools?.length??0,toolResultBytes:Array.isArray(body.input)?body.input.filter(i=>['function_call_output','custom_tool_call_output'].includes(String(i.type))).reduce((bytes,i)=>bytes+Buffer.byteLength(JSON.stringify(i.output??'')),0):0,upstreamAttemptCount:0});
    // Old desktop builds strip reasoning history; preserve their non-thinking tool behavior.
    const clientVersion = a.device!.appVersion.match(/^(\d+)\.(\d+)\./);
    const legacyDesktop = !clientVersion || (Number(clientVersion[1]) === 0 && Number(clientVersion[2]) < 3);
    if (legacyDesktop && body.reasoning?.mode === undefined) body.reasoning = {...body.reasoning,mode:'normal'};
    const ent = await requireEntitlement(a.user.id, a.device!.id, body.model);
    requestMilestone(req,'entitlementDone');
    requestContext(req, { model: ent.model.publicId });
    const [threadSession] = await db.select().from(modelSessions).where(and(eq(modelSessions.userId,a.user.id),eq(modelSessions.deviceId,a.device!.id),eq(modelSessions.clientThreadId,threadId),gte(modelSessions.expiresAt,new Date()))).limit(1);
    let sessionHint = threadSession?.modelId === ent.model.id ? threadSession : undefined;
    if (body.previous_response_id) {
      const [previous] = await db.select().from(modelSessions).where(and(eq(modelSessions.userId,a.user.id),eq(modelSessions.deviceId,a.device!.id),eq(modelSessions.modelId,ent.model.id),gte(modelSessions.expiresAt,new Date()),sql`${modelSessions.state}->>'responseId' = ${String(body.previous_response_id)}`)).limit(1);
      if (!previous || !previous.state.encryptedHistory) throw new ApiError(409,'CONVERSATION_NOT_FOUND','历史响应已过期、超出缓存限制或不属于此账号设备，请重发完整历史。');
      const history = JSON.parse(decryptSecret(previous.state.encryptedHistory as {ciphertext:string;iv:string;tag:string})) as Array<Record<string,unknown>>;
      const delta = typeof body.input==='string'?[{role:'user',content:body.input}]:body.input;
      const includesHistory = delta.length >= history.length && JSON.stringify(delta.slice(0,history.length))===JSON.stringify(history);
      body.input = includesHistory ? delta : [...history,...delta];
      delete body.previous_response_id; sessionHint = previous;
    }
    requestMilestone(req,'historyRecovered');
    const selected = chooseInstance(ent.candidates,body,sessionHint?.instanceId);
    ent.provider = selected.provider;
    ent.model = {...ent.model, providerModelId:selected.instance.providerModelId};
    const isolatedMock=ent.provider.code==='MOCK'&&integrationMockAllowed(ent.provider.code,a.user.email,process.env.INTEGRATION_MOCK_ENABLED==='true',process.env.INTEGRATION_MOCK_TEST_EMAIL);
    const profile=responsesProfile(ent.provider.code)??'deepseek';
    const native=!isolatedMock && selected.instance.nativeProtocols.includes('responses') && process.env.NATIVE_RESPONSES_ENABLED !== 'false';
    if(!native&&!isolatedMock)throw new ApiError(422,'UNSUPPORTED_PROTOCOL','云模型仅支持原生 Responses。');
    const compatibility = native ? validateNativeRequest(body,profile) : {};
    const reasoning = nativeReasoning(body, selected.instance.capabilities.reasoning === true,profile);
    const resolvedMode = body.reasoning?.mode==='normal'||reasoning.effort === 'none' || selected.instance.capabilities.reasoning!==true ? 'normal' : 'thinking';
    if (sessionHint?.state.resolvedMode && sessionHint.state.resolvedMode !== resolvedMode) throw new ApiError(409,'CONVERSATION_MODE_CHANGED','当前会话的思考模式已改变，请新建会话。');
    requestMilestone(req,'routingDone');
    requestContext(req, { providerId: ent.provider.id, instanceId:selected.instance.id, inputProtocol:'responses', outboundProtocol:native?'responses':'integration_mock', protocolMode:native?'native':'integration_mock', responsesProfile:profile,reasoningMode:resolvedMode, stream:body.stream, ...compatibility });
    const ratePolicy = await currentRatePolicy(a.user.id);
    const mode = ent.usage.moneyEnabled ? 'ENFORCED' : currentBillingMode();
    const connectionHeader = req.headers['x-provider-connection-id'];
    if (connectionHeader !== undefined && typeof connectionHeader !== 'string') throw new ApiError(400, 'INVALID_PROVIDER_CONNECTION');
    const connectionId = connectionHeader ? z.uuid().parse(connectionHeader) : null;
    if (connectionId && (mode === 'OFF' || ent.provider.code === 'MOCK')) throw new ApiError(409, 'PROVIDER_CONNECTION_UNAVAILABLE');
    const [connection] = connectionId ? await db.select().from(providerAccounts).where(and(eq(providerAccounts.id, connectionId), eq(providerAccounts.userId, a.user.id),
      eq(providerAccounts.providerId, ent.provider.id), eq(providerAccounts.ownership, 'BYOS'), eq(providerAccounts.status, 'ACTIVE'))).limit(1) : [];
    if (connectionId && !connection) throw new ApiError(403, 'PROVIDER_AUTH_REQUIRED');
    const adapter = await providerFor(ent.provider.id, ent.provider.code, connection ? { id: connection.id, userId: a.user.id } : undefined);
    if(native&&!adapter.executeNative)throw new ApiError(422,'UNSUPPORTED_PROTOCOL','该资源没有原生 Responses 执行能力。');
    const billingPolicy: BillingPolicy = connection ? 'BYOS_USAGE' : 'MANAGED_USAGE';
    const meteredMock = ent.provider.code === 'MOCK' && mode === 'SHADOW' && integrationMockAllowed(ent.provider.code, a.user.email,
      process.env.INTEGRATION_MOCK_ENABLED === 'true', process.env.INTEGRATION_MOCK_TEST_EMAIL);
    const settlementMode = mode !== 'OFF' && (ent.provider.code !== 'MOCK' || meteredMock) ? mode : null;
    if (ent.usage.moneyEnabled && !connection && isDeepSeekProvider(ent.provider.code)) await ensureMoneyRate(ent.provider.id,ent.model.id,ent.model.providerModelId);
    const v2Rate = settlementMode === 'ENFORCED' ? (await preflightPoints(a.user.id, ent.provider.id, ent.model.id, billingPolicy)).rate
      : settlementMode === 'SHADOW' ? await activeRateVersion(ent.provider.id, ent.model.id, billingPolicy) : null;
    if (settlementMode === 'SHADOW' && !v2Rate) throw new ApiError(503, 'RATE_CARD_UNAVAILABLE');
    const upstream = ent.usage.moneyEnabled && !connection && isDeepSeekProvider(ent.provider.code) ? await upstreamBalance(ent.provider.id,ent.provider.code) : null;
    if(upstream&&!upstream.isAvailable)throw new ApiError(503,'PROVIDER_UNAVAILABLE','DeepSeek 上游余额不足，请管理员充值。');
    const upstreamCny=upstream?.balances.find(balance=>balance.currency==='CNY');
    const upstreamPoints=upstreamCny?Math.floor(Number(upstreamCny.total)*10000):null;
    requestMilestone(req,'preflightDone');
    const weight = Number(ent.model.usageWeight);
    const reserveTokens = Math.min(1024, Math.max(1, ent.usage.tokenLimit));
    const reserveCredit = usageCredit(reserveTokens, weight);
    const responseId = `resp_${randomUUID().replaceAll('-', '')}`;
    const traceHeader=req.headers['x-bridge-trace-id'];
    requestContext(req,{responseId,traceId:typeof traceHeader==='string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(traceHeader)?traceHeader:undefined});
    const { record, v2RequestId, continuation, maxOutputTokens } = await db.transaction(async tx => {
      await tx.execute(sql`select id from users where id = ${a.user.id} for update`);
      let reserveMoneyPoints=0;let maxOutputTokens:number|undefined;
      if(ent.usage.moneyEnabled && v2Rate && !connection && native) {
        const fresh=await currentUsage(a.user.id,ent.subscription,ent.plan);
        const serialized=JSON.stringify(body);
        const estimatedInput=Math.min(ent.model.contextWindow??1000000,Buffer.byteLength(serialized)+256+(serialized.includes('input_image')?1000000:0));
        const availablePoints=Math.min(fresh.remainingPoints,upstreamPoints??fresh.remainingPoints);
        const inputPoints=estimatedInput*Number(v2Rate.inputRate)/1000;
        const maxOutput=Number(v2Rate.outputRate)>0?Math.floor((availablePoints-inputPoints)*1000/Number(v2Rate.outputRate)):32768;
        maxOutputTokens=Math.min(32768,ent.model.maxOutputTokens??32768,maxOutput, typeof body.max_output_tokens === 'number' ? body.max_output_tokens : 32768);
        if(maxOutputTokens<1)throw new ApiError(402,'INSUFFICIENT_POINTS','可用人民币额度不足以完成这次请求，请充值或调整周期限额。');
        reserveMoneyPoints=ratePoints('MANAGED_USAGE',{inputTokens:estimatedInput,outputTokens:maxOutputTokens},v2Rate);
        if(reserveMoneyPoints>availablePoints)throw new ApiError(402,'INSUFFICIENT_POINTS');
      }
      const [session] = await tx.select().from(modelSessions).where(and(eq(modelSessions.userId, a.user.id),
        eq(modelSessions.deviceId, a.device!.id), eq(modelSessions.clientThreadId, threadId),
        gte(modelSessions.expiresAt, new Date()))).for('update').limit(1);
      if (session?.modelId === ent.model.id && session.instanceId && session.instanceId !== selected.instance.id)
        throw new ApiError(409,'CONVERSATION_MODE_CHANGED','会话正在绑定资源，请重试当前请求。');
      if (session?.modelId === ent.model.id && session.state.resolvedMode && session.state.resolvedMode !== resolvedMode)
        throw new ApiError(409,'CONVERSATION_MODE_CHANGED','当前会话的思考模式已改变，请新建会话。');
      const continuation = session?.modelId === ent.model.id && session.providerId === ent.provider.id
        ? pendingContinuation(session.state, body, Date.now()) : null;
      const [totals] = await tx.select({ tokens: sum(usageRecords.totalTokens), credit: sum(usageRecords.usageCredit), running: sql<number>`count(*) filter (where ${usageRecords.status} = 'RUNNING')`, rpm: sql<number>`count(*) filter (where ${usageRecords.createdAt} >= now() - interval '1 minute')` }).from(usageRecords)
        .where(and(eq(usageRecords.userId, a.user.id), gte(usageRecords.createdAt, ent.subscription.currentPeriodStart), lt(usageRecords.createdAt, ent.subscription.currentPeriodEnd)));
      const [recent] = await tx.select({
        account: sql<number>`count(*)`,
        device: sql<number>`count(*) filter (where ${usageRecords.deviceId} = ${a.device!.id})`,
      }).from(usageRecords).where(and(eq(usageRecords.userId, a.user.id), eq(usageRecords.rateCounted, true),
        sql`${usageRecords.createdAt} >= now() - interval '1 minute'`));
      if (!ent.usage.moneyEnabled && (Number(totals.tokens ?? 0) + reserveTokens > ent.usage.tokenLimit || Number(totals.credit ?? 0) + reserveCredit > ent.usage.creditLimit)) throw new ApiError(429, 'MONTHLY_QUOTA_EXCEEDED');
      if (Number(totals.running) >= ent.plan.maxConcurrentRequests || Number(totals.rpm) >= ent.plan.requestsPerMinute
        || (!continuation && (Number(recent.account) >= ratePolicy.accountRpm || Number(recent.device) >= ratePolicy.deviceRpm))) throw new ApiError(429, 'RATE_LIMITED');
      if (session) await tx.update(modelSessions).set({ state: {responseId:session.state.responseId,resolvedMode:session.state.resolvedMode,encryptedHistory:session.state.encryptedHistory} }).where(eq(modelSessions.id, session.id));
      else await tx.insert(modelSessions).values({userId:a.user.id,deviceId:a.device!.id,clientThreadId:threadId,providerId:ent.provider.id,modelId:ent.model.id,instanceId:selected.instance.id,state:{resolvedMode},expiresAt:new Date(Date.now()+3600000)})
        .onConflictDoUpdate({target:[modelSessions.userId,modelSessions.deviceId,modelSessions.clientThreadId],set:{providerId:ent.provider.id,modelId:ent.model.id,instanceId:selected.instance.id,state:{resolvedMode},expiresAt:new Date(Date.now()+3600000),lastActiveAt:new Date()}});
      const [newRecord] = await tx.insert(usageRecords).values({ userId: a.user.id, deviceId: a.device!.id, planId: ent.plan.id,
        providerId: ent.provider.id, modelId: ent.model.id, status: 'RUNNING', rateCounted: !continuation,
        totalTokens: reserveTokens, usageCredit: String(ent.usage.moneyEnabled?reserveMoneyPoints:reserveCredit) }).returning();
      const [request] = settlementMode ? await tx.insert(aiRequests).values({ responseId, userId: a.user.id, deviceId: a.device!.id,
        instanceId:selected.instance.id, protocolMode:native?'native':'integration_mock',
        providerId: ent.provider.id, modelId: ent.model.id, providerAccountId: connection?.id ?? null, billingPolicy, rateCardVersionId: v2Rate?.id ?? null,
        legacyUsageRecordId: newRecord.id, status: 'STARTED', startedAt: new Date() }).returning() : [];
      await tx.insert(deviceSessions).values({ userId: a.user.id, deviceId: a.device!.id, lastSeenAt: new Date(), lastIpHash: hashRiskSignal(req.ip), requestCount: 1 })
        .onConflictDoUpdate({ target: deviceSessions.deviceId, set: { lastSeenAt: new Date(), lastIpHash: hashRiskSignal(req.ip), requestCount: sql`${deviceSessions.requestCount} + 1` } });
      await tx.update(devices).set({ lastSeenAt: new Date(), updatedAt: new Date() }).where(eq(devices.id, a.device!.id));
      return { record: newRecord, v2RequestId: request?.id, continuation, maxOutputTokens };
    });
    requestMilestone(req,'reservationDone');
    if(maxOutputTokens)body.maxOutputTokens=maxOutputTokens;
    const started = Date.now();
    if (v2RequestId) reply.header('X-Bridge-AI-Request-Id', v2RequestId);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ent.provider.timeoutMs);
    let ended = false;
    let clientDisconnected = false;
    let observedResult: CanonicalResult | undefined;
    let copilotStreamOpened = false;
    let observedTextDelta = false;
    let upstreamAttempted = false;
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
      if (body.stream && (native || ent.provider.code === 'COPILOT' || isDeepSeekProvider(ent.provider.code))) {
        reply.hijack();
        reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive', 'X-Accel-Buffering': 'no', ...(v2RequestId ? { 'X-Bridge-AI-Request-Id': v2RequestId } : {}) });
        copilotStreamOpened = true;
        if (!native) {
        writeEvent(reply.raw, 'response.created', { response: { id: responseId, status: 'in_progress', model: body.model } });
        writeEvent(reply.raw, 'response.output_item.added', { response_id: responseId, output_index: 0,
          item: { id: `msg_${responseId}`, type: 'message', status: 'in_progress', role: 'assistant', content: [] } });
        writeEvent(reply.raw, 'response.content_part.added', { item_id: `msg_${responseId}`, response_id: responseId, output_index: 0,
          content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
        }
      }
      const onTextDelta = copilotStreamOpened ? (delta: string) => {
        observedTextDelta = hasObservedUpstreamTextDelta(observedTextDelta, delta);
        if (delta && !reply.raw.destroyed && !reply.raw.writableEnded) {
          writeEvent(reply.raw, 'response.output_text.delta', { item_id: `msg_${responseId}`, response_id: responseId, output_index: 0, content_index: 0, delta });
        }
      } : undefined;
      const onNativeEvent = async (type:string, event:Record<string,unknown>) => {
        requestMilestone(req,'relayFirstEvent');
        if(type==='response.output_text.delta'||type==='response.reasoning_text.delta')requestMilestone(req,'relayFirstText');
        if(type==='response.function_call_arguments.done'||type==='response.custom_tool_call_input.done')requestMilestone(req,'relayToolArgumentsDone');
        observedTextDelta = true; // Even reasoning/tool events prove upstream execution; missing usage must be reviewed.
        const rewritten = { ...event, ...(event.response_id ? {response_id:responseId}:{}),
          ...(event.response && typeof event.response==='object' ? {response:{...event.response as Record<string,unknown>, id:responseId, model:body.model}}:{}) };
        if (!reply.raw.destroyed && !reply.raw.writableEnded) {
          const ok = reply.raw.write(`event: ${type}\ndata: ${JSON.stringify(rewritten)}\n\n`);
          if (!ok) await once(reply.raw,'drain',{signal:controller.signal});
        }
      };
      upstreamAttempted = true;
      requestMilestone(req,'upstreamStarted');requestCounts(req,{upstreamAttemptCount:1});
      const result = native && adapter.executeNative
        ? await adapter.executeNative(body,ent.model.providerModelId,controller.signal,body.stream?onNativeEvent:undefined)
        : !connection && existing?.modelId === ent.model.id && existing.providerSessionId
        ? await adapter.resumeSession(body, ent.model.providerModelId, existing.providerSessionId, controller.signal, onTextDelta)
        : await adapter.createResponse(body, ent.model.providerModelId, controller.signal, onTextDelta);
      observedResult = result;
      requestNativeMetrics(req,(result as CanonicalResult&{nativeMetrics?:Record<string,number>}).nativeMetrics);
      requestContext(req,{terminalStatus:result.status??'completed'});
      await db.update(modelInstances).set({healthStatus:result.status==='failed'?'DEGRADED':'READY',healthCheckedAt:new Date(),cooldownUntil:result.status==='failed'?new Date(Date.now()+60000):null}).where(eq(modelInstances.id,selected.instance.id));
      if (!native) result.output = result.output.map((item, index) => ({ ...item,
        id: item.type === 'message' ? `msg_${responseId}` : `fc_${responseId}_${index}`, status: 'completed' }));
      const total = result.inputTokens + result.outputTokens;
      const credit = usageCredit(total, weight);
      const event = v2RequestId && settlementMode ? await settleAiRequest(v2RequestId, clientDisconnected ? 'CLIENT_DISCONNECTED' : result.status==='failed'?'PROVIDER_ERROR':'COMPLETED', {
        usageUnavailable:result.usageUnavailable,
        usage: { inputTokens: result.inputTokens, outputTokens: result.outputTokens, cachedInputTokens: result.cachedInputTokens,
          reasoningTokens: result.reasoningTokens, imageInput: result.imageInput, imageOutput: result.imageOutput, toolCalls: result.toolCalls },
        providerReportedUsage: result.providerReportedUsage, providerCost: result.providerCost === undefined ? undefined : String(result.providerCost),
        providerCurrency: result.providerCurrency,
      }, settlementMode) : null;
      requestMilestone(req,'settlementDone');
      if(event?.billingStatus==='UNPAID')throw new ApiError(402,'INSUFFICIENT_POINTS','本次用量超过可用余额，需要管理员核对补足。');
      await db.transaction(async tx => {
        await tx.update(usageRecords).set({ status:result.status==='failed'?'FAILED':'COMPLETED',errorCode:result.status==='failed'?'PROVIDER_UNAVAILABLE':null, inputTokens: result.inputTokens, outputTokens: result.outputTokens, totalTokens: total, usageCredit: String(credit), providerCost: result.providerCost === undefined ? null : String(result.providerCost), costKind: result.costKind, durationMs: Date.now() - started, completedAt: new Date() }).where(eq(usageRecords.id, record.id));
        const history = [...(typeof body.input==='string'?[{role:'user',content:body.input}]:body.input),...result.output];
        const state = {...(result.status==='failed'?{}:nextContinuationState(body, result, continuation, Date.now())), resolvedMode, responseId,
          ...(Buffer.byteLength(JSON.stringify(history)) < 900_000 ? {encryptedHistory:encryptSecret(JSON.stringify(history))} : {historyUnavailable:'LIMIT'})};
        // Expired content is purged, not merely made inaccessible by the TTL query.
        await tx.update(modelSessions).set({state:{}}).where(lt(modelSessions.expiresAt,new Date()));
        await tx.insert(modelSessions).values({ userId: a.user.id, deviceId: a.device!.id, clientThreadId: threadId, providerId: ent.provider.id, modelId: ent.model.id, instanceId:selected.instance.id, providerSessionId: result.providerSessionId ?? responseId, expiresAt: new Date(Date.now() + 3600000), state })
          .onConflictDoUpdate({ target: [modelSessions.userId, modelSessions.deviceId, modelSessions.clientThreadId], set: { providerId: ent.provider.id, modelId: ent.model.id, instanceId:selected.instance.id, providerSessionId: result.providerSessionId ?? responseId, lastActiveAt: new Date(), expiresAt: new Date(Date.now() + 3600000), state } });
      });
      requestMilestone(req,'historySaved');
      const latestUsage = await currentUsage(a.user.id, ent.subscription, ent.plan);
      const balance = latestUsage.moneyEnabled ? latestUsage.remainingPoints : event ? (await walletSummary(a.user.id)).balance : 0;
      const response = responseBody(responseId, body.model, result, event && v2RequestId
        ? { points: event.pointsCharged, points_rated: event.pointsRated, points_charged: event.pointsCharged,
          remaining_points: balance, request_id: v2RequestId, billing_mode: settlementMode! } : undefined);
      Object.assign(response.usage,{ points_per_rmb:10000, cost_rmb:(event?.pointsCharged??0)/10000, remaining_rmb:balance/10000,
        billing_status:event?.billingStatus, ...(result.usageUnavailable?{usage_unavailable:true}:{}),
        period_limit_rmb:latestUsage.rmbLimit, period_used_rmb:latestUsage.rmbUsed, money_enabled:latestUsage.moneyEnabled,
        limits:{account_rpm:ratePolicy.accountRpm,device_rpm:ratePolicy.deviceRpm,plan_rpm:ent.plan.requestsPerMinute} });
      if (!body.stream) { ended = true; return response; }
      if (copilotStreamOpened) {
        if (!reply.raw.destroyed && !reply.raw.writableEnded) {
          if (native) {
            writeEvent(reply.raw, result.nativeTerminalEvent ?? `response.${response.status}`, {...result.nativeTerminalData,response});
            ended = true; reply.raw.end(); return;
          }
          result.output.forEach((item, index) => {
            if (item.type !== 'message') writeEvent(reply.raw, 'response.output_item.added', { response_id: responseId, output_index: index, item });
            if (item.type === 'message') {
              const part = (item.content as Array<{ text?: string }>)[0];
              writeEvent(reply.raw, 'response.output_text.done', { item_id: item.id, output_index: index, content_index: 0, text: part?.text ?? '' });
              writeEvent(reply.raw, 'response.content_part.done', { item_id: item.id, output_index: index, content_index: 0,
                part: { type: 'output_text', text: part?.text ?? '', annotations: [] } });
            }
            writeEvent(reply.raw, 'response.output_item.done', { response_id: responseId, output_index: index, item });
          });
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
      const upstream = error instanceof Error ? /^HTTP_(\d{3})$/.exec(error.message) : null;
      req.log.warn({ event: 'provider_failed', requestId: req.id, userId: a.user.id, deviceId: a.device!.id,
        model: ent.model.publicId, providerId: ent.provider.id, upstreamStatus: upstream ? Number(upstream[1]) : undefined,
        errorCode: error instanceof ApiError || error instanceof CopilotFailure ? error.code
          : controller.signal.aborted ? 'GATEWAY_TIMEOUT' : 'PROVIDER_UNAVAILABLE' }, 'provider request failed');
      if (v2RequestId) {
        try {
          await settleAiRequest(v2RequestId, clientDisconnected ? 'CLIENT_DISCONNECTED' : 'PROVIDER_ERROR', observedResult ? {
            usage: { inputTokens: observedResult.inputTokens, outputTokens: observedResult.outputTokens, cachedInputTokens: observedResult.cachedInputTokens,
              reasoningTokens: observedResult.reasoningTokens, imageInput: observedResult.imageInput, imageOutput: observedResult.imageOutput, toolCalls: observedResult.toolCalls },
            providerReportedUsage: observedResult.providerReportedUsage,
          } : { usageUnavailable: interruptedStreamUsageUnavailable(observedTextDelta, Boolean(observedResult))
            || (error instanceof ApiError && error.code==='PROVIDER_USAGE_UNAVAILABLE')
            || (upstreamAttempted && (controller.signal.aborted || (error instanceof ApiError && error.code==='PROTOCOL_INVALID' && error.status>=500) || (!(error instanceof ApiError) && !(error instanceof CopilotFailure)))) }, settlementMode!);
        } catch (settlementError) { req.log.error({ settlementErrorType: settlementError instanceof Error ? settlementError.name : 'UnknownError', requestId: v2RequestId }, 'V2 settlement failed'); }
      }
      const failure = error instanceof CopilotFailure || error instanceof ApiError ? error : controller.signal.aborted
        ? new CopilotFailure(504, 'GATEWAY_TIMEOUT') : new CopilotFailure(503, 'PROVIDER_UNAVAILABLE');
      requestContext(req,{terminalStatus:clientDisconnected?'client_disconnected':'failed',errorCode:failure.code});
      if (['PROVIDER_AUTH_REQUIRED','PROVIDER_UNAVAILABLE','PROVIDER_RATE_LIMITED','GATEWAY_TIMEOUT'].includes(failure.code)) {
        await db.update(modelInstances).set({healthStatus:failure.code==='PROVIDER_AUTH_REQUIRED'?'UNAVAILABLE':'DEGRADED',healthCheckedAt:new Date(),cooldownUntil:new Date(Date.now()+60000)}).where(eq(modelInstances.id,selected.instance.id));
      }
      await db.update(usageRecords).set({ status: controller.signal.aborted ? 'ABORTED' : 'FAILED', totalTokens: 0, usageCredit: '0',
        errorCode: failure.code, durationMs: Date.now() - started, completedAt: new Date() }).where(eq(usageRecords.id, record.id));
      if (copilotStreamOpened) {
        if (!reply.raw.destroyed && !reply.raw.writableEnded) {
          writeEvent(reply.raw, 'response.failed', { response: { id: responseId, status: 'failed' },
            error: { code: failure.code, message: failure.message, request_id: v2RequestId ?? req.id } });
          reply.raw.write('data: [DONE]\n\n');
          ended = true;
          reply.raw.end();
        }
        return;
      }
      throw new ApiError(failure.status, failure.code, failure.message);
    } finally { clearTimeout(timeout); }
  });
}
