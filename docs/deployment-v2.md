# Copilot Bridge Server V2 — deployment status and runbook

Contract version `2.1.0`; live Desktop handoff: [PRODUCTION_INTEGRATION_MANIFEST.md](protocol/PRODUCTION_INTEGRATION_MANIFEST.md). The host is `linuxuser@66.245.221.236`, public base `https://ai.mddxz.top`. Existing host Nginx owns 80/443 and forwards this site to loopback Caddy; dedicated Docker Compose API, Web, Caddy and PostgreSQL 17 containers are persistent. Other host services must remain untouched.

## Actual status, 2026-09-24

| Capability | Status | Evidence/limit |
| --- | --- | --- |
| HTTPS, V1 Mock-only Desktop integration | PASS | Public auth, models, JSON/SSE responses and two-step tool continuation smoke passed. |
| V2 additive schema `0001`–`0003`, API/Web | PASS | API source `0cb3307d9fce0ea8a5bf8ffef43e00364abf1738` deployed; Web remains at prior version. Production health and V2 reads passed. |
| V2 wallet, ledger, usage and rate lookup | PASS | Test account has an audited 10000-point `TEST_GRANT`; production settlement lookup and wallet reconciliation passed. |
| Migration `0003` and expiring lot code | PASS | Full migration chain and 10 invariants passed on an isolated DB; production migration and hourly expiry timer remain active. |
| Shadow rating and settlement | PASS | `V2_BILLING_MODE=SHADOW`; HTTPS Mock E2E rated 1 point, charged 0, wallet 10000→10000, status `SHADOW`, repeat pass after API restart. |
| V2 point charging, BYOS inference, progressive upstream streaming | BLOCKED | `ENFORCED` is disabled; real provider E2E and cohort gate absent. |
| DeepSeek/Copilot real inference | BLOCKED | DeepSeek server key absent; Copilot authorization needs user action. |
| Commercial plans, real QR payment, revenue/margin | BLOCKED | Prices/merchant parameters and valuation absent; public plan list is empty. |

The V1 gateway contract is tag `gateway-api-v1.0.0` at `15ceb492349aa20cd5948b270efdfb11a730e17c`, OpenAPI SHA-256 `4c72178606ecd71ec047c9618e89eff6581e489f53d80ff54f4035d7152a2d85`. Do not change it silently. V2 `2.1.0` OpenAPI SHA-256 is `e7f84c5fb8811f4ede1aee4964a37ace8682cc3ae720ade0b5941362aff6b1c6`. Production backup `backups/bridge-20260924T071531Z.dump` was verified before rollout; `backups/bridge-20260924T072700Z.dump` succeeded after rollout. The test account's existing device was reused, with no revocation. A build exhausted disk space briefly and PostgreSQL restarted; after Docker build-residue cleanup, free space was 3.5 GB and PostgreSQL, backup, health and restart-persistence checks passed. Future builds need a disk-space preflight.

## Controlled forward rollout

1. Keep `V2_BILLING_MODE=SHADOW` and `V2_BILLING_ENABLED=false`. Confirm both pinned OpenAPI hashes, public health and all four Compose services. Require at least 3 GB free disk before building and confirm that Nginx site bindings are unchanged.
2. Apply all migrations to a disposable `bridge_v2_test_*` database and run PostgreSQL invariants: concurrent debit, idempotent grant/debit, lot expiry, invalid usage hold, rate-version pin, referral duplicate/review and Admin audit. Never run destructive test truncation on the production database.
3. Record the current API/Web image IDs and source commit. Take a new custom-format production dump and verify its archive listing and private permissions. Check preexisting V2 wallet/transaction balances before `0003`.
4. Build API/Web images from one reviewed commit. Apply `0003` with a one-off image before switching services. Preserve prior image tags and source archive for rollback.
5. Recreate only the project's API service for the V2.1 cutover. Run `/health`, production auth/device/subscription/model/JSON/SSE/tool continuation, V2 read and Shadow settlement, Admin, public Web and restart-persistence smoke. Verify `V2_BILLING_MODE=SHADOW` inside the running API.
6. Install the hourly expiry timer only after `0003` and its corresponding API code are live; run it once and inspect the exit status. Sync the canonical Desktop manifest with the actual deployed API commit. Do not advertise real providers or point billing until their separate E2E passes.

## Commercial cutover gate

Enable `ENFORCED` only after a cohort-scoped gate exists, a real provider key and valid usage/cost are tested end to end, a funded non-test wallet and rate version are reconciled, disconnect/error settlement is verified, off-host backup is tested, and App contract version `2.1.0` is accepted. The current mode is global, so it remains `SHADOW` on public production. DeepSeek needs a server credential supplied outside the repository; Copilot requires user authorization; payment methods need merchant data. Never put secrets in the manifest or repo.

## Rollback

If the new code fails while charging remains off, set `V2_BILLING_MODE=OFF` or revert only the API image to `src-api:v2-b669b60`, leaving additive schema untouched. Check both contract hashes and repeat the public smoke suite. If billed events ever exist, first disable charging and export affected requests/events/ledger, then settle with compensating transactions. A full database restore would discard subsequent users/orders/usage and requires a separate data-loss decision. See [migration-v2.md](migration-v2.md).
