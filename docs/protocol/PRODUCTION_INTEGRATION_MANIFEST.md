# PRODUCTION_INTEGRATION_MANIFEST

This is the **only App/Desktop production integration handoff**. Server/Contract ownership remains with the Server Agent. [api-v2.md](../api-v2.md), the generated [openapi.v2.json](openapi.v2.json), the shared Zod schemas and the deployed routes are frozen together as V2 `2.1.0`. Breaking changes require a reviewed new version.

`SERVER_COMMIT` identifies the source in the deployed API image. Documentation-only commits may be newer. No password or provider secret is stored in this repository.

```text
SERVER_BASE_URL: https://ai.mddxz.top
CONTRACT_VERSION: 2.1.0
SERVER_COMMIT: 0cb3307d9fce0ea8a5bf8ffef43e00364abf1738
DEPLOYMENT_VERSION: api-image-sha256:20a67bd8151dcd5db1c8c808485ec858532eb43c982cdfaa1661a0f509890f9a
OPENAPI_HASH: sha256:e7f84c5fb8811f4ede1aee4964a37ace8682cc3ae720ade0b5941362aff6b1c6
ACCOUNT_MANAGEMENT_URL: https://ai.mddxz.top/dashboard
TEST_ACCOUNT: production-integration@example.test
TEST_ACCOUNT_PLAN: Pro (hidden integration fixture; commercial Pro PENDING)
TEST_DEVICE_LIMIT: 3 (all occupied; reuse an existing installation UUID)
AVAILABLE_MODELS: mock/mock-chat (test account only)
LATEST_RELEASE_ENDPOINT: https://ai.mddxz.top/api/v1/releases/latest
MOCK_PROVIDER: ENABLED_FOR_TEST_ACCOUNT_ONLY
METERED_TEST_PROVIDER: mock/mock-chat; SHADOW rated usage and settlement PASS
REAL_PROVIDERS: Copilot=NEEDS_USER_ACTION; DeepSeek=BLOCKED (API key missing)
REAL_PROVIDER: BLOCKED (no real-provider production E2E)
BILLING_MODE: SHADOW (V2_BILLING_ENABLED=false; ENFORCED disabled)
TEST_WALLET: 10000 AI_POINT via idempotent TEST_GRANT ledger fixture
PRODUCTION_STATUS: PARTIAL — HTTPS, V2 Contract, referral onboarding DB tests, gated Mock, wallet/ledger/usage/rate/Shadow settlement PASS; real provider and commercial charging BLOCKED
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

Production HTTPS checks on 2026-09-24 passed auth, subscription, models, JSON Responses, SSE completion, two-step tool continuation, V2 account/wallet/usage/referral reads, and API restart persistence. A metered Mock request produced `pointsRated=1`, `pointsCharged=0`, `billingStatus=SHADOW`; `/api/v1/usage/responses/{id}` returned the same settlement and the wallet stayed at `10000`. The grant is a `TEST_GRANT` wallet transaction, and no usage debit was created. The latest release endpoint currently returns `{ "release": null }`; publishing a Desktop release is **PENDING**.

The Mock provider is gated to this exact account. Public production ignores `X-Mock-Error-Code`, rejects the fixed loopback Mock password and exposes no development Mock download route. Commercial plans remain unpublished. This integration path does **not** establish real provider usage, payment, progressive upstream streaming, or approval for `ENFORCED` point charging.
