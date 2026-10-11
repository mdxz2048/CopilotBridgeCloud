# Native Responses A/B diagnostic

`native-responses-ab.mjs` is an external, fixed diagnostic driver. It is not part of Cloud or Bridge runtime, and it never executes model-generated commands. A PASS from this driver does not establish official desktop Word drag/drop support.

Run without credentials or network model calls:

```sh
node scripts/diagnostics/native-responses-ab.mjs --self-test
node scripts/diagnostics/native-responses-ab.mjs --mock-bridge-test
node scripts/diagnostics/native-responses-ab.mjs
```

The mock test uses the actual built `RemoteBridgeServer` and fake in-memory Cloud Responses/settlement. Its result is explicitly `MOCK_DRIVER_ONLY`, not a provider acceptance result. The default run writes an unpaid matrix to `outputs/native-responses-ab.json`.

Paid execution requires all of:

- `BRIDGE_AB_RUN=1`; published latest/minimum version must both be `0.3.3`.
- `BRIDGE_AB_EMAIL` and `BRIDGE_AB_PASSWORD`, or an explicitly supplied `BRIDGE_AB_CREDENTIALS_FILE` containing `{ "email": "...", "password": "..." }`. There is no default private credential path.
- Built App modules under `BRIDGE_APP_ROOT/dist-electron/cloud`, defaulting to sibling `copilot-bridge-app`.
- `BRIDGE_AB_RATE_CNY_PER_MILLION_JSON`: a map keyed by public model ID, with verified **platform effective** numeric `input`, `output`, optional `reasoning` RMB per million tokens, optional `toolRmb` per call and `minimumRmb` per request. Missing rates fail closed. These are budget inputs, not inferred supplier cost.

Optional controls:

- `BRIDGE_AB_CASES=W` (default `N,W,C,T`), `BRIDGE_AB_MODES=normal,thinking`, `BRIDGE_AB_MODELS=deepseek/deepseek-flash`.
- `AB_MAX_RMB=0.03` limits the run; each request must fit a conservative remaining-budget estimate and the account's live balance before sending.
- `BRIDGE_AB_BASE_URL` and `BRIDGE_AB_OUTPUT` override the API base and report path.

Cases: N arithmetic; W a real, locally generated synthetic DOCX read by a fixed tool; C fixed code read, exact allowlisted repair and trusted fixed tests; T a namespace/custom tool with a fixed marker result. Normal/thinking only run when advertised capabilities permit. Absent GPT native resources produce `BLOCKED_NO_GPT_CONNECTION` with no GPT POST.

Each case permits at most five Responses POSTs, each with at most 1024 output tokens. An automatic auth retry of a Responses POST is blocked before transmission. Every actual POST, shape-only transformation, trace ID, first-text/tool timing, terminal status and real settlement is recorded. Tools return only controlled fixtures; no shell or model code is run. Temporary devices are revoked and private in-memory credentials cleared on completion. Unsettled usage, budget exhaustion or correctness failure stops the run; it never claims a reliable zero supplier cost.
