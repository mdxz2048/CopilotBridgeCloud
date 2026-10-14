# GPT 带图失败及失败记录模型名（2026-10-14）

11:03（北京时间）的 App 0.3.14 失败报告为 `UNSUPPORTED_CAPABILITY`，实际 Cloud 模型 `openai/gpt-6-sol`，客户端原始型号 `gpt-5.5`。请求含一项高细节图片。路由在供应商调用前因实例 `vision=false` 拒绝；同一账号随后有 GPT 文本成功记录，因此不是账号余额、整个 GPT 服务不可用或一次异常封锁新会话。

根因是 `probeOpenAIResponses` 仅验证文本和流式工具，将 vision 固定写为 false。合成图片直连中转证明 GPT-6 Sol 能识别红色方块。现在管理员能力检查增加独立的合成 PNG 识别请求；仅完成且正确识别时写入 `vision=true`，图片检查不支持或失败时保留文本工具能力并标记未验证，不把客户图片用于检查。

线上 GPT 实例重新执行能力检查，通过后开放图片能力，并将逻辑模型图片属性同步为 true。客户端从现有模型目录自动同步，App 版本仍为 0.3.14，不重新发布安装包。

10:23 的两项报告来自 0.3.13，错误为 `CLIENT_UPGRADE_REQUIRED`，没有进入模型转发。旧失败页用客户端 model 兜底显示 Cloud 模型，导致 gpt-6-luna/gpt-5.5 看起来像实际调用了其他服务端模型。API 现分离 `model`（forwarded）与 `clientModel`（desktop）；没有 forwarded 时 model=null。后台显示“实际 Cloud 模型 / 客户端原始模型”，未进入转发明确标注“未转发到模型”。

当前开放目录仍为一个 DeepSeek Flash 和一个 GPT-6 Sol，每次请求只使用 Bridge 选中的一个模型。改变官方客户端原始 model 不扩大账号权限、不切换 Cloud 实例或绕过服务端检查。

验证：API 133 项、独立数据库 30 项、Web 15 项及 API/Web 构建通过；失败页面 480/1000 宽度显示与滚动检查通过。真实客户端代理图片 JSON/SSE 及余额结算以 `docs/acceptance/gpt-vision-20261014-client.json` 为准；没有重启当前官方桌面宿主。
