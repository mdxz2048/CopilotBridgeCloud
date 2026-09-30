# Gateway device proof in V2.3

This is a **breaking internal-test cutover deployed on 2026-09-30** on the existing `/api/v1/auth/*` and `/v1/*` paths. Frozen Gateway V1 `1.0.0` (`openapi.v1.json`, `GATEWAY_API_V1.md`, and its Zod schemas) remains unchanged as historical documentation but does not describe the current Desktop authentication path. The replacement is specified by V2 `2.3.0` (`openapi.v2.json` and `DeviceInfoV23Schema`). Paired local signed login, refresh, JSON/SSE, replay and tool continuation, isolated PostgreSQL migration and production signed Mock/SHADOW smoke passed. The unsigned 0.2.0 Desktop test installer was built but not published or installed; no official executable attestation is claimed.

Desktop login sends `device.publicKeyJwk` with **exactly** `{kty:"EC",crv:"P-256",x,y}` and a persistent installation UUID in `device.deviceId`. Login itself needs no proof. A registered key cannot be silently replaced for the same device ID. Generate a per-installation software P-256 key; keep the private key in OS-protected credential storage, never plaintext files or logs. This demonstrates key possession, **not** an official executable or hardware/TPM identity.

Every subsequent Desktop bearer request and refresh sends `DPoP: <compact ES256 JWT>`. The protected header is `{typ:"dpop+jwt",alg:"ES256",jwk:<exact enrolled public JWK>}`. The JWT payload has exactly `{htm,htu,iat,jti,ath,bth}`:

- `htm`: uppercase HTTP method.
- `htu`: `new URL(requestUrl).origin + new URL(requestUrl).pathname` — exclude query and fragment.
- `iat`: Unix seconds, accepted within ±60 seconds.
- `jti`: new UUID for every request, single-use; replay IDs persist in the database and are pruned after 600 seconds.
- `ath`: base64url SHA-256 of the raw access token, or of the raw refresh token on refresh.
- `bth`: base64url SHA-256 of **the exact raw HTTP body bytes**; hash empty bytes when there is no body.

The signature is JOSE ES256 over the compact JWT signing input, not a separately transmitted raw JSON signature. Browser cookie sessions remain independent and use origin/CSRF protection rather than DPoP.

Initial AI limits are 2 new turns/minute per account and 1 new turn/minute per device; the admin can change these in the existing System settings UI. JSON and SSE both count. A tool continuation is not a new turn only when the server has an unexpired pending call for that same account, device, model and thread, and the input supplies its exact call ID. The Desktop may send its accumulated history, but the history must match the server-recorded transcript fingerprint exactly, followed only by tool outputs; an appended new prompt is not exempt. Tool-output-only continuation is also supported. Each returned result consumes a pending call ID atomically; other calls issued simultaneously remain pending for separate replies. A continuation claim expires after five minutes and is capped at eight follow-ups per turn. Every tool request still counts against the plan's concurrency, request and usage quotas and is metered independently. Forged, repeated, expired or cross-thread call IDs count as new turns. The Mock enforces the same defaults; test fixtures may raise limits for rapid non-tool integration checks.

Shared deterministic vector: for `POST https://example.test/v1/responses?stream=true`, `htu` is `https://example.test/v1/responses`. Token `test-token` yields `ath` `TF3Jt3CJBfd_Xl0WMWtd-0JeaMsybc1VqGDpCncHAx4`. Exact raw UTF-8 body `{"model":"mock/mock-chat","input":"Hi"}` yields `bth` `OLciEt12i9omEznk-GfwPKda8mX6tCeCxZcJTxbKbWc`; an empty body yields `47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU`.
