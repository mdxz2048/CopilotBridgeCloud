import { OpenAPIRegistry, OpenApiGeneratorV31, extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { PlanSchema, ResponseRequestSchema, ResponseSchema, SubscriptionSchema, UserSchema } from './schemas.js';
import {
  AccountSummaryV2Schema, BillingModeV2Schema, DeviceCredentialV2Schema, DeviceV2Schema, ErrorResponseV2Schema,
  ModelV2Schema, ProviderConnectionV2Schema, ProviderV2Schema, ReferralRecordV2Schema, ReferralSummaryV2Schema,
  DeviceInfoV23Schema, RegisterRequestV2Schema, RegisterRequestV24Schema, RegistrationConfigV24Schema, RequestEmailCodeV24Schema,
  WebLoginRequestV24Schema, SubscriptionSummaryV2Schema, UsageRecordV2Schema, UsageSummaryV2Schema, WalletSummaryV2Schema,
} from './v2-schemas.js';

extendZodWithOpenApi(z);
const registry = new OpenAPIRegistry();
const json = (schema: z.ZodType) => ({ 'application/json': { schema } });
const generic = z.object({}).passthrough();
const uuidParams = z.object({ id: z.uuid() });
const list = (schema: z.ZodType) => z.object({ data: z.array(schema) });
const success = (schema: z.ZodType, status = 200) => ({
  [status]: { description: 'Success', content: json(schema) },
  400: { description: 'Invalid request', content: json(ErrorResponseV2Schema) },
  401: { description: 'Authentication required', content: json(ErrorResponseV2Schema) },
  403: { description: 'Access denied', content: json(ErrorResponseV2Schema) },
  409: { description: 'Conflict', content: json(ErrorResponseV2Schema) },
  429: { description: 'Rate limited', content: json(ErrorResponseV2Schema) },
});
type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
function route(method: Method, path: string, output: z.ZodType, body?: z.ZodType, status = 200, auth = true) {
  const params = path === '/api/v1/usage/responses/{id}'
    ? z.object({ id: z.string().regex(/^resp_[0-9a-f]{32}$/) })
    : path.includes('{id}') ? uuidParams : undefined;
  registry.registerPath({ method, path, summary: `${method.toUpperCase()} ${path}`,
    ...(auth ? { security: [{ DesktopBearer: [] }] } : {}),
    ...(body || params ? { request: { ...(params ? { params } : {}), ...(body ? { body: { content: json(body) } } : {}) } } : {}),
    responses: success(output, status) });
}

const account = z.object({ account: AccountSummaryV2Schema, subscription: SubscriptionSummaryV2Schema,
  wallet: WalletSummaryV2Schema, activeDevices: z.number().int().nonnegative() });
const providerConnectionCreate = z.object({ providerId: z.uuid(), label: z.string().trim().min(1).max(120), apiKey: z.string().min(8).max(4096) });
const ratePolicyV23 = z.object({ accountRpm: z.number().int().min(1).max(120), deviceRpm: z.number().int().min(1).max(60),
  publicIpRpm: z.number().int().min(1).max(10000), authIpRpm: z.number().int().min(1).max(1000) });
const requestLookup = z.object({
  request: z.object({ id: z.uuid(), responseId: z.string(), status: z.enum(['CREATED', 'STARTED', 'COMPLETED', 'CLIENT_DISCONNECTED', 'PROVIDER_ERROR']),
    billingPolicy: z.enum(['MANAGED_USAGE', 'BYOS_USAGE', 'LOCAL_USAGE']), createdAt: z.iso.datetime({ offset: true }),
    completedAt: z.iso.datetime({ offset: true }).nullable() }),
  usage: UsageRecordV2Schema.nullable(), wallet: WalletSummaryV2Schema,
});
const walletTransaction = z.object({ id: z.uuid(), type: z.string(), points: z.number().int(), balanceAfter: z.number().int(),
  referenceType: z.string(), referenceId: z.string(), createdAt: z.iso.datetime({ offset: true }) });
const referralCode = z.object({ code: z.string(), status: z.string() });
const referralApply = z.object({ id: z.uuid(), status: z.enum(['REGISTERED', 'PENDING']), riskReviewRequired: z.boolean() });
const responseV2 = ResponseSchema.extend({ usage: ResponseSchema.shape.usage.extend({
  points: z.number().int().nonnegative().optional(), points_rated: z.number().int().nonnegative().optional(),
  points_charged: z.number().int().nonnegative().optional(), remaining_points: z.number().int().nonnegative().optional(),
  request_id: z.uuid().optional(), billing_mode: BillingModeV2Schema.exclude(['OFF']).optional(),
}) });

for (const [name, schema] of Object.entries({ AccountSummary: AccountSummaryV2Schema, SubscriptionSummary: SubscriptionSummaryV2Schema,
  WalletSummary: WalletSummaryV2Schema, Device: DeviceV2Schema, DeviceCredential: DeviceCredentialV2Schema, Provider: ProviderV2Schema,
  ProviderConnection: ProviderConnectionV2Schema, Model: ModelV2Schema, UsageSummary: UsageSummaryV2Schema, UsageRecord: UsageRecordV2Schema,
  ReferralSummary: ReferralSummaryV2Schema, ReferralRecord: ReferralRecordV2Schema, ErrorResponse: ErrorResponseV2Schema,
  RegisterRequest: RegisterRequestV24Schema, RegistrationConfig: RegistrationConfigV24Schema,
  RequestEmailCode: RequestEmailCodeV24Schema, WebLoginRequest: WebLoginRequestV24Schema, Response: responseV2 })) {
  registry.register(name, schema);
}
registry.registerComponent('securitySchemes', 'DesktopBearer', { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Desktop bearer requests also require a DPoP compact ES256 JWT bound to the installation public P-256 JWK. Browser cookies remain exempt.' });

route('get', '/api/v1/auth/registration-config', RegistrationConfigV24Schema, undefined, 200, false);
route('post', '/api/v1/auth/email-code', z.object({ accepted: z.literal(true) }), RequestEmailCodeV24Schema, 202, false);
route('post', '/api/v1/auth/register', z.object({ user: UserSchema }),
  z.union([RegisterRequestV2Schema, RegisterRequestV24Schema]), 201, false);
route('post', '/api/v1/auth/login', z.union([DeviceCredentialV2Schema, z.object({ user: UserSchema })]),
  z.union([WebLoginRequestV24Schema, z.object({ email: z.email(), password: z.string() }),
    z.object({ email: z.email(), password: z.string(), device: DeviceInfoV23Schema })]), 200, false);
route('get', '/api/v1/admin/rate-policy', z.object({ policy: ratePolicyV23 }));
route('put', '/api/v1/admin/rate-policy', z.object({ policy: ratePolicyV23 }), ratePolicyV23);
registry.registerPath({ method: 'post', path: '/api/v1/auth/refresh', summary: 'Rotate a DPoP-bound desktop refresh token',
  request: { headers: z.object({ DPoP: z.string() }),
    body: { content: json(z.object({ refreshToken: z.string().min(20) })) } },
  responses: success(z.object({ accessToken: z.string(), refreshToken: z.string(), expiresIn: z.literal(1800) })) });
route('get', '/api/v1/me', account);
route('get', '/api/v1/me/subscription', z.object({ subscription: SubscriptionSchema.nullable(), plan: PlanSchema.extend({
  monthlyPoints: z.number().int(), rolloverPolicy: z.enum(['NONE', 'UNLIMITED']),
}).nullable() }));
route('get', '/api/v1/me/wallet', WalletSummaryV2Schema);
route('get', '/api/v1/me/devices', list(DeviceV2Schema));
route('get', '/api/v1/me/wallet/transactions', list(walletTransaction));
route('get', '/api/v1/me/usage', UsageSummaryV2Schema);
route('get', '/api/v1/usage', UsageSummaryV2Schema);
route('get', '/api/v1/usage/requests/{id}', requestLookup);
route('get', '/api/v1/usage/responses/{id}', requestLookup);
route('get', '/api/v1/providers', list(ProviderV2Schema));
route('get', '/api/v1/providers/{id}', ProviderV2Schema);
route('get', '/api/v1/providers/{id}/models', list(ModelV2Schema));
route('get', '/api/v1/me/provider-connections', list(ProviderConnectionV2Schema));
route('post', '/api/v1/me/provider-connections', ProviderConnectionV2Schema, providerConnectionCreate, 201);
route('delete', '/api/v1/me/provider-connections/{id}', z.object({ id: z.uuid(), status: z.literal('DISABLED') }));
route('post', '/api/v1/devices/{id}/revoke', z.object({ device: DeviceV2Schema }));
route('patch', '/api/v1/devices/{id}', z.object({ device: DeviceV2Schema }), z.object({ deviceName: z.string().trim().min(1).max(120) }));
route('get', '/api/v1/referral/code', referralCode);
route('post', '/api/v1/referral/apply', referralApply, z.object({ code: z.string().trim().min(8).max(24) }));
route('get', '/api/v1/referral/stats', ReferralSummaryV2Schema);
route('get', '/api/v1/referral', ReferralSummaryV2Schema);
route('get', '/api/v1/referral/history', list(ReferralRecordV2Schema));

const adminResponse = generic;
route('get', '/api/v1/admin/wallets', adminResponse);
route('get', '/api/v1/admin/users/{id}/finance', adminResponse);
route('post', '/api/v1/admin/users/{id}/wallet/adjust', adminResponse,
  z.object({ points: z.number().int(), reason: z.string().min(10).max(500), idempotencyKey: z.uuid() }));
route('get', '/api/v1/admin/rate-cards', adminResponse);
route('post', '/api/v1/admin/rate-cards', adminResponse,
  z.object({ providerId: z.uuid(), modelId: z.uuid(), billingPolicy: z.enum(['MANAGED_USAGE', 'BYOS_USAGE', 'LOCAL_USAGE']) }), 201);
route('post', '/api/v1/admin/rate-cards/{id}/versions', adminResponse, generic, 201);
route('post', '/api/v1/admin/rate-card-versions/{id}/publish', adminResponse);
route('get', '/api/v1/admin/referrals', adminResponse);
route('get', '/api/v1/admin/referral-policy', adminResponse);
route('put', '/api/v1/admin/referral-policy', adminResponse, generic);
route('post', '/api/v1/admin/referrals/{id}/review', adminResponse,
  z.object({ decision: z.enum(['APPROVE', 'REJECT']), reason: z.string() }));
route('get', '/api/v1/admin/cost-analytics', adminResponse);
route('post', '/v1/responses', responseV2, ResponseRequestSchema);

export function buildOpenApiV2(): Record<string, unknown> {
  const base = JSON.parse(readFileSync(new URL('../../../docs/protocol/openapi.v1.json', import.meta.url), 'utf8')) as Record<string, any>;
  const v2 = new OpenApiGeneratorV31(registry.definitions).generateDocument({ openapi: '3.1.0',
    info: { title: 'Copilot Bridge Cloud App and Gateway API', version: '2.4.0' },
    servers: [{ url: 'https://ai.mddxz.top' }] });
  return { ...base, info: v2.info, servers: v2.servers,
    paths: { ...base.paths, ...v2.paths },
    components: { ...base.components, ...v2.components, schemas: { ...base.components?.schemas, ...v2.components?.schemas },
      securitySchemes: { ...base.components?.securitySchemes, ...v2.components?.securitySchemes } } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeFileSync(resolve(process.cwd(), '../../docs/protocol/openapi.v2.json'), `${JSON.stringify(buildOpenApiV2(), null, 2)}\n`);
}
