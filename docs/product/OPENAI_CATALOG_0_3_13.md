# GPT 接入与目录同步

本文记录 0.3.13 的历史行为。0.3.14 已接入真实 GPT 中转，并取消向客户端展示待配置模型，当前流程见 [GPT 中转与模型开放](RELAY_MODELS_0_3_14.md)。

后台 OpenAI 连接支持先保存配置，不要求 API 充值或真实生成。`POST /api/v1/admin/providers/:id/connect-openai` 默认 `verifyGeneration=false`，API Key 可稍后添加，留空保留已有加密凭据。模型 ID 必填；预置 gpt-6.1-sol、gpt-6-astra、gpt-6-luna，也可填写其他真实 API 型号。保存无模型或目录网络调用，不扩大用户权限，不创建费率。

仅显式勾选生成检查时执行模型目录和两次受限原生 Responses 请求，该操作消耗供应商额度。检查成功后实例仍需显式启用，并配置正式费率和用户/套餐权限。预置型号的声明能力来自 [OpenAI 官方模型目录](https://developers.openai.com/api/docs/models)，不是用户 API Key 的权限或真实生成验证。Sol/Astra 不显示不受支持的 none 普通模式。

`/v1/models` 及 `/api/v1/models` 展示已启用且授权的逻辑模型，选择状态与路由就绪分离；新增可选字段 availability（READY/SETUP_REQUIRED/UNAVAILABLE）和 statusMessage。待开通不会进入路由或产生消费记录，用户 DENY 优先于套餐授权。客户端刷新最新目录，服务端在每次请求仍独立验证权限和实例状态。

OpenAI 原生 Responses 使用现有 OpenAI 分支，不进行 DeepSeek 工具适配，不执行工具或新增 agent loop。429 insufficient_quota/billing_hard_limit_reached 显示上游 API 额度不足；普通供应商 429 仍显示繁忙。

App 0.3.13 每 5 秒同步账户余额/用量/设备和授权模型列表，慢查询去重，故障恢复后继续同步；保持选中模型，不自动改变既有会话模型。交易历史沿用打开账户/焦点完整刷新。后续增删模型、授权或余额数据变化不需要重新发 App。OpenAI Key 仅在后台管理。
