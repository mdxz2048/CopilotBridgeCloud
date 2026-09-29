# Copilot Bridge Server V2 — deployment status and runbook

Current contract version `2.2.0`; live Desktop handoff: [PRODUCTION_INTEGRATION_MANIFEST.md](protocol/PRODUCTION_INTEGRATION_MANIFEST.md). The host is `linuxuser@66.245.221.236`, public base `https://ai.mddxz.top`. Existing host Nginx owns 80/443 and forwards this site to loopback Caddy; dedicated Docker Compose API, Web, Caddy and PostgreSQL 17 containers are persistent. Other host services must remain untouched.

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

## 2026-09-29 API/Web rollout and incremental migration `0004`

**DEPLOYED, with commercial and real-provider gates still closed.** The reviewed deployment came from source archive SHA-256 `26047678958dc76f6280cf3e39d0aa08f75529f5d03f79254b7042a74f388c12`; commit `6cea3f8233ecb4aebe09bca6d910e9365ea9b576` recorded matching API/Web runtime code afterward, with documentation and a production-origin browser test correction. API and Web images were switched together; their deployed digests are recorded in the [production integration manifest](protocol/PRODUCTION_INTEGRATION_MANIFEST.md). The archive and image digests, not the later commit, identify the exact build. Do not attribute this release to the older API commit in the 2026-09-24 history above.

The full migration chain and PostgreSQL tests passed **14/14 on an isolated database** before the incremental `0004_dear_gressill.sql` production migration and API/Web cutover. `0004` adds `devices.auth_version` with default `0`: old device JWTs without the claim remain compatible while the stored version is `0`; revocation and Admin status transitions invalidate old device credentials, and restoration requires a new login. Production health, Admin reads, gated Mock JSON/SSE and two-step tool continuation, SHADOW settlement (`pointsRated=1`, `pointsCharged=0`), unchanged 10000-point test wallet, and API restart persistence passed. This does **not** verify real Copilot inference or payment.

The user explicitly waived a **new DB backup for this rollout**; none was taken for the 2026-09-29 migration. Earlier 2026-09-24 dumps are historical, not a rollback point for this release. Previous API **and** Web Docker tags were retained for code rollback, but there is no same-release database restore point; do not describe image rollback as a database recovery guarantee. Remaining disk space after deployment was approximately **1.58 GB**: clean up and recheck free space before any further image build or deployment.

Copilot GitHub OAuth reports `NOT_AUTHENTICATED` in production; Copilot Provider/real-provider E2E remain blocked. `ENFORCED` remains disabled (`V2_BILLING_MODE=SHADOW`, `V2_BILLING_ENABLED=false`). The new website QR opens a test activation information page: it is **not a payment QR** and creates no real payment, order or automatic subscription. Real payment is unconnected. `/api/v1/releases/latest` returns `{ "release": null }`; no Desktop release is published.

## Controlled forward rollout

1. Keep `V2_BILLING_MODE=SHADOW` and `V2_BILLING_ENABLED=false`. Confirm the pinned contract hashes, public health and all four Compose services. Disk was about 1.58 GB after this rollout: clean up and require at least 3 GB free before building; confirm shared-host bindings.
2. Apply **future pending** migrations only to a disposable `bridge_v2_test_*` database first and run the relevant PostgreSQL invariants. The `0004` chain already passed 14/14 on an isolated DB; never run destructive test truncation on production.
3. Record the running API/Web image IDs and source artifact/commit mapping. For future deployments, take and verify a new production DB backup unless a new, explicit risk decision waives it; the 2026-09-29 waiver did not create a DB rollback point.
4. Build API/Web images from one reviewed source artifact. Apply only migrations not yet present **before** starting the API code that needs them; `0004` was applied on 2026-09-29. Preserve previous API/Web tags and source archive for rollback.
5. Switch only this project's services as reviewed. Run `/health`, authorized auth/device/subscription/model/JSON/SSE/tool continuation, V2 reads and Shadow settlement, Admin, public Web and restart-persistence smoke. Verify `V2_BILLING_MODE=SHADOW` inside the running API.
6. Confirm the existing hourly expiry timer continues to run. Sync the Desktop manifest with the deployed image digests and archive fingerprint. Do not advertise real providers or point billing until their separate E2E passes.

## Commercial cutover gate

Enable `ENFORCED` only after a cohort-scoped gate exists, a real provider key and valid usage/cost are tested end to end, a funded non-test wallet and rate version are reconciled, disconnect/error settlement is verified, off-host backup is tested, and App contract version `2.2.0` is accepted. The current mode is global, so it remains `SHADOW` on public production. DeepSeek needs a server credential supplied outside the repository; Copilot requires user authorization; payment methods need merchant data. Never put secrets in the manifest or repo.

## Rollback

For the 2026-09-29 release, revert to the **retained previous API and Web tags together** (identify the exact tags/digests before acting) and leave additive migration `0004` intact. Do not assume the much older `src-api:v2-b669b60` tag is the immediate predecessor. Keep charging in `SHADOW` or, if necessary, set `V2_BILLING_MODE=OFF`; check both contract hashes and repeat smoke tests. **No fresh DB backup was taken for this rollout**, so Docker rollback cannot restore pre-migration database contents. If billed events ever exist, first disable charging and export affected requests/events/ledger, then settle with compensating transactions. A full database restore would discard subsequent users/orders/usage and requires a separate data-loss decision. See [migration-v2.md](migration-v2.md).
