# DEVELOPMENT HANDOFF — 2026-09-23

| Gate | Status | Scope |
| --- | --- | --- |
| SERVER CONTRACT | PASS | Gateway API V1 `1.0.0`, tag `gateway-api-v1.0.0`, pinned OpenAPI hash and contract tests. |
| PRODUCTION HTTPS | PASS | Public certificate and `/health` verified. |
| PRODUCTION AUTH | PASS | Registration, browser login/logout and Desktop test login over HTTPS. |
| PRODUCTION DEVICE | FAIL | Test account activation and revoke pass; production device-limit and Admin restore acceptance pending. |
| PRODUCTION SUBSCRIPTION | FAIL | Hidden test Pro subscription works; commercial plans and lifecycle acceptance pending. |
| PRODUCTION USAGE | PASS | Gated Mock requests persisted usage records across container restart; real-provider usage awaits key. |
| PRODUCTION MODELS | PASS | Dedicated test account sees `mock/mock-chat`; no commercial model enabled. |
| PRODUCTION RESPONSES | PASS | JSON response works for the gated Mock account over HTTPS. |
| PRODUCTION SSE | FAIL | SSE framing passes; progressive real-provider streaming is not implemented. |
| PRODUCTION TOOL CONTINUATION | PASS | Production gated Mock completed read → write → final answer with both local outputs. |
| WEBSITE | PASS | Public pages and five viewport widths passed production Playwright. |
| USER DASHBOARD | PARTIAL | UI and account data exist; subscribed UI acceptance pending. |
| ADMIN | PARTIAL | Routes/UI exist; initial production admin still needs terminal bootstrap and live acceptance. |
| BILLING | PARTIAL | Manual order and mark-paid transaction exist; commercial plan and payment E2E pending. |
| REAL PROVIDER | BLOCKED | DeepSeek API key absent; Copilot requires approved integration and user authorization. |
| ai.mddxz.top | PASS | DNS, Nginx, loopback Caddy, Web, API, PostgreSQL and HTTPS verified. |

**Server source commit:** `534cb791f2dc412722b1b14bc719d3e615a160eb`.

**Contract version:** `1.0.0`; **OpenAPI SHA-256:** `4c72178606ecd71ec047c9618e89eff6581e489f53d80ff54f4035d7152a2d85`.

Desktop may use the [PRODUCTION_INTEGRATION_MANIFEST](../protocol/PRODUCTION_INTEGRATION_MANIFEST.md). Desktop owns only its client changes; Server/Contract changes require this Server owner and an explicit versioned contract review. Public Mock controls and fixed test passwords remain disabled. The overall commercial Release Gate is **FAIL** until the remaining acceptance items pass.
