# 百炼图片输入与完整上下文（2026-11-16）

## 现象与根因

- 0.3.32 客户端选择百炼模型后，带图请求返回 `422 UNSUPPORTED_CAPABILITY`，桌面 catalog 也把百炼模型声明为纯文本。
- 根因不在供应商：百炼 Responses 端点接受 data-URL 图片。问题是 `connect-bailian` 导入时把 `supportsVision` 硬编码为 `false`，同时 `gateway.ts` 把百炼的 `effective_context_window_percent` 固定为 75。
- 数据库中的 `bailian/*` 模型行与 `model_instances.capabilities` 也都是 `vision=false`，因此单改代码不会自动生效。

## 代码修复

- `bailian-catalog.ts`：每个预设显式声明 `vision`。经 Responses 图片探测通过的为 `qwen4-max`、`qwen3.8-flash`、`qwen3.7-plus`、`qwen3.8-27b`、`kimi-k3.1-pro`、`deepseek-v4.1-flash`、`deepseek-v4.1-flash-1017`、`deepseek-v4-pro-0813`；`qwen3-coder-flash`、`glm-5.3` 保持 `false`。
- `admin.ts`：导入以探测结果为准（探测通过且 `vision=true` 才保留），未验证时回退到审阅过的预设声明，不再一律写成 `false`。
- `gateway.ts`：百炼 `effective_context_window_percent` 75 → 100，与 1,000,000 上下文窗口一致。

## 生产变更

- API 镜像 `src-api:latest`（`70b1b4ddb03d`）已替换运行容器 `src-api-1`，`/health` 200，容器内为 `isBailianProvider(providerCode) ? 100 : 95`。
- 既有模型行按同一审阅结论做了一次定向数据回填：8 个 `models.supports_vision=true`、2 个保持 `false`，并同步 `model_instances.capabilities.vision`；未改动 `enabled` 状态、价格或用户授权。审计记录 `BAILIAN_VISION_BACKFILL`。
- 最低兼容客户端仍为 0.3.28；桌面 catalog 的上下文与视觉声明需要 0.3.33 客户端才会重新生成。

## 验证边界

- 已验证：镜像内容、容器生效值、模型与实例能力回填、`/health`、公开 `releases/latest` 与 `client/config`。
- 未验证：没有用真实账号发起付费图片生成，也没有运行官方 ChatGPT 桌面 GUI 的图片任务。用户实际测试仍待完成。
