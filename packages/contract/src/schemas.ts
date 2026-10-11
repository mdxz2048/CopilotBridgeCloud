import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

export const DeviceInfoSchema = z.object({
  deviceId: z.uuid(), deviceName: z.string().min(1).max(120), platform: z.string().min(1).max(60),
  osVersion: z.string().max(120).default(''), appVersion: z.string().max(120).default(''),
});
export const LoginRequestSchema = z.object({ email: z.email(), password: z.string(), device: DeviceInfoSchema });
export const UserSchema = z.object({ id: z.uuid(), email: z.email(), role: z.enum(['USER', 'ADMIN']), status: z.enum(['ACTIVE', 'DISABLED', 'EXPIRED']) });
export const DeviceSchema = DeviceInfoSchema.extend({ id: z.uuid(), userId: z.uuid(), status: z.enum(['ACTIVE', 'REVOKED']), activatedAt: z.iso.datetime(), lastSeenAt: z.iso.datetime().nullable() });
export const LoginResponseSchema = z.object({ accessToken: z.string(), refreshToken: z.string(), expiresIn: z.literal(1800), user: UserSchema, device: DeviceSchema });
export const RefreshRequestSchema = z.object({ refreshToken: z.string().min(20) });
export const RefreshResponseSchema = z.object({ accessToken: z.string(), refreshToken: z.string(), expiresIn: z.literal(1800) });
export const ErrorCodeSchema = z.enum([
  'UNAUTHORIZED', 'TOKEN_EXPIRED', 'DEVICE_NOT_REGISTERED', 'DEVICE_REVOKED', 'DEVICE_LIMIT_REACHED', 'ACCOUNT_DISABLED',
  'SUBSCRIPTION_REQUIRED', 'SUBSCRIPTION_EXPIRED', 'MODEL_NOT_ALLOWED', 'MONTHLY_QUOTA_EXCEEDED', 'RATE_LIMITED',
  'PROVIDER_UNAVAILABLE', 'MODEL_UNAVAILABLE', 'GATEWAY_TIMEOUT', 'CLIENT_THREAD_ID_REQUIRED', 'VALIDATION_ERROR', 'INTERNAL_ERROR',
  'UNSUPPORTED_CAPABILITY','UNSUPPORTED_PROTOCOL','PROTOCOL_INVALID','PROVIDER_RATE_LIMITED','PROVIDER_BALANCE_EXHAUSTED','PROVIDER_AUTH_REQUIRED','PROVIDER_USAGE_UNAVAILABLE','CONVERSATION_NOT_FOUND','CONVERSATION_MODE_CHANGED',
]);
export const ErrorResponseSchema = z.object({ error: z.object({ code: ErrorCodeSchema, message: z.string(), requestId: z.string() }) });
export const PlanSchema = z.object({ id: z.uuid(), code: z.enum(['STANDARD', 'PRO']), name: z.string(), description: z.string(), monthlyPrice: z.string(), currency: z.string(), maxDevices: z.number().int(), monthlyTokenLimit: z.number().int(), monthlyUsageCreditLimit: z.string(), maxConcurrentRequests: z.number().int(), requestsPerMinute: z.number().int(), enabled: z.boolean() });
export const SubscriptionSchema = z.object({ id: z.uuid(), userId: z.uuid(), planId: z.uuid(), status: z.enum(['TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED', 'SUSPENDED']), startedAt: z.iso.datetime(), currentPeriodStart: z.iso.datetime(), currentPeriodEnd: z.iso.datetime(), cancelAtPeriodEnd: z.boolean(), pendingPlanId: z.uuid().nullable() });
export const UsageSchema = z.object({ tokens: z.number(), credit: z.number(), requests: z.number(), tokenLimit: z.number(), creditLimit: z.number(), percent: z.number(), threshold: z.union([z.literal(0), z.literal(70), z.literal(90), z.literal(100)]) });
export const AccountSchema = z.object({ user: UserSchema, subscription: SubscriptionSchema.nullable(), plan: PlanSchema.nullable(), devices: z.array(DeviceSchema), usage: UsageSchema.nullable() });
export const ModelSchema = z.object({ id: z.string(), object: z.literal('model'), owned_by: z.string(), capabilities: z.object({ tools: z.boolean(), vision: z.boolean(), reasoning: z.boolean(), streaming: z.boolean(), nativeResponses: z.boolean().optional(), reasoningModes: z.array(z.enum(['normal','thinking','auto'])).optional(), defaultReasoningMode: z.enum(['normal','thinking','auto']).optional() }) });
export const ModelListSchema = z.object({ object: z.literal('list'), data: z.array(ModelSchema) });
export const ReleaseSchema = z.object({
  id: z.uuid(), version: z.string(), channel: z.string(), platform: z.string(), arch: z.string(),
  downloadUrl: z.string(), sha256: z.string(), releaseNotes: z.string(), published: z.boolean(), createdAt: z.iso.datetime(),
});
export const LatestReleaseResponseSchema = z.object({ release: ReleaseSchema.nullable() });
export const FunctionToolSchema = z.object({ type: z.literal('function').optional(), name: z.string(), description: z.string().optional(), parameters: z.record(z.string(), z.unknown()).optional() }).passthrough();
export const InputItemSchema = z.union([
  z.object({ role: z.enum(['system', 'developer', 'user', 'assistant']), content: z.union([z.string(), z.array(z.unknown())]) }).passthrough(),
  z.object({ type: z.literal('function_call'), call_id: z.string(), name: z.string(), arguments: z.string() }).passthrough(),
  z.object({ type: z.literal('function_call_output'), call_id: z.string().min(1), output: z.union([z.string(),z.array(z.unknown())]) }).passthrough(),
  z.object({ type:z.literal('custom_tool_call'), call_id:z.string().min(1),name:z.string().min(1),input:z.string() }).passthrough(),
  z.object({ type:z.literal('custom_tool_call_output'), call_id:z.string().min(1),output:z.union([z.string(),z.array(z.unknown())]) }).passthrough(),
  z.object({ type: z.string().refine(type=>!['message','function_call','function_call_output','custom_tool_call','custom_tool_call_output'].includes(type)) }).passthrough(),
]);
export const ResponseRequestSchema = z.object({
  model: z.string().min(1), input: z.union([z.string(), z.array(InputItemSchema)]).default([]), stream: z.boolean().default(false),
  tools: z.array(z.record(z.string(), z.unknown())).optional(), reasoning: z.record(z.string(), z.unknown()).optional(),
  instructions: z.string().nullable().optional(), tool_choice: z.unknown().optional(), parallel_tool_calls: z.boolean().optional(),
  text: z.record(z.string(), z.unknown()).optional(), previous_response_id: z.string().nullable().optional(),
  max_output_tokens: z.number().int().positive().optional(), include: z.array(z.string()).optional(), metadata: z.record(z.string(), z.unknown()).optional(),
}).passthrough();
export const OutputItemSchema = z.union([
  z.object({ type: z.literal('message'), role: z.literal('assistant'), content: z.array(z.object({ type: z.literal('output_text'), text: z.string() }).passthrough()) }).passthrough(),
  z.object({ type: z.literal('function_call'), call_id: z.string(), name: z.string(), arguments: z.string() }).passthrough(),
  z.object({ type:z.string().refine(type=>!['message','function_call'].includes(type)) }).passthrough(),
]);
export const ResponseSchema = z.object({ id: z.string(), object: z.literal('response'), status: z.enum(['completed','incomplete','failed']), model: z.string(), output: z.array(OutputItemSchema), usage: z.object({ input_tokens: z.number().int(), output_tokens: z.number().int(), total_tokens: z.number().int() }).passthrough() }).passthrough();
export const ClientConfigSchema = z.object({ minimumVersion: z.string(), latestVersion: z.string(), maintenance: z.boolean(), features: z.object({ cloudGateway: z.boolean() }) });

export type ResponseRequest = z.infer<typeof ResponseRequestSchema>;
// Additive V2 product shapes; Gateway V1 schemas and generated OpenAPI remain frozen.
export * from './v2-schemas.js';
