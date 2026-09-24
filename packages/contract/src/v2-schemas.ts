import { z } from 'zod';

const instant = z.iso.datetime({ offset: true });
const id = z.uuid();

export const AccountSummaryV2Schema = z.object({ id, email: z.email(), status: z.enum(['ACTIVE', 'DISABLED', 'EXPIRED']) });
export const SubscriptionSummaryV2Schema = z.object({
  id, status: z.enum(['TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED', 'SUSPENDED']),
  planCode: z.string(), periodStart: instant, periodEnd: instant,
  monthlyPoints: z.number().int().nonnegative(), maxDevices: z.number().int().nonnegative(),
  rolloverPolicy: z.enum(['NONE', 'UNLIMITED']),
}).nullable();
export const WalletSummaryV2Schema = z.object({ balance: z.number().int().nonnegative(), unit: z.literal('AI_POINT') });
export const DeviceV2Schema = z.object({
  id, userId: id, deviceId: id, deviceName: z.string(), platform: z.string(), osVersion: z.string(), appVersion: z.string(),
  status: z.enum(['ACTIVE', 'REVOKED', 'BLOCKED']), activatedAt: instant, lastSeenAt: instant.nullable(), updatedAt: instant,
});
export const DeviceCredentialV2Schema = z.object({
  accessToken: z.string().min(1), refreshToken: z.string().min(1), expiresIn: z.literal(1800),
  user: AccountSummaryV2Schema.extend({ role: z.enum(['USER', 'ADMIN']) }), device: DeviceV2Schema,
});
export const ProviderV2Schema = z.object({
  id, code: z.string(), name: z.string(), ownership: z.literal('MANAGED'), status: z.enum(['ACTIVE', 'DISABLED']),
});
export const ProviderConnectionV2Schema = z.object({
  id, providerId: id, ownership: z.literal('BYOS'), status: z.enum(['ACTIVE', 'DISABLED']), label: z.string(),
  createdAt: instant.optional(), updatedAt: instant.optional(),
});
export const ModelV2Schema = z.object({
  id, publicId: z.string(), displayName: z.string(),
  capabilities: z.object({ tools: z.boolean(), vision: z.boolean(), reasoning: z.boolean(), streaming: z.boolean() }),
});
export const UsageSummaryV2Schema = z.object({
  requests: z.number().int().nonnegative(), pointsRated: z.number().int().nonnegative(), pointsCharged: z.number().int().nonnegative(),
  legacy: z.record(z.string(), z.unknown()).nullable(),
});
export const UsageRecordV2Schema = z.object({
  inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(), reasoningTokens: z.number().int().nonnegative(),
  pointsRated: z.number().int().nonnegative(), pointsCharged: z.number().int().nonnegative(),
  billingStatus: z.enum(['SETTLED', 'UNPAID', 'NO_USAGE', 'METERING_ERROR', 'UNRATED']), rateCardVersionId: id.nullable(),
});
export const ReferralSummaryV2Schema = z.object({
  code: z.string(), registered: z.number().int().nonnegative(), rewarded: z.number().int().nonnegative(), pointsEarned: z.number().int().nonnegative(),
});
export const ReferralRecordV2Schema = z.object({
  id, status: z.enum(['REGISTERED', 'PENDING', 'QUALIFIED', 'REWARDED', 'REJECTED']),
  registeredAt: instant, qualifiedAt: instant.nullable(),
});
export const ErrorResponseV2Schema = z.object({ error: z.object({
  code: z.string().min(1), message: z.string(), request_id: z.string(), requestId: z.string(),
}).refine(error => error.request_id === error.requestId) });
