# 模型能力拦截核查与余额策略（2026-10-14）

用户明确要求余额不足、账号锁定阻止使用；此前“余额只警告”的要求已被本次指令替代。请求次数、并发和周期额度仍不增加硬限制。此审查检查 App 协议转换、本地代理、Cloud 权限/路由/计费、实例能力和实际上游响应，使用合成提示，不重放用户私人任务。

## 已修正

| 问题 | 根因和处理 | 验证 |
| --- | --- | --- |
| GPT 图片被拒绝 | 旧能力探测硬编码 vision=false；此前发布已改成合成 PNG 实测，并打开已验证实例/逻辑模型的图片能力 | GPT 图片 JSON/SSE 已通过；当前 DeepSeek Flash 也通过合成红色图片识别 |
| 输出预算统一压到 32,768 | 两个模型 maxOutputTokens 未配置，触发 gateway 保守缺省值；通过管理员模型 PATCH 设置准确预算 | DeepSeek 上游目录给出 context=1,048,576/output=393,216；GPT 用户中转预设 context=1,050,000/output=128,000。合成短答请求携带大预算被接受，本地代理也完成；并非实际生成几十万 Token 的长文压力验收 |
| 新会话受前一次异常影响 | 单次超时/500 将共享实例冷却60秒；现在记录 DEGRADED，但立即允许后续请求 | 单实例数据库故障注入：idle timeout 和 HTTP500 后的新会话立即200。实际供应商429保留退避；密钥无效/供应商余额耗尽仍需管理员修复 |
| 余额不足继续调用 | 原 preflight 只检查费率 | 钱包余额<=0返回402 INSUFFICIENT_POINTS、明确中文提示，在创建上游调用前拒绝；管理员充值立即生效，无需审核 |
| 余额状态混同月额度 | App 把余额不足转换为 QUOTA_EXCEEDED，提示与恢复不合适 | 新 BALANCE_REQUIRED 服务状态保留登录，提示联系管理员充值；5秒策略同步自动恢复。锁定提示优先于余额提示，解锁同样自动同步 |

模型预算由服务端管理，客户端无需知道供应商限制。未配置的其他模型仍使用保守缺省值；不得将未经检查的新型号直接宣称已验证。

## 上游限制与当前未实现能力

| 项目 | DeepSeek Flash | 当前 GPT 中转 |
| --- | --- | --- |
| 普通本地 Agent 函数工具、续接、并行结果 | 支持；Bridge 只转换协议，不执行工具 | 支持、按 OpenAI Responses 格式转发 |
| 图片输入 | 已验证支持 | 已验证支持 |
| 思考 + tool_choice required/指定函数 | 上游实际400：Thinking mode does not support this tool_choice，保留准确错误；normal 或自动选择可用 | 普通模式工具调用已验证；深度思考尚未验证 |
| GPT 深度思考 | 不适用 | 合成 low 请求被接受，但 reasoning_tokens=0 且没有 reasoning 项，不能据此宣称已验证；只开放普通模式 |
| 原始 input_file / 音频内容 | Responses 不能这样输入；保留提示。客户端本地文件读取工具仍可提供文本 | OpenAI 配置路径不套用 DeepSeek 内容白名单；上游是否支持具体媒体仍由实际供应商决定 |
| 内置 web_search/file_search/code_interpreter/MCP 等 | 供应商 Responses 当前不执行这些内置工具；本地已绑定函数工具可用 | OpenAI 路径保留原始工具类型，不套 DeepSeek 白名单 |
| namespace / 非 apply_patch 自定义工具 | 当前 Bridge 把桌面可执行工具适配为函数；不直接发送供应商不支持的原始定义 | 原生 OpenAI 路径保留 |
| 加密/摘要思考历史 | 缺少明文时无法安全重放给 DeepSeek，需新会话；有明文思考正常续接 | 不套用 DeepSeek 历史检查 |
| background / 上游 conversation 引用 | 上游本身不支持 | Bridge 当前同步计费/会话隔离未实现此生命周期，仍明确拒绝；不能归因为 GPT 模型缺少能力 |
| prompt模板/context_management自动压缩 | 当前 DeepSeek路径拒绝，不能假装已经执行 | OpenAI路径保留字段；实际支持取决于中转 |

供应商说明：[DeepSeek Responses](https://api-docs.deepseek.com/guides/responses_api/)、[价格与上下文](https://api-docs.deepseek.com/quick_start/pricing/)。实际上游400和模型目录优先于泛化的能力猜测。GPT 证据来自当前用户第一把中转密钥的合成调用，不代表官方 OpenAI 付费路径已验收。

## 保留的边界

账号/设备身份验证、账号锁定、模型启用和授权、有效套餐、最新客户端检查保留。接口请求体64MiB；SSE单事件缓冲8MiB；本地会话历史缓存2小时。工具 call_id 与账号/设备绑定必须匹配；同一会话切换模型/思考配置要新建会话。供应商响应头等待60秒、空闲5分钟、总时长65分钟；用户取消仍结束当前请求。这些不能描述为任意文件/无限长请求均可透传。

计量异常/缺少最终usage仅记录待核对，不自动锁用户、不阻止余额为正的新会话；管理员调整余额立即入账，不需额外审核。已开始的请求若最终费用超出可用余额，扣除当时可用余额至零，UNPAID记录额定费用与实扣差额；并不是预扣最大输出预算。幂等结算不重复扣费，后续请求明确阻止，充值后可恢复。

## 验收

API143项单元测试、独立数据库30项通过；App210项测试通过。实际编译的本地代理经公网Cloud测试余额拒绝/充值恢复、DeepSeek→GPT→DeepSeek、JSON/SSE、GPT工具续接及7次实际扣费。真实React组件在480/1000像素、浅色/深色检查余额状态、模型控件恢复和无横向溢出。安装包逐文件核对ASAR；公开HTTPS下载由服务器Node执行相同App UpdateManager并核对SHA达到READY。

没有安装/重启当前开发宿主，没有重新运行官方桌面GUI原始用户任务。客户端能力、打包和本地代理测试不能代替完整官方GUI验收。

本次后续邀请/更新弹窗/成本记录见 COST_OBSERVATIONS_AND_INVITES_2026_10_14.md。
