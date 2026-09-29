# Status as of 2026-09-29
Overall: **PARTIAL — deployed API/Web and gated Mock integration, not a commercial V1 release.** The 2026-09-29 isolated database migration/tests passed **14/14**; production `0004`, API/Web switch, health, Admin reads, Mock JSON/SSE/two-step tool continuation, SHADOW settlement without wallet debit, and API restart persistence passed. These are limited to the dedicated test fixture and do not prove real-provider, production device-restore end-to-end, full Admin UI mutation, or paid checkout. See [deployment-v2.md](../deployment-v2.md) and the [production manifest](../protocol/PRODUCTION_INTEGRATION_MANIFEST.md) for scope and deployed source digests; exact build archive SHA-256 is `26047678958dc76f6280cf3e39d0aa08f75529f5d03f79254b7042a74f388c12`, with runtime source recorded afterward by `6cea3f8233ecb4aebe09bca6d910e9365ea9b576`.

**Gates still closed:** production Copilot OAuth is `NOT_AUTHENTICATED`; no real-provider inference acceptance, commercial plans/prices, WeChat/Alipay payment or Desktop release (`/api/v1/releases/latest` returns `{ "release": null }`). `V2_BILLING_MODE=SHADOW`, `V2_BILLING_ENABLED=false`: rated points are **not charged**; `ENFORCED` remains disabled. The website QR is test activation information, **not** a payment QR; no real collection, order or automatic activation follows. No new DB backup was taken for this rollout by explicit user decision; old API/Web Docker tags provide code rollback only. About **1.58 GB** disk remained; clean up before the next deployment. Full release and restore acceptance remain open.

## Historical 2026-09-23 gate snapshot (itemized below; not current full-release PASS)

Overall: **FAIL — integration preview, not V1 release candidate.** PASS means verified locally or over production HTTPS; PASS (Mock only) means the local loopback MockProvider test passed and the production path is not yet validated. FAIL includes implemented code that has not passed its full release criterion. See the deployment document for test scope.
Blockers at that date: no configured commercial plan prices and quotas, no DeepSeek key, Copilot integration needs authorization/review, WeChat Pay and Alipay are not connected, progressive production streaming is not implemented, and full device/subscription/usage/restore acceptance is pending. The production administrator is bootstrapped; Admin mutation and UI acceptance remain pending.

---

# Copilot Bridge Cloud — Release Gate

最终必须逐项填写真实状态。

禁止：

WIP 写 PASS

Mock 替代 Real 时不注明。


## Product

Website:
PASS

Homepage:
PASS

Pricing:
PASS

Download:
PASS


## Auth

User Login:
PASS

Password Hash:
PASS

Refresh Token Rotation:
PASS (Mock only)

Logout:
PASS

Admin RBAC:
PASS


## Device

Device Register:
PASS (Mock only)

Device Limit:
PASS (Mock limit test; hidden production test plan configured)

Device Revoke:
PASS (production HTTPS; revoked token rejected)

Device Restore:
FAIL (release criterion not yet verified or configured)


## Subscription

Plans:
FAIL (release criterion not yet verified or configured)

Standard:
FAIL (release criterion not yet verified or configured)

Pro:
FAIL (release criterion not yet verified or configured)

Manual Subscription:
FAIL (release criterion not yet verified or configured)

Expiration:
FAIL (release criterion not yet verified or configured)

Upgrade:
FAIL (release criterion not yet verified or configured)

Cancel:
FAIL (release criterion not yet verified or configured)


## Billing

Billing Domain:
FAIL (release criterion not yet verified or configured)

Order:
FAIL (release criterion not yet verified or configured)

Manual Payment:
FAIL (release criterion not yet verified or configured)

QR Payment Contract:
FAIL (release criterion not yet verified or configured)

Webhook Idempotency Framework:
FAIL (release criterion not yet verified or configured)

Wechat Pay:
NOT_CONNECTED

Alipay:
NOT_CONNECTED


## Usage

Usage Records:
PASS (production gated Mock only)

Input Tokens:
PASS (production gated Mock only)

Output Tokens:
PASS (production gated Mock only)

Usage Credit:
PASS

Quota:
FAIL (release criterion not yet verified or configured)

70/90/100 States:
PASS

Concurrency:
FAIL (release criterion not yet verified or configured)

RPM:
FAIL (release criterion not yet verified or configured)


## Model

Model Catalog:
PASS (test-only Mock catalog; commercial models unconfigured)

Model Enable:
FAIL (release criterion not yet verified or configured)

Plan ACL:
FAIL (release criterion not yet verified or configured)

User Override:
FAIL (release criterion not yet verified or configured)

GET /v1/models:
PASS (Mock only)


## Provider

MockProvider:
PASS (Mock only)

Copilot Provider:
NEEDS_AUTH

DeepSeek Provider:
NEEDS_KEY

Provider Health:
FAIL (release criterion not yet verified or configured)

Secret Encryption:
FAIL (release criterion not yet verified or configured)


## Gateway

POST /v1/responses:
PASS (Mock only)

Streaming SSE:
PASS (production Mock SSE framing); FAIL (progressive real-provider stream)

Text:
PASS (Mock only)

Reasoning:
FAIL (release criterion not yet verified or configured)

Function Call:
PASS (Mock only)

Function Call Output:
PASS (Mock only)

Same Session:
PASS (Mock only)

Sequential Tool Calls:
PASS (Mock only)

Session Isolation User:
FAIL (release criterion not yet verified or configured)

Session Isolation Device:
PASS (Mock test)

Disconnect:
FAIL (release criterion not yet verified or configured)

Timeout:
FAIL (release criterion not yet verified or configured)


## Dashboard

User Dashboard:
FAIL (release criterion not yet verified or configured)

Subscription UI:
FAIL (release criterion not yet verified or configured)

Usage UI:
FAIL (release criterion not yet verified or configured)

Devices UI:
FAIL (release criterion not yet verified or configured)

Models UI:
FAIL (release criterion not yet verified or configured)


## Admin

Dashboard:
FAIL (release criterion not yet verified or configured)

Users:
FAIL (release criterion not yet verified or configured)

User Detail:
FAIL (release criterion not yet verified or configured)

Devices:
FAIL (release criterion not yet verified or configured)

Plans:
FAIL (release criterion not yet verified or configured)

Subscriptions:
FAIL (release criterion not yet verified or configured)

Usage:
FAIL (release criterion not yet verified or configured)

Orders:
FAIL (release criterion not yet verified or configured)

Providers:
FAIL (release criterion not yet verified or configured)

Models:
FAIL (release criterion not yet verified or configured)

Releases:
FAIL (release criterion not yet verified or configured)

Audit:
FAIL (release criterion not yet verified or configured)

System:
FAIL (release criterion not yet verified or configured)


## UI

Apple-inspired Minimal Design:
PASS

Visual Consistency:
PASS

Desktop 1280:
PASS

Desktop 1440:
PASS

Desktop 1920:
PASS

Mobile 375:
PASS

No Horizontal Overflow:
PASS

Loading:
FAIL (release criterion not yet verified or configured)

Empty States:
FAIL (release criterion not yet verified or configured)

Error States:
FAIL (release criterion not yet verified or configured)

Accessibility:
FAIL (release criterion not yet verified or configured)


## Security

Argon2id:
PASS

Refresh Token Hash:
PASS

Provider Secret Encryption:
FAIL (release criterion not yet verified or configured)

HTTPS:
PASS

Secret Redaction:
FAIL (release criterion not yet verified or configured)

Prompt Not Persisted:
PASS

Response Not Persisted:
PASS

Tool Output Not Persisted:
PASS


## Database

PostgreSQL:
PASS

Migration:
PASS

Seed:
PASS

Backup:
PASS (daily timer, verified dump; off-host copy pending)

Restore Procedure:
FAIL (release criterion not yet verified or configured)


## Deployment

Docker:
PASS

Docker Compose:
PASS

Caddy:
PASS

DNS:
PASS

HTTPS:
PASS

ai.mddxz.top:
PASS

Production Health:
PASS

Restart Persistence:
PASS (database record and HTTPS health after container restart)


## Desktop Contract

GATEWAY_API_V1.md:
PASS

DESKTOP_INTEGRATION.md:
PASS

Desktop Auth Contract:
PASS

Device Contract:
PASS

Subscription Contract:
PASS

Usage Contract:
PASS

Gateway Contract:
PASS


============================================================
