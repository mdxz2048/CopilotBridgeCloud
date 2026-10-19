# 中文故障原因与直接充值入口

2026-10-19，配套 App 0.3.25。

本次 Cloud 运行时代码仅更新钱包不足的中文指引：HTTP 402 / INSUFFICIENT_POINTS 保持，提示改为打开 Copilot Bridge 后点击「充值」，到账后重试。计费、钱包、订单审核、设备与邀请奖励规则不变，无数据库迁移。

App 负责自定义工具参数的窄范围兼容，以及给官方客户端返回中文失败终止。工具参数失败指明工具名称，现有 diagnostics 接口接收的 error.message 与客户端中文原因一致；reply.http / reply.events 保留脱敏后的 toolFailure（toolName、callId、itemId、reason）和原始上游失败/incomplete 事件。沿用既有鉴权、账号绑定、限流、加密存储与保留策略，无共享契约变化。

API typecheck/build 与 metering、diagnostics 8 项单测通过。API 候选镜像构建后校验充值文案，正式健康检查通过。仅替换 API，Web/Postgres/Caddy 镜像保持；未用真实用户余额制造测试故障。

配套验收：App 自动化全量回归；99 个此前真实 DeepSeek 响应离线回放；官方 Codex CLI 在本机隔离 Bridge 的余额不足、工具参数、断流、输出超限四例均显示中文原因。CLI/renderer 验收不等于正式 ChatGPT/Codex GUI 验收。

生产 API：sha256:c7a0125dfdfd31998d007e985052687aa3c86a4c96f32da96937bb5c18a83200。
