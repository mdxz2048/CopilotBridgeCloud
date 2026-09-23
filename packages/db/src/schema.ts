import { pgTable, uuid, varchar, text, boolean, integer, numeric, timestamp, jsonb, uniqueIndex, index } from 'drizzle-orm/pg-core';

const id = () => uuid('id').primaryKey().defaultRandom();
const created = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const users = pgTable('users', {
  id: id(), email: varchar('email', { length: 320 }).notNull().unique(), passwordHash: text('password_hash').notNull(),
  role: varchar('role', { length: 16 }).notNull().default('USER'), status: varchar('status', { length: 16 }).notNull().default('ACTIVE'), createdAt: created(),
});
export const plans = pgTable('plans', {
  id: id(), code: varchar('code', { length: 32 }).notNull().unique(), name: text('name').notNull(), description: text('description').notNull().default(''),
  monthlyPrice: numeric('monthly_price', { precision: 12, scale: 2 }).notNull(), currency: varchar('currency', { length: 3 }).notNull().default('CNY'),
  maxDevices: integer('max_devices').notNull(), monthlyTokenLimit: integer('monthly_token_limit').notNull(), monthlyUsageCreditLimit: numeric('monthly_usage_credit_limit', { precision: 16, scale: 4 }).notNull(),
  maxConcurrentRequests: integer('max_concurrent_requests').notNull(), requestsPerMinute: integer('requests_per_minute').notNull(), enabled: boolean('enabled').notNull().default(true),
});
export const subscriptions = pgTable('subscriptions', {
  id: id(), userId: uuid('user_id').notNull().references(() => users.id), planId: uuid('plan_id').notNull().references(() => plans.id),
  status: varchar('status', { length: 16 }).notNull(), startedAt: timestamp('started_at', { withTimezone: true }).notNull(), currentPeriodStart: timestamp('current_period_start', { withTimezone: true }).notNull(),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }).notNull(), cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
  pendingPlanId: uuid('pending_plan_id').references(() => plans.id), createdAt: created(),
}, t => [index('subscriptions_user_idx').on(t.userId)]);
export const devices = pgTable('devices', {
  id: id(), userId: uuid('user_id').notNull().references(() => users.id), deviceId: uuid('device_id').notNull(), deviceName: text('device_name').notNull(), platform: text('platform').notNull(),
  osVersion: text('os_version').notNull().default(''), appVersion: text('app_version').notNull().default(''), status: varchar('status', { length: 16 }).notNull().default('ACTIVE'),
  activatedAt: created(), lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
}, t => [uniqueIndex('devices_user_device_idx').on(t.userId, t.deviceId)]);
export const refreshTokens = pgTable('refresh_tokens', {
  id: id(), userId: uuid('user_id').notNull().references(() => users.id), deviceId: uuid('device_id').notNull().references(() => devices.id), tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(), revokedAt: timestamp('revoked_at', { withTimezone: true }), createdAt: created(),
});
export const webSessions = pgTable('web_sessions', {
  id: id(), userId: uuid('user_id').notNull().references(() => users.id), tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(), revokedAt: timestamp('revoked_at', { withTimezone: true }), createdAt: created(),
});
export const providers = pgTable('providers', {
  id: id(), code: varchar('code', { length: 32 }).notNull().unique(), name: text('name').notNull(), enabled: boolean('enabled').notNull().default(false),
  baseUrl: text('base_url'), timeoutMs: integer('timeout_ms').notNull().default(60000), config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
});
export const providerCredentials = pgTable('provider_credentials', {
  id: id(), providerId: uuid('provider_id').notNull().references(() => providers.id).unique(), ciphertext: text('ciphertext').notNull(), iv: text('iv').notNull(), tag: text('tag').notNull(), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
export const models = pgTable('models', {
  id: id(), providerId: uuid('provider_id').notNull().references(() => providers.id), providerModelId: text('provider_model_id').notNull(), publicId: text('public_id').notNull().unique(), displayName: text('display_name').notNull(),
  enabled: boolean('enabled').notNull().default(false), supportsTools: boolean('supports_tools').notNull().default(false), supportsVision: boolean('supports_vision').notNull().default(false),
  supportsReasoning: boolean('supports_reasoning').notNull().default(false), supportsStreaming: boolean('supports_streaming').notNull().default(true), contextWindow: integer('context_window'), maxOutputTokens: integer('max_output_tokens'),
  usageWeight: numeric('usage_weight', { precision: 12, scale: 4 }).notNull().default('1'), sortOrder: integer('sort_order').notNull().default(0),
});
export const planModelAccess = pgTable('plan_model_access', {
  id: id(), planId: uuid('plan_id').notNull().references(() => plans.id), modelId: uuid('model_id').notNull().references(() => models.id),
}, t => [uniqueIndex('plan_model_unique').on(t.planId, t.modelId)]);
export const userModelAccess = pgTable('user_model_access', {
  id: id(), userId: uuid('user_id').notNull().references(() => users.id), modelId: uuid('model_id').notNull().references(() => models.id), access: varchar('access', { length: 8 }).notNull(),
}, t => [uniqueIndex('user_model_unique').on(t.userId, t.modelId)]);
export const modelSessions = pgTable('model_sessions', {
  id: id(), userId: uuid('user_id').notNull().references(() => users.id), deviceId: uuid('device_id').notNull().references(() => devices.id), clientThreadId: text('client_thread_id').notNull(),
  providerId: uuid('provider_id').notNull().references(() => providers.id), modelId: uuid('model_id').notNull().references(() => models.id), providerSessionId: text('provider_session_id'),
  state: jsonb('state').$type<Record<string, unknown>>().notNull().default({}), createdAt: created(), lastActiveAt: timestamp('last_active_at', { withTimezone: true }).notNull().defaultNow(), expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, t => [uniqueIndex('model_session_scope').on(t.userId, t.deviceId, t.clientThreadId)]);
export const usageRecords = pgTable('usage_records', {
  id: id(), userId: uuid('user_id').notNull().references(() => users.id), deviceId: uuid('device_id').notNull().references(() => devices.id), planId: uuid('plan_id').notNull().references(() => plans.id),
  providerId: uuid('provider_id').notNull().references(() => providers.id), modelId: uuid('model_id').notNull().references(() => models.id), status: varchar('status', { length: 16 }).notNull().default('RUNNING'),
  inputTokens: integer('input_tokens').notNull().default(0), outputTokens: integer('output_tokens').notNull().default(0), totalTokens: integer('total_tokens').notNull().default(0),
  usageCredit: numeric('usage_credit', { precision: 16, scale: 4 }).notNull().default('0'), providerCost: numeric('provider_cost', { precision: 16, scale: 6 }), costKind: varchar('cost_kind', { length: 16 }).notNull().default('UNKNOWN'),
  durationMs: integer('duration_ms'), errorCode: text('error_code'), createdAt: created(), completedAt: timestamp('completed_at', { withTimezone: true }),
}, t => [index('usage_user_date_idx').on(t.userId, t.createdAt)]);
export const billingOrders = pgTable('billing_orders', {
  id: id(), orderNo: text('order_no').notNull().unique(), userId: uuid('user_id').notNull().references(() => users.id), planId: uuid('plan_id').notNull().references(() => plans.id),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(), currency: varchar('currency', { length: 3 }).notNull(), provider: varchar('provider', { length: 16 }).notNull(), status: varchar('status', { length: 16 }).notNull().default('PENDING'),
  externalOrderId: text('external_order_id'), qrCodePayload: text('qr_code_payload'), expiresAt: timestamp('expires_at', { withTimezone: true }), paidAt: timestamp('paid_at', { withTimezone: true }), createdAt: created(),
});
export const paymentEvents = pgTable('payment_events', { id: id(), provider: text('provider').notNull(), eventId: text('event_id').notNull(), orderId: uuid('order_id').notNull().references(() => billingOrders.id), receivedAt: created() }, t => [uniqueIndex('payment_event_unique').on(t.provider, t.eventId)]);
export const releases = pgTable('releases', {
  id: id(), version: text('version').notNull(), channel: text('channel').notNull(), platform: text('platform').notNull(), arch: text('arch').notNull(), downloadUrl: text('download_url').notNull(), sha256: text('sha256').notNull(), releaseNotes: text('release_notes').notNull().default(''), published: boolean('published').notNull().default(false), createdAt: created(),
});
export const auditLogs = pgTable('audit_logs', { id: id(), actorId: uuid('actor_id').references(() => users.id), action: text('action').notNull(), targetType: text('target_type').notNull(), targetId: text('target_id').notNull(), metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}), createdAt: created() });
export const systemSettings = pgTable('system_settings', { key: text('key').primaryKey(), value: jsonb('value').$type<unknown>().notNull(), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow() });
