# Production Integration Gate — 2026-09-23

Status vocabulary: **PASS**, **PARTIAL**, **BLOCKED**, **NOT_IMPLEMENTED**. `IMPLEMENTED` describes the code; `TESTED` covers automated or manual checks; `REAL_E2E` requires a live HTTPS or external-provider flow; `PRODUCTION` describes the deployed configuration. A Mock result is explicitly named and does not count as a real AI-provider E2E.

| Module | IMPLEMENTED | TESTED | REAL_E2E | PRODUCTION | Evidence / limit |
| --- | --- | --- | --- | --- | --- |
| User/Auth | PASS | PASS | PASS | PASS | Registration, browser login/logout and RBAC over HTTPS; Desktop login and refresh rotation tested. |
| Device | PASS | PASS | PARTIAL | PARTIAL | Mock limit/revoke/isolation tests; production test device activation. Restore through Admin awaits acceptance. |
| Plans | PASS | PARTIAL | PARTIAL | PARTIAL | Standard and Pro seeded; commercial plans hidden until prices and limits are set. |
| Subscription | PARTIAL | PARTIAL | PARTIAL | PARTIAL | Manual grant/cancel/upgrade routes; dedicated test Pro subscription works. Commercial lifecycle awaits E2E. |
| Entitlement | PASS | PARTIAL | PARTIAL | PARTIAL | Server enforces plan and model ACL; production Mock additionally gated by exact test email. |
| Usage | PASS | PARTIAL | PARTIAL | PARTIAL | Usage is recorded for test Mock calls; reconciliation with a real provider awaits a key. |
| Quota | PASS | PARTIAL | BLOCKED | PARTIAL | Transactional reservation and Mock quota error mapping exist; production boundary E2E pending. |
| Rate Limit | PASS | PARTIAL | PARTIAL | PARTIAL | Auth rate limiting, concurrency and RPM checks exist; load boundary not verified. |
| Billing Domain | PASS | PARTIAL | BLOCKED | PARTIAL | Order and payment-event tables exist; public plans are not commercially configured. |
| Manual Payment | PASS | PARTIAL | BLOCKED | PARTIAL | Manual order creation and admin mark-paid transaction exist; live admin payment flow pending. |
| QR Payment Contract | PARTIAL | PARTIAL | BLOCKED | PARTIAL | Order response reserves QR payload; unconnected providers reject creation. |
| Providers | PARTIAL | PARTIAL | PARTIAL | PARTIAL | Mock works; DeepSeek awaits key; Copilot awaits authorization and adapter. |
| MockProvider | PASS | PASS | PASS | PASS | Dedicated account only on production; loopback Mock remains local. |
| Copilot Provider | NOT_IMPLEMENTED | NOT_IMPLEMENTED | BLOCKED | BLOCKED | Needs reviewed GitHub integration and authorization. |
| DeepSeek Provider | PARTIAL | PARTIAL | BLOCKED | BLOCKED | Adapter exists; no API key or real upstream E2E. |
| Model Catalog | PASS | PARTIAL | PARTIAL | PARTIAL | Seeded models and ACL routes; only hidden test Mock enabled. |
| `/v1/models` | PASS | PASS | PASS | PARTIAL | Mock contract and production test account pass; no real model enabled. |
| `/v1/responses` | PASS | PASS | PASS | PARTIAL | JSON response passes with production test Mock; real provider pending. |
| SSE | PARTIAL | PARTIAL | PARTIAL | PARTIAL | Event framing passes; production gateway emits after upstream completion, not progressive upstream streaming. |
| Tool continuation | PASS | PASS | PASS | PASS | Production gated Mock completed read → write → final text and returned both local output markers over HTTPS; real provider still pending. |
| Release | PASS | PASS | PARTIAL | PARTIAL | Nullable latest-release response is frozen; no production release published. |
| Website | PASS | PASS | PASS | PASS | HTTPS Playwright at 375/768/1280/1440/1920; home, pricing, download and auth pages. |
| User Dashboard | PARTIAL | PARTIAL | PARTIAL | PARTIAL | UI and account endpoints exist; subscribed production UI acceptance pending. |
| Admin | PARTIAL | PARTIAL | PARTIAL | PARTIAL | Production administrator authenticated; dashboard, wallet, rates, referrals and cost read routes passed over HTTPS. UI/mutations await acceptance. |
| Audit | PASS | PARTIAL | PARTIAL | PASS | Registration/admin operations write audit rows; event review incomplete. |
| Docker | PASS | PASS | PASS | PASS | Four Compose services running on the server. |
| PostgreSQL | PASS | PASS | PASS | PASS | Dedicated persistent PostgreSQL 17 volume; account survived container restart. |
| Migration | PASS | PASS | PASS | PASS | Generated migration applied at API startup. |
| Backup | PASS | PASS | PARTIAL | PARTIAL | Daily systemd timer, verified custom-format dumps, 0700/0600 permissions; restore and off-host copy pending. |
| Caddy | PASS | PASS | PASS | PASS | Loopback Caddy behind existing Nginx, preserving other sites. |
| HTTPS | PASS | PASS | PASS | PASS | Public certificate validates; Nginx owns 80/443. |
| `ai.mddxz.top` | PASS | PASS | PASS | PASS | DNS, home page and `/health` verified from Windows. |

The production site is an **integration preview**, not a commercial V1 release candidate. The remaining failures in [SERVER_RELEASE_GATE.md](SERVER_RELEASE_GATE.md) are not waived by a test-only Mock result.
