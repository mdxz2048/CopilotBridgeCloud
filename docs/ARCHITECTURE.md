# Copilot Bridge Cloud — Architecture

## 1. Architecture Principle

保持 Modular Monolith。

不要首发拆微服务。


技术：

TypeScript

Node.js

Fastify

PostgreSQL

Drizzle ORM

Next.js

React

Zod

Pino

Docker Compose

Caddy


## 2. Monorepo

推荐：

copilot-bridge-cloud/

apps/
  api/
  web/

packages/
  db/
  auth/
  shared/
  billing/
  provider-core/
  ui/

providers/
  copilot/
  deepseek/

docs/

docker/


## 3. Architecture

Internet
   ↓
Caddy
   ↓
┌───────────────────────┐
│ Web                   │
│ Next.js               │
└──────────┬────────────┘
           │
           ↓
┌───────────────────────┐
│ API / Gateway         │
│ Fastify               │
│                       │
│ Auth                  │
│ Device                │
│ Subscription          │
│ Entitlement           │
│ Usage                 │
│ Billing               │
│ Models                │
│ Provider Router       │
│ Session               │
│ Releases              │
│ Audit                 │
└────────┬──────────────┘
         │
    PostgreSQL
         │
         └──────── Provider Adapter
                       │
             ┌─────────┴─────────┐
             │                   │
          Copilot             DeepSeek


## 4. Core Modules

auth/

users/

devices/

plans/

subscriptions/

entitlements/

usage/

billing/

providers/

models/

sessions/

gateway/

releases/

audit/

system/


模块之间通过 Service interface 交互。


## 5. Provider Adapter

定义统一接口：

ProviderAdapter

至少能力：

health()

listModels()

createResponse()

resumeSession()

closeSession()


Provider 不应该直接处理：

用户套餐

设备

订单

网页登录


Provider 只处理模型。


## 6. Canonical Protocol

内部统一：

CanonicalResponseRequest

CanonicalResponseEvent


Provider Adapter 负责：

厂商格式

⇅

Canonical format


外部 Desktop 使用：

OpenAI Responses 风格。


## 7. EntitlementService

所有权限判断集中：

EntitlementService.checkAccess()


输入：

userId

deviceId

modelId


检查：

User

Device

Subscription

Plan

Model

Override

Quota

Rate Limit


返回：

allowed

reason

plan

limits

usage


禁止 Gateway 自己散落套餐判断。


## 8. Session

Session Key：

user_id
+
device_id
+
client_thread_id


必须避免：

跨用户

跨设备

跨 thread


Provider session 混用。


## 9. Model Session

model_sessions：

id

user_id

device_id

client_thread_id

provider_id

model_id

provider_session_id

created_at

last_active_at

expires_at


## 10. Database

核心表：

users

devices

refresh_tokens

plans

subscriptions

providers

provider_credentials

models

plan_model_access

user_model_access

model_sessions

usage_records

billing_orders

releases

audit_logs

system_settings


## 11. Usage Lifecycle

请求开始：

UsageRecord = RUNNING


Provider 完成：

COMPLETED


失败：

FAILED


客户端断开：

ABORTED


记录实际能够获得的：

input_tokens

output_tokens

total_tokens

cost


## 12. Gateway Pipeline

Request

→ Request ID

→ Authentication

→ Device Validation

→ Subscription Validation

→ Entitlement

→ Quota

→ Rate Limit

→ Session

→ Provider Router

→ Provider

→ SSE

→ Usage Settlement

→ Audit/metrics


## 13. Web Session 与 Desktop Token 分开

Browser：

Secure HttpOnly Cookie


Desktop：

Bearer Access Token
+
Refresh Token


不要让 Web 和 Desktop 共享一套危险的本地 token storage 模式。


## 14. Billing

BillingService 不知道具体支付平台实现。


PaymentProvider：

createOrder()

queryOrder()

closeOrder()

refund()

handleWebhook()


实现：

ManualPaymentProvider

未来：

WechatPayProvider

AlipayProvider


## 15. Provider Credential

provider_credentials：

secret encrypted at rest


算法：

AES-256-GCM


Master Key：

服务器环境变量。


## 16. Mock Provider

必须实现测试 Provider：

MockProvider


支持：

streaming text

usage

function_call

function_call_output

same-session continuation


这样自动测试不依赖外部模型。


## 17. Implemented V1 layout and current boundaries

`packages/db` owns Drizzle schema and immutable SQL migrations. `packages/contract` owns Desktop request/response Zod schemas and generates OpenAPI 3.1. `apps/api` owns Fastify routes and the Provider adapter interface. `apps/web` is a Next.js App Router application; `/api/v1/*` and `/v1/*` are routed to Fastify by Caddy in dedicated deployment, or Nginx → loopback Caddy on the shared target host.

The test-only MockProvider uses an in-memory state store on `127.0.0.1:3001` for immediate Desktop integration. Production requests use PostgreSQL. Provider calls are wrapped by entitlement checks and usage reservation. Model sessions are scoped by user, device, and client thread. Prompt, response, and tool output text are not stored in PostgreSQL.

DeepSeek uses its documented Chat Completions adapter. The current production adapter resolves the upstream response before emitting compatibility SSE events; progressive upstream token streaming remains a release-gate failure. The Copilot Provider stays disabled until a reviewed, supported authentication and authorization path is implemented. Payment provider ports are represented by the order contract, while real WeChat/Alipay webhooks are not connected.
