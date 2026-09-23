# Copilot Bridge Cloud — MASTER PRD

## 1. 产品定位

Copilot Bridge Cloud 是 Copilot Bridge Desktop 的云端服务。

核心职责：

- 用户
- 设备
- 激活
- 套餐
- 订阅
- 模型权限
- Provider
- AI Gateway
- 用量
- 配额
- 支付
- 软件发布

Desktop 负责：

- ChatGPT Desktop
- Local Bridge
- Local Agent
- Tool Bridge
- 本地文件
- read/edit/create
- shell/python
- Original/Bridge Profile

必须遵守：

Cloud 管“人、设备、模型、权限、付费、推理”。

Desktop 管“ChatGPT、Agent、本地工具、本地文件”。

Server 不成为远程电脑控制服务器。


## 2. 产品入口

正式域名：

https://ai.mddxz.top

首页首先是产品官网，而不是管理后台。

主要入口：

/
产品官网

/download
软件下载

/pricing
套餐

/login
登录

/dashboard
用户中心

/admin
管理员后台


## 3. V1 用户旅程

新用户：

访问官网
↓
了解产品
↓
注册/获得账号
↓
选择套餐
↓
支付或管理员开通
↓
下载 Copilot Bridge
↓
Desktop 登录
↓
设备激活
↓
获得允许的模型列表
↓
使用 AI Gateway


## 4. Desktop 登录状态

Desktop 后续应该增加：

“账号与服务”

至少显示：

账号

套餐

订阅状态

有效期

本月 AI 用量

设备状态

Cloud 连接状态


典型状态：

SIGNED_OUT

AUTHENTICATED

DEVICE_REVOKED

SUBSCRIPTION_REQUIRED

SUBSCRIPTION_EXPIRED

QUOTA_EXCEEDED

SERVER_UNREACHABLE


## 5. 用户系统

用户拥有：

账号
密码
状态
角色
设备
订阅
套餐
模型权限
用量
订单


角色：

USER
ADMIN


用户状态：

ACTIVE
DISABLED
EXPIRED


管理员允许：

创建用户

搜索用户

禁用/恢复用户

重置密码

查看订阅

修改套餐

延长订阅

查看设备

停用设备

查看用量

查看订单

修改模型权限


管理员绝不能查看用户原始密码。


## 6. 设备系统

用户可以拥有多台设备。

例如：

张三
├── DESKTOP-HOME
├── OFFICE-PC
└── MacBook Pro


设备信息：

device_id

device_name

platform

os_version

app_version

status

activated_at

last_seen_at


状态：

ACTIVE
REVOKED


设备 ID：

Desktop 首次运行产生随机稳定 UUID。

禁止把：

CPU ID
主板 ID
硬盘 Serial
MAC Address

作为唯一设备身份。


## 7. 设备激活

用户登录之后注册设备。

服务器检查：

用户状态
订阅状态
设备数量
设备状态

达到设备上限：

DEVICE_LIMIT_REACHED


管理员可以：

停用设备

恢复设备


用户也可以：

查看自己的设备

下线其它设备


## 8. 套餐

V1 两档：

STANDARD

PRO


产品层展示名称：

Standard

Pro


STANDARD：

部分模型

标准 AI 用量

较少设备

标准并发


PRO：

全部已开放模型

更高 AI 用量

更多设备

更高并发

高级 reasoning 模型


具体价格、额度、设备数量：

不能写死在源码。

后台动态配置。


## 9. Plan 数据

Plan 至少包含：

code

name

description

monthly_price

currency

max_devices

monthly_token_limit

monthly_usage_credit_limit

max_concurrent_requests

requests_per_minute

enabled


## 10. 模型和套餐必须解耦

禁止：

if plan == PRO:
    allow everything

模型权限必须通过关系管理：

plan_model_access


管理员可以控制：

某模型是否属于 Standard

某模型是否属于 Pro


不需要客户端更新。


## 11. 用户特殊模型权限

支持：

user_model_access


用于：

特殊测试用户

赠送用户

临时开放

限制某个模型


支持：

ALLOW
DENY


最终模型权限：

Model Enabled

+

Plan Access

+

User Override


## 12. Subscription

Subscription 状态：

TRIAL

ACTIVE

PAST_DUE

CANCELED

EXPIRED

SUSPENDED


字段：

started_at

current_period_start

current_period_end

cancel_at_period_end


计费周期：

按用户订阅日期。

例如：

9月23日购买

10月23日重置。


不要统一每月1日重置。


## 13. 付费产品设计

当前正式设计：

月度订阅。


V1 支持：

Standard 月付

Pro 月付


以后支付：

微信支付

支付宝


交互：

选择套餐
↓
创建订单
↓
选择微信 / 支付宝
↓
生成二维码
↓
扫码
↓
支付平台回调
↓
订单 PAID
↓
Subscription 生效


## 14. V1 支付范围

支付领域完整实现。

真实微信/支付宝 Provider：

可以后续接入。


当前必须实现：

ManualPaymentProvider

管理员可以手工：

开通 30 天

延长

暂停

取消

升级套餐


这样即使第三方支付没上线：

整套商业系统也必须能运行。


## 15. Billing Order

状态：

PENDING

PAID

FAILED

CANCELED

REFUNDED

EXPIRED


Provider：

MANUAL

WECHAT_PAY

ALIPAY


订单包含：

order_no

user

plan

amount

currency

provider

external_order_id

qr_code_payload

expires_at

paid_at


## 16. 扫码支付产品接口

预留：

POST /api/v1/billing/orders


请求：

{
  "plan": "PRO",
  "paymentProvider": "WECHAT_PAY"
}


响应：

{
  "orderId": "...",
  "status": "PENDING",
  "amount": 69,
  "currency": "CNY",
  "payment": {
    "type": "QR_CODE",
    "qrCodePayload": "..."
  }
}


订单查询：

GET /api/v1/billing/orders/:id


未来 webhook：

POST /api/v1/payments/wechat/webhook

POST /api/v1/payments/alipay/webhook


Webhook 必须：

签名验证

幂等

防重复入账


## 17. 升级降级

Standard → Pro：

允许立即升级。


Pro → Standard：

下一个 billing period 生效。


取消：

cancel_at_period_end=true


当前周期继续可用。


V1 不做复杂 prorating。


## 18. Provider

至少支持：

GitHub Copilot

DeepSeek


未来：

Qwen

OpenAI

Claude

Gemini

其它 Provider


禁止业务代码到处：

if provider === ...


必须统一 Provider Adapter。


## 19. Copilot Provider

Admin 可以：

Connect GitHub Copilot

Reconnect

Health Check

查看 Model


流程：

Server Device Auth

→ 管理员 GitHub 授权

→ Runtime 获得 Credential

→ Server 安全存储

→ Provider Ready


普通用户不应该接触 Copilot Token。


## 20. DeepSeek Provider

后台：

Enabled

Base URL

API Key

Timeout

Health


API Key：

只显示掩码。

禁止从后台重新读取明文。


## 21. Copilot 商业使用前置条件

Server V1 可以完成技术实现和私有测试。

但在：

共享 Copilot 账号

多用户提供 Copilot 模型

公开收费

商业发布

之前：

必须核查当前 GitHub Copilot 的服务条款、授权范围和商业使用限制。

不得因为技术上可行就假定：

一个 Copilot 账号可以合法作为多人共享 Provider。

如授权条件不满足：

Copilot Provider 必须能够独立禁用，

不能阻塞 DeepSeek 等合法 Provider。


## 22. 模型目录

Server 自己维护 Model Catalog。

模型字段：

provider

provider_model_id

public_id

display_name

enabled

supports_tools

supports_vision

supports_reasoning

supports_streaming

context_window

max_output_tokens

usage_weight

sort_order


例如：

copilot/gpt-xxx

deepseek/deepseek-chat


## 23. 用量

V1 必须统计：

Requests

Input Tokens

Output Tokens

Total Tokens

Usage Credit

Provider Cost Estimate

Duration

Status


维度：

User

Device

Plan

Provider

Model

Date


## 24. Usage Credit

不能只用 Token 限制套餐。

不同模型成本差别可能非常大。

内部使用：

usage_credit

作为统一套餐额度单位。


每个模型：

usage_weight


用户 UI：

本月 AI 用量 42%


管理员：

可以查看：

Token

Usage Credit

Provider Cost Estimate


## 25. Provider Cost

成本必须区分：

ACTUAL

ESTIMATED

UNKNOWN


不要把估算值假装成精确费用。


## 26. 用量阈值

70%

记录提醒状态


90%

用户 UI 警告


100%

禁止新的模型请求


V1：

不自动超额收费。


## 27. Rate Limit

套餐还包含：

最大并发

RPM


月额度和 Rate Limit 是两套机制。


## 28. AI Gateway

Desktop 统一使用：

GET /v1/models

POST /v1/responses


服务端负责：

Auth
↓
Device
↓
Subscription
↓
Entitlement
↓
Quota
↓
Rate Limit
↓
Session
↓
Provider Router
↓
Provider


## 29. Tool Call

Server 支持：

function_call

function_call_output


但 Server 不执行用户工具。


链路：

Provider
↓
function_call
↓
Server
↓
Desktop
↓
Local Tool Bridge
↓
本地 read/edit/shell
↓
function_call_output
↓
Server
↓
原 Provider Session


## 30. 本地文件

Server 禁止：

主动读取 Desktop 文件

执行 Desktop shell

扫描 Workspace

上传本地文件系统


本地 Agent 能力全部属于 Desktop。


## 31. Release

网站提供：

Windows 下载


后台管理：

Version

Channel

Platform

Arch

Download URL

SHA256

Release Notes

Published


未来支持：

Stable

Beta


## 32. 用户中心

用户中心至少：

概览

订阅

AI 用量

设备

可用模型

软件下载

账号


## 33. Admin

至少：

Dashboard

Users

Devices

Plans

Subscriptions

Usage

Orders

Providers

Models

Releases

Audit

System


## 34. V1 不做

不做：

远程文件系统

云文件

RAG

Vector DB

远程 shell

远程桌面

企业组织

复杂团队权限

代理商

工单

短信

复杂 BI

自动超额扣款

复杂退款系统

Kubernetes

微服务拆分


============================================================
