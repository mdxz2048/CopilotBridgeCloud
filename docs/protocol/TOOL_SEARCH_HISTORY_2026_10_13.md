# DeepSeek 客户端工具发现历史兼容（2026-10-13）

## 问题与结果

官方客户端历史包含 execution=client 的 tool_search_call/tool_search_output。DeepSeek 原生 Responses 不接受这些输入类型，原 validateNativeRequest 返回 422 UNSUPPORTED_PROTOCOL；反复继续会重放同样的历史。

nativeInput 现在把这些记录汇总为历史文本信封，保留原始输入索引、call_id、查询、状态、工具定义和扩展字段。信封位于开头的 system/developer 消息之后、普通会话之前；其余历史保持原顺序，源请求不变。这样，交错的工具发现输出不会插入普通 function_call 与 function_call_output 之间。

这不是重复执行工具发现，也不创建 Agent Loop。实际执行工具仍来自当前请求 tools 和既有客户端别名绑定，历史里的工具定义仅保留为上下文，不擅自创建客户端无法还原的新别名。OpenAI profile 的原始输入保持不变；服务器执行的工具发现以及缺失 call_id/无效 tools 的历史明确拒绝。

## 验证

- 本地 API 127 项通过；普通运行跳过的数据库 29 项另在隔离 PostgreSQL 运行。专门覆盖空/非空发现、原始位置、政策消息位置、交错工具结果、多轮重放、JSON/SSE、OpenAI 透传、异常记录和调用关联防篡改。
- 网关数据库回归增强：初始输入带交错工具发现与普通调用；后续重放和 encrypted previous_response_id 恢复继续通过，多个结果、设备隔离、计费和余额异常后新会话仍使用既有断言。
- 候选镜像真实 DeepSeek：合成内容，normal 模式，每次最多 128 输出 tokens；JSON completed（450 输入 / 4 输出 tokens），SSE 历史重放 completed（506 输入 / 6 输出 tokens，13 个非终止事件）。空/非空发现及普通工具历史正常；未执行本地工具。API Key 只在服务器内存使用，不导出。
- 真实测试先发现逐条信封会使上游找不到普通工具结果，因此最终采用汇总信封以保持工具结果相邻；失败候选从未上线。

仅 API 修复，无依赖、schema、公共契约或 App 变化。App 仍 0.3.13，无需安装新版本。不等于重新运行用户原始 GUI 任务或真实 OpenAI 验收。

## 上线验收

仅替换 src-api-1。运行镜像为 sha256:92198a4076aa9e5af7c0a28eb1eaa07a24382ca04032c386f2efec86e4f528d9，与已验证镜像一致；native-responses.ts SHA256=5b7a534b3ab4b207bb4274322b55726e470e37da34b44c1bde6963b4272fb069，与本地源代码一致；dist/server.js SHA256=9241003beba65bddad55adeb041b73aa59107f6dc5fc36d000aa4f19ee49d9c9。

运行 API 容器内使用同样合成内容再次进行真实 DeepSeek JSON 和 SSE 测试，两次 completed；这是原生 ProviderAdapter 检查，不是原用户 GUI 任务重跑。增强后的网关测试在独立数据库 29/29 通过，数据库确认已删除。health、官网均 200，新版官网保留，App latest=0.3.13，授权 GPT 目录仍仅 Luna SETUP_REQUIRED、DeepSeek 资源 READY。
