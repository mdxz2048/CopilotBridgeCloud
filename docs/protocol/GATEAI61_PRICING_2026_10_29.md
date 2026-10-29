# GateAI GPT-6.1 Sol rollout and pricing — 2026-10-29

The operator requested GPT-6.1 Sol as the only user-facing GPT model, supplied its GateAI price card, confirmed their upstream discount is 0.1, and explicitly selected a 0.13 user multiplier. DeepSeek must remain unchanged.

## Currency correction

The operator subsequently clarified that every number on the card is **CNY**; its dollar symbol was wrong. The initial USD interpretation below was superseded by [the CNY correction](GATEAI61_CNY_CORRECTION_2026_10_29.md). It is retained only as the initial release record.

## Initial prices and cost provenance (superseded)

The reference is the operator's attached price card, not an independently verified supplier invoice. USD/CNY remains 7. Per million tokens:

| Category | Card USD | Supplier CNY estimate at 0.1 | User CNY at 0.13 |
| --- | ---: | ---: | ---: |
| Ordinary input | 2 | 1.40 | 1.82 |
| Cached read | 0.1 | 0.07 | 0.091 |
| Five-minute cache write | 2.5 | 1.75 | 2.275 |
| Output, including reasoning | 10 | 7.00 | 9.10 |
| Input when total input exceeds 272K | 4 | 2.80 | 3.64 |
| Output when total input exceeds 272K | 15 | 10.50 | 13.65 |

0.13 / 0.1 = 1.3: a 30% cost markup and approximately 23.08% gross margin before rounding, other expenses or unreported usage. Interpret 272K as 272,000 input tokens, with a strictly greater-than threshold. The screenshot does not specify different extended-context cache prices; those remain the supplied standard cache prices and this assumption is recorded.

Cache writes use GateAI's observed `usage.input_tokens_details.cache_write_tokens` field. Reads and writes are disjoint subsets of total input; neither is charged twice. If write usage is absent, writes are not invented: they remain included at ordinary-input cost/rate, with an explicit assumption in the audit snapshot. Invalid write counters do not produce a debit. Cost estimates are isolated to the GateAI hostname and actual upstream model `gpt-6.1-sol`; other OpenAI-compatible endpoints remain unknown without their own evidence. Supplier-reported costs take precedence without applying an extra discount.

New cost audits use `USER_PROVIDED_RATE_ESTIMATE`. The admin cost page labels them as provided-price estimates and explains the discount, exchange rate and missing-write assumption. They are never labeled as official rates or actual supplier receipts. Historical costs and user debits are not backfilled or repriced.

User tier/cache-write rating is isolated by the server-generated GateAI GPT-6.1 price snapshot and `MANAGED_USAGE`. It applies exact integer arithmetic to the immutable standard rate-card version selected at request start, rounding once at final AI_POINT precision. BYOS and existing DeepSeek/other-provider rating retain the existing formula. No database migration or new mandatory protocol field is needed.

## Catalog and App behavior

Enable the existing `openai/gpt-6.1-sol` logical model and its actual GateAI `gpt-6.1-sol` instance. Disable other GPT logical models/instances. Keep the separate old `openai/gpt-6-sol` row for historical usage instead of relabeling its history as GPT-6.1. Transfer the old model's plan assignments and user overrides to the new model, preserving an explicit DENY on either side. A rollback rehearsal checks this transaction before committing it, with an audit entry under `GATEAI61_MODEL_SWITCHED`.

The Cloud display name is `GateAI · GPT-6.1 Sol`. The existing App derives `GPT-6.1 Sol` from the real public model ID; this was verified against the existing App display helper. There is no App source change or installer release. App catalog polling will expose the new model; users who selected GPT-6 must select GPT-6.1 and start a new conversation. No fallback silently switches a user to DeepSeek. Thinking was not established by supplier output, so this route exposes verified normal mode rather than advertising unproven reasoning.

Actual GateAI text, native SSE tool and synthetic image probes pass; vision recognizes the synthetic red square. DeepSeek catalog/configuration fingerprints before and after are identical. Only GPT requests need to drain for the catalog change; unrelated active DeepSeek requests continue. API/Web image replacement was performed earlier with zero active model generations. No official desktop client, Postgres or Caddy restart was performed.

## Validation and deployment

- API: 208 unit tests, typecheck and build pass. Web: 16 tests, typecheck and build pass.
- Disposable PostgreSQL: new tier settlement, immutable rate versions, idempotency, invalid counters and unchanged legacy rating pass. The first run passed 31 of 32 cases; one old test copied from the production image still expected forced installer pruning. The current checkout's existing compatible-client test was then mounted and the targeted four cases passed. The original failure and rerun are retained; no production policy was changed to satisfy that stale test. Both temporary databases were dropped.
- API image: `731f247275a5db595c454228dcad75e1baf5ec35bd0d0c242efcd688f000e807`.
- API bundle SHA256: `4cee290adc208e1535770e45b62ce6edbe54ebafcdd78d6ba278d92ea14d1fe5`.
- Web image: `2acdee18d14b059e0bafa4775d2004ac50ac0193a3dc05249a25438f4ab83830`.
- DeepSeek provider source SHA256 remains `7262afa7e738c7fa9443ad3e395d308837556f261dcec52b100c19dd1c2d9d1e`.
- App latest 0.3.30 / minimum compatible 0.3.28 are unchanged. Public acceptance uses signed protocol clients declaring those versions, not historical installers or official GUI automation.

The first catalog attempt deferred while a global in-flight check saw DeepSeek traffic. Its transaction rehearsal rolled back and did not change the model. The check was narrowed to the GPT models actually being retired, and the subsequent transaction committed with the identical DeepSeek fingerprint. This is a configuration-only scope correction, not a DeepSeek behavior change.

Evidence and final public acceptance are recorded in `docs/acceptance/gateai61-20261029.json`. No actual user's wallet or existing conversation data was edited. Diagnostic traffic uses isolated internal accounts or direct synthetic supplier probes, with retained ledger records and explicit cleanup.
