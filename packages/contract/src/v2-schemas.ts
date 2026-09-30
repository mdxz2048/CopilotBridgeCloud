import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

const instant = z.iso.datetime({ offset: true });
const id = z.uuid();
export const BillingModeV2Schema = z.enum(['OFF', 'SHADOW', 'ENFORCED']);
export const InstallationPublicJwkV23Schema = z.object({
  kty: z.literal('EC'), crv: z.literal('P-256'), x: z.base64url().length(43), y: z.base64url().length(43),
}).strict();
export const DeviceInfoV23Schema = z.object({
  deviceId: id, deviceName: z.string().min(1).max(120), platform: z.string().min(1).max(60),
  osVersion: z.string().max(120).default(''), appVersion: z.string().max(120).default(''),
  publicKeyJwk: InstallationPublicJwkV23Schema,
});

export const RegisterRequestV2Schema = z.object({
  email: z.email(), password: z.string().min(12).max(256), referralCode: z.string().trim().min(8).max(24).optional(),
});
export const RegistrationConfigV24Schema = z.object({
  verificationRequired: z.boolean(), turnstileSiteKey: z.string().nullable(), registrationAvailable: z.boolean(),
  configurationStatus: z.enum(['DISABLED', 'READY', 'MISSING_CONFIG']),
});
export const RequestEmailCodeV24Schema = z.object({
  email: z.email(), turnstileToken: z.string().min(1).max(4096),
});
export const RegisterRequestV24Schema = RegisterRequestV2Schema.extend({ emailCode: z.string().regex(/^\d{6}$/) });
export const WebLoginRequestV24Schema = z.object({
  email: z.email(), password: z.string(), turnstileToken: z.string().min(1).max(4096),
});

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
  billingStatus: z.enum(['SETTLED', 'SHADOW', 'UNPAID', 'NO_USAGE', 'METERING_ERROR', 'UNRATED']), rateCardVersionId: id.nullable(),
});
export const ReferralSummaryV2Schema = z.object({
  code: z.string(), registered: z.number().int().nonnegative(), rewarded: z.number().int().nonnegative(), pointsEarned: z.number().int().nonnegative(),
});
export const ReferralRecordV2Schema = z.object({
  id, status: z.enum(['REGISTERED', 'PENDING', 'QUALIFIED', 'REWARDED', 'REJECTED']),
  registeredAt: instant, qualifiedAt: instant.nullable(),
});
export const ErrorCodeV2Schema = z.enum([
  'ACCOUNT_DISABLED', 'AUTH_REQUIRED', 'BILLING_REVIEW_REQUIRED', 'CANNOT_DISABLE_SELF', 'CLIENT_THREAD_ID_REQUIRED', 'COPILOT_AUTH_EXPIRED', 'COPILOT_NOT_ENTITLED', 'COPILOT_USAGE_UNAVAILABLE',
  'CSRF_REJECTED', 'DEVICE_LIMIT_REACHED', 'DEVICE_NOT_REGISTERED', 'DEVICE_PROOF_INVALID', 'DEVICE_PROOF_REPLAYED', 'DEVICE_REVOKED', 'EMAIL_IN_USE', 'EMAIL_CODE_INVALID', 'EMAIL_DELIVERY_UNAVAILABLE', 'FEATURE_DISABLED', 'TURNSTILE_INVALID', 'TURNSTILE_UNAVAILABLE', 'FORBIDDEN',
  'GATEWAY_TIMEOUT', 'IDEMPOTENCY_CONFLICT', 'INSUFFICIENT_POINTS', 'INTERNAL_ERROR', 'INVALID_CREDENTIALS', 'INVALID_POINTS',
  'INVALID_PROVIDER_CONNECTION', 'INVALID_REFERRAL_CODE', 'MODEL_NOT_ALLOWED', 'MODEL_NOT_AVAILABLE', 'MODEL_PROVIDER_MISMATCH',
  'MODEL_UNAVAILABLE', 'MONTHLY_QUOTA_EXCEEDED', 'NOT_FOUND', 'ORDER_NOT_PAYABLE', 'PAYMENT_PROVIDER_NOT_CONNECTED',
  'PLAN_NOT_FOUND', 'PLAN_REQUIRED', 'PROVIDER_AUTH_REQUIRED', 'PROVIDER_CONNECTION_UNAVAILABLE', 'PROVIDER_UNAVAILABLE',
  'RATE_CARD_EXISTS', 'RATE_CARD_FUTURE_SCHEDULE_NOT_SUPPORTED', 'RATE_CARD_NOT_DRAFT', 'RATE_CARD_UNAVAILABLE', 'RATE_LIMITED',
  'REFERRAL_CODE_UNAVAILABLE', 'REFERRAL_NOT_ELIGIBLE', 'REFERRAL_NOT_REVIEWABLE', 'REQUEST_NOT_FOUND', 'ROLLOVER_POLICY_INVALID',
  'SUBSCRIPTION_EXPIRED', 'SUBSCRIPTION_NOT_FOUND', 'SUBSCRIPTION_REQUIRED', 'TOKEN_EXPIRED', 'UNAUTHORIZED', 'VALIDATION_ERROR',
  'WALLET_LEDGER_MISMATCH', 'WALLET_LIMIT_REACHED',
]);
export const ErrorResponseV2Schema = z.object({ error: z.object({
  code: ErrorCodeV2Schema, message: z.string(), request_id: z.string(), requestId: z.string(),
}).refine(error => error.request_id === error.requestId) });
