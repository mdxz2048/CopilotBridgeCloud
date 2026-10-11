# Gateway additive revision 1.1：0.3.0 执行协议

状态：2026-10-11 已部署；真实normal/thinking工具、财务审计与管理UI生产验收通过。旧 Gateway 1.0.0 的冻结文件/hash 保留为历史契约；新增生成 `openapi.gateway1.1.json` 与 Domain 2.5.0 `openapi.v2.json`，hash见CONTRACT_VERSION.json。账号/设备/财务不变量保留，Domain增量包含模型实例与能力。

## 身份、路径与保真

沿用 `/v1/models`、`/v1/responses`、Bearer 平台认证、设备证明和 `X-Client-Thread-ID`。每次请求重新检查账号、设备、订阅、逻辑模型 ACL、RMB/RPM/并发。客户端不能指定实例/key/任意 endpoint；旧 BYOS 仅按既有所有权受控兼容，不进入管理资源池。

| 字段 | 规则 |
| --- | --- |
| model | 稳定逻辑 publicId；旧 publicId 精确解析，权限不自动合并 |
| input | 字符串或完整结构项；支持的 message/function/推理历史保留次序 |
| instructions | 传递语义；翻译时按规则放入 system/developer，不能丢失 |
| stream | 默认 false；事件按上游协议返回 |
| tools / tool_choice / parallel_tool_calls | 保留函数定义及限制；不支持工具类型明确拒绝 |
| reasoning | 保留对象；新增平台 `mode`，见下一节 |
| text | 保留 format 等结构；翻译实例缺结构化输出能力时拒绝 |
| previous_response_id | 验证账号/设备/逻辑模型/实例归属；无可恢复映射明确失效 |
| include / metadata | 原生保留；翻译仅允许可证明不改变执行语义的元数据，未实现 include 明确拒绝 |
| max_output_tokens | 上游上限、实例限制与预算三者取合法最小值，记录实际值 |
| 未知字段或 input item | 原生保留；翻译不可静默忽略可能改变语义的内容，返回 unsupported protocol/capability |

`input_file/audio/video`、compaction/item_reference 不因 schema 接受就宣称翻译支持。转换需要证据；缺失则返回具体错误。不得把多模态 function output 任意 stringify 为可理解内容并宣称无损。旧 developer -> system、custom tool -> function 别名属于显式转换，保留名称恢复和 collision 校验。

## 思考模式与模型元数据

模型能力新增 `capabilities.reasoningModes` 和 `capabilities.defaultReasoningMode`；沿用旧 boolean。旧服务/模型未返回字段时 App 仅显示 normal。合法 mode 为 `normal`、`thinking`、`auto`；不能发布实例不支持的模式。

- `reasoning.mode=normal`：明确关闭可选思考。
- `reasoning.mode=thinking`：仅在实例支持真实思考时启用；不伪造 low/medium/high/xhigh 强度。
- `reasoning.mode=auto` 或未指定 mode/effort：Cloud 按所选实例的已配置 defaultReasoningMode 解析成 normal/thinking，记录 resolvedMode；auto 不直接发给 DeepSeek。
- 显式 mode 优先于历史 effort；App 用户明确选择时去掉 effort，防止双重设置。
- DeepSeek 官方 Responses effort 为 none/low/high/max：none 关闭思考；normal -> none，thinking 默认 high，auto 按官方默认思考 high；合法显式 effort 保留。官方兼容映射 minimal -> low、medium/xhigh -> high；不能将 minimal 误判为 normal。需要能力驱动，不能把此映射推广到所有 Provider。显式 UI mode 优先，合法 effort 与模式不一致时需清除/拒绝而非双重设置。
- 官网不支持/未验证时 mode 不上架。DeepSeek model 名称来自当前真实目录，不用旧示例覆盖。

推理 Provider 私有历史须保持并在工具续接重放；不能编造或日志输出 chain-of-thought。Responses 对 reasoning 的表达需要独立协议证据；文本推理不冒充加密 reasoning item。

### 2026-10-11 官方资料补充与原生优先

Cloud Agent 实时核对 [DeepSeek Responses](https://api-docs.deepseek.com/guides/responses_api/) 与 [Thinking mode](https://api-docs.deepseek.com/guides/thinking_mode/)：当前 deepseek-flash/deepseek-v4-pro 有原生 Responses；Flash 支持视觉，两者有工具/思考。Phase 0 记录“当前源码无原生路径”仍正确，但其“未验证是否有原生服务”现已被官网证据更新。模型能力上线还须真实 probe，不由目录发现直接打开。

DeepSeek Responses 是 stateless：发送完整 input，不支持上游 previous_response_id/conversation。Cloud 先按安全归属恢复前序历史，再展开 input 并删除上游不支持的引用字段。parallel_tool_calls 在上游被忽略且并行默认 true；false 必须拒绝或选支持约束的实例，不能假称遵守。原生 SSE 没有 `[DONE]`，以 response.completed/incomplete/failed 终止；不得追加破坏原生协议的终止标记。原生失败不静默转换重发可能已收费的请求。

生产真实补充：原生reasoning可能同时带可用plaintext content、summary[]和opaque encrypted_content；有可用明文时整体保留opaque字段续接，不能一律拒encrypted。只有加密/摘要、没有可用明文的推理历史才明确422。thinking模式不支持tool_choice=required或指定function/custom，Cloud在上游前明确422并建议normal或auto；真实normal named200、thinking auto200。

## 实例、路由与收费

复用 models 作为逻辑权限、providers 作为连接、现有加密 credentials；新增 model_instances。已落地字段：id/modelId/providerId/providerModelId/enabled/capabilities/nativeProtocols/priority/weight/healthStatus/healthCheckedAt/cooldownUntil/createdAt。protocol 值 `responses` / `chat_completions`；weight范围0..100000。没有新增healthReason持久化列。

新实例必须验证 READY 后对用户可用。旧一对一回填 UNKNOWN 可通过兼容路径暂用，但标注未验证，不扩大能力。筛选顺序：授权模型 → 续接实例 → enabled/健康/能力 → 原生协议优先 → priority 降序 → 同组正 weight；weight=0 停止新分配，但已固定实例的续接仍可继续（enabled/健康/能力仍检查）。enabled=false停用所有请求，不能用weight0冒充完全停用。续接不重新随机选实例。无合格候选返回模型不可用/能力不支持。

READY暂无自动TTL，记录check时间并在成功请求刷新；DEGRADED冷却60s后可尝试，认证失效UNAVAILABLE需admin check恢复。不做可能重复付费的自动跨实例重试。Cloud加密history最多900k、TTL1h、仅最后response ID；请求同步清过期history，每5分钟unref清理器清空到期state，最坏物理保留1h+5min。Local不可变response snapshot覆盖App前序分支。

请求/会话记录 instanceId、provider、inputProtocol、outboundProtocol、native/translated、resolvedMode、费率版本。客户售价与账号余额/实例成本分开。先固定实例/费率再预留预算，历史 rate cards 不改。私有状态或已发可能收费请求后不跨实例重试。禁用用户/实例/模型在下一请求立即生效。

## 续接与响应

Local 与 Cloud 共同维护受限响应映射，key 至少隔离账号、设备、model、instance。response_id/call_id/thread/session 只关联所属上下文。完整历史与 previous_response_id 同时存在不得重复拼接。重复工具输出、call_id 篡改、跨会话、未知 reference 应拒绝并带请求 ID。长等待、App 重启后恢复需真实测试；不能通过取消所有权检查修复失效。

翻译 JSON 返回稳定 item/call IDs、completed/incomplete/failed 状态与合法 usage。`finish_reason=length` 对应 incomplete；工具输出不是普通文字消息。SSE 保证 item/index 一致、added -> delta -> done -> terminal；function arguments 必须有增量与结束事件，不重复完成。无消息的纯工具输出不先伪造空 message。reasoning/refusal/unknown event 只按真实语义处理；原生 SSE 保真，旁路观察 usage，不重组私有未知事件。

断连中止上游并清理 reader。SSE 已建立后的错误发单一失败终止事件，不再写 HTTP error body；原生协议保持其终止语义。必须记录实际终止原因，不能以HTTP200证明生成成功。

## 错误契约

沿用 `{error:{code,message,requestId}}`，增量支持 category、retryable、retryAfterSeconds（如有可信来源）、safe details。具体 code 与源码需生成同步；下表 category 是跨层稳定语义。

| category | HTTP 建议 | 行为 |
| --- | --- | --- |
| auth | 401 | 平台token问题；上游key失败不要求用户重新登录 |
| permission | 403 | 用户/设备/模型权限拒绝 |
| quota | 402/403 | 钱包/周期额度或上游账号余额不足，标明scope |
| rate_limit | 429 | 平台RPM或上游限流区分scope；不能假造Retry-After |
| provider | 502/503 | 上游认证/资源不可用；消息不含key/上游私密body |
| timeout | 504 | 已可能消耗时不自动重发 |
| unsupported_capability | 422 | 请求能力不支持，给字段/能力名 |
| unsupported_protocol | 422 | 原生未知结构在转换路径不可表达 |
| invalid_request | 400 | 类型/格式/归属错误；不回显原始敏感input |
| internal | 500 | 安全消息+requestId |

使用现有错误code时也应满足语义分离。平台rate_limit与并发拒绝不得用上游RATE_LIMIT误表示。provider 401 不回用户平台401；SSE 错误沿同类别传回。用户可以凭 requestId 找到实例和终止原因。

## 观测、内容与预算反馈

跨层 trace/request/thread/response/call IDs、model/instance/provider、protocol/strategy、mode/resolvedMode、stream、工具类型/数、事件索引/终止原因入摘要日志。默认隐藏 prompt、instructions、推理、工具参数/结果、文件/图片/base64/local path 和 token。敏感值不因键名未知而泄露；大entry降级也须脱敏。默认不抓官方其它网络请求，不安装MITM证书。

10000点=¥1；既有 settlement 获取账号预算，并在每次完成/失败后触发客户端更新。Gateway改写本站response ID/逻辑model，并保留既有usage点数扩展；这是受控协议改写，不是byte-identical透传。最终终止事件等待结算后发送。官方UI兼容未知部分不据此宣称通过。无usage但可能消费保存审核状态并限制后续消费，不伪称免费。资源余额标注共享账号CNY余额，模型usage仅本站。

2026-10-11 Cloud Agent核对[官网定价](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)与money-pricing.ts一致：CNY/百万token，Flash低峰输入/缓存输入/输出=1/0.02/4，高峰2/0.04/8；Pro低峰4.5/0.15/13.5，高峰9/0.3/27。此为当日资料，不是长期固定官方承诺；本站收费仍按请求固定rate version与倍率，不能重算历史。

### 取消/未知消费的管理员核对

真实中断可能产生METERING_ERROR且客户扣费0；原有预检阻止该用户继续消费，保护不能靠删除usage解除。复用system_settings追加`billing_review:<eventId>`和auditLogs，不修改不可变usage/钱包/账本，不伪造供应商零成本。

管理员 GET `/api/v1/admin/usage-events/review` 按userId限定待核对METERING_ERROR/UNRATED；POST `/api/v1/admin/usage-events/:id/review`，body `{resolution:'platform_waived',reason:<1..500非空>}`，同源Origin检查。一次事务锁定event并追加actor/time/reason/supplierCostKnown:false的review与审计；同event重复提交返回已有review、alreadyReviewed:true，不重复核销。平台承担未知上游成本，此操作不是退款、不修改已知usage收费。用户详情仅显示自己的待核对，成功后刷新限制；不得恢复独立用量页。新增review routes已生成封板，Domain hash20269272…a8ee6a8、完整contract10/10 PASS。

## 合同验收

Cloud/App 对同一 fixture 核对请求字段、JSON output、完整SSE序列、tools + thinking、previous response、取消、unknown字段原生保留/转换拒绝；确认两端schema和生成OpenAPI/hash一致。内部 E2E 补充真实模型和官方客户端版本，公开仓库仅提交匿名fixture和摘要。
