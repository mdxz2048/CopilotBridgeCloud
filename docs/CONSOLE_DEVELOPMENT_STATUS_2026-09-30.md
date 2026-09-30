# Console development checkpoint — 2026-09-30

Status: **development paused; code committed for handoff, not deployed**.
The deployed production reference remains the staged V2.4 release described
in [DEPLOYMENT.md](DEPLOYMENT.md) and the
[production integration manifest](protocol/PRODUCTION_INTEGRATION_MANIFEST.md).
Do not interpret a GitHub push as permission to rebuild or roll out production.
The agreed direction is in [UI_UX_PRD.md](UI_UX_PRD.md) and
[MASTER_PRD.md](MASTER_PRD.md).

## Implemented in the working branch

- Login, returning visitors and the public header direct USER to `/dashboard`
  and ADMIN to `/admin`. The user page shows only their account state,
  invitation count, wallet balance, active device count, download entry and
  their own invite/device details. Admin navigation is separate. Existing API
  role checks remain authoritative; changing a client route is not access
  control. Admin list navigation clears old selections and guards against late
  responses when moving between sections.
- The admin user detail combines per-user devices, test subscription history,
  wallet transactions, invitation summary and payment records; admin-only
  `/api/v1/admin/users/:id/activity` supplies bounded referral/order data.
- Model creation opens the selected Provider onboarding dialog. Copilot
  reuses the existing GitHub device authorization card; DeepSeek accepts an
  encrypted server-side API key and checks Provider health. New models are
  created disabled. The model enable API now requires a ready Provider and
  still rejects public Copilot activation. Plan editing exposes model ACL
  binding, while legacy monthly fields are labeled as test compatibility.
- The public pricing page states the **intended** pay-per-use model without
  presenting legacy monthly prices or a test QR as a purchase mechanism.
  Actual billing/entitlement logic has **not** migrated to pay-per-use.
- Admin can upload a Windows executable as a streamed binary (max 512 MiB).
  The API validates the executable signature and declared size when present,
  computes SHA-256, writes outside the source tree, and creates an
  **unpublished** release. Published release IDs can be downloaded; draft
  IDs return 404. Compose persists files in `bridge_releases`.
- Admin dashboard displays 30-day Gateway/model usage separately from
  actual points charged, basic system checks, and aggregated public-page
  views. Migration `0009` adds daily page-view counters for five public pages;
  it stores no IP, account identity or raw URL. Counts are browser-reported
  page views, not unique visitors or complete reverse-proxy access logs.

## Validation at checkpoint

- Web/API/DB TypeScript checks passed. Next production build and API bundle
  completed successfully during this development session.
- Focused Vitest: release stream validator and Provider policy **4/4**;
  role-home and Copilot authorization utilities **9/9**.
- Focused Playwright: new Provider onboarding + release-upload scenarios
  **2/2** after the latest UI fix. Other changed UI scenarios were exercised
  in targeted batches; the first batch exposed outdated selectors and a
  dialog lifecycle bug, both corrected. **The entire E2E suite has not been
  rerun** since the last edits.
- No real PostgreSQL migration, authenticated browser session, large binary
  transfer, reverse-proxy limit or production deployment was exercised for
  this checkpoint. Unit/browser-mock passes do not validate those paths.

## Next work, in order

1. Re-run the full existing Playwright suite and resolve any remaining
   baseline/test expectation differences. Add tests for fast user switching,
   server-side USER/ADMIN separation and release draft/download behavior
   against a disposable PostgreSQL database. Test `0009` up and rollback
   decisions on an isolated copy; don't run it against production first.
2. Validate full upload/download with Caddy and shared-host Nginx, configure
   only the upload route for large streamed bodies, verify 512 MiB rejection,
   disk capacity, SHA-256 and download headers. Back up the release volume
   along with PostgreSQL; retain previous images for rollback. Determine
   installer signing/attestation before advertising an official download.
3. Refine the admin information architecture and accessibility using actual
   browser data: pagination/filtering for users, visits and usage, loading and
   error states, device confirmation and operator audit. Daily browser page
   views are deliberately not a complete visitor/access log; add a separate
   privacy-reviewed server access pipeline only if required.
4. Design and implement a **gated** backend transition from the old
   subscription/monthly quota/periodic point grants to no-monthly-fee
   usage-priced entitlements. Confirm payment/top-up, refunds, access without
   a dated subscription, rate disclosure and reconciliation rules before
   changing the Gateway. Production still uses SHADOW metering; no real
   online payment or automatic renewal is enabled.
5. Complete the independent Copilot integration/commercial authorization
   review and real-provider verification. Admin GitHub authentication alone
   does not enable Copilot for all customers. Finish Resend/Turnstile
   end-to-end acceptance before enabling email-verification enforcement.

No new production deployment is included in this checkpoint. The local
untracked host probe `scripts/copilot-host-probe.mjs` is deliberately **not**
part of the GitHub commit: it references local authentication material and
is unrelated to the console handoff.
