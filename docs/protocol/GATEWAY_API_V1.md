# Gateway API V1

API Root：

https://ai.mddxz.top


产品 API：

/api/v1/*


Responses Compatibility：

/v1/*


## 1. Auth

POST /api/v1/auth/login

Request：

{
  "email": "...",
  "password": "...",
  "device": {
    "deviceId": "...",
    "deviceName": "...",
    "platform": "windows",
    "osVersion": "...",
    "appVersion": "..."
  }
}


Response：

{
  "accessToken": "...",
  "refreshToken": "...",
  "expiresIn": 1800,
  "user": {...},
  "device": {...}
}


POST /api/v1/auth/refresh


Refresh Token：

必须 rotation。


POST /api/v1/auth/logout


GET /api/v1/auth/me


## 2. Device

POST /api/v1/devices/register

GET /api/v1/devices

DELETE /api/v1/devices/:id


## 3. Account

GET /api/v1/account


返回：

Account

Plan

Subscription summary

Device summary

Usage summary


## 4. Subscription

GET /api/v1/subscription


## 5. Usage

GET /api/v1/usage/current

GET /api/v1/usage/history


## 6. Plans

GET /api/v1/plans


## 7. Billing

POST /api/v1/billing/orders

GET /api/v1/billing/orders/:id


## 8. Models

GET /v1/models


只能返回：

当前用户有权限的 Enabled Models。


## 9. Responses

POST /v1/responses


支持：

stream=true

model

input

tools

reasoning

function_call_output


SSE 语义尽量兼容 Desktop 当前 Responses client。


## 10. Headers

Authorization:
Bearer <access token>


X-Device-ID:
<device id>


X-Client-Thread-ID:
<desktop thread id>


## 11. Error

统一：

{
  "error": {
    "code": "...",
    "message": "...",
    "requestId": "..."
  }
}


错误至少：

UNAUTHORIZED

TOKEN_EXPIRED

DEVICE_NOT_REGISTERED

DEVICE_REVOKED

DEVICE_LIMIT_REACHED

ACCOUNT_DISABLED

SUBSCRIPTION_REQUIRED

SUBSCRIPTION_EXPIRED

MODEL_NOT_ALLOWED

MONTHLY_QUOTA_EXCEEDED

RATE_LIMITED

PROVIDER_UNAVAILABLE

MODEL_UNAVAILABLE

GATEWAY_TIMEOUT

INTERNAL_ERROR


Desktop 必须根据 code 做状态 UI，

不要根据英文 message 猜。


## 12. Client Config

GET /api/v1/client/config


Response：

{
  "minimumVersion": "0.1.0",
  "latestVersion": "0.1.0",
  "maintenance": false,
  "features": {
    "cloudGateway": true
  }
}


## 13. Release

GET /api/v1/releases/latest

GET /api/v1/releases


## 14. V1 frozen wire contract (Desktop integration)

Contract version `1.0.0` is frozen in `CONTRACT_VERSION.json`, including the SHA-256 of the generated OpenAPI file. CI tests reject an OpenAPI change until the version and pinned hash are updated deliberately. Any breaking change requires a new major contract version and an announced Desktop migration; additive changes require a minor version. Do not silently change request fields, response fields, SSE event order, status codes, or `error.code` values.

Machine-readable source: `packages/contract/src/schemas.ts`. Generated OpenAPI 3.1: `docs/protocol/openapi.v1.json`. Run `pnpm contract:generate` after any schema change. The Desktop client should target these schemas and use `error.code` for state transitions.

### Authentication and device scope

Desktop sends `POST /api/v1/auth/login` with a stable random UUID `device.deviceId`. A successful response contains a 30-minute bearer access token (`expiresIn: 1800`) and a rotating refresh token. Store the refresh token in Windows Credential Manager. `POST /api/v1/auth/refresh` accepts `{ "refreshToken": "..." }`; the previous token becomes invalid immediately. `POST /api/v1/auth/logout` sends the same body and bearer token. Every `/v1/*` request sends `Authorization: Bearer ...`, `X-Device-ID: <UUID>` and, for responses, `X-Client-Thread-ID: <stable thread ID>`. The device header must match the device bound to the access token.

The login endpoint registers the supplied device if its account has an active subscription and capacity. A revoked device is rejected. Desktop should not retry revoked or over-limit devices with a new random UUID automatically.

### Response requests

```json
{
  "model": "mock/mock-chat",
  "input": "Hello",
  "stream": false,
  "tools": [{ "name": "read_file", "description": "Read a local file", "parameters": { "type": "object", "properties": { "path": { "type": "string" } } } }]
}
```

`input` may be a string or an array of `{ "role": "user|assistant|system", "content": "..." }`, `{ "type": "function_call", "call_id": "...", "name": "...", "arguments": "<JSON string>" }`, and `{ "type": "function_call_output", "call_id": "call_...", "output": "..." }` items. Desktop executes local tools and sends their output in a subsequent request with the same `X-Client-Thread-ID`. Include the relevant conversation and returned `function_call` item before its `function_call_output` when using stateless providers such as DeepSeek; the server does not persist prompt or tool output. Server never executes tools. Validate `arguments` before running the local tool.

The loopback Mock consumes the exact `output` strings, supports both two- and three-tool sequences on the same thread, and includes all received tool outputs in its final assistant text. The marker acceptance scenario sends a prompt that does not contain `CLOUD-TOOL-731`, returns that marker only from the local read tool, and requires the final Mock answer to contain the marker.

Non-streaming response: `{ "id": "resp_...", "object": "response", "status": "completed", "model": "...", "output": [...], "usage": { "input_tokens": 1, "output_tokens": 1, "total_tokens": 2 } }`.

When `stream: true`, `Content-Type` is `text/event-stream`. Events arrive in this order: `response.created`, `response.output_item.added`, zero or more `response.output_text.delta`, `response.output_item.done`, `response.completed`, then `data: [DONE]`. Each event uses `event: <name>\ndata: <JSON>\n\n`. `response.completed` contains the same final response object under `response`. Function calls appear as output items. Clients must support a completed response with no text delta.

### Errors and retry

All errors are JSON `{ "error": { "code": "...", "message": "...", "requestId": "..." } }`. HTTP 401 covers invalid or expired access token; refresh once and retry. HTTP 403 covers disabled account, revoked device, missing/expired subscription, or model denial. HTTP 429 covers monthly quota or RPM/concurrency. HTTP 503 covers provider unavailability. HTTP 504 covers gateway timeout. Do not retry non-idempotent `POST /v1/responses` blindly after a network disconnect because the upstream call may have completed.

### Local Mock integration server

Run `pnpm install` then `pnpm dev:mock` at the repository root. The test-only server binds **127.0.0.1:3001** and needs no database, Provider key, payment, website, or Admin setup. Login with `desktop@example.test` / `MockDesktop123!` and any stable random UUID. Override the local password with `MOCK_DESKTOP_PASSWORD`. The mock account has a Pro test subscription and `mock/mock-chat`. This server is ephemeral: state clears on restart. It supports token rotation, device activation/revocation, account, subscription, usage, model list, JSON responses, SSE, two sequential tool calls, and same-thread continuation. It never executes local tools. The mock endpoint must not be exposed to the internet.

For deterministic Desktop error-state tests, authenticated Mock requests accept the loopback-only header `X-Mock-Error-Code`:

| Value | HTTP status | Frozen `error.code` |
| --- | ---: | --- |
| `SUBSCRIPTION_EXPIRED` | 403 | `SUBSCRIPTION_EXPIRED` |
| `MONTHLY_QUOTA_EXCEEDED` | 429 | `MONTHLY_QUOTA_EXCEEDED` |

The control applies to authenticated Mock API routes and `/v1/responses` after token/device validation. It exists only in `createMockServer`, is intentionally absent from production route registration and generated OpenAPI, and must never be forwarded to or implemented by a production deployment.

### Latest release response

`GET /api/v1/releases/latest` is public and returns the frozen `LatestReleaseResponse`:

```json
{
  "release": {
    "id": "66666666-6666-4666-8666-666666666666",
    "version": "0.1.0",
    "channel": "stable",
    "platform": "windows",
    "arch": "x64",
    "downloadUrl": "https://example.test/desktop.exe",
    "sha256": "<hex digest>",
    "releaseNotes": "...",
    "published": true,
    "createdAt": "2026-09-23T00:00:00.000Z"
  }
}
```

When no published release exists, the response is exactly `{ "release": null }`. The loopback Mock returns a contract-valid deterministic release fixture.
