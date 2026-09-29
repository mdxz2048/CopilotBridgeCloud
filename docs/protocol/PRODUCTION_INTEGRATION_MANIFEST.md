# PRODUCTION_INTEGRATION_MANIFEST

This is the **only App/Desktop production integration handoff**. Server/Contract ownership remains with the Server Agent. [api-v2.md](../api-v2.md), the generated [openapi.v2.json](openapi.v2.json), the shared Zod schemas and the deployed routes are frozen together as V2 `2.2.0`. Breaking changes require a reviewed new version.

The 2026-09-29 deployment was built from a reviewed source archive before commit `6cea3f8233ecb4aebe09bca6d910e9365ea9b576` was created. The archive SHA-256 and image digests identify the exact build; the later commit records matching API/Web runtime code plus documentation and a production-origin browser test correction. No password or provider secret is stored in this repository.

```text
SERVER_BASE_URL: https://ai.mddxz.top
CONTRACT_VERSION: 2.2.0
SERVER_COMMIT: 6cea3f8233ecb4aebe09bca6d910e9365ea9b576 (recorded after build; use archive/image digests for exact artifact)
SOURCE_ARCHIVE_SHA256: 26047678958dc76f6280cf3e39d0aa08f75529f5d03f79254b7042a74f388c12
DEPLOYMENT_VERSION: api-image-sha256:a27056c896899c7db1d4bb19c0ba25e43abbbc10d1842d38de5b7db7066123c7
WEB_DEPLOYMENT_VERSION: web-image-sha256:8cc16eb6c975afc0f34219bc76e29ccd3bfba392f8ec75ac44134f369f163a4a
DATABASE_MIGRATION: 0004_dear_gressill applied; isolated database tests 14/14 PASS
OPENAPI_HASH: sha256:c8039a458af1adf9af9863c2bce6d54c729c5bbc71bf173778ad4072cc7de090
ACCOUNT_MANAGEMENT_URL: https://ai.mddxz.top/dashboard
TEST_ACCOUNT: production-integration@example.test
TEST_ACCOUNT_PLAN: Pro (hidden integration fixture; commercial Pro PENDING)
TEST_DEVICE_LIMIT: 3 (all occupied; reuse an existing installation UUID)
AVAILABLE_MODELS: mock/mock-chat (test account only)
LATEST_RELEASE_ENDPOINT: https://ai.mddxz.top/api/v1/releases/latest
MOCK_PROVIDER: ENABLED_FOR_TEST_ACCOUNT_ONLY
METERED_TEST_PROVIDER: mock/mock-chat; SHADOW rated usage and settlement PASS
REAL_PROVIDERS: Copilot=BLOCKED (Admin Device Flow deployed; server authentication NOT_AUTHENTICATED; real-provider E2E pending); all others OUT_OF_V1_RELEASE_GATE
REAL_PROVIDER: BLOCKED (local SDK entitlement verified; production real-provider E2E pending)
BILLING_MODE: SHADOW (V2_BILLING_ENABLED=false; ENFORCED disabled)
TEST_WALLET: 10000 AI_POINT via idempotent TEST_GRANT ledger fixture
PRODUCTION_STATUS: PARTIAL — HTTPS, V2.2 Contract, gated Mock Shadow settlement, API/Web and Admin read smoke PASS; server Copilot authentication and real-provider E2E BLOCKED; ENFORCED remains disabled
GATEWAY_V1_CONTRACT_VERSION: 1.0.0
GATEWAY_V1_OPENAPI_HASH: sha256:4c72178606ecd71ec047c9618e89eff6581e489f53d80ff54f4035d7152a2d85
```

The test password is stored **outside the repository** at `C:\Users\HP\.codex\bridge-cloud-production-test.dpapi`, encrypted for the current Windows user. An App Agent running as that user can load it in process memory without printing it:

```powershell
$secure = Get-Content -LiteralPath 'C:\Users\HP\.codex\bridge-cloud-production-test.dpapi' | ConvertTo-SecureString
$credential = [pscredential]::new('production-integration@example.test', $secure)
# Pass $credential.GetNetworkCredential().Password directly to POST /api/v1/auth/login.
```

The three device slots are occupied. Reuse the previously registered installation UUID `e6478afb-4719-4359-b57f-e446b3861629` for automated integration tests; do not revoke another installation silently. The App must persist its own stable random installation UUID for normal use.

Production HTTPS checks on 2026-09-29 passed auth on the existing test device, subscription, models, JSON Responses, SSE completion, two-step tool continuation, V2 account/wallet/usage/referral reads, Admin reads, and API restart persistence. The isolated PostgreSQL migration chain and all 14 database tests passed before the production `0004` migration. A metered Mock request produced `pointsRated=1`, `pointsCharged=0`, `billingStatus=SHADOW`; `/api/v1/usage/responses/{id}` returned the same settlement and the wallet stayed at `10000`. The grant is a `TEST_GRANT` wallet transaction, and no usage debit was created. The latest release endpoint still returns `{ "release": null }`; publishing a Desktop release is **PENDING**.

The Mock provider is gated to this exact account. Public production ignores `X-Mock-Error-Code`, rejects the fixed loopback Mock password and exposes no development Mock download route. Commercial plans remain unpublished. This integration path does **not** establish real provider usage, payment, progressive upstream streaming, or approval for `ENFORCED` point charging.
