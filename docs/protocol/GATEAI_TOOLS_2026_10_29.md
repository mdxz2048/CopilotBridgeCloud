# GateAI native Responses tool compatibility — 2026-10-29

This API-only fix was deployed on 2026-10-29 after explicit user authorization. It is not an official Codex GUI acceptance report. GateAI is an OpenAI-compatible supplier, separate from DeepSeek. Keep the existing logical IDs, `responsesProfile: openai`, credentials, model permissions and prices. Do not apply DeepSeek wrappers, tool-name repairs or protocol recovery to this route.

## Confirmed cause and change

The 0860 diagnostic snapshot retained five GPT requests with `tools: []` and 13 executable definitions inside native `input.additional_tools`, including namespace/custom execution and browser tools. The Cloud prepared-request snapshot was captured before the supplier adapter, so it did not expose the subsequent mutation.

GateAI has the existing connection option `emptyToolsWorkaround: true`. The previous OpenAIProvider code examined only the top-level list, inserted a disabled placeholder and forced `tool_choice: none`. That explicitly suppressed the tools that were already declared in the input. Earlier successful direct HTTP probes bypassed this adapter and therefore could not exclude a Bridge defect. The synthetic baseline through the actual adapter reproduced a completed response with no expected tool call.

The candidate checks nonempty native `additional_tools` inventories before applying the existing empty-list workaround. It preserves their position, namespaces, native custom grammar, choice, call IDs, events, history and tool results; no tool promotion, name rewriting, execution or automatic paid retry is introduced. Truly empty tool requests still get the disabled compatibility placeholder. Explicit `tool_choice: none` remains none, and unexpected placeholder execution still fails.

Only `apps/api/src/openai-provider.ts` production code changes. The compatibility check affects only connections that already opt into `emptyToolsWorkaround`. App production code, DeepSeek production code, shared native Responses transport and contract are unchanged.

## Actual supplier and model inventory

The configured endpoint is GateAI. The enabled logical/model binding is `openai/gpt-6-sol` → `gpt-6-sol`. `openai/gpt-6.1-sol` → `gpt-6.1-sol` exists but is disabled. Both model IDs were tested directly through the candidate provider adapter, using only synthetic fixtures and the existing supplier credential in server memory. Testing the disabled model does not enable or reassign it. No models, wallets, permissions, prices or provider settings were changed.

## Verification and limits

The live matrix covers 17 cases for GPT-6 Sol and 18 for GPT-6.1 Sol: JSON and SSE functions, namespace functions/custom tools, additional function/custom tools, mixed inventories, required/named choices, native Lark custom wrapper input, two calls with two results, a roughly 51 KB tool result, content-array results, an explicit tool error result, three sequential tool rounds, ordinary no-tool generation, explicit tool disabling and one GPT-6.1 reasoning-mode request. Tools return fixed synthetic data and random markers; model-generated commands are never executed. A successful reasoning-mode request does not establish that the supplier actually performed reasoning.

Each of the 35 cases has a successful result. Preserve these qualifications:

- An initial parallel-call checker incorrectly required incremental argument chunks. GateAI sends complete `arguments.done` without delta events for these calls; the payloads match the final calls. The corrected checker and local App integration both pass, with both call IDs and results retained. No production SSE normalization was needed.
- One GPT-6.1 long-result request failed to reproduce the marker, and the supplier reported 2,550 output tokens despite a requested 384-token cap. The repeat passed. The failure remains in the evidence and is not a resolved supplier-reliability claim. No extra generation was added to production to hide it.
- The baseline namespace/custom fixture also had a raw-input assertion failure before its prompt was made explicit. It is a fixture/model input mismatch, not evidence of a protocol transport failure. The baseline additional-tools case independently demonstrates the disabling defect.

API typecheck/build passed. API tests: 198 passed, 76 database tests skipped and not claimed as executed. Existing App protocol tests: 26 passed. Two additional synthetic integration tests exercise the actual compiled App local bridge plus candidate Cloud adapter: native additional custom-tool SSE/output-only continuation, and parallel arguments.done calls with reversed result order and a 126 KB result. They pass without App code changes. This mock supplier integration is separate from the real supplier matrix and is not official GUI acceptance.

Live diagnostic traffic was 80 supplier POSTs, 406,998 reported input tokens and 3,978 reported output tokens across the recorded baseline/matrix/parallel investigation/confirmation runs. Direct supplier tests did not debit user wallets; supplier cost is not verified. No private task was replayed.

Evidence: [gateai-tools-20261029.json](../acceptance/gateai-tools-20261029.json). Historical failures and confirmation runs are both retained. The initial matrix phase did not deploy. Public release policy was read as latest 0.3.30 / minimum 0.3.28; this compatible API-only change does not require an App update or a minimum-version increase.

## Authorized deployment and public acceptance

The user subsequently reported another no-tool response at 11:10 Beijing time. Production still had the original empty-list check; request `e27b2608-8d43-4d58-befc-7dc788073fcc` used `openai/gpt-6-sol` and recorded zero tool calls. This was before deployment, not a failed result from the candidate code. The user then explicitly authorized deployment while preserving DeepSeek.

Built an incremental API image from the actual running image without new dependencies or a migration. Compared 123 API source files with normalized line endings: the only production source difference was `openai-provider.ts`; the other differences were test files. Before replacement, both active AI-request and recent running-usage counts were zero. Only API was recreated; Web, Postgres, Caddy and official desktop clients were not restarted. The first immediate health probe during startup returned 502, followed by health/config 200 once startup completed; this was not a zero-downtime deployment claim.

- Previous image: `38e7d1acf8fc36a35d5460fd7dcb0c391b382d1c729daed032f2483bb29907fe`.
- Deployed image: `ac8a1a175583589e5c0a6d0e79b7c000581379e8da0985e27aebf9c62e45a9b1`.
- API source SHA256: `2e4c7bc0b18922bd20980c93d89ec5a1cb9160b095bbee3c07f5f07989fa2949`.
- API bundle SHA256: `3ef43501de2c25426d703a6e4a99e0e7b93ecc7b92539beb947d7d47a8a87999`.
- DeepSeek provider SHA256 before/after: `7262afa7e738c7fa9443ad3e395d308837556f261dcec52b100c19dd1c2d9d1e`.

Public HTTPS acceptance with an isolated, audited `@example.test` fixture passed real login and token refresh, model catalog access, and two-request GateAI/DeepSeek tool-result round trips for registered versions 0.3.28 and 0.3.30. The former used JSON and the latter SSE. Version 0.3.27 was rejected by the actual model-directory version gate with 426. This tests a real signed protocol client declaring those versions; it does not establish every historical installer or official GUI workflow. Eight generation requests settled once; 484 AI_POINT total debit reconciled with the temporary fixture wallet. Fixture accounts were soft-deleted, devices and refresh sessions revoked, and model sessions removed; ledger rows were retained, with zero active diagnostic users/devices remaining.

Two preliminary acceptance-driver failures are retained separately: a fixture SQL parameter-type error rolled back before fixture creation; a synthetic namespace omitted its required description and GateAI rejected it. The original Codex snapshot includes namespace descriptions, including an empty string for `functions`. Adding the fixture description resolved that validation failure without further production changes. These are not provider-success evidence and are not silently discarded.

See [public deployment acceptance](../acceptance/gateai-deployed-20261029.json), [setup attempt](../acceptance/gateai-deploy-smoke-setup-20261029.json), and [namespace fixture attempt](../acceptance/gateai-deploy-smoke-fixture-20261029.json). No App release, forced upgrade, model reassignment, real-user wallet adjustment or DeepSeek configuration change was made. Temporary diagnostic files were removed after verification. Source and acceptance records are backed up on the existing `codex/ued-v3-1-implementation` branch.

## Reproduce

From Cloud root, with the configured runtime on PATH:

```powershell
pnpm --filter @bridge/api exec vitest run src/openai-provider.test.ts --maxWorkers=2
pnpm --filter @bridge/api exec tsx --test ../../scripts/diagnostics/gateai-loopback.test.mts
```

The loopback test expects the sibling App checkout with its existing compiled `dist-electron`; override `BRIDGE_APP_ROOT` if needed. It makes no real supplier requests.

For the real matrix, bundle `apps/api/src/openai-provider.ts` to an isolated diagnostic directory with tsup, place the bundled `openai-provider.js` beside `scripts/diagnostics/gateai-tool-matrix.mjs`, and run only in the API container with `GATEAI_PROBE_RUN=1`. Its package resolution needs access to the existing API dependencies; credentials are read/decrypted only in process memory. Optional `GATEAI_PROBE_MODELS` and `GATEAI_PROBE_CASES` restrict the fixed allowlisted model/case matrix. The driver caps each run at 90 POSTs and never retries a POST automatically. Do not install this driver in the gateway or print/export credentials. Remove only the isolated diagnostic files after collecting sanitized evidence.
