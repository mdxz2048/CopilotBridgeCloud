# Copilot Bridge V2 Domain API contract

**Contract version: `2.9.0` — native Responses platform candidate; live GPT A/B pending.** Base URL: `https://ai.mddxz.top`. Domain OpenAPI [openapi.v2.json](protocol/openapi.v2.json) and Gateway [revision 1.2](protocol/NATIVE_RESPONSES_POLICY_0_3_3.md) are generated from shared schemas and pinned in [CONTRACT_VERSION.json](protocol/CONTRACT_VERSION.json). The old Gateway 1.0 artifact remains historical. AI routes remain `/v1/models` and `/v1/responses`; device-bound auth remains unchanged. Managed DeepSeek RMB billing can enforce charges irrespective of historical SHADOW-only documentation. Current release status is in [the production manifest](protocol/PRODUCTION_INTEGRATION_MANIFEST.md).

Desktop authenticated routes require the bearer token **and** a signed `DPoP` compact ES256 JWT bound to the enrolled installation JWK; refresh requires DPoP bound to the refresh token. Browser routes also accept the same-site HttpOnly session without DPoP. Desktop AI requests still require `X-Device-Id` and `X-Client-Thread-Id`. See [V2.3 device-proof rules and vectors](protocol/GATEWAY_DEVICE_PROOF_V2_3.md). JSON times are RFC 3339 UTC. Amounts named `points` are nonnegative integer AI points; transaction `points` is signed. Token counters are provider usage, never points. `null` means unknown or not yet settled, not zero.

## Stable shapes

```ts
type AccountSummary = { id: string; email: string; status: 'ACTIVE'|'DISABLED'|'EXPIRED' };
type SubscriptionSummary = { id: string; status: string; planCode: string; periodStart: string; periodEnd: string; monthlyPoints: number; maxDevices: number; rolloverPolicy: 'NONE'|'UNLIMITED' } | null;
type WalletSummary = { balance: number; regularBalance?: number; rewardBalance?: number; unit: 'AI_POINT' };
type Device = { id: string; userId: string; deviceId: string; deviceName: string; platform: string; osVersion: string; appVersion: string; status: 'ACTIVE'|'REVOKED'|'BLOCKED'; activatedAt: string; lastSeenAt: string|null; updatedAt: string };
type DeviceCredential = { accessToken: string; refreshToken: string; expiresIn: 1800; user: { id: string; email: string; role: 'USER'|'ADMIN'; status: AccountSummary['status'] }; device: Device };
type Provider = { id: string; code: string; name: string; ownership: 'MANAGED'; status: 'ACTIVE'|'DISABLED' };
type ProviderConnection = { id: string; providerId: string; ownership: 'BYOS'; status: 'ACTIVE'|'DISABLED'; label: string; createdAt?: string; updatedAt?: string };
type Model = { id: string; publicId: string; displayName: string; capabilities: { tools: boolean; vision: boolean; reasoning: boolean; streaming: boolean } };
type ReferralSummary = { code: string; registered: number; rewarded: number; pointsEarned: number };
type ReferralRecord = { id: string; status: 'REGISTERED'|'PENDING'|'QUALIFIED'|'REWARDED'|'REJECTED'; registeredAt: string; qualifiedAt: string|null };
type UsageSummary = { requests: number; pointsRated: number; pointsCharged: number; legacy: unknown|null };
type UsageRecord = { inputTokens: number; outputTokens: number; cachedInputTokens: number; reasoningTokens: number; pointsRated: number; pointsCharged: number; billingStatus: 'SETTLED'|'SHADOW'|'UNPAID'|'NO_USAGE'|'METERING_ERROR'|'UNRATED'; rateCardVersionId: string|null };
type ErrorResponse = { error: { code: string; message: string; request_id: string; requestId: string } };
```

`requestId` remains as the V1 compatibility alias and equals `request_id`. `legacy` is the existing `/api/v1/usage/current` shape; App clients must not interpret its `credit` as AI points. `DeviceCredential` is returned only by device login and contains secrets; never log it. Browser login sets an HttpOnly cookie instead. The refresh endpoint returns only its three token fields. `ProviderConnection` never exposes an API key or ciphertext. `UsageRecord` is nullable until a final event exists. V2 objects can gain fields, but names and meanings listed above require version review before change.

## Auth and device credentials

| Method and path | Request | Response | State/error |
| --- | --- | --- | --- |
| `POST /api/v1/auth/register` | `{email,password,referralCode?}`; password length 12–256 | `201 {user:{id,email,role,status}}` | `EMAIL_IN_USE`, `INVALID_REFERRAL_CODE`, `VALIDATION_ERROR` |
| `POST /api/v1/auth/login` | `{email,password,device:{deviceId,deviceName,platform,osVersion?,appVersion?,publicKeyJwk:{kty:"EC",crv:"P-256",x,y}}}`; V2.3 initial password login does not require DPoP | `DeviceCredential` | `INVALID_CREDENTIALS`, `DEVICE_LIMIT_REACHED`, `DEVICE_REVOKED`, `SUBSCRIPTION_EXPIRED` |
| `POST /api/v1/auth/refresh` | `{refreshToken}` plus `DPoP` bound to refresh token and exact request body bytes | `{accessToken,refreshToken,expiresIn:1800}` | `UNAUTHORIZED`, `DEVICE_REVOKED`, `DEVICE_PROOF_INVALID`, `DEVICE_PROOF_REPLAYED` |
| `POST /api/v1/auth/logout` | Authenticated | `{ok:true}` | `UNAUTHORIZED` |

### Pending V2.4 web registration and login gate

Safe default: `STAGED_EMAIL_REGISTRATION_ENABLED=false` preserves the existing registration/login payloads and login behavior; `/api/v1/auth/email-code` returns 404. To enable, configure `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `TURNSTILE_EXPECTED_HOSTNAME` (equal to `PUBLIC_BASE_URL` hostname), `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM`; missing settings fail API startup. SMTP uses implicit TLS on ports 465/2465 or mandatory STARTTLS otherwise. Do not enable before applying migration `0008_dear_sebastian_shaw.sql` and integrating the new web flow. Never embed private SMTP/Turnstile secrets in the web client.

The administrator-only `GET /api/v1/admin/website-settings` returns the effective public Turnstile site key/hostname, SMTP host/port/user/from, registration-mail template and `verificationRequired`; private keys are represented only by `secretConfigured` and `passwordConfigured` booleans. `PUT` accepts `{turnstile:{siteKey,expectedHostname,secretKey?},email:{smtpHost,smtpPort,smtpUser,from,password?},template:{subject,body}}`. Omit unchanged secret fields (the UI leaves blank inputs out of the request); supplied credentials are AES-GCM encrypted using the server's provider master key in `system_settings`. Body is plain text and must include `{{code}}`; only new registration emails use the editable template. Both routes require ADMIN and same-origin CSRF protection on cookie writes. Settings take effect on subsequent requests, but the server-managed release flag cannot be enabled through this page. The general `/api/v1/admin/system` endpoint returns setting keys and timestamps, not values.

| Method and path | Request (feature enabled) | Response | Failure |
| --- | --- | --- | --- |
| `GET /api/v1/auth/registration-config` | None | `{verificationRequired:boolean,turnstileSiteKey:string|null,registrationAvailable:boolean,configurationStatus:"READY"|"DISABLED"|"MISSING_CONFIG"}`. Without credentials and with the gate off: `{false,null,true,"MISSING_CONFIG"}`; with credentials preconfigured but gate off: `{false,null,true,"DISABLED"}`; gate on with valid settings: `{true,publicSiteKey,true,"READY"}`. A misconfigured enabled gate fails startup instead of serving this endpoint. | — |
| `POST /api/v1/auth/email-code` | `{email,turnstileToken}` plus exact `Origin: PUBLIC_BASE_URL` | `202 {accepted:true}` whether email is already registered or not | `CSRF_REJECTED`, `TURNSTILE_INVALID`, `TURNSTILE_UNAVAILABLE`, `RATE_LIMITED`, `EMAIL_DELIVERY_UNAVAILABLE` |
| `POST /api/v1/auth/register` | `{email,password,referralCode?,emailCode}` plus exact origin; 6 numeric digits, single use, valid 10 minutes | `201 {user}` | `EMAIL_CODE_INVALID`, `EMAIL_IN_USE`, `INVALID_REFERRAL_CODE` |
| `POST /api/v1/auth/login` (web) | `{email,password,turnstileToken}` plus exact origin; no `device` | `{user}` plus HttpOnly cookie | `TURNSTILE_INVALID`, `TURNSTILE_UNAVAILABLE`, `INVALID_CREDENTIALS` |
| `POST /api/v1/auth/login` (desktop) | `{email,password,device}` with no `Origin`; initial password login remains V2.3-compatible without DPoP or Turnstile. Subsequent authenticated device requests and refresh still require DPoP. | `DeviceCredential` | Existing device errors |

Turnstile server verification requires matching hostname and action (`registration_email_code` for send, `web_login` for browser login), with the client IP forwarded to Cloudflare. Tokens are single-use at Turnstile; expired/invalid challenges fail closed. Issuance is limited per IP (8/hour), email (3/hour), and email cooldown (60 seconds) across API instances; the existing auth rate limits also apply. OTPs are stored only as keyed hashes; five failed attempts exhaust a code. Existing addresses receive an informational email instead of an actionable code, with the same public response. Mail transport errors return 503 and never report a message as sent. Invalid referral and duplicate email registrations roll back without consuming an otherwise valid code. Admin account creation is unchanged.

Desktop 0.2 login compatibility means a device-mode password login without `Origin` is exempt from Turnstile, but is subject to existing per-IP login limits, subscription/device limits, installation-key binding, and DPoP for subsequent authenticated/refresh calls. A password login alone cannot attest that a caller is the official Desktop executable.

`deviceId` is a stable installation UUID generated by the App; its per-installation P-256 public JWK cannot be silently replaced. Browser login without `device` is allowed only with the same-origin browser flow and returns `{user}` plus an HttpOnly cookie, not `DeviceCredential`. Tokens and private keys are secrets: keep refresh tokens and the software-generated installation private key in OS-protected storage, never logs or plaintext files. No TPM or official-binary attestation is required or claimed.

On the first password login after upgrading an existing device without a registered JWK, the server binds its new public key to that installation ID exactly once, advances the device authorization version, and revokes earlier refresh tokens. An already enrolled device rejects a different key; a revoked device must be restored and then logged in again. The Desktop's follow-up device-registration request includes the same public key and a fresh DPoP proof.

## Adjustable request limits

Admin-only `GET /api/v1/admin/rate-policy` reads and `PUT /api/v1/admin/rate-policy` replaces `{accountRpm,deviceRpm,publicIpRpm,authIpRpm}`. Defaults are **2 new AI turns/minute/account**, **1 new AI turn/minute/device**, **60 public requests/minute/IP**, and **10 auth requests/minute/IP**. Bounds are respectively 1–120, 1–60, 1–120, and 1–120; `authIpRpm` cannot exceed `publicIpRpm`. Changes persist in `system_settings` and are audited. The account and device checks occur in the user-locked usage transaction, with a rolling one-minute window; JSON and SSE starts both count. Only server-issued pending tool calls for the same user, device, model and thread may continue the existing turn: the request may contain tool outputs alone, or an exact server-recorded transcript prefix followed solely by tool outputs. The transcript is checked by hash; added prompts are not exempt. When simultaneous calls return results separately, each valid result consumes a bounded continuation and the other call IDs remain pending. A continuation is limited to eight follow-ups within five minutes and still consumes plan concurrency/quota with its own usage record and settlement. Replayed, forged, expired, or mixed new-prompt/tool requests count as a new turn. Public and sensitive auth routes use durable, per-IP rolling counters with advisory transaction locks across API instances. A separate 120/minute global IP ceiling still covers other API routes; additional auth-specific long-window hard caps remain as defense in depth. `GET /health` is excluded from the database-backed policy so health probes do not require a database. All limits return HTTP 429 `RATE_LIMITED`.

## Account, wallet, and usage

| Method and path | Request | Response | State/error |
| --- | --- | --- | --- |
| `GET /api/v1/me` | None | `{account: AccountSummary, subscription: SubscriptionSummary, wallet: WalletSummary, activeDevices: number}` | `401 AUTH_REQUIRED`, `403 ACCOUNT_DISABLED` |
| `GET /api/v1/me/subscription` | None | `{subscription: object|null, plan: object|null}` | Existing V1 subscription state |
| `GET /api/v1/me/wallet` | None | `WalletSummary` | Missing wallet reads as balance `0` |
| `GET /api/v1/me/devices` | None | `{data: Device[]}` | V2 states include `BLOCKED` |
| `GET /api/v1/me/wallet/transactions` | None | `{data: [{id,type,points,balanceAfter,referenceType,referenceId,createdAt}]}` latest 100 | Immutable ledger; no credential data |
| `GET /api/v1/me/usage` | None | `UsageSummary` | V2 totals cover all immutable events; `legacy` tracks current V1 period |
| `GET /api/v1/usage` | None | `UsageSummary` | Stable alias of `/api/v1/me/usage` |
| `GET /api/v1/usage/requests/{id}` | UUID request ID | `{request,usage,wallet}` | `usage:null` while in progress; `404` for other users |
| `GET /api/v1/usage/responses/{id}` | `id` is `resp_` plus 32 lowercase hex | Same `{request,usage,wallet}` | Useful when the App has only a Responses API ID |
| `GET /api/v1/usage/history` | None | Existing V1 history | Kept for compatibility |

Settled `usage` has the exact `UsageRecord` shape above. `SHADOW` means the server rated observed usage without debiting the wallet. `UNPAID` means the rated amount was not debited; `METERING_ERROR` means invalid or unavailable provider usage (including an interrupted Copilot stream after the server observes a nonempty upstream text delta but before final usage counters, even if the client disconnected before the delta could be written); its zero counters are placeholders, not confirmed zero consumption, and no points are charged. `UNRATED` means a rating failure. Review states block further `ENFORCED` requests. In `SHADOW` or `ENFORCED` mode, `/v1/responses` adds `usage.points_rated`, `usage.points_charged`, `usage.remaining_points`, `usage.request_id`, `usage.billing_mode`, and header `X-Bridge-AI-Request-Id`; the legacy `usage.points` alias equals `points_charged`. These fields are absent in `OFF`. SSE `response.completed` carries the same response object. The App should poll `/api/v1/usage/responses/{id}` after a disconnect or missing final frame. `/v1/responses` uses progressive upstream text deltas for Copilot. Its `response.completed` follows persisted usage and settlement; retained non-Copilot adapters may emit frames after completion.

## Devices

| Method and path | Request | Response | State/error |
| --- | --- | --- | --- |
| `POST /api/v1/devices/register` | Existing `DeviceInfoSchema` with installation UUID `deviceId` | `{device: Device}` | `409 DEVICE_LIMIT_REACHED`, `403 DEVICE_REVOKED` |
| `GET /api/v1/devices` | None | Frozen V1 device list | Includes revoked devices; a blocked device is presented as `REVOKED` for V1 compatibility |
| `PATCH /api/v1/devices/{id}` | `{deviceName: string}` | `{device: Device}` | `404 NOT_FOUND` if not owned |
| `POST /api/v1/devices/{id}/revoke` | None | `{device: Device}` | Revokes refresh tokens; idempotent status effect |
| `DELETE /api/v1/devices/{id}` | None | Existing V1 `{device}` | Preserved alias |

The active subscription's `maxDevices` determines capacity. `devices.deviceId` is a random installation UUID, not a MAC address. An App must generate and keep it stable per installation. AI requests tie `user_id` and internal `device_id` to the usage event. After incremental database migration `0004`, device access JWTs without an authorization-version claim are treated as version `0` for compatibility while the stored device version is `0`. User revocation and Admin status transitions invalidate device refresh tokens and advance that version; restoring a device does **not** reactivate old access or refresh tokens. The App must discard stale credentials and log in again to obtain fresh device tokens after restoration (old access is rejected as `DEVICE_REVOKED`, revoked refresh as `UNAUTHORIZED`). `GET /api/v1/me/devices` exposes `BLOCKED`; frozen `GET /api/v1/devices` maps blocked to `REVOKED`. Migration `0004` and these restoration semantics are not yet deployed or verified on production; no `V2_TEST_DATABASE_URL` is configured here to run the DB integration test.

## Providers and models

| Method and path | Request | Response |
| --- | --- | --- |
| `GET /api/v1/providers` | None | `{data: Provider[]}` permitted by current plan/model ACL |
| `GET /api/v1/providers/{id}` | Provider UUID | `Provider` or `404` |
| `GET /api/v1/providers/{id}/models` | Provider UUID | `{data: Model[]}` permitted by current plan/model ACL |
| `GET /v1/models` | V1 Desktop headers | Frozen Gateway V1 model list |

The V1 production provider catalog exposes only the managed `Copilot Bridge Cloud` provider and models verified against the configured GitHub Copilot entitlement. DeepSeek, Qwen, custom API and local provider extensions are outside this release gate. BYOS remains an architectural extension. BYOS currently supports only a validated DeepSeek connection: `GET /api/v1/me/provider-connections` lists masked connection metadata; `POST` accepts `{providerId,label,apiKey}`, validates the key with DeepSeek, encrypts it at rest, then returns `{id,providerId,ownership,status,label}`; `DELETE /api/v1/me/provider-connections/{id}` disables it and removes its encrypted secret. No endpoint returns the key. When V2 billing is enabled, the App may send `X-Provider-Connection-Id: {id}` on `/v1/responses`; the server validates ownership and uses the `BYOS_USAGE` rate card. A connection header while V2 billing is disabled returns `PROVIDER_CONNECTION_UNAVAILABLE`. Custom endpoint URLs, App-side Copilot OAuth and local usage reporting are outside the V1 release gate.

## Referral

| Method and path | Request | Response | State/error |
| --- | --- | --- | --- |
| `GET /api/v1/referral/code` | None | `{code,status}`; lazy creates one code per user | `REFERRAL_CODE_UNAVAILABLE` on collision failure |
| `POST /api/v1/referral/apply` | `{code: string}` | `{id,status,riskReviewRequired}` | `INVALID_REFERRAL_CODE`, `REFERRAL_NOT_ELIGIBLE` |
| `GET /api/v1/referral/stats` | None | `ReferralSummary` | Reward count and earned points |
| `GET /api/v1/referral` | None | `ReferralSummary` | Stable alias of `/api/v1/referral/stats` |
| `GET /api/v1/referral/history` | None | `{data: [{id,status,registeredAt,qualifiedAt}]}` | No referred user's email disclosed |

Status: `REGISTERED → PENDING` if flagged, then Admin review; a paid order meeting the configured threshold can move it to `QUALIFIED → REWARDED`; Admin may set `REJECTED`. By default registration does not award points; the separately enabled invite-signup campaign credits both parties and a new-account trial atomically. A user can apply one code, before a subscription exists. The server stores an HMAC of the registration IP, not the raw address in the referral row.

New accounts may provide `referralCode` in the registration request; the web form accepts manual entry or prefills it from `/register?ref=...`. Code validation, user creation, referral creation and the registration audit row commit in one database transaction. An invalid code rejects the registration. When the invite-signup campaign is enabled, an eligible new invited registration credits each party RMB 5 in reward balance and grants the new account 30 days of PAYG service. Risk-flagged referrals remain pending for administrator review. The legacy paid-order policy remains separate and cannot pay a rewarded signup twice. The `/referral/apply` route remains for accounts registered without a code. The test-only QR on the website links to the same site's `/pricing` information page: it never initiates a payment, creates or marks an order paid, activates a subscription, or qualifies a referral. Test subscriptions require separate Admin action after verification; no live payment channel is offered.

`ReferralRecord` is the exact item shape in `/history`.

## Admin V2 endpoints

Admin role is required. `GET /api/v1/admin/wallets`, `GET /api/v1/admin/users/{id}/finance`, and `POST /api/v1/admin/users/{id}/wallet/adjust` expose balances, history and audited adjustment. Adjustment body: `{points: signed integer except 0, reason: string 10..500, idempotencyKey: UUID}`. The key makes retries safe; a changed payload with the same key returns `409 IDEMPOTENCY_CONFLICT`.

`GET/POST /api/v1/admin/rate-cards`, `POST /api/v1/admin/rate-cards/{id}/versions`, and `POST /api/v1/admin/rate-card-versions/{id}/publish` implement draft/publish. Create a card with `{providerId,modelId,billingPolicy}`. Create a version with seven decimal strings (`inputRate`, `outputRate`, `cachedInputRate`, `reasoningRate`, `imageInputRate`, `imageOutputRate`, `toolRate`) and integer `minimumCharge`; `effectiveFrom` may be `null` or now/past. Publish retires the prior active version atomically and pins new requests to the new version. Future scheduling is currently rejected.

`GET /api/v1/admin/referrals`, `GET/PUT /api/v1/admin/referral-policy` and `POST /api/v1/admin/referrals/{id}/review` manage qualification. Policy body: `{enabled,minPaidAmount,referrerPoints,referredPoints}`. Review body: `{decision:'APPROVE'|'REJECT',reason}`. `GET /api/v1/admin/cost-analytics?groupBy=day|provider|model|user` returns request count, points charged, known provider cost, unpriced row count, and `estimatedRevenue:null`, `grossMargin:null`; results are separated by provider cost currency.

The existing `/api/v1/admin/*` V1 routes remain. Admin Web panels now expose the V2 wallet, rate, referral and cost endpoints; production rollout remains gated.

`GET /api/v1/admin/model-access` is an admin-only read of configured `{planAccess,overrides,subscription,effectiveModelIds}`; optional `?userId={UUID}` selects an existing user for overrides and effective model IDs. The effective list reuses the Gateway's current `allowedModels` decision and an active subscription; it does not grant access or bypass provider, model, device, quota, or production gates. Writes continue through the existing Admin model/plan and user-model routes.

### Admin Copilot device authentication (operational, not an App entitlement)

Configure `COPILOT_GITHUB_CLIENT_ID` with a GitHub OAuth App Client ID and enable its device flow in GitHub App settings. The admin-only `POST /api/v1/admin/copilot/auth` begins a device authorization; `GET /api/v1/admin/copilot/auth` reads its status. Both return `{status, login?, userCode?, verificationUri?, expiresAt?, message?}` where `status` is `NOT_CONFIGURED`, `NOT_AUTHENTICATED`, `PENDING`, `VERIFYING`, `AUTHENTICATED`, or `ERROR`. The UI may display `userCode` and open `verificationUri` only when returned. The server never returns the device code, OAuth token, or stored credential. `message` is a safe error code, not a GitHub response body.

The server requests only `read:user` and verifies the resulting GitHub OAuth token with `CopilotProvider.discover()` before encrypting it in `provider_credentials` and recording a token-free audit row. `AUTHENTICATED` means only that the server-side credential passed `discover()`, **not** that a provider, model, or billing mode was enabled. Generic `PATCH /api/v1/admin/providers/{id}` rejects both Copilot API-key writes and enabling Copilot; reviewed device authentication and the existing validated CLI credential import remain separate from that generic route. This operational endpoint does not relax the reviewed Copilot release gate or the frozen App V2 schema. A pending device flow is kept in server memory, deduplicated within one API process, and must be restarted after a process restart; a previously verified credential is recovered from encrypted storage. Run a single API replica for this flow until shared pending-flow coordination exists. [Official Copilot SDK OAuth documentation](https://docs.github.com/en/copilot/how-tos/copilot-sdk/setup/github-oauth) supports passing an OAuth App user's access token as `gitHubToken` with `useLoggedInUser: false`, but describes each user using their own subscription. It does **not** authorize sharing one administrator's Copilot entitlement across terminal users; that use remains behind a separate authorization and production release review, in addition to live server-side entitlement verification.

## Error codes and lifecycle

Auth and access: `AUTH_REQUIRED`, `TOKEN_EXPIRED`, `DEVICE_REVOKED`, `DEVICE_LIMIT_REACHED`, `SUBSCRIPTION_EXPIRED`, `MODEL_NOT_AVAILABLE`, `COPILOT_NOT_ENTITLED`. Billing: `INSUFFICIENT_POINTS` (HTTP 402), `BILLING_REVIEW_REQUIRED` (409), `RATE_CARD_UNAVAILABLE` (503), `IDEMPOTENCY_CONFLICT` (409). Provider: `PROVIDER_UNAVAILABLE`, `PROVIDER_AUTH_REQUIRED`, `PROVIDER_CONNECTION_UNAVAILABLE`. Referral: `INVALID_REFERRAL_CODE`, `REFERRAL_NOT_ELIGIBLE`. Throttle: `RATE_LIMITED`. Validation and unknown resources: `VALIDATION_ERROR`, `NOT_FOUND`. Existing V1 aliases (`UNAUTHORIZED`, `MODEL_NOT_ALLOWED`, `SUBSCRIPTION_REQUIRED`, `MONTHLY_QUOTA_EXCEEDED`) remain during migration. Do not treat all 403/429 responses as point exhaustion.

The shared V1 authentication middleware currently emits `UNAUTHORIZED` for a missing bearer token or browser session. `AUTH_REQUIRED` is reserved for a coordinated V2 auth cutover and is not an observed production response today; App clients must handle `UNAUTHORIZED` as the missing-auth case. Likewise, `MODEL_NOT_AVAILABLE` and `COPILOT_NOT_ENTITLED` are reserved V2 names while the frozen Gateway may emit `MODEL_NOT_ALLOWED` or `MODEL_UNAVAILABLE`. These names must not be substituted silently on an existing V1 endpoint.

`V2_BILLING_MODE` has three states: `OFF` leaves the Gateway V1 billing path intact, `SHADOW` writes immutable AI request and usage events with `pointsRated > 0` and `pointsCharged = 0` when usage is observed, and `ENFORCED` performs wallet preflight and debit. The production gate permits `SHADOW` only. A dedicated integration account may use the gated Mock provider for metered testing in `SHADOW`; public accounts cannot access it. `ENFORCED` requires separate approval and real-provider evidence.

`ai_requests.status` is `CREATED`, `STARTED`, `COMPLETED`, `CLIENT_DISCONNECTED` or `PROVIDER_ERROR`; the current gateway creates at `STARTED`. One final immutable event is stored per V2 request. A failed provider request with no observed usage has a zero counter event and `NO_USAGE`. A provider request that produced usage can still be billed when the client disconnects. If actual usage exceeds the wallet, the event is `UNPAID`; subsequent V2 requests return `INSUFFICIENT_POINTS`. The current V1 Mock integration does not use V2 billing and continues under its frozen contract. Plan `rolloverPolicy:'NONE'` expires unspent subscription grant points at period end after earliest-expiry-first spending; `UNLIMITED` grants and purchased points do not expire under this policy. The historical SHADOW-only statement is superseded by the 0.3.0 release: managed DeepSeek requests enforce the current RMB policy; see [release acceptance](acceptance/RELEASE_0_3_0_REPORT.md).

### 2026-10-15 钱包余额拆分（兼容新增字段）

WalletSummary 增加可选整数 `regularBalance`、`rewardBalance`，单位仍为万分之一人民币。balance = regularBalance + rewardBalance；奖励余额为邀请奖励批次中尚未消费、未过期的余额，其余充值、管理员增加、套餐额度归正常余额。总余额继续用于消费与余额不足判断，扣款顺序沿用最早到期优先、其次创建时间；不重复赠送、不重算账单。旧服务缺字段时客户端不假定奖励为零。

### 2026-10-15 活动与轻量广播

管理员 GET/PUT `/api/v1/admin/engagement` 读取/保存 `{revision,campaign:{enabled},notices:[{id,text,enabled}]}`。保存受同源、管理员鉴权和事务版本校验保护；邀请活动在新用户首次确认充值后固定发放双方各50000点（人民币5元），双方奖励自到账起7天有效，账号和按量使用资格长期有效。启用要求PAYG套餐可用。通知为纯文本，最多10条、每条160字符，不能提供跳转URL。

`/api/v1/client/config` 和 `/api/v1/auth/registration-config` 兼容新增 `inviteCampaign` 与 `announcements`。无有效活动/通知时返回空列表；客户端不渲染额外区域。App广告低优先级、10秒轮播，悬停/焦点/隐藏/减弱动态时暂停，维护/强制更新/安装/切换/异常时隐藏，不自动弹窗或发送邀请。邀请文案生成时重新读取活动配置。

仅新账号注册事务能创建本次活动资格快照，老账号补绑、管理员创建、无邀请码或活动关闭后的注册均不发注册奖励。不补发历史邀请；已产生的待核对资格和已到账奖励不因活动关闭消失。注册仅提交邀请关系、资格快照及长期有效的零余额按量资格，不发奖励。管理员首次正额增加余额（当前无充值入口）或正额订单确认付款，才记录invite_credit:<referralId>并发放双方奖励；加款与奖励在同一事务内提交，一方奖励失败则整笔回滚。减少余额、奖励赠送、重复加款或重复提交不重复发放。审核通过但尚未充值仍不发钱。异常待核对通过既有管理员审核入口兑现当时快照，使用统一referral幂等键，付款奖励不能重复发放。奖励按到账时间逐笔设置7天到期，优先消费最先到期的余额，过期仅清理该笔剩余奖励；充值余额不受活动有效期影响。钱包返回rewardExpiresAt和rewardExpiringBalance提示最近一批奖励到期。ACTIVE/TRIAL资格不受currentPeriodEnd限制（仅为用量统计周期），V2订阅expiresAt:null表示长期有效；锁定、取消/停用资格和余额不足仍按原规则阻止调用。


### 2026-10-15 注册防刷与首次充值触发修订

生产强制启用 `STAGED_EMAIL_REGISTRATION_ENABLED=true`（持久化于生产环境及 runtime override），使用已配置的 Turnstile + Resend SMTP。获取邮箱码须同源请求及服务端人机凭证验证；注册必须消费10分钟内的邮箱码，5次错误后作废，成功使用后不可重放。发码有60秒冷却、每邮箱每小时3次、每IP每小时8次数据库限额；注册接口另有每IP每小时5次限制。验证失败/上游异常不会降级为无验证注册；强制验证配置不全时 registrationAvailable:false、MISSING_CONFIG。

活动广播与邀请文案现在说明“首次充值后双方各得¥5”，取代之前的“注册即送”。已到账奖励不追溯撤回，历史REWARDED不会重复领取；原活动快照中未发奖的资格也须今后有真实加款再发。当前任意首次正额管理员加款视为充值，无最低金额设置，管理员减款不计。正常账号资格仍长期有效，奖励自实际发放起7天有效。既有客户端登录/模型调用鉴权与余额不足策略不变。


### 0.3.17 紧凑账户的充值记录

GET /api/v1/me/wallet/transactions 兼容增加 kind=account，仅在数据库查询中筛选 PURCHASE / ADMIN_ADJUSTMENT，再取最近100条，避免逐次消费挤掉较早充值记录。默认kind=all保持原行为。App仅展示充值、管理员加减金额、时间与当时变动后余额，当前钱包总额单独展示，不称为完整账单。

### 0.3.18 通知标题与正文

管理员 GET/PUT /api/v1/admin/engagement 的 notices 使用 {id,title,content,enabled}：title 1–80字、content 1–6000字、最多10条，纯文本。旧 {id,text,enabled} 读取/保存时兼容转换，revision并发保护和审计不变。campaign.announcementEnabled（默认true）只控制邀请活动广播，独立于campaign.enabled。公开client/config及registration-config仅返回启用通知；announcements保留text标题，兼容新增title/content，隐藏正文不泄露。client/config返回Cache-Control:no-store，新App约5秒配置轮询，多条10秒轮播，点击标题看正文；详情能同步编辑，隐藏/删除收起。无数据库迁移，原奖励和余额规则不变。


## 2026-10-16 administrator management additions

- GET /api/v1/admin/online-events: administrator cookie session only; optional email substring filter, page (1+), pageSize (1–100, default30). Returns data/total/page/pageSize. Events distinguish WEB_LOGIN, APP_LOGIN and APP_RECONNECT after a gap of at least five minutes. Timestamps are ISO UTC; UI renders Asia/Shanghai. IP is the trusted request IP, no geographic lookup or raw user-agent storage. This is event history, not current online status.
- GET /api/v1/admin/site/summary: administrator only. pageViews and downloads each expose total/today/last30Days; downloads.data is grouped UTC day/version/platform/arch. trackingSince is the installation of telemetry migration0012. Counts valid published Bridge installer GET responses only, excludes HEAD/unpublished/missing files. Repeat downloads and App updates each count; no claim of completed downloads, unique people or installs. A counter failure never interrupts a download.
- GET /api/v1/admin/model-pricing adds cumulative inputTokens/cachedInputTokens/outputTokens (cache is an input subset), preserves actual wallet charges and known upstream-cost coverage, excludes internal @example.test. All unarchived managed models including disabled rows are returned. Upstream account balance remains shared; unknown cost/balance is not zero.
- GET /api/v1/admin/audit excludes USER_ONLINE events (separate view) and adds actorEmail.
- New telemetry contains no historical fabricated events/downloads, and no download IP identity is stored. Existing Desktop/Gateway routes and App minimum version are unchanged.

## 2026-10-16 account security additions

- `POST /api/v1/auth/forgot-password`: trusted browser Origin, optional configured Turnstile `password_reset` proof, normalized email. Returns generic HTTP 202 acceptance; persisted per-email/IP mail quotas apply. Chinese one-time recovery link expires in 30 minutes, with token in the URL fragment.
- `POST /api/v1/auth/reset-password`: `{token,password}`. A valid unused hashed token and unchanged password snapshot are consumed atomically; expired/used links return `PASSWORD_RESET_INVALID`.
- `POST /api/v1/auth/change-password`: authenticated cookie or DPoP bearer; `{currentPassword,password}`. Requires the actual current password. New passwords have 12–128 characters.
- Administrator `POST /api/v1/admin/users/{id}/reset-password` accepts a custom password; the UI can generate a cryptographically random 20-character password and copy it. Passwords never appear in response/audit records.
- All three password changes revoke browser sessions and refresh tokens, advance device authorization versions and require explicit login again. Administrator-blocked devices remain blocked.
- Desktop login accepts optional `replaceDeviceId`. Only a valid password login can receive `DEVICE_LIMIT_REACHED` details `{maxDevices,devices:[{id,deviceName,platform,lastSeenAt}]}`; selecting a currently authorized device owned by the same user revokes it and activates the new installation in one user-locked transaction. Existing access tokens stay invalid after re-enrollment. Browser login does not consume App device slots.

## 2026-10-17 hardware identity and startup validation

`POST /api/v1/auth/resume` is desktop-only and requires an active DPoP-bound bearer session. Its body is `{device, legacyDeviceId?, sessionId}`. It validates account/device status and authorization version under user/device locks, migrates an owned legacy random UUID in place when appropriate, rotates refresh credentials, and atomically records `APP_START`. A process-scoped `sessionId` deduplicates retries but does not suppress the next launch. Raw passwords are never stored for automatic login. Manual password login still validates the password and records `APP_LOGIN`; a correct password can re-enroll the same hardware UUID after a reinstall, invalidating the old key's sessions. Token-only resume cannot re-enroll a different key.

Refresh additionally returns optional `device`, allowing an upgraded App with an expired access token to refresh the legacy credential before signed hardware migration, without recursively refreshing or registering the wrong UUID. Hardware-changed machines do not use the legacy random-ID migration path and require explicit login. User-visible name and stable binding UUID are distinct fields. `online-events` additionally returns `deviceId` and `authMethod` (`PASSWORD`/`TOKEN`, null for older history); `APP_START` is separate from password login and reconnect heartbeats.

## 2026-10-17 account bills and device sign-out

`GET /api/v1/me/bills?kind=all|recharge|consumption&page=1&pageSize=20` returns only the authenticated user's paginated non-USAGE wallet entries and saved device interval summaries. `pending` has open interval device/time fields without amounts. Summary totals cover full history, not the current page. Positive balance additions include labelled rewards/grants, and all view retains expiration/negative adjustments. One unit remains RMB 0.0001.

`POST /api/v1/me/devices/revoke-all` requires a same-origin web session and `{confirm:true}`. It locks the user, increments every device authorization version, retains BLOCKED status, revokes all refresh tokens and web sessions (including current), clears the cookie, and records one audit event. It preserves balances, device records, history, and password. Re-login after clearing is explicit.

Online audit records include `billingRecorded` and nullable `previousBilling` (`id`, `kind`, `points`, `startedAt`, `endedAt`). A missing legacy record differs from an empty first interval. Device counters and closed periods are server-side reporting only; clients retain the existing sign-in/startup protocol. No App update is required for these Web features.

## Purchase review and reward acknowledgement (2.8.0)

- POST `/api/v1/me/purchase-tickets` accepts `{}`; GET `/api/v1/me/purchase-tickets/{id}` and `/api/v1/me/purchase-claims` are owner-only. Browser session or signed current App device; App additionally supplies X-Device-ID. Tickets expire after 10 minutes and bind to the initiating device version or web session. Public purchase options provide the personal-homepage merchant QR path and 10/20/50 RMB suggestions.
- POST `/api/v1/purchase-mobile/exchange` consumes `{ticket}` from the URL fragment, requires trusted Origin, returns ticketId, maskedAccount, expiresAt and optional claim, and sets path-scoped HttpOnly bridge_purchase cookie. GET `/status` and POST `/claims` under that prefix require this cookie plus matching X-Purchase-Ticket. Claims accept only `{orderNo}`; never userId or amount. This grants no wallet, device, profile or unrelated account read permissions. Exchange cannot fall back to a different existing ticket.
- GET `/api/v1/admin/purchase-claims` supports page, status and email/order search; includes pending/overdue/today credited totals. GET `/{id}/reviews` preserves audit history. POST `/{id}/review` accepts either `{status:"APPROVED",paidRmb:"20.00",verified:true,reason?}` or `{status:"REJECTED",reason}`. Paid RMB uses decimal strings, 1 RMB = 10000 ledger units; positive/int32 bounds enforced. Approval atomically credits once with referenceType PURCHASE_CLAIM. Duplicate approval with the same amount returns duplicate=true; conflicting decisions return 409.
- New registered invite eligibility is fulfilled only after a genuine APPROVED purchase claim and matching positive PURCHASE transaction. Manual adjustments and subscription activation cannot qualify. Reward lots and both durable notices share the approval transaction; risk approval also verifies the purchase evidence.
- GET `/api/v1/me/reward-notices` returns up to 10 own unacknowledged notices. POST `/api/v1/me/reward-notices/{id}/ack` accepts `{}`, is owner-only/idempotent and marks an explicit acknowledgement. No acknowledgement on displaying, refreshing or dismissing with Esc. Rewards have already been credited independently of the receipt.
- Purchase routes use no-store/no-referrer responses. Order identity unique globally, public conflicts reveal no other owner. Financial history is retained, old ephemeral tickets removed in batches of at most 500. Mutating clients do not automatically retry network timeouts.

## 2026-10-26 order email and App notices (domain contract 2.9.0)

- Submission queues an administrator email to `zhipeng2048@gmail.com` in the claim transaction. Review queues an administrator receipt and an owner result email in the financial transaction. Unique `(claimId,attempt,kind)` events prevent duplicate application enqueue; mail failure cannot undo successful review or credit again. Approval still requires verified paid RMB.
- Administrator mail links to `/login?reviewOrder=ORDER`, then an authenticated ADMIN reaches the filtered purchase section. Validated order identifiers cannot redirect to external URLs. A link GET grants no approval authority; replying to email does not approve orders. Non-admin users reach their dashboard.
- `GET /api/v1/me/purchase-notices` accepts an authenticated web session or signed device request, returning `{data: PurchaseClaim[]}` for at most 20 own, reviewed, unacknowledged attempts. `POST /api/v1/me/purchase-notices/{id}/ack` accepts only `{attempt:positiveInteger}`. Matching own final attempts are idempotently acknowledged; another account or stale attempt returns 404. Displaying a notice does not acknowledge it. These notices are independent of reward receipts.
- Migration 0017 marks historical final attempts acknowledged; future decisions persist until explicit acknowledgement. App 0.3.29 polls while visible and refreshes wallet state. Older compatible Apps keep their previous order and balance capabilities.
- Durable mail delivery uses a 15-second worker, leased `FOR UPDATE SKIP LOCKED` batches, TLS SMTP, bounded timeouts, exponential retries (maximum ten attempts), and stable message IDs. SMTP accept followed by a process crash can still cause duplicate delivery; exactly-once SMTP delivery is not guaranteed. Successful delivery clears the message body; terminal rows are deleted after 30 days. Failure logs contain event/count only; queued metadata never includes passwords, tokens or request content. Exhausted events remain FAILED until retention expiry, without blocking purchases.
- `client/config.minimumVersion` is independent of `latestVersion`. The minimum compatible App is **0.3.28** for this release. Signed model routes reject versions below that minimum, instead of rejecting every version unequal to the latest. Ordinary publication neither revokes compatible sessions nor installs an update automatically. Reassess compatibility for every server/App deployment and record the actual evidence before raising the minimum.

See `docs/acceptance/order-notifications-20261026.json` for deployment, package and verification evidence and its limitations. Domain documentation 2.9.0 remains distinct from the existing runtime desktop handshake contract.
