# PRODUCTION_INTEGRATION_MANIFEST

This is the **only Desktop production integration handoff manifest**. Server/Contract ownership remains with the Server Agent. Contract changes require an explicit version review; Desktop must not edit Server source.

`SERVER_COMMIT` identifies the deployed API source commit. Later documentation-only commits do not change that image.

```text
SERVER_BASE_URL: https://ai.mddxz.top
CONTRACT_VERSION: 1.0.0
SERVER_COMMIT: 534cb791f2dc412722b1b14bc719d3e615a160eb
OPENAPI_HASH: sha256:4c72178606ecd71ec047c9618e89eff6581e489f53d80ff54f4035d7152a2d85
ACCOUNT_MANAGEMENT_URL: https://ai.mddxz.top/dashboard
TEST_ACCOUNT: production-integration@example.test
TEST_ACCOUNT_PLAN: Pro (hidden integration fixture; commercial Pro PENDING)
TEST_DEVICE_LIMIT: 3 (gate-test devices revoked; three slots available)
AVAILABLE_MODELS: mock/mock-chat (test account only; real models BLOCKED)
LATEST_RELEASE_ENDPOINT: https://ai.mddxz.top/api/v1/releases/latest
MOCK_PROVIDER: ENABLED_FOR_TEST_ACCOUNT_ONLY
REAL_PROVIDERS: Copilot=NEEDS_USER_ACTION; DeepSeek=BLOCKED (API key missing)
PRODUCTION_STATUS: PARTIAL — HTTPS and gated Mock integration verified; real-provider and commercial release BLOCKED
```

`LATEST_RELEASE_ENDPOINT` currently returns `{ "release": null }`; publishing a Desktop release is **PENDING**.

The test password is stored **outside the repository** at `C:\Users\HP\.codex\bridge-cloud-production-test.dpapi`, encrypted for the current Windows user. A Desktop Agent running as that same user can load it in process memory without printing it:

```powershell
$secure = Get-Content -LiteralPath 'C:\Users\HP\.codex\bridge-cloud-production-test.dpapi' | ConvertTo-SecureString
$credential = [pscredential]::new('production-integration@example.test', $secure)
# Pass $credential.GetNetworkCredential().Password directly to POST /api/v1/auth/login.
```

Desktop must generate a new stable random UUID for its device ID. The production test account has a live hidden Pro subscription and a three-device limit. The production gateway has passed login, device activation and revocation, account and subscription reads, `/v1/models`, JSON response, SSE completion, two sequential local tool calls with both outputs returned, and usage persistence after container restart. This is a **Mock-only** production integration path; it does not prove a real AI provider, progressive upstream streaming, payment, or commercial plan readiness.

Production rejects the fixed loopback Mock password and has no `/mock/desktop.exe` route. `X-Mock-Error-Code` is ignored in production. Public `/api/v1/plans` remains empty until commercial prices and quotas are configured. The local loopback Mock environment in [DESKTOP_INTEGRATION.md](DESKTOP_INTEGRATION.md) remains separate.
