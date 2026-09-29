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
  monthlyPoints: integer('monthly_points').notNull().default(0), rolloverPolicy: varchar('rollover_policy', { length: 16 }).notNull().default('NONE'),
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
  authVersion: integer('auth_version').notNull().default(0),
  activatedAt: created(), lastSeenAt: timestamp('last_seen_at', { withTimezone: true }), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
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

// V2 is additive. usage_records remains the V1 quota/legacy history source.
export const wallets = pgTable('wallets', {
  id: id(), userId: uuid('user_id').notNull().references(() => users.id).unique(),
  balance: integer('balance').notNull().default(0), createdAt: created(), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
export const walletTransactions = pgTable('wallet_transactions', {
  id: id(), walletId: uuid('wallet_id').notNull().references(() => wallets.id),
  type: varchar('type', { length: 32 }).notNull(), points: integer('points').notNull(), balanceAfter: integer('balance_after').notNull(),
  referenceType: varchar('reference_type', { length: 32 }).notNull(), referenceId: text('reference_id').notNull(),
  idempotencyKey: text('idempotency_key').notNull().unique(), metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}), createdAt: created(),
}, t => [index('wallet_transactions_wallet_date_idx').on(t.walletId, t.createdAt)]);
export const walletLots = pgTable('wallet_lots', {
  id: id(), walletId: uuid('wallet_id').notNull().references(() => wallets.id), sourceTransactionId: uuid('source_transaction_id').notNull().references(() => walletTransactions.id).unique(),
  grantedPoints: integer('granted_points').notNull(), remainingPoints: integer('remaining_points').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }), createdAt: created(),
}, t => [index('wallet_lots_expiry_idx').on(t.walletId, t.expiresAt)]);
export const walletLotSpends = pgTable('wallet_lot_spends', {
  id: id(), lotId: uuid('lot_id').notNull().references(() => walletLots.id), transactionId: uuid('transaction_id').notNull().references(() => walletTransactions.id),
  points: integer('points').notNull(), createdAt: created(),
}, t => [uniqueIndex('wallet_lot_spend_unique').on(t.lotId, t.transactionId)]);
export const rateCards = pgTable('rate_cards', {
  id: id(), providerId: uuid('provider_id').notNull().references(() => providers.id), modelId: uuid('model_id').notNull().references(() => models.id),
  billingPolicy: varchar('billing_policy', { length: 24 }).notNull(), createdAt: created(),
}, t => [uniqueIndex('rate_cards_provider_model_policy_idx').on(t.providerId, t.modelId, t.billingPolicy)]);
export const rateCardVersions = pgTable('rate_card_versions', {
  id: id(), rateCardId: uuid('rate_card_id').notNull().references(() => rateCards.id), version: integer('version').notNull(), status: varchar('status', { length: 16 }).notNull().default('DRAFT'),
  inputRate: numeric('input_rate', { precision: 20, scale: 6 }).notNull().default('0'), outputRate: numeric('output_rate', { precision: 20, scale: 6 }).notNull().default('0'),
  cachedInputRate: numeric('cached_input_rate', { precision: 20, scale: 6 }).notNull().default('0'), reasoningRate: numeric('reasoning_rate', { precision: 20, scale: 6 }).notNull().default('0'),
  imageInputRate: numeric('image_input_rate', { precision: 20, scale: 6 }).notNull().default('0'), imageOutputRate: numeric('image_output_rate', { precision: 20, scale: 6 }).notNull().default('0'),
  toolRate: numeric('tool_rate', { precision: 20, scale: 6 }).notNull().default('0'), minimumCharge: integer('minimum_charge').notNull().default(0),
  effectiveFrom: timestamp('effective_from', { withTimezone: true }), effectiveTo: timestamp('effective_to', { withTimezone: true }),
  createdBy: uuid('created_by').references(() => users.id), createdAt: created(),
}, t => [uniqueIndex('rate_card_versions_number_idx').on(t.rateCardId, t.version)]);
export const providerAccounts = pgTable('provider_accounts', {
  id: id(), providerId: uuid('provider_id').notNull().references(() => providers.id), userId: uuid('user_id').references(() => users.id),
  ownership: varchar('ownership', { length: 16 }).notNull(), status: varchar('status', { length: 16 }).notNull().default('DISABLED'),
  label: text('label').notNull().default(''), config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}), createdAt: created(), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('provider_accounts_user_idx').on(t.userId)]);
export const providerAccountCredentials = pgTable('provider_account_credentials', {
  id: id(), accountId: uuid('account_id').notNull().references(() => providerAccounts.id).unique(), ciphertext: text('ciphertext').notNull(),
  iv: text('iv').notNull(), tag: text('tag').notNull(), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
export const aiRequests = pgTable('ai_requests', {
  id: id(), responseId: text('response_id').notNull().unique(), userId: uuid('user_id').notNull().references(() => users.id), deviceId: uuid('device_id').notNull().references(() => devices.id),
  providerId: uuid('provider_id').notNull().references(() => providers.id), modelId: uuid('model_id').notNull().references(() => models.id),
  providerAccountId: uuid('provider_account_id').references(() => providerAccounts.id), rateCardVersionId: uuid('rate_card_version_id').references(() => rateCardVersions.id), billingPolicy: varchar('billing_policy', { length: 24 }).notNull(),
  status: varchar('status', { length: 24 }).notNull().default('CREATED'), errorCode: text('error_code'), legacyUsageRecordId: uuid('legacy_usage_record_id').references(() => usageRecords.id),
  startedAt: timestamp('started_at', { withTimezone: true }), completedAt: timestamp('completed_at', { withTimezone: true }), createdAt: created(),
}, t => [index('ai_requests_user_date_idx').on(t.userId, t.createdAt)]);
export const usageEvents = pgTable('usage_events', {
  id: id(), requestId: uuid('request_id').notNull().references(() => aiRequests.id), eventKey: text('event_key').notNull().unique(),
  userId: uuid('user_id').notNull().references(() => users.id), deviceId: uuid('device_id').notNull().references(() => devices.id),
  providerId: uuid('provider_id').notNull().references(() => providers.id), modelId: uuid('model_id').notNull().references(() => models.id),
  inputTokens: integer('input_tokens').notNull().default(0), outputTokens: integer('output_tokens').notNull().default(0), cachedInputTokens: integer('cached_input_tokens').notNull().default(0), reasoningTokens: integer('reasoning_tokens').notNull().default(0),
  imageInput: integer('image_input').notNull().default(0), imageOutput: integer('image_output').notNull().default(0), toolCalls: integer('tool_calls').notNull().default(0),
  providerReportedUsage: jsonb('provider_reported_usage').$type<Record<string, unknown>>(), providerCost: numeric('provider_cost', { precision: 20, scale: 8 }),
  providerCurrency: varchar('provider_currency', { length: 3 }), rateCardVersionId: uuid('rate_card_version_id').references(() => rateCardVersions.id),
  pointsRated: integer('points_rated').notNull().default(0), pointsCharged: integer('points_charged').notNull().default(0), billingStatus: varchar('billing_status', { length: 16 }).notNull().default('SETTLED'), billingPolicy: varchar('billing_policy', { length: 24 }).notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(), completedAt: timestamp('completed_at', { withTimezone: true }).notNull(), createdAt: created(),
}, t => [index('usage_events_user_date_idx').on(t.userId, t.createdAt), uniqueIndex('usage_events_request_idx').on(t.requestId)]);
export const deviceSessions = pgTable('device_sessions', {
  id: id(), userId: uuid('user_id').notNull().references(() => users.id), deviceId: uuid('device_id').notNull().references(() => devices.id),
  firstSeenAt: created(), lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(), lastIpHash: text('last_ip_hash'), requestCount: integer('request_count').notNull().default(0),
}, t => [uniqueIndex('device_sessions_device_idx').on(t.deviceId)]);
export const referralCodes = pgTable('referral_codes', {
  id: id(), userId: uuid('user_id').notNull().references(() => users.id).unique(), code: varchar('code', { length: 24 }).notNull().unique(), status: varchar('status', { length: 16 }).notNull().default('ACTIVE'), createdAt: created(),
});
export const referrals = pgTable('referrals', {
  id: id(), referrerUserId: uuid('referrer_user_id').notNull().references(() => users.id), referredUserId: uuid('referred_user_id').notNull().references(() => users.id).unique(),
  referralCodeId: uuid('referral_code_id').notNull().references(() => referralCodes.id), sourceDeviceId: uuid('source_device_id').references(() => devices.id),
  status: varchar('status', { length: 16 }).notNull().default('REGISTERED'), riskFlags: jsonb('risk_flags').$type<string[]>().notNull().default([]),
  registrationIpHash: text('registration_ip_hash'), paymentIdentityHash: text('payment_identity_hash'),
  registeredAt: created(), qualifiedAt: timestamp('qualified_at', { withTimezone: true }),
}, t => [index('referrals_referrer_date_idx').on(t.referrerUserId, t.registeredAt)]);
export const referralRewards = pgTable('referral_rewards', {
  id: id(), referralId: uuid('referral_id').notNull().references(() => referrals.id), beneficiaryUserId: uuid('beneficiary_user_id').notNull().references(() => users.id),
  points: integer('points').notNull(), walletTransactionId: uuid('wallet_transaction_id').notNull().references(() => walletTransactions.id), createdAt: created(),
}, t => [uniqueIndex('referral_rewards_beneficiary_idx').on(t.referralId, t.beneficiaryUserId)]);
