# PRODUCTION_INTEGRATION_MANIFEST

This is the **only App/Desktop production integration handoff**. Server/Contract ownership remains with the Server Agent. [api-v2.md](../api-v2.md), generated [openapi.v2.json](openapi.v2.json), and shared Zod schemas describe deployed V2 `2.4.0`, with staged registration explicitly disabled. The frozen Gateway V1 `1.0.0` artifacts remain unchanged as historical evidence, but its unsigned device requests no longer work on the V2.3+ production API. This internal-test breaking cutover was explicitly accepted; do not claim that an installation key proves the official executable. No password or provider secret is stored in this repository.

## Staged V2.4 API/Web production release (2026-09-30)

The V2.4 API/Web and additive migration `0008_dear_sebastian_shaw` are deployed; **`STAGED_EMAIL_REGISTRATION_ENABLED=false`**, so legacy unverified email/password signup and web login remain active. The administrator-only 网站配置 page is live: production ADMIN GET confirmed encrypted-key presence, a configured sender of `admin@ai.mddxz.top`, and no key disclosure; a normal USER received HTTP 403. Public home, registration, API and Admin read smoke passed. Resend SMTP accepted a non-code test message from that sender to the owner's email, **not** confirmed inbox receipt or arbitrary-recipient delivery; the Resend domain was reported partially verified. Only a fake Turnstile token was checked to validate the private key, not a real widget challenge. Do not enable verification before real user email and Turnstile tests. No new production database backup was taken under the user's pre-release no-backup direction; API/Web prior image tags and source were retained for code rollback, not database rollback. The build exhausted the 23 GB volume; unused Docker build cache was pruned to restore 1.5 GB free. Preflight disk before any further build.

```text
DEPLOYED_SERVER_CONTRACT: 2.4.0 (email/Turnstile paths gated OFF; Desktop V2.3 auth compatible)
SOURCE_ARCHIVE_SHA256: 78d02a38b2cbb6ed7ffebb538eedea36ab39b83d1df7af0237924be8c4ec960e
API_IMAGE_SHA256: 6ebcdc7487bd0476801a3f495e0ca82f23c8e643702621ac13ef1d4565ca2851
WEB_IMAGE_SHA256: 33866c0fd67a3e38241607ec9a4dbd70a95cc8b944f389a987a45ee1a138ebf5
DATABASE_MIGRATION: 0008 applied; dedicated PostgreSQL migration + registration/admin tests 6/6 PASS
PREVIOUS_API_IMAGE_SHA256: 937ee4e64f2f2663defbc0e9a0bd3a3aef173da92ff6f48afb88d9bebefb9ff2
PREVIOUS_WEB_IMAGE_SHA256: 8c707dce9b96522387d0814513378a152e13179b9d6eb9df2287d2db1d93772b
OPENAPI_HASH: sha256:9b6ebcb1c30bdd854a10067b281e7ca5bf6259e19af0709d903cb0eb99417b6a
RELEASE_STATUS: INTERNAL TEST; VERIFIED EMAIL/WEB CAPTCHA OFF; payments/real-provider gates remain closed
```

## Prior V2.3 production handoff (historical)

Desktop 0.2 advertises V2.3 and retains its unchanged password/device login (no initial-login DPoP or Turnstile); its subsequent device/refresh requests remain DPoP-bound. Its unsigned installer remains local-only. The following block records the earlier V2.3 server release and is not the currently running API/Web image:

```text
SERVER_BASE_URL: https://ai.mddxz.top
CONTRACT_VERSION: 2.3.0
SERVER_COMMIT: c091b1ce04d60a9d13b235738c1addfc9d7b380d (recorded after build; exact build identified by archive/image digests)
SOURCE_ARCHIVE_SHA256: 54a6887e5580df45d9cdf792b6cbd37375f65a328f8d30096596b95286c644d5
DEPLOYMENT_VERSION: api-image-sha256:937ee4e64f2f2663defbc0e9a0bd3a3aef173da92ff6f48afb88d9bebefb9ff2
WEB_DEPLOYMENT_VERSION: web-image-sha256:8c707dce9b96522387d0814513378a152e13179b9d6eb9df2287d2db1d93772b
DATABASE_MIGRATION: 0005_loose_bloodstrike, 0006_amused_ser_duncan, 0007_cheerful_snowbird applied; isolated DB tests 17/17 PASS
OPENAPI_HASH: sha256:c9b9b6fb543ae41841b51bf026292c0eba2822c9a1464dd17fe3236efd75450e
ACCOUNT_MANAGEMENT_URL: https://ai.mddxz.top/dashboard
TEST_ACCOUNT: production-integration@example.test
TEST_ACCOUNT_PLAN: Pro (hidden integration fixture; commercial Pro PENDING)
TEST_DEVICE_LIMIT: 3 (all occupied; one legacy installation was bound to its test-only device key)
AVAILABLE_MODELS: mock/mock-chat (test account only)
LATEST_RELEASE_ENDPOINT: https://ai.mddxz.top/api/v1/releases/latest
MOCK_PROVIDER: ENABLED_FOR_TEST_ACCOUNT_ONLY
METERED_TEST_PROVIDER: mock/mock-chat; SHADOW rated usage and settlement PASS
REAL_PROVIDERS: Copilot=BLOCKED (Admin Device Flow deployed; server authentication NOT_AUTHENTICATED; real-provider E2E pending); all others OUT_OF_V1_RELEASE_GATE
REAL_PROVIDER: BLOCKED (local SDK entitlement verified; production real-provider E2E pending)
BILLING_MODE: SHADOW (V2_BILLING_ENABLED=false; ENFORCED disabled)
TEST_WALLET: 10000 AI_POINT via idempotent TEST_GRANT ledger fixture
PRODUCTION_STATUS: INTERNAL TEST — HTTPS, V2.3 DPoP, account 2/min and device 1/min new-turn policy, same-thread tool continuation, SHADOW settlement and Admin rate reads PASS; real-provider and commercial gates remain CLOSED
PENDING_CONTRACT_VERSION: 2.4.0
PENDING_OPENAPI_HASH: sha256:9b6ebcb1c30bdd854a10067b281e7ca5bf6259e19af0709d903cb0eb99417b6a
PENDING_GATEWAY_V1_OPENAPI_HASH: sha256:4c72178606ecd71ec047c9618e89eff6581e489f53d80ff54f4035d7152a2d85
PENDING_PRODUCTION_STATUS: PARTIAL (staged registration disabled; not deployed)
GATEWAY_V1_CONTRACT_VERSION: 1.0.0 (frozen documentation only, not currently accepted for Desktop auth)
GATEWAY_V1_OPENAPI_HASH: sha256:4c72178606ecd71ec047c9618e89eff6581e489f53d80ff54f4035d7152a2d85
DESKTOP_TEST_INSTALLER: 0.2.0 built locally, SHA256 f470859995fda95f45dd2a43dab66110ab5f79c76cc08c0e8fe04e39c3cf04e0, unsigned and not published
DESKTOP_SOURCE_COMMIT: dc648d8c36449b71f5431b6741c3e48a371346ae
```

The reviewed 2026-09-29 deployment remains identifiable by source archive SHA-256 `26047678958dc76f6280cf3e39d0aa08f75529f5d03f79254b7042a74f388c12`, API image `a27056c896899c7db1d4bb19c0ba25e43abbbc10d1842d38de5b7db7066123c7`, Web image `8cc16eb6c975afc0f34219bc76e29ccd3bfba392f8ec75ac44134f369f163a4a`, and later source commit `6cea3f8233ecb4aebe09bca6d910e9365ea9b576`. On 2026-09-30 the user approved deleting the old rollback image tags to free disk; no same-release database backup or quick image rollback is available.

The test password is stored **outside the repository** at `C:\Users\HP\.codex\bridge-cloud-production-test.dpapi`, encrypted for the current Windows user. An App Agent running as that user can load it in process memory without printing it:

```powershell
$secure = Get-Content -LiteralPath 'C:\Users\HP\.codex\bridge-cloud-production-test.dpapi' | ConvertTo-SecureString
$credential = [pscredential]::new('production-integration@example.test', $secure)
# Pass $credential.GetNetworkCredential().Password directly to POST /api/v1/auth/login.
```

The three device slots are occupied. A pre-existing installation UUID `e6478afb-4719-4359-b57f-e446b3861629` was bound once to an isolated Windows-user credential target for the signed internal-test probe. Reusing that ID with a different key now fails; do not revoke another installation or re-enroll a key silently. The App must persist its own stable random installation UUID and private key for normal use.

Production HTTPS checks on 2026-09-30 passed V2.3 signed test-device login/refresh, account/device/wallet reads, JSON Responses, same-thread tool continuation under the 1/min device cap, rejection of another new turn with `RATE_LIMITED`, and unchanged wallet in `SHADOW`. The signed tool/refresh check passed again after an API restart. Admin reads returned the configured defaults (account 2/min, device 1/min, public IP 60/min, auth IP 10/min). The isolated PostgreSQL migration chain and all 17 database tests passed before production migration `0005`–`0007`; local signed SSE and Remote Bridge tool E2E passed. Real Windows installer use, simultaneous live provider tools, real Copilot inference and payment are not validated. The latest release endpoint still returns `{ "release": null }`; the unsigned Desktop test installer remains local-only.

The Mock provider is gated to this exact account. Public production ignores `X-Mock-Error-Code`, rejects the fixed loopback Mock password and exposes no development Mock download route. Commercial plans remain unpublished. This integration path does **not** establish real provider usage, payment, progressive upstream streaming, or approval for `ENFORCED` point charging.
