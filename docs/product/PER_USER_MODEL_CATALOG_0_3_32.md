# 每用户模型目录（0.3.32）

## 接口变化

`GET /v1/models` 的每个模型增加可选字段：

- `display_name`
- `context_window`
- `max_output_tokens`
- `effective_context_window_percent`

字段为向后兼容的可选扩展；旧客户端忽略，新 Bridge 用它们生成 Codex `model_catalog_json`。

## 取值

- `display_name`：逻辑模型显示名。
- `context_window` / `max_output_tokens`：来自模型配置；未配置时 Bridge 使用命名空间回退。
- `effective_context_window_percent`：百炼连接为 75，其他为 95。

模型列表仍只返回“已启用 + 当前套餐/用户有权限 + 资源可路由”的逻辑模型；目录由 Bridge 按用户本地生成，不需要平台写用户 ChatGPT 配置。

## 兼容

- 旧 Bridge 不读取新字段，行为不变。
- 新 Bridge 对旧 API 缺字段使用保守回退，不扩大模型权限。
- 未授权模型请求由 Bridge 返回 403，不静默切换到其他模型。
