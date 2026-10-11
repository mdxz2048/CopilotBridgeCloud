# 文档工具多调用与健康状态 hotfix

日期2026-10-11。状态：服务端修复已部署，真实普通/思考模式均通过多工具回环与续接验收。App维持0.3.4，本次功能修复不要求重新打包客户端。

## 真实故障链

Root对齐真实日志：11:45:53上游多tool被Bridge人工判失败，随后实例冷却60秒；11:46:22固定实例续接409，11:46:41新请求503。相关两个请求imageParts=0/fileParts=0，因此本次链路不能归因为图片能力缺失，也不能据文档任务报错推断raw附件未支持。无私密文档/工具参数正文入本报告。

## 最小修复

移除DeepSeek串行人工单call阻断、单调用指令注入及工具缓冲；按原生Responses顺序保留多个function/custom tool事件、稳定索引/ID、delta/done/completed与原有usage。不得将多个合法调用改为response.failed、丢弃调用或重复上游POST。工具由官方/外部Harness授权并执行，Bridge不加入执行器或Agent loop，不替官方规划串行/并行。

只对真实Provider资源故障调整健康/冷却：上游认证、服务不可用/超时/限流等按明确分类处理；Bridge兼容错误、用户input/unsupported能力或协议错误不能使资源进入冷却，更不能由本次平台错误污染其他用户候选池。固定续接与账号/模型/实例权限边界保留，真正资源禁用仍拒绝。

此更改撤销0.3.1–033人工串行guard产品行为，不能宣称仍保证parallel_tool_calls=false单调用。DeepSeek官方忽略该字段，平台应保留实际native行为并说明上游限制；多工具是否执行/允许由外部Harness决定。历史报告保留为当时事实，本hotfix为新策略。

## 验收门槛

| 场景 | 要求 | 状态 |
| --- | --- | --- |
| 原生多tool | JSON/SSE多个call按顺序完整透传，input/arguments delta与final一致，无人工failed | PASS：原生JSON/SSE测试、真实normal/thinking各2调用 |
| 不注入/缓冲 | 无serial指令或held工具事件，既有request字段/事件顺序保留 | PASS：无注入/无缓冲回归 |
| 健康分类 | 用户/Bridge协议错误不冷却；真实上游资源失败仍按类型更新健康 | PASS：健康分类单元与隔离数据库测试 |
| 固定会话 | 修复后续接可用，原call归属/账本不改、无自动模型重POST | PASS：两种模式原会话续接、立即新会话均成功 |
| 文档任务 | 原故障相关input image/file计数和多调用flow对齐，受控fixture可回传工具结果 | PASS：真实固定文档文本+读工具回环；不等于官方拖入UI成功 |
| 构建/部署 | API/DB回归、真实health/日志/新策略与生产代码hash | PASS：107unit、typecheck、21DB、health200和生产hash对齐 |

## 边界

不绕官方host工具policy；官方Word拖入/预览、GUI/真实UAC/host重启未验证。日志imageParts0/fileParts0只说明这些请求没有原始image/file content part，不排除其他会话有附件或工具读取。真实usage/幂等结算/未知成本review保护保留；hotfix不新增账单、不改历史财务。

[最终安全验收报告](evidence/document-hotfix-0.3.4.json)：107单元测试、类型检查、21隔离数据库测试通过。首次并发测试有两个5秒导入超时，限制为2个worker/15秒后全量通过，无测试业务改动。生产API镜像sha256:f73f5a902c61b60a6bb096e05811a321819e1137cec7bcafea3f4b2ff9e085e3，源码与容器hash一致。normal/thinking各4次真实请求全部native completed、每次1次上游POST，无serialHeld事件；各2个固定工具调用全部call_id匹配，原会话续接与立即新会话成功，8次消费合计30点（¥0.0030），临时测试设备已撤销。未运行官方附件拖入界面，不将合成文档文本验收宣称为用户原Word文件的完整GUI重演。
