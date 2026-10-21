# DeepSeek 服务端适配清单

本文件记录当前 DeepSeek 原生 Responses 兼容处理。后续涉及 DeepSeek 的协议转换或提示约束变更，应同步更新本清单及对应测试、验收结果。历史版本文档用于追溯，不代表当前线上状态。

## 现有边界

| 内容 | 实现位置 | 行为 |
| --- | --- | --- |
| 命名空间与 custom 工具 | App `electron/cloud/desktop-protocol.ts` | 将官方工具转换为可还原的函数别名及 `input` 包装；官方客户端仍负责执行工具。 |
| JavaScript 包装器调用约束 | API `native-responses.ts::nativeToolBoundary` | 仅匹配 DeepSeek 请求中的已知 `functions__exec` JavaScript 包装器，补充准确顶层名称和内部方法边界。见下节。 |
| 已知内部命令调用修复 | API `deepseek-tool-repair.ts`、`gateway.ts` | 在当前包装器与内嵌声明均精确匹配时，将误发的 `exec_command` 参数转换为 JavaScript 包装器输入；不执行命令、不重试生成。见 2026-10-21 记录。 |
| 客户端工具发现历史 | API `native-responses.ts::nativeInput` | 将客户端已执行的 tool_search 历史放入保留关联的文本信封；不把历史定义擅自变为可执行工具。详见 [工具发现历史兼容](TOOL_SEARCH_HISTORY_2026_10_13.md)。 |
| Agent 消息信封 | API `native-responses.ts::nativeInput` | 保留作者、路由和原始内容的历史信封。详见 [工具恢复记录](TOOL_RECOVERY_0_3_11.md)。 |
| 思考模式与强度 | API `native-responses.ts::nativeReasoning` | 根据 DeepSeek profile 映射 normal/thinking/auto 与支持的 effort；按实例能力校验。 |
| 上游历史状态 | API `gateway.ts` | 在账户、设备、模型归属检查后恢复平台历史；上游发送展开后的历史。 |
| 能力与超时校验 | API `native-responses.ts`、`native-timeouts.ts` | 拒绝不支持的输入/服务器会话能力，区分连接、空闲和总超时，保留真实 failed/incomplete。 |

OpenAI profile 不应用本次包装器约束，继续使用其原生工具形状。平台不新增工具执行器或 Agent Loop，不自动重放失败命令，不通过伪造 completed 掩盖错误。

## 2026-10-19：exec_command 被当作顶层工具

### 问题证据

线上加密故障快照显示：同一用户 5 次请求共 5,598 条记录，缺失标记为空。失败请求进入服务器及准备后的工具列表均有 11 个工具，包括 `functions__exec`，不包括顶层 `exec_command`；上游原始 `response.output_item.added` 却返回了后者。绑定审计结果是零候选、`MODEL_TOOL_NAME_UNDECLARED`。前面几轮相同包装器可正常调用。

直接原因是模型输出了未声明的工具。包装器说明中的 `tools.exec_command` 是内部 JavaScript 方法，不能作为顶层调用名。没有发现此次请求丢失声明或触发调用次数上限。多轮上下文与发生概率的关系尚未定量验证。

### 修改范围

只有同时满足下列条件才添加约束：DeepSeek profile；顶层 function 名称为 `functions__exec`；描述包含 JavaScript 编排及全局 `tools` 对象；参数恰好是必填字符串 `input`，并禁止额外字段。普通同名函数、没有该包装器的聊天、OpenAI 请求保持原样。

适配在原 instructions 后追加当前请求的真实 function/custom 工具名称名单及包装器用法，并在包装器描述开头强调入口。保留原任务指令、工具参数 schema、历史顺序、call_id、其他工具、并行语义和流式转发。每次请求重新读取工具表，不使用固定的全局白名单。

期望调用形状：

```json
{
  "name": "functions__exec",
  "arguments": "{\"input\": \"text(await tools.exec_command({cmd: \\\"echo bridge_probe\\\"}));\"}"
}
```

`echo bridge_probe` 只是合成示例。实际模型应传入当前任务要求的 JavaScript。如果 `exec_command` 确实被另外声明为顶层函数，则仍按其 schema 正常调用，不一律禁止。

当时模型输出继续使用既有名称与参数校验，没有输出修复。2026-10-21 增加下述受限的参数转换；其他未知工具仍不自动改名、重试或执行。故障记录增加 `provider_tool_boundary`，保存实际生成的约束内容，便于后续检查适配是否生效。

### 验证与限制

- 本地 API 类型检查与构建通过；API 170 项测试通过，69 项数据库测试在该次普通运行中跳过，不记为通过。
- 原生 Responses 回归共 22 项，其中新增包装器边界测试覆盖 50 轮合成历史、源对象不变、JSON 示例有效、原 instructions/schema 保留、动态声明、单独声明的命令工具及 OpenAI 不变。
- 使用候选模块对真实 DeepSeek Flash 运行 4 项合成请求：短 JSON、25 轮历史 SSE、25 轮历史 thinking SSE、同时声明独立命令工具。均 completed 并返回合法 `functions__exec` 调用；参数解析及内部 `tools.exec_command` 和目标合成命令检查通过。两项长历史各约 123 KiB，分别约 22,357 / 22,409 输入 tokens。
- 上述只生成并检查调用，没有执行本地命令，没有重放用户私人任务。候选模块真实验证不等于官方 GUI 完整任务验收。
- 本次为提示约束，不能保证模型永不输出非法工具，也没有进行足以量化故障率改善的对照实验。后续继续依据加密快照核查。

仅 API 更新，无依赖、数据库 schema、公共契约或客户端安装包变更。部署与运行镜像验收见本次交付记录。

### 部署验收

2026-10-19 已替换 API，镜像 `sha256:d7df017bbf5d769cb020e2f730569d7d65aaf39ab30dd03e8a64576ba3ad6a81`。Web、PostgreSQL、Caddy 镜像保持不变，公网 health 为 ok。运行容器内 `native-responses.ts` SHA256 为 `93802a9fd811af3dd60b5982b06327120b6124b2323525cc9c11bf2e5afb5deb`，与本地候选一致。

从已部署源代码编译出的原生适配模块再次对真实 DeepSeek 运行短 JSON、25 轮历史 SSE：均 completed，顶层名称均为 `functions__exec`，input 结构及嵌套方法检查通过，没有执行本地命令。这是部署容器内 Provider 适配验证，不等于通过真实官方 GUI 完成客户任务，也不能据此宣称故障率为零。

## 2026-10-21：修复误发的内部 exec_command 调用

当天北京时间 11:44 的 0.3.26 / DeepSeek Flash 失败快照无缺失标记。当前工具表含 `functions__exec`，不含顶层 `exec_command`；上游却输出了 `exec_command`，绑定零候选后客户端断开。快照同时确认 10 月 19 日的包装器提示已经下发，提示不能确保模型遵守。断开是工具协议失败的后续结果。

API 新增每请求独立的 `DeepSeekToolRepair`，仅同时满足以下条件才处理：DeepSeek profile；唯一的已知 `functions__exec` 包装器及严格 input schema；包装器描述内当前 `exec_command` TypeScript 参数声明与已知版本完全匹配；当前没有独立或可唯一绑定的命令工具。不会从历史、工具搜索结果或普通说明文本扩张可执行工具表。

只转换精确名称 `exec_command` 的 function_call。参数须是完整 JSON 对象，cmd 是非空字符串，其他字段须符合该声明，拒绝额外字段和超 1 MiB 参数。生成 `text(await tools.exec_command(JSON.parse(<JSON 字符串字面量>)));`，再放入 `functions__exec` 的 input 字符串；保留参数值、call_id、item id、状态及扩展字段。所有代码片段通过 JSON 字符串字面量嵌入，命令内容不会变成额外 JavaScript。服务器只返回调用，工具执行及授权仍归客户端。

流式调用暂存该调用的 added 和参数片段，完整校验后才发送包装器 added / 参数 / done；不同调用独立，正文和推理继续转发。重写 item.done、JSON output 和最终 response.output 保持一致，后续缓存历史也是包装器形状。重复完成或终止时参数/ID 不一致明确失败。适用请求的转发事件重新连续编号（含成功及失败终止），避免暂存与合成事件造成 sequence_number 倒序或重复。OpenAI、普通工具及未匹配的声明不应用本适配。

诊断保留原始上游事件，记录 `repairPending` 和不含命令正文的 `tool_call_repaired`；不能修复时仍返回真实失败。没有新增上游 POST、Agent Loop、工具执行器或数据库迁移，不改变计费规则。已知用量先保留在 observedResult，再进行最终结果转换，转换错误不丢失已收到的真实用量。

验证：API 178 项单元测试通过、70 项数据库用例在普通运行跳过；类型检查及构建通过。独立 PostgreSQL 的新签名网关测试和既有原生续接/计费测试均通过，覆盖 SSE、JSON、缓存续接、调用关联、三次真实数据库结算与钱包对账；数据库及测试容器已清理。当前编译 App 的 normalize / stream translator / terminal output 还原合成调用通过，没有执行命令。

扩展 PostgreSQL 运行 29 项通过、1 项旧安装包保留数量断言失败（v2.db.test.ts 的 release 清理测试）；未修改的生产基线镜像在全新独立数据库上同样复现该失败。本次不修改发布生命周期，也不把该项记作通过。上述均非官方 GUI 任务验收，没有重放私人任务或额外付费生成。部署记录见 `docs/acceptance/deepseek-tool-repair-20261021.json`。
