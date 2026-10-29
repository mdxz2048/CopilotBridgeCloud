# GateAI GPT-6.1 CNY correction and pricing layout — 2026-10-29

The operator clarified that the supplied price card is denominated in CNY despite its dollar symbol. Remove the mistaken factor of 7 for GPT-6.1 only. Keep the confirmed supplier discount 0.1 and sale multiplier 0.13. Existing old GPT-6 historical references and DeepSeek pricing remain unchanged.

| Per million tokens | CNY reference | Estimated supplier CNY | User CNY |
| --- | ---: | ---: | ---: |
| Input | 2 | 0.2 | 0.26 |
| Cached read | 0.1 | 0.01 | 0.013 |
| Five minute cache write | 2.5 | 0.25 | 0.325 |
| Output | 10 | 1 | 1.30 |
| Input above 272K | 4 | 0.4 | 0.52 |
| Output above 272K | 15 | 1.5 | 1.95 |

Cost audit snapshots explicitly record referenceCurrency CNY and referencePerMillion, without USD exchange-rate fields. The price correction publishes a new immutable version; historical snapshots remain unchanged. Production checks found zero real GPT-6.1 user requests before correction, so no refund was required. Internal acceptance fixtures are excluded from that statement.

The admin multiplier cell uses a vertical flex layout with an 8px gap between input and margin hint. Negative hints use text color instead of the generic padded inline error alert. Margin is 1 minus costMultiplier divided by saleMultiplier: GateAI 0.13 against 0.1 and DeepSeek 1.3 against 1 both give 23.08%. A sale multiplier below 1 alone does not mean a loss. Unknown supplier discounts produce an unknown-cost hint instead of an invented negative margin.

Validation: API 208 unit tests; Web 19 tests including discounted margin, loss and unknown cost; production builds and type checks. Browser renderer with synthetic API fixtures verified 1440px, 800px and 390px viewports, plus an actual loss state; input and hint rectangles do not overlap. This browser check is separate from real supplier request acceptance. No App release or protocol change; minimum compatible client stays 0.3.28, latest 0.3.30.

Production: new API and Web deployed. Admin save published multiplier revision 2 at 0.13. Public HTTPS acceptance passed 8 settled requests across GateAI and DeepSeek with JSON at client 0.3.28 and SSE at 0.3.30, including tool continuation, signed login/refresh, below-minimum rejection, CNY cost snapshots and wallet reconciliation. Isolated PostgreSQL settlement tests: 3 passed; temporary database dropped.

A pre-existing STARTED request at 06:50:18 UTC predates the previous API container boot at 06:50:22 UTC. It is an orphaned historical record, not a live connection. Replacement was gated on zero active requests and zero legacy RUNNING usage created since that container boot. The historical record was left intact. DeepSeek provider source SHA-256 remains 7262afa7e738c7fa9443ad3e395d308837556f261dcec52b100c19dd1c2d9d1e. This update does not repair historical orphan records.
