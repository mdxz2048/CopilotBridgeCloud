# Security

## 1. Password

Argon2id。


绝不存明文。


## 2. Refresh Token

Server DB：

只存 Hash。


必须：

Device scoped

Rotation

Revoke


## 3. Provider Secret

AES-256-GCM。


Master Key：

只在服务器 Secret/Environment。


## 4. HTTPS

生产：

HTTPS only。


## 5. Browser Auth

HttpOnly

Secure

SameSite

CSRF 防护。


## 6. Desktop

Bearer Access Token。


Refresh Token：

Desktop 安全存储。


## 7. Logging

禁止记录：

Password

Access Token

Refresh Token

Provider Credential

Prompt

Response

Tool Output

用户文件内容


必要日志：

request_id

user_id

device_id

provider

model

duration

status

usage

error_code


## 8. Local File Boundary

Server 永远不获取：

文件系统权限

任意本地 path 访问

Shell 权限。


## 9. Admin

所有 Admin API：

RBAC。


敏感操作：

Audit Log。


## 10. Payment

Webhook：

签名验证

幂等

Replay protection

Order state machine


金额：

Server 计算。

绝不相信 Client 传来的价格。


## 11. Usage

Quota enforcement：

Server authoritative。


禁止 Desktop 自己决定额度。


## 12. Privacy

不能宣传：

“所有数据都不会离开设备”。


准确原则：

本地文件操作发生在 Desktop。

服务端不主动存储本地文件。

模型推理所需上下文会被发送至相应 AI Provider。


## 13. Copilot Legal Gate

公开商业化以前：

必须验证 GitHub Copilot 当前授权和服务条款是否允许计划中的：

Server-hosted provider

账号共享

多用户使用

商业收费。


技术测试完成 != 商业授权完成。


## 14. Implemented controls and review notes

The API hashes passwords with Argon2id, hashes rotating refresh tokens with a server pepper, stores browser sessions as hashed opaque tokens, and encrypts Provider credentials with AES-256-GCM. Browser mutations require matching `Origin` and Secure/HttpOnly/SameSite cookies in HTTPS production. Gateway requests require a bearer token whose device matches `X-Device-ID`; revoked devices are rejected. Provider secrets are write-only in Admin responses. Request bodies are not logged, and generic server errors omit request details.

The local mock server is an isolated development fixture bound to loopback with a documented test credential. It must never be published or used as a production API. Production has `ENABLE_MOCK_PROVIDER=false` by default.

Before commercial Copilot access, verify current GitHub authorization and product terms for the intended server-hosted, multi-user use. The code intentionally rejects enabling the Copilot Provider until an approved integration exists. GitHub documents several SDK authentication modes, including organization-attributed server-to-server access: https://docs.github.com/en/copilot/how-tos/copilot-sdk/auth/authenticate . This availability alone does not establish permission for this product's planned resale or account-sharing model.
