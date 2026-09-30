# Copilot Bridge V2 Domain API contract

**Contract version: `2.3.0` — deployed for internal testing on 2026-09-30.** Base URL: `https://ai.mddxz.top`. This file is the V2 App/Server wire contract; its machine-readable form is [openapi.v2.json](protocol/openapi.v2.json), generated from shared Zod schemas and pinned in [CONTRACT_VERSION.json](protocol/CONTRACT_VERSION.json). The required installation public key and DPoP proof change desktop authentication compatibility; product routes remain under `/api/v1` and AI routes remain `/v1/models` and `/v1/responses`. Production remains on V2 `2.2.0` and Gateway V1 `1.0.0` until a paired new client passes the release gate. Production V2 charging remains disabled in `SHADOW` mode. Use [the production integration manifest](protocol/PRODUCTION_INTEGRATION_MANIFEST.md) for current deployment status.

Desktop authenticated routes require the bearer token **and** a signed `DPoP` compact ES256 JWT bound to the enrolled installation JWK; refresh requires DPoP bound to the refresh token. Browser routes also accept the same-site HttpOnly session without DPoP. Desktop AI requests still require `X-Device-Id` and `X-Client-Thread-Id`. See [pending V2.3 device-proof rules and vectors](protocol/GATEWAY_DEVICE_PROOF_V2_3.md). JSON times are RFC 3339 UTC. Amounts named `points` are nonnegative integer AI points; transaction `points` is signed. Token counters are provider usage, never points. `null` means unknown or not yet settled, not zero.

## Stable shapes

```ts
type AccountSummary = { id: string; email: string; status: 'ACTIVE'|'DISABLED'|'EXPIRED' };
type SubscriptionSummary = { id: string; status: string; planCode: string; periodStart: string; periodEnd: string; monthlyPoints: number; maxDevices: number; rolloverPolicy: 'NONE'|'UNLIMITED' } | null;
type WalletSummary = { balance: number; unit: 'AI_POINT' };
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
| `POST /api/v1/auth/login` | `{email,password,device:{deviceId,deviceName,platform,osVersion?,appVersion?,publicKeyJwk:{kty:"EC",crv:"P-256",x,y}}}`; initial login needs no DPoP | `DeviceCredential` | `INVALID_CREDENTIALS`, `DEVICE_LIMIT_REACHED`, `DEVICE_REVOKED`, `SUBSCRIPTION_EXPIRED` |
| `POST /api/v1/auth/refresh` | `{refreshToken}` plus `DPoP` bound to refresh token and exact request body bytes | `{accessToken,refreshToken,expiresIn:1800}` | `UNAUTHORIZED`, `DEVICE_REVOKED`, `DEVICE_PROOF_INVALID`, `DEVICE_PROOF_REPLAYED` |
| `POST /api/v1/auth/logout` | Authenticated | `{ok:true}` | `UNAUTHORIZED` |

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

Status: `REGISTERED → PENDING` if flagged, then Admin review; a paid order meeting the configured threshold can move it to `QUALIFIED → REWARDED`; Admin may set `REJECTED`. Registration never awards points. A user can apply one code, before a subscription exists. The server stores an HMAC of the registration IP, not the raw address in the referral row.

New accounts may provide `referralCode` in the registration request; the web form accepts manual entry or prefills it from `/register?ref=...`. Code validation, user creation, referral creation and the registration audit row commit in one database transaction. An invalid code rejects the registration. No points are granted at registration; qualification and reward still require the paid-order policy. The `/referral/apply` route remains for accounts registered without a code. The test-only QR on the website links to the same site's `/pricing` information page: it never initiates a payment, creates or marks an order paid, activates a subscription, or qualifies a referral. Test subscriptions require separate Admin action after verification; no live payment channel is offered.

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

`ai_requests.status` is `CREATED`, `STARTED`, `COMPLETED`, `CLIENT_DISCONNECTED` or `PROVIDER_ERROR`; the current gateway creates at `STARTED`. One final immutable event is stored per V2 request. A failed provider request with no observed usage has a zero counter event and `NO_USAGE`. A provider request that produced usage can still be billed when the client disconnects. If actual usage exceeds the wallet, the event is `UNPAID`; subsequent V2 requests return `INSUFFICIENT_POINTS`. The current V1 Mock integration does not use V2 billing and continues under its frozen contract. Plan `rolloverPolicy:'NONE'` expires unspent subscription grant points at period end after earliest-expiry-first spending; `UNLIMITED` grants and purchased points do not expire under this policy. Public billing stays off until the release gates in [deployment-v2.md](deployment-v2.md) pass.
