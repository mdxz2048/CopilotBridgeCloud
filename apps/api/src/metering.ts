import { aiRequests, db, rateCards, rateCardVersions, usageEvents } from '@bridge/db';
import { and, desc, eq, gt, isNull, lte, or } from 'drizzle-orm';
import { ApiError } from './core.js';
import { normalizeUsage, ratePoints, type BillingPolicy, type NormalizedUsage, type PointRates } from './rating.js';
import { applyWalletChange, walletSummary } from './wallet.js';
import type { BillingMode } from './billing-mode.js';

export type RequestState = 'COMPLETED' | 'CLIENT_DISCONNECTED' | 'PROVIDER_ERROR';
export type MeteredResult = {
  usage?: Partial<NormalizedUsage>; usageUnavailable?: boolean; providerReportedUsage?: Record<string, unknown>;
  providerCost?: string; providerCurrency?: string; completedAt?: Date;
};

export function hasObservedUpstreamTextDelta(previous: boolean, delta: string) {
  return previous || delta.length > 0;
}

export function interruptedStreamUsageUnavailable(observedTextDelta: boolean, observedUsage: boolean) {
  return observedTextDelta && !observedUsage;
}

export function evaluateMeteredUsage(result: MeteredResult, policy: BillingPolicy, version: PointRates | undefined, mode: Exclude<BillingMode, 'OFF'>) {
  let meteringError = result.usageUnavailable === true;
  let usage;
  try { usage = normalizeUsage(result.usage ?? {}); }
  catch { meteringError = true; usage = normalizeUsage({}); }
  const hasObservedUsage = Object.values(usage).some(value => value > 0);
  let rated = 0;
  let ratingError = false;
  if (hasObservedUsage && !meteringError) {
    try { rated = ratePoints(policy, usage, version); }
    catch { ratingError = true; }
  }
  const billingStatus = meteringError ? 'METERING_ERROR' : ratingError ? 'UNRATED' : !hasObservedUsage ? 'NO_USAGE' : mode === 'SHADOW' ? 'SHADOW' : 'SETTLED';
  return { usage, rated, meteringError, ratingError, billingStatus };
}

export async function activeRateVersion(providerId: string, modelId: string, billingPolicy: BillingPolicy, at = new Date()) {
  const [rate] = await db.select({ version: rateCardVersions }).from(rateCardVersions)
    .innerJoin(rateCards, eq(rateCardVersions.rateCardId, rateCards.id))
    .where(and(eq(rateCards.providerId, providerId), eq(rateCards.modelId, modelId), eq(rateCards.billingPolicy, billingPolicy),
      eq(rateCardVersions.status, 'ACTIVE'), or(isNull(rateCardVersions.effectiveFrom), lte(rateCardVersions.effectiveFrom, at)),
      or(isNull(rateCardVersions.effectiveTo), gt(rateCardVersions.effectiveTo, at))))
    .orderBy(desc(rateCardVersions.version)).limit(1);
  return rate?.version ?? null;
}

export async function preflightPoints(userId: string, providerId: string, modelId: string, policy: BillingPolicy) {
  if (policy === 'LOCAL_USAGE') return { rate: null };
  const rate = await activeRateVersion(providerId, modelId, policy);
  if (!rate) throw new ApiError(503, 'RATE_CARD_UNAVAILABLE');
  const requiresBalance = rate.minimumCharge > 0 || [rate.inputRate, rate.outputRate, rate.cachedInputRate, rate.reasoningRate,
    rate.imageInputRate, rate.imageOutputRate, rate.toolRate].some(value => Number(value) > 0);
  const [unpaid] = await db.select({ id: usageEvents.id }).from(usageEvents).where(and(eq(usageEvents.userId, userId), eq(usageEvents.billingStatus, 'UNPAID'))).limit(1);
  if (unpaid) throw new ApiError(402, 'INSUFFICIENT_POINTS');
  const [review] = await db.select({ id: usageEvents.id }).from(usageEvents).where(and(eq(usageEvents.userId, userId), or(eq(usageEvents.billingStatus, 'METERING_ERROR'), eq(usageEvents.billingStatus, 'UNRATED')))).limit(1);
  if (review) throw new ApiError(409, 'BILLING_REVIEW_REQUIRED');
  if (requiresBalance && (await walletSummary(userId)).balance <= 0) throw new ApiError(402, 'INSUFFICIENT_POINTS');
  return { rate };
}

export async function createAiRequest(input: {
  responseId: string; userId: string; deviceId: string; providerId: string; modelId: string;
  billingPolicy: BillingPolicy; rateCardVersionId?: string | null; legacyUsageRecordId?: string;
}) {
  const [request] = await db.insert(aiRequests).values({ ...input, status: 'STARTED', startedAt: new Date() }).returning();
  return request;
}

export async function settleAiRequest(requestId: string, state: RequestState, result: MeteredResult, mode: Exclude<BillingMode, 'OFF'> = 'ENFORCED') {
  return db.transaction(async tx => {
    const [request] = await tx.select().from(aiRequests).where(eq(aiRequests.id, requestId)).for('update').limit(1);
    if (!request) throw new ApiError(404, 'REQUEST_NOT_FOUND');
    const [existing] = await tx.select().from(usageEvents).where(eq(usageEvents.requestId, requestId)).limit(1);
    if (existing) return existing;
    const [version] = request.rateCardVersionId
      ? await tx.select().from(rateCardVersions).where(eq(rateCardVersions.id, request.rateCardVersionId)).limit(1)
      : [];
    const { usage, rated, meteringError, ratingError, billingStatus: initialStatus } = evaluateMeteredUsage(
      result, request.billingPolicy as BillingPolicy, version ?? undefined, mode);
    let charged = 0;
    let billingStatus = initialStatus;
    if (rated > 0 && mode === 'ENFORCED') {
      try {
        await applyWalletChange(tx, { userId: request.userId, points: -rated, type: 'USAGE', referenceType: 'AI_REQUEST', referenceId: request.id, idempotencyKey: `usage:${request.id}` });
        charged = rated;
      } catch (error) {
        if (!(error instanceof ApiError && error.code === 'INSUFFICIENT_POINTS')) throw error;
        billingStatus = 'UNPAID';
      }
    }
    const [event] = await tx.insert(usageEvents).values({
      requestId, eventKey: `final:${requestId}`, userId: request.userId, deviceId: request.deviceId,
      providerId: request.providerId, modelId: request.modelId, ...usage,
      providerReportedUsage: result.providerReportedUsage ?? (meteringError && result.usage ? result.usage as Record<string, unknown> : null), providerCost: result.providerCost ?? null, providerCurrency: result.providerCurrency ?? null,
      rateCardVersionId: request.rateCardVersionId, pointsRated: rated, pointsCharged: charged, billingStatus,
      billingPolicy: request.billingPolicy, startedAt: request.startedAt ?? request.createdAt, completedAt: result.completedAt ?? new Date(),
    }).returning();
    await tx.update(aiRequests).set({ status: state, completedAt: event.completedAt,
      errorCode: result.usageUnavailable ? 'COPILOT_USAGE_UNAVAILABLE' : meteringError ? 'INVALID_PROVIDER_USAGE' : ratingError ? 'UNRATED_USAGE' : state === 'PROVIDER_ERROR' ? 'PROVIDER_UNAVAILABLE' : null }).where(eq(aiRequests.id, requestId));
    return event;
  });
}
