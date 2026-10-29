# 0.3.31 production release

This release follows public 0.3.30. Preview-only 0.3.32 evidence records an earlier local build and is not the public release number. App 0.3.31 adds device-first consumption, user feedback and clearer administrator user management. Domain 2.11.0 is additive; desktop handshake remains 2.3.0 and minimum compatible App remains 0.3.28.

Migration `0018_gray_senator_kelly` creates encrypted feedback storage. Consumption reads do not change settlement or wallet writes. Existing `/api/v1/me/bills` stays compatible. Feedback supports owner-scoped creation/history, administrator filtering and optimistic state updates. User management groups status, balance, plan, models and devices.

API image: `sha256:a2a4a4a34227923965a98ca6d5c1a753b93a3cc9f1e181de95451d5f7039f568`.
Web image: `sha256:cce14aaf30d0b943d99e8cea45e51fbd68fd25f615247e0d3a41add08a55b772`.

The original cold local Docker build could not reach Docker Hub. Deployment instead verified the normalized lockfile and every workspace package manifest against the running API image, reused that exact dependency environment, copied all reviewed App/shared Cloud sources and rebuilt API plus Web. Web used the standalone production output on the cached Node Linux image. Candidate API and Web passed before replacement; source hashes were checked from the reviewed archive. No dependency changes were introduced. Disk recovery removed obsolete Bridge Web builds and dangling images, preserving running images, database, volumes and official installers. The previous API/Web image tags remain available.

Two checks confirmed zero active model requests for the running API incarnation before migration/replacement. Postgres and Caddy container images remained unchanged. Candidate production-DB checks covered consumption reads, cross-owner denial, anonymous/admin authorization, user summary fields and synthetic feedback creation → administrator read → resolved state. The synthetic feedback and temporary sessions were removed; no financial mutations were requested. Existing audit records retain the synthetic feedback status action.

Validation: API 210 unit tests; 45 independent local PostgreSQL tests across V2, admin/feedback and consumption; Web 19; contract 10; App 301 full, 61 subsequent UI regression, and 48 formal-build focused tests. Source and packaged renderer/main resources matched. The actual UpdateManager downloaded the published 0.3.31 installer over public HTTPS and verified SHA256 to READY, without installing it. Public configuration reports latest 0.3.31, minimum 0.3.28 and maintenance false.

The version-gate checks use signed fixtures and do not certify every historical binary's official GUI inference. No new paid model inference was initiated for this read/UI change. The earlier real installed Preview IPC/UI evidence is retained separately. Production admin browser verification uses an expiring maintenance session and makes no real user account changes; screenshots containing real user identities stay outside Git.

Release installer: 343,680,750 bytes; SHA256 `d9d4eca147b8cce7f6653162ea864f7757139cd4c8021f85a71555ee12cc830a`; release ID `71ccaad0-f16c-4f8b-b3ff-75ca4bc6b1be`. Evidence: `docs/acceptance/release-0.3.31/`. Git uses the existing `codex/ued-v3-1-implementation` branch for both repositories; no force push or main-branch rewrite.

Public production browser verification passed for the redesigned user list, all five management categories and the feedback workbench. No account changes or script errors occurred; real-user screenshots are excluded from Git.
