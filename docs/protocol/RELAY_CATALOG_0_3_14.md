# 管理接口：GPT 中转目录

客户端契约不变。`GET /v1/models` 和 `GET /api/v1/models` 只返回通过授权且存在可用连接的逻辑模型；不再将待配置型号发送到用户选择菜单。实际请求仍独立检查用户、设备、模型权限、实例健康和费率。

管理员 `POST /api/v1/admin/providers/:id/sync-openai` 接收 `baseUrl`、可选 `apiKey` 和 `emptyToolsWorkaround`。地址须为 HTTPS，可填写域名或含 `/v1` 的基础路径。留空密钥保留既有加密凭据。读取该连接的真实 `/models` 目录，导入逻辑模型与实例，新增记录默认关闭且未经生成验证。改变 Key、地址或兼容配置使该资源实例停用并失去既有验证。

`POST /api/v1/admin/providers/:id/connect-openai` 继续支持选择单一型号，新增可选 `baseUrl`、`emptyToolsWorkaround`。验证和保存均使用该资源已配置的地址。`verifyGeneration=true` 执行真实生成及工具检查；新实例不自动启用、不自动扩大用户权限、不创建用户费率。

`DELETE /api/v1/admin/models/:id` 关闭模型及其所有实例，写入归档设置，使其从管理目录消失。历史用量、账单及模型记录保留。重新导入同一上游型号恢复其管理可见性，仍需检查启用状态。

Cloud OpenAI provider 原生转发 Responses。可选空工具兼容只影响该连接的无工具请求：禁用占位定义并设置 tool_choice=none。已有工具、call_id、输出和流式事件保留。占位调用异常直接拒绝；不执行工具，不增加代理 agent loop。
