# Differential distribution acceptance — 2026-10-19

Cloud implementation supports bounded electron-builder v2 sidecars, exact single byte ranges with strong ETag/If-Range, version lookup, and a three-version stable retention window. Full executable SHA-256 remains authoritative. No database migration is added by this feature.

Local validation: API typecheck/build passed. Full API unit suite passed 157 tests; 65 existing database tests were skipped when no isolated database URL was configured. Six targeted installer/route tests passed. Route tests use isolated temporary files and mocked database/authentication, and are distinguished from the real database checks below.

Real PostgreSQL checks ran in a disposable database `bridge_v2_test_diff_20261019045107` on the existing PostgreSQL service. A separate ephemeral container used candidate source files, all migrations, one Vitest worker, and a 512 MiB memory cap. All three integration tests passed with no skips:

1. Actual SQL lookup excludes unpublished, beta and non-x64 records. Only the published stable Windows x64 row is returned; unpublishing removes public access.
2. Real administrator cookie authentication uploads a draft sidecar. A PostgreSQL transaction locks the release row; `pg_stat_activity` confirms another PUT waits for its lock. Publishing and committing first causes the waiting PUT to return 409, preserving the existing sidecar. An already-published legacy installer lacking a sidecar accepts its first valid attachment, records `publishedBackfill: true` in the audit log, and rejects replacement with 409.
3. Seven out-of-order stable semantic versions retain exactly the newest three. Both installer and sidecar of the four obsolete managed releases are deleted. Drafts, beta releases and the official-client ZIP sentinel remain untouched. Retained by-version queries succeed; obsolete versions return 404.

The test container, staged source directory and independent database were removed in `finally`; the cleanup completed successfully. Production business tables, wallets and accounts were not modified. Only synthetic `@example.test` fixtures were used inside the independent database. No production API container was replaced and no release was published during this verification.

The earlier five-version design was reduced to three after checking 2.5 GiB free server disk space. Three current-sized installers require about 1 GB; clients outside the retained bootstrap window automatically need the full-download fallback unless they already saved a verified local baseline.

The isolated checks above do not claim production behavior. Production verification subsequently completed as recorded below; actual NSIS execution and official desktop restart remain unperformed.

## Production verification

API image `7b6934bae4697eabfa1294c8be659f2176897c99247fd0a76b83339428a094ae` deployed with all three source hashes verified. Web, PostgreSQL and Caddy images were unchanged; no migration or production environment-file edits. Health remained normal.

The existing published 0.3.25 release accepted its first administrator blockmap attachment. Public sidecar SHA matched the upload result, and repeating the upload returned 409. Temporary administrator sessions were deleted in `finally`.

App 0.3.26 was uploaded with blockmap before publishing. Latest and minimum version both read 0.3.26. Actual compiled App UpdateManager ran against public HTTPS through nginx/Caddy/API: eight Range requests transferred 1,025,887 installer bytes plus 695,803 map bytes, reconstructed the 343,429,580-byte installer to the exact release SHA and reached READY without a full download. A second check used cache with no new download. Injecting one corrupt range caused an automatic 343,429,580-byte full download; SHA and READY passed again. Public 206, 416 and stale If-Range/200 behavior passed.

An additional Windows run used the existing native NSIS cache and public HTTPS, with the same eight ranges and exact final SHA, no full download. Neither run executed an installer or changed the user's official client configuration. New delta-capable behavior applies from 0.3.26 onward; old clients still bootstrap this first version with a full download.

See `differential-production-20261019.json`, `differential-deployment-20261019.json`, `differential-base-map-20261019.json`, and App `docs/evidence/20261019-differential/windows-public.json`.
