# PRODUCTION_INTEGRATION_MANIFEST

This is the **only Desktop production integration handoff manifest**. Server/Contract ownership remains with the Server Agent. Contract changes require an explicit version review; Desktop must not edit Server source.

`SERVER_COMMIT` identifies the deployed API source commit. Later documentation-only commits do not change that image.

```text
SERVER_BASE_URL: https://ai.mddxz.top
CONTRACT_VERSION: 1.0.0
SERVER_COMMIT: d02a961f83e3af3f6b788f04ae0f4757f3775ed8
OPENAPI_HASH: sha256:4c72178606ecd71ec047c9618e89eff6581e489f53d80ff54f4035d7152a2d85
ACCOUNT_MANAGEMENT_URL: https://ai.mddxz.top/dashboard
TEST_ACCOUNT: production-integration@example.test
TEST_ACCOUNT_PLAN: Pro (hidden integration fixture; commercial Pro PENDING)
TEST_DEVICE_LIMIT: 3 (all three currently active; reuse an existing registered installation or free a slot through account management)
AVAILABLE_MODELS: mock/mock-chat (test account only; real models BLOCKED)
LATEST_RELEASE_ENDPOINT: https://ai.mddxz.top/api/v1/releases/latest
MOCK_PROVIDER: ENABLED_FOR_TEST_ACCOUNT_ONLY
REAL_PROVIDERS: Copilot=NEEDS_USER_ACTION; DeepSeek=BLOCKED (API key missing)
PRODUCTION_STATUS: PARTIAL — HTTPS, gated Mock integration and additive V2 schema deployed; V2 point billing DISABLED; real-provider and commercial release BLOCKED
```

`LATEST_RELEASE_ENDPOINT` currently returns `{ "release": null }`; publishing a Desktop release is **PENDING**.

The test password is stored **outside the repository** at `C:\Users\HP\.codex\bridge-cloud-production-test.dpapi`, encrypted for the current Windows user. A Desktop Agent running as that same user can load it in process memory without printing it:

```powershell
$secure = Get-Content -LiteralPath 'C:\Users\HP\.codex\bridge-cloud-production-test.dpapi' | ConvertTo-SecureString
$credential = [pscredential]::new('production-integration@example.test', $secure)
# Pass $credential.GetNetworkCredential().Password directly to POST /api/v1/auth/login.
```

Desktop must generate a stable random UUID for its device ID and persist it. The production test account has a live hidden Pro subscription and a three-device limit. All three slots were occupied on 2026-09-24 by registered Desktop installations; another new installation will receive `DEVICE_LIMIT_REACHED` until a slot is freed. Do not silently revoke a Desktop installation. The production gateway has passed login, account and subscription reads, `/v1/models`, JSON response, SSE completion, two sequential local tool calls with both outputs returned, and V2 wallet read after the additive deployment. Earlier V1 testing also verified usage persistence after restart. This is a **Mock-only** production integration path; it does not prove a real AI provider, progressive upstream streaming, payment, or commercial plan readiness.

Production rejects the fixed loopback Mock password and has no `/mock/desktop.exe` route. `X-Mock-Error-Code` is ignored in production. Public `/api/v1/plans` remains empty until commercial prices and quotas are configured. The local loopback Mock environment in [DESKTOP_INTEGRATION.md](DESKTOP_INTEGRATION.md) remains separate.
