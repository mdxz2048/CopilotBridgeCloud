# Copilot Bridge Server V2 — deployment status and runbook

Contract version `2.1.0`; live Desktop handoff: [PRODUCTION_INTEGRATION_MANIFEST.md](protocol/PRODUCTION_INTEGRATION_MANIFEST.md). The host is `linuxuser@66.245.221.236`, public base `https://ai.mddxz.top`. Existing host Nginx owns 80/443 and forwards this site to loopback Caddy; dedicated Docker Compose API, Web, Caddy and PostgreSQL 17 containers are persistent. Other host services must remain untouched.

## Actual status, 2026-09-24

| Capability | Status | Evidence/limit |
| --- | --- | --- |
| HTTPS, V1 Mock-only Desktop integration | PASS | Public auth, models, JSON/SSE responses and two-step tool continuation smoke passed. |
| V2 additive schema `0001`–`0003`, API/Web | PASS | Deployed source commit `b669b60acb49cdc95bee526c75ff3cefbc60f1bc`; production health and Admin read routes passed. |
| V2 wallet/usage reads | PASS | Production read smoke passed; point charging remains disabled. |
| Migration `0003` and expiring lot code | PASS | Full migration chain and eight invariants passed on isolated DB; production migration and hourly expiry timer succeeded. Public point charging remains off. |
| V2 point charging, BYOS inference, progressive upstream streaming | BLOCKED | Global `V2_BILLING_ENABLED=false`; real provider E2E and cohort gate absent. |
| DeepSeek/Copilot real inference | BLOCKED | DeepSeek server key absent; Copilot authorization needs user action. |
| Commercial plans, real QR payment, revenue/margin | BLOCKED | Prices/merchant parameters and valuation absent; public plan list is empty. |

The V1 gateway contract is tag `gateway-api-v1.0.0` at `15ceb492349aa20cd5948b270efdfb11a730e17c`, OpenAPI SHA-256 `4c72178606ecd71ec047c9618e89eff6581e489f53d80ff54f4035d7152a2d85`. Do not change it silently. The deployed V2 API/Web commit above is distinct from later documentation commits. Production backup `backups/bridge-20260924T034328Z.dump` is a verified 0600 custom-format archive (210 archive-list lines). Pre-migration V2 wallet transactions and nonzero wallets were both zero. After rollout, public Desktop Mock and Admin smoke passed; API/Web restart preserved users and usage; public Playwright passed. The test account's existing device was reused, with no revocation.

## Controlled forward rollout

1. Keep `V2_BILLING_ENABLED=false`. Confirm V1 OpenAPI hash, public health and all four Compose services. Confirm free disk and that Nginx site bindings are unchanged.
2. Apply all migrations to a disposable `bridge_v2_test_*` database and run PostgreSQL invariants: concurrent debit, idempotent grant/debit, lot expiry, invalid usage hold, rate-version pin, referral duplicate/review and Admin audit. Never run destructive test truncation on the production database.
3. Record the current API/Web image IDs and source commit. Take a new custom-format production dump and verify its archive listing and private permissions. Check preexisting V2 wallet/transaction balances before `0003`.
4. Build API/Web images from one reviewed commit. Apply `0003` with a one-off image before switching services. Preserve prior image tags and source archive for rollback.
5. Recreate only the project's API/Web services. Run `/health`, production auth/device/subscription/model/JSON/SSE/tool continuation, V2 read, Admin, public Web and restart-persistence smoke. Verify `V2_BILLING_ENABLED=false` inside the running API.
6. Install the hourly expiry timer only after `0003` and its corresponding API code are live; run it once and inspect the exit status. Sync the canonical Desktop manifest with the actual deployed API commit. Do not advertise real providers or point billing until their separate E2E passes.

## Commercial cutover gate

Enable V2 billing only after a cohort-scoped flag exists, a real provider key and valid usage/cost are tested end to end, a funded non-test wallet and rate version are reconciled, disconnect/error settlement is verified, off-host backup is tested, and App contract version `2.0.0` is accepted. The current flag is global, so it remains false on public production. DeepSeek needs a server credential supplied outside the repository; Copilot requires user authorization; payment methods need merchant data. Never put secrets in the manifest or repo.

## Rollback

If the new code fails while billing remains off, revert only the API/Web images and matching source artifact, leaving additive schema untouched. Check the V1 gateway hash and repeat the public smoke suite. If billed events ever exist, first disable billing and export affected requests/events/ledger, then settle with compensating transactions. A full database restore would discard subsequent users/orders/usage and requires a separate data-loss decision. See [migration-v2.md](migration-v2.md).
