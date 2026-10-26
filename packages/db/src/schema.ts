import { sql } from 'drizzle-orm';
import { bigint, pgTable, uuid, varchar, text, boolean, integer, numeric, timestamp, jsonb, uniqueIndex, index } from 'drizzle-orm/pg-core';

const id = () => uuid('id').primaryKey().defaultRandom();
const created = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const users = pgTable('users', {
  id: id(), email: varchar('email', { length: 320 }).notNull().unique(), passwordHash: text('password_hash').notNull(),
  role: varchar('role', { length: 16 }).notNull().default('USER'), status: varchar('status', { length: 16 }).notNull().default('ACTIVE'), createdAt: created(),
});
export const registrationChallenges = pgTable('registration_challenges', {
  id: id(), emailHash: varchar('email_hash', { length: 64 }).notNull(),
  ipHash: varchar('ip_hash', { length: 64 }).notNull(), codeHash: varchar('code_hash', { length: 64 }),
  state: varchar('state', { length: 16 }).notNull().default('PENDING'),
  attempts: integer('attempts').notNull().default(0),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: created(), sentAt: timestamp('sent_at', { withTimezone: true }),
}, t => [index('registration_challenges_email_idx').on(t.emailHash, t.createdAt),
  index('registration_challenges_ip_idx').on(t.ipHash, t.createdAt),
  index('registration_challenges_created_idx').on(t.createdAt)]);
export const passwordResets = pgTable('password_resets', {
  id: id(), userId: uuid('user_id').references(() => users.id), emailHash: text('email_hash').notNull(), ipHash: text('ip_hash').notNull(),
  tokenHash: text('token_hash').notNull().unique(), passwordSnapshot: text('password_snapshot'), state: varchar('state',{length:16}).notNull(),
  expiresAt: timestamp('expires_at',{withTimezone:true}).notNull(), createdAt: created(),
}, t=>[index('password_resets_email_idx').on(t.emailHash,t.createdAt),index('password_resets_ip_idx').on(t.ipHash,t.createdAt)]);
export const plans = pgTable('plans', {
  id: id(), code: varchar('code', { length: 32 }).notNull().unique(), name: text('name').notNull(), description: text('description').notNull().default(''),
  monthlyPrice: numeric('monthly_price', { precision: 12, scale: 2 }).notNull(), currency: varchar('currency', { length: 3 }).notNull().default('CNY'),
  maxDevices: integer('max_devices').notNull(), monthlyTokenLimit: integer('monthly_token_limit').notNull(), monthlyUsageCreditLimit: numeric('monthly_usage_credit_limit', { precision: 16, scale: 4 }).notNull(),
  maxConcurrentRequests: integer('max_concurrent_requests').notNull(), requestsPerMinute: integer('requests_per_minute').notNull(), enabled: boolean('enabled').notNull().default(true),
  monthlyPoints: integer('monthly_points').notNull().default(0), rolloverPolicy: varchar('rollover_policy', { length: 16 }).notNull().default('NONE'),
});
export const failureDiagnostics = pgTable('failure_diagnostics', {
  id:uuid('id').primaryKey(),userId:uuid('user_id').notNull().references(()=>users.id,{onDelete:'cascade'}),
  deviceId:uuid('device_id').notNull().references(()=>devices.id,{onDelete:'cascade'}),
  userEmail:text('user_email').notNull(),appVersion:varchar('app_version',{length:64}).notNull(),
  traceId:uuid('trace_id').notNull(),stage:varchar('stage',{length:32}).notNull(),errorCode:varchar('error_code',{length:100}).notNull(),
  occurredAt:timestamp('occurred_at',{withTimezone:true}).notNull(),createdAt:created(),
  payload:jsonb('payload').$type<{ciphertext:string;iv:string;tag:string}>().notNull(),payloadBytes:integer('payload_bytes').notNull(),
},t=>[index('failure_diagnostics_user_created_idx').on(t.userId,t.createdAt),index('failure_diagnostics_created_idx').on(t.createdAt)]);
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
  publicKeyJwk: jsonb('public_key_jwk').$type<{ kty: 'EC'; crv: 'P-256'; x: string; y: string }>(),
  activatedAt: created(), lastSeenAt: timestamp('last_seen_at', { withTimezone: true }), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex('devices_user_device_idx').on(t.userId, t.deviceId)]);
export const deviceProofs = pgTable('device_proofs', {
  id: id(), deviceId: uuid('device_id').notNull().references(() => devices.id), jti: uuid('jti').notNull().unique(),
  createdAt: created(),
}, t => [index('device_proofs_created_idx').on(t.createdAt)]);
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
// Connection credentials remain on providers; this table only binds resources to logical models.
export const modelInstances = pgTable('model_instances', {
  id: id(), modelId: uuid('model_id').notNull().references(() => models.id),
  providerId: uuid('provider_id').notNull().references(() => providers.id), providerModelId: text('provider_model_id').notNull(),
  enabled: boolean('enabled').notNull().default(false), priority: integer('priority').notNull().default(0), weight: integer('weight').notNull().default(1),
  nativeProtocols: jsonb('native_protocols').$type<string[]>().notNull().default(['chat_completions']),
  capabilities: jsonb('capabilities').$type<Record<string, unknown>>().notNull().default({}),
  healthStatus: varchar('health_status', { length: 16 }).notNull().default('UNKNOWN'),
  healthCheckedAt: timestamp('health_checked_at', { withTimezone: true }), cooldownUntil: timestamp('cooldown_until', { withTimezone: true }),
  createdAt: created(),
}, t => [uniqueIndex('model_instances_binding_unique').on(t.modelId, t.providerId, t.providerModelId), index('model_instances_model_idx').on(t.modelId)]);
export const planModelAccess = pgTable('plan_model_access', {
  id: id(), planId: uuid('plan_id').notNull().references(() => plans.id), modelId: uuid('model_id').notNull().references(() => models.id),
}, t => [uniqueIndex('plan_model_unique').on(t.planId, t.modelId)]);
export const userModelAccess = pgTable('user_model_access', {
  id: id(), userId: uuid('user_id').notNull().references(() => users.id), modelId: uuid('model_id').notNull().references(() => models.id), access: varchar('access', { length: 8 }).notNull(),
}, t => [uniqueIndex('user_model_unique').on(t.userId, t.modelId)]);
export const modelSessions = pgTable('model_sessions', {
  id: id(), userId: uuid('user_id').notNull().references(() => users.id), deviceId: uuid('device_id').notNull().references(() => devices.id), clientThreadId: text('client_thread_id').notNull(),
  providerId: uuid('provider_id').notNull().references(() => providers.id), modelId: uuid('model_id').notNull().references(() => models.id), providerSessionId: text('provider_session_id'),
  instanceId: uuid('instance_id').references(() => modelInstances.id),
  state: jsonb('state').$type<Record<string, unknown>>().notNull().default({}), createdAt: created(), lastActiveAt: timestamp('last_active_at', { withTimezone: true }).notNull().defaultNow(), expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, t => [uniqueIndex('model_session_scope').on(t.userId, t.deviceId, t.clientThreadId)]);
export const usageRecords = pgTable('usage_records', {
  id: id(), userId: uuid('user_id').notNull().references(() => users.id), deviceId: uuid('device_id').notNull().references(() => devices.id), planId: uuid('plan_id').notNull().references(() => plans.id),
  providerId: uuid('provider_id').notNull().references(() => providers.id), modelId: uuid('model_id').notNull().references(() => models.id), status: varchar('status', { length: 16 }).notNull().default('RUNNING'),
  rateCounted: boolean('rate_counted').notNull().default(true),
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
export const auditLogs = pgTable('audit_logs', { id: id(), actorId: uuid('actor_id').references(() => users.id), action: text('action').notNull(), targetType: text('target_type').notNull(), targetId: text('target_id').notNull(), metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}), createdAt: created() }, t => [index('audit_logs_action_created_idx').on(t.action,t.createdAt)]);

export const siteDownloadStats = pgTable('site_download_stats', {
  id: id(), day: varchar('day', {length:10}).notNull(), version: text('version').notNull(),
  platform: text('platform').notNull(), arch: text('arch').notNull(), downloads: integer('downloads').notNull().default(0),
}, t => [uniqueIndex('site_download_stats_scope_idx').on(t.day,t.version,t.platform,t.arch)]);
export const systemSettings = pgTable('system_settings', { key: text('key').primaryKey(), value: jsonb('value').$type<unknown>().notNull(), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow() });
export const publicRateHits = pgTable('public_rate_hits', {
  id: id(), ipHash: text('ip_hash').notNull(), createdAt: created(),
}, t => [index('public_rate_hits_ip_time_idx').on(t.ipHash, t.createdAt), index('public_rate_hits_created_idx').on(t.createdAt)]);
export const sitePageViews = pgTable('site_page_views', {
  id: id(),
  day: varchar('day', { length: 10 }).notNull(),
  page: varchar('page', { length: 16 }).notNull(),
  views: integer('views').notNull().default(0),
}, t => [uniqueIndex('site_page_views_day_page_idx').on(t.day, t.page)]);

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
}, t => [index('wallet_transactions_wallet_date_idx').on(t.walletId, t.createdAt), index('wallet_transactions_account_date_idx').on(t.walletId, t.createdAt).where(sql`${t.type} <> 'USAGE'`)]);
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
  instanceId: uuid('instance_id').references(() => modelInstances.id), protocolMode: varchar('protocol_mode', { length: 16 }),
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


// A single counter per device; no periodic scans of individual usage events.
export const deviceBillingStates = pgTable('device_billing_states', {
  deviceId: uuid('device_id').primaryKey().references(() => devices.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  chargedPoints: bigint('charged_points', { mode: 'number' }).notNull().default(0),
  settledPoints: bigint('settled_points', { mode: 'number' }).notNull().default(0),
  startedAt: timestamp('started_at', { withTimezone: true }), startEventId: uuid('start_event_id'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('device_billing_states_user_idx').on(t.userId)]);

export const deviceBillingPeriods = pgTable('device_billing_periods', {
  id: id(), userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  deviceId: uuid('device_id').notNull().references(() => devices.id, { onDelete: 'cascade' }),
  deviceName: text('device_name').notNull(), bindingId: uuid('binding_id').notNull(),
  kind: varchar('kind', { length: 16 }).notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  endedAt: timestamp('ended_at', { withTimezone: true }).notNull(),
  chargedPoints: bigint('charged_points', { mode: 'number' }).notNull(),
  startEventId: uuid('start_event_id'), endEventId: uuid('end_event_id').unique(),
}, t => [index('device_billing_periods_user_date_idx').on(t.userId, t.endedAt)]);


export const purchaseClaims = pgTable('purchase_claims', {
 id:id(), userId:uuid('user_id').notNull().references(()=>users.id,{onDelete:'cascade'}),
 orderNo:varchar('order_no',{length:64}).notNull().unique(),status:varchar('status',{length:16}).notNull().default('PENDING'),
 points:integer('points'),reason:text('reason'),reviewedBy:uuid('reviewed_by').references(()=>users.id),reviewedAt:timestamp('reviewed_at',{withTimezone:true}),
 attempt:integer('attempt').notNull().default(1),createdAt:created(),submittedAt:timestamp('submitted_at',{withTimezone:true}).notNull().defaultNow(),
 noticeAcknowledgedAttempt:integer('notice_acknowledged_attempt').notNull().default(0),
 deadlineAt:timestamp('deadline_at',{withTimezone:true}).notNull(),updatedAt:timestamp('updated_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[index('purchase_claims_user_created_idx').on(t.userId,t.createdAt),index('purchase_claims_status_deadline_idx').on(t.status,t.deadlineAt)]);
export const purchaseReviews=pgTable('purchase_reviews',{
 id:id(),claimId:uuid('claim_id').notNull().references(()=>purchaseClaims.id,{onDelete:'cascade'}),actorId:uuid('actor_id').notNull().references(()=>users.id),
 status:varchar('status',{length:16}).notNull(),points:integer('points'),reason:text('reason'),createdAt:created(),
},t=>[index('purchase_reviews_claim_idx').on(t.claimId,t.createdAt)]);
export const purchaseMailOutbox=pgTable('purchase_mail_outbox',{
 id:id(),claimId:uuid('claim_id').notNull().references(()=>purchaseClaims.id,{onDelete:'cascade'}),attempt:integer('attempt').notNull(),
 kind:varchar('kind',{length:32}).notNull(),recipient:text('recipient').notNull(),subject:text('subject').notNull(),body:text('body').notNull(),
 status:varchar('status',{length:16}).notNull().default('PENDING'),deliveryAttempts:integer('delivery_attempts').notNull().default(0),
 nextAttemptAt:timestamp('next_attempt_at',{withTimezone:true}).notNull().defaultNow(),leaseToken:uuid('lease_token'),lockedUntil:timestamp('locked_until',{withTimezone:true}),
 sentAt:timestamp('sent_at',{withTimezone:true}),lastError:varchar('last_error',{length:100}),createdAt:created(),
},t=>[uniqueIndex('purchase_mail_event_idx').on(t.claimId,t.attempt,t.kind),index('purchase_mail_due_idx').on(t.status,t.nextAttemptAt)]);
export const purchaseTickets=pgTable('purchase_tickets',{
 id:id(),userId:uuid('user_id').notNull().references(()=>users.id,{onDelete:'cascade'}),deviceId:uuid('device_id').references(()=>devices.id,{onDelete:'cascade'}),
 deviceVersion:integer('device_version'),webSessionId:uuid('web_session_id').references(()=>webSessions.id,{onDelete:'cascade'}),
 tokenHash:text('token_hash').notNull().unique(),mobileHash:text('mobile_hash').unique(),expiresAt:timestamp('expires_at',{withTimezone:true}).notNull(),
 revokedAt:timestamp('revoked_at',{withTimezone:true}),claimId:uuid('claim_id').references(()=>purchaseClaims.id,{onDelete:'set null'}),createdAt:created(),
},t=>[index('purchase_tickets_user_source_idx').on(t.userId,t.deviceId,t.webSessionId),index('purchase_tickets_expiry_idx').on(t.expiresAt)]);

export const rewardNotices=pgTable('reward_notices',{
 id:id(),userId:uuid('user_id').notNull().references(()=>users.id,{onDelete:'cascade'}),walletTransactionId:uuid('wallet_transaction_id').notNull().references(()=>walletTransactions.id).unique(),points:integer('points').notNull(),expiresAt:timestamp('expires_at',{withTimezone:true}).notNull(),createdAt:created(),acknowledgedAt:timestamp('acknowledged_at',{withTimezone:true}),
},t=>[index('reward_notices_user_ack_idx').on(t.userId,t.acknowledgedAt)]);
