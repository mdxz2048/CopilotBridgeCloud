# Copilot V1 production operations

The production release gate includes only the managed `Copilot Bridge Cloud` provider. Billing remains `SHADOW`. The server routes `/v1/responses` through the provider router, Copilot SDK adapter, usage capture, rate card and settlement. The production catalog exposes only models enabled after actual account discovery and request verification.

## Authentication and entitlement

GitHub authentication and Copilot entitlement are separate checks. Import first calls GitHub `/user` with the token, then asks the official Copilot SDK for the authenticated account's models and requires the chosen model to be enabled. A real prompt with that model is the final entitlement proof. An authenticated GitHub login alone does not pass the gate.

The current operator's Windows Copilot CLI credential is stored in Windows Credential Manager. To renew it manually when needed:

1. In a trusted operator terminal, run `copilot login --device-code` (or run `copilot login` and choose device authentication).
2. Open the displayed GitHub device authorization URL, enter the one-time code shown in that terminal and authorize the account that has Copilot access.
3. Run `pwsh -NoProfile -File scripts/copilot-credential-transfer.ps1 -Mode Probe` to validate a real SDK model call. The script prints model IDs and usage, never the token.
4. Run `pwsh -NoProfile -File scripts/copilot-credential-transfer.ps1 -Mode Import` to pass the token over SSH standard input to the API container. The importer validates GitHub authentication and Copilot model entitlement, then stores the token encrypted with AES-256-GCM in PostgreSQL.

No provider token is placed in Git, App responses, command arguments, API logs or a plain configuration file. The encryption master key is a separately managed production secret. The importer emits only stable failure codes; renew the token if `COPILOT_AUTH_EXPIRED` occurs. Restrict this operator workflow and review the `COPILOT_CREDENTIAL_IMPORTED` audit record after rotation.

As of 2026-09-24, the existing Windows credential passes a real local SDK request but the server SDK reports `isAuthenticated=false` after transfer. GitHub `/user` succeeds on the server, so GitHub identity alone is insufficient. The credential importer correctly rejects it and does not store it. A server-specific device authorization and real server SDK request are still required; do not mark the production entitlement or Shadow gate as passed from the local result.

## Usage and rating

`assistant.usage` events supply reported model, input/output tokens, optional cache-read/cache-write/reasoning counters and upstream request identifiers. Missing required input/output counters cause `COPILOT_USAGE_UNAVAILABLE`; no text-length token approximation is made. `cost` is a Copilot premium multiplier, not a currency value. See [billing-v2.md](billing-v2.md) for the exact Copilot V1 AI Point rate card and Shadow settlement policy.
