# Desktop Integration

Server 与 Desktop 只能通过公开 API Contract 连接。

Desktop 不访问 Server DB。

Server 不依赖 Desktop 内部实现。


## 1. Desktop CloudClient

建议 Desktop 最终抽象：

CloudClient

login()

refresh()

logout()

getAccount()

registerDevice()

listDevices()

getSubscription()

getUsage()

getModels()

createResponse()

getClientConfig()

getLatestRelease()


## 2. Desktop UI

Desktop 增加：

账号与服务


未登录：

Copilot Bridge Cloud

○ 未登录

登录后即可使用在线模型与订阅服务。

[登录]


登录后：

账号
xxx@example.com

套餐
Pro

状态
有效

有效期
2026-10-23

本月 AI 用量
42%

设备
当前设备已激活

云服务
● 已连接


[管理账号]
[退出登录]


## 3. Desktop State

Cloud state：

SIGNED_OUT

AUTHENTICATING

AUTHENTICATED

DEVICE_REVOKED

SUBSCRIPTION_REQUIRED

SUBSCRIPTION_EXPIRED

QUOTA_EXCEEDED

SERVER_UNREACHABLE


## 4. Token Storage

Windows：

Refresh Token

必须放：

Windows Credential Manager


Access Token：

只放进程内存或受控短期 storage。


禁止：

settings.json 明文 Refresh Token。


## 5. Gateway

Desktop：

ChatGPT Desktop
↓
localhost Local Bridge
↓
Cloud Gateway


ChatGPT 不直接连接公网 Gateway。


## 6. Tool Boundary

Remote：

Model decides tool call


Local：

Desktop executes tool


例如：

function_call
↓
Local Agent
↓
read/edit/shell
↓
function_call_output
↓
Cloud
↓
Provider Session


Server 不获得本地文件权限。


## 7. Client Upgrade

Desktop 调：

GET /api/v1/client/config

GET /api/v1/releases/latest


显示：

有新版本

强制升级

维护模式


## 8. Immediate Desktop integration recipe

1. Generate a stable UUID on first launch and persist it as the Cloud device ID. Use a new `X-Client-Thread-ID` for each conversation, then reuse it for all turns and tool continuations in that conversation.
2. Start the local server with `pnpm dev:mock` from this project. Base URL: `http://127.0.0.1:3001`. Test account: `desktop@example.test` / `MockDesktop123!`.
3. Login with the device object. Keep the access token in memory and store the refresh token in Windows Credential Manager. Send the bearer token and device ID on all Gateway requests.
4. Call `/api/v1/account` and `/v1/models`. Request `mock/mock-chat` through `/v1/responses` first with `stream: false`, then with `stream: true`.
5. For tools, send `tools` definitions. On a `function_call` output, run only the named local tool after validating its arguments. Send a `function_call_output` with the same `call_id` and thread ID. The mock supports two sequential calls to check continuation logic.
6. Test refresh token rotation and device revocation. Map `error.code` to the Cloud states listed above. Use `docs/protocol/openapi.v1.json` for generated endpoint details and `packages/contract/src/schemas.ts` for runtime Zod validation.

The local mock is explicitly a contract and control-flow test. Its tokens and subscription are ephemeral. Production base URL remains `https://ai.mddxz.top`; switch only the base URL in Desktop configuration when a production deployment passes the release gate.

### Loopback acceptance controls

The Mock supports two and three sequential local tool calls on one `X-Client-Thread-ID`. It consumes every returned `function_call_output.output` and echoes those outputs in the final assistant answer. For the read-marker gate, keep `CLOUD-TOOL-731` out of the prompt, return it only in the local read output, and assert that the final answer contains it.

To drive otherwise unreachable Cloud states, add `X-Mock-Error-Code: SUBSCRIPTION_EXPIRED` or `X-Mock-Error-Code: MONTHLY_QUOTA_EXCEEDED` to an authenticated request against `http://127.0.0.1:3001`. Assert HTTP 403 or 429 respectively and map the exact wire code; `MONTHLY_QUOTA_EXCEEDED` intentionally maps to Desktop state `QUOTA_EXCEEDED`. This header is a loopback Mock-only test contract. It is absent from OpenAPI and production routes and must never be sent to production.

`getLatestRelease()` parses the generated `LatestReleaseResponse` schema. `release` is either the complete published release object (`id`, `version`, `channel`, `platform`, `arch`, `downloadUrl`, `sha256`, `releaseNotes`, `published`, `createdAt`) or `null`. Do not infer fields from the Server database.
