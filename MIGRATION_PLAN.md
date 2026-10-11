# CopilotBridge 最小演进计划（Phase 0 输出）

日期：2026-10-11。基线、已验证范围及实际差距见 [CURRENT_ARCHITECTURE.md](CURRENT_ARCHITECTURE.md)。以下是待执行计划，**本轮未实施任何 Phase 1–5 代码或数据库变化**。

## 1. 不变量和目标

```text
官方 ChatGPT / Codex / 兼容客户端
  → Local Bridge（上游协议兼容，不运行 Agent）
  → Cloud（鉴权、逻辑模型权限、预算）
  → Logical Model
  → Instance Router
  → 既有 ProviderAdapter（原生或必要转换）
  → DeepSeek 资源
```

不增加 planner、Agent loop、memory、OpenAI Agents SDK 或产品 subagents；不接管上游工具执行。保留既有 Copilot/LOCAL/Mock 代码但不继续开发 Copilot SDK、OAuth、session/runtime。保留账号、设备 UUID/证明、订阅、ACL、历史模型 ID、密钥加密、钱包/usage/账本与发布升级链路。

不因为需求示例改成旧 DeepSeek 名称；不在没有实时官方资料和真实探测时打开 vision/thinking/structured output 标志。客户端只暴露可使用的逻辑模型和真实 normal/thinking/auto，资源与密钥仅由 Cloud 控制。

## 2. 最小修改集合

| 集合 | 必要变化 | 复用对象 | 不必做的工作 |
| --- | --- | --- | --- |
| 模型资源 | models 逐步逻辑化；增加模型与现有连接的实例绑定/状态字段 | models/providers/两套现有 credentials/ACL | 新建第二套 Provider、密钥、用户和钱包表 |
| 路由 | Cloud resolveInstance；可用性/能力/协议筛选；priority/weight；续接固定实例 | requireEntitlement、providerFor、model_sessions | 客户端选资源、负载/成本优化算法 |
| 协议 | 保留请求语义；扩展 output/SSE；能力拒绝；原生/翻译分流 | 现有 schemas/RemoteBridgeServer/Gateway/ProviderAdapter | 另建一套 Adapter 或聊天应用 |
| DeepSeek | normal/thinking/auto、推理历史、参数/事件/usage/错误完整映射 | DeepSeekProvider + rating/metering | 以 low/medium/high/xhigh 假装 DeepSeek 原生能力 |
| 观测与测试 | 跨层 IDs、结构化错误、内容脱敏、匿名 corpus 和真实验收 | BridgeTrace/request-log/现有测试及脚本 | 全局 MITM、默认记录私人正文 |

## 3. Phase 1：复用表完成模型与实例分离

### 推荐数据方案

继续使用 `models` 作为 Logical Model，保留 id/publicId/displayName/enabled 和 ACL。现有 `providers` 暂作为连接资源记录（含 endpoint/timeout/启用），添加明确 providerKind，消除依赖 `DEEPSEEK_<随机码>` 判断类型；保留 code 为兼容标识。

仅增加一张 `model_instances`：表示“一个现有连接所提供的某个上游模型”，而不是另一套账号/密钥资源系统。建议字段：id、modelId、providerId、providerModelId、enabled、capabilities、nativeProtocols、priority、weight、healthStatus、healthCheckedAt、healthReason、cooldownUntil。能力中明确 reasoningModes、支持的输入类型和工具/结构化输出限制。健康 UNKNOWN/READY/DEGRADED/UNAVAILABLE 的资格规则要明确；不要把过期 UNKNOWN 当永久 READY。

管理密钥仍通过 providerId 引用 `provider_credentials`。既有 BYOS account/credential 不迁入公共资源池；若将来支持专用资源，用既有 providerAccountId 引用并在 Cloud 检查归属，不创建平行 account 表。本阶段公共客户端不再选择账号/实例。是否允许用户专属资源池是独立业务策略，不能通过抹掉归属限制顺便实现。

`models.providerId/providerModelId` 过渡期保留为旧路径默认绑定，不立即删列。每个旧 model 精确生成一个实例，先保持单实例行为。此处新增绑定表是当前一个模型对多个后端关系所必需；不新建 logical_models 与 providers 平行域。

### 身份、ACL 与历史迁移

1. 全量核对 models、Provider、ACL、rate cards、sessions、ai_requests 与 usage 外键引用，制作不含秘密的迁移清单。
2. 新增表与 nullable instanceId 等字段，回填旧模型的一对一实例；不得修改历史 usage 或 ledger。
3. 将多个资源挂到一个逻辑模型应由管理员显式确认。不要自动合并有不同 ACL/成本/专用资源含义的旧模型。
4. 旧 publicId 可作为兼容 alias 解析到旧逻辑模型；是否以后映射到公共逻辑模型需逐用户计算原 ALLOW/DENY，不能 union 权限或自动放宽。旧模型先可隐藏但继续解析；不删除历史外键目标。
5. 权限若只是逻辑模型 ACL，则用户不能要求具体资源。如需专用 DeepSeek Key，提供 Cloud 内部路由策略/资源池绑定，独立于客户端模型 ACL。
6. 客户端展示与管理站分别改成逻辑模型选择、资源配置/绑定。保留旧设置读取兼容，不再发送 managed 实例选择头；旧 BYOS 接口另行受限保留。

收费最小方案：继续以现有 rateCard(providerId, modelId, policy) 表示该逻辑模型在具体连接上的费率，执行前固定 version，暂不同时拆出新价目域。原历史费率不改。多个 instance 若同 provider/model 但上游模型不同或售价不同，当前唯一键不足；Phase 1 评审后只扩充该表的适用维度，不挪用 usageWeight。客户售价和实例成本必须有明确区分，报价一致性要在选路前约束。

验收：单实例行为等价、旧模型 ID 可解析、ACL 不扩大、密钥不出 Cloud、账本/usage 外键与金额不变、关闭连接会影响该实例而不错误停用其他实例。

## 4. Phase 2：Cloud Instance Router

请求顺序：身份/设备 → 逻辑模型 ACL → 请求能力识别 → 续接查找 → 合资格实例 → 原生协议优先 → priority → 同优先级 weight → 固定实例与价格 → 预算/RPM预检 → Adapter。

- 先筛 enabled、健康资格/TTL、模型/输入/tools/reasoning/structured output 能力；原生优先只能在满足能力的实例中进行，不能越过授权。
- 第一版只实现确定的 priority 和 weight；负载、成本和复杂健康探测稍后。管理 health 已可复用，但目录成功不证明生成能力。
- `model_sessions`、`ai_requests` 增加 instanceId；会话记录 inputProtocol、outboundProtocol、native/translated。工具续接和有状态 previous_response_id 固定实例及模式，避免跨 Provider 使用私有状态。
- 重新校验账号/模型/资源状态和限额；锁定/撤销对后续请求立即生效，已输出的请求不能撤回。状态禁用后不静默改路由，明确返回会话/资源不可用。
- 只在没有上游执行/输出且明确可重试时降级；一旦发出可能计费的 POST、收到任何 token/tool call 或使用 Provider 私有历史，不盲目重试另一实例。记录 attempt，不重复执行工具或生成第二账单。
- 继续使用既有用户预算预留；共享上游余额不是硬额度锁。资源级并发/预算预留可补在既有 Cloud 控制层，不能靠客户端显示防止过度消费。

验收：逻辑模型可对应两资源；禁用/能力过滤/无资源/priority/weight/native 优先正确；续接固定；切价不重算进行中的请求；失败不会跨账号或扩大权限；并发限制/费用回归通过。

## 5. Phase 3：DeepSeek 完整可靠的转换路径

先对当前目录实际模型整理官方能力资料及日期，使用隔离非敏感 fixture 验证普通文本、思考、思考+工具、并行工具、图片和结构化输出；目录读取不足以确认能力。

沿用 DeepSeekProvider，不新增第二个 DeepSeek Adapter：

- 根据逻辑模型和实例能力定义 normal/thinking/auto；auto 明确为平台策略及默认值，不冒充上游 API 参数。既有 effort 设置升级时迁移为合法模式，不能按名字猜映射。
- 正确传递 instructions、工具选择/并行约束、输出格式和输出预算；翻译路径不能实现的字段明确拒绝并指出 unsupported capability/protocol，而不是静默删除。
- 思考的 reasoning_content/Provider 私有历史如何保留和回放要有真实协议证据；思考+工具不能伪造缺失推理。扩展既有会话/cache 表达并保留账号/实例边界。
- 完整处理 tool arguments deltas、稳定 call/item IDs、事件索引与顺序、finish_reason、incomplete/refusal、完成/失败及 usage。不可将 length 截断统称 completed。
- 校验 malformed/truncated SSE、换行/分块边界、取消和背压；错误不暴露密钥或文档。
- 区分上游 auth、rate limit（含可安全使用的 Retry-After）、余额不足、unsupported、timeout、protocol invalid 和 internal。quota/rate/provider 原因分别返回，避免官方客户端因误分类反复重试。
- 使用缓存与推理 token 子集结算；上游实际价格与本站费率分开。UNKNOWN 成本保持未知，部分生成无 usage 保留审核标记。

验收：JSON/SSE 文本、工具输出续接、思考与思考工具链、截断、上游错误、取消、真实 usage/cache/reasoning 及账本测试。所有 capability 标志须与证据一致；未支持模型不展示可用思考开关。

## 6. Phase 4：原生协议优先与必要转换

扩展**现有** ProviderAdapter 的协议能力声明和请求执行接口，使结果可表达原生 transport 或翻译结果/事件；保留旧 createResponse/resumeSession 兼容入口。不要新增独立 NativeProviderAdapter 体系。

```text
incoming Responses + native Responses instance
  → 校验平台权限/预算，改上游 model 和认证 → 保留协议语义 → 原生转发
incoming Responses + Chat Completions instance（当前 DeepSeek）
  → 已有 Canonical 的转换路径 → DeepSeek → 完整 Responses 输出
incoming Chat Completions + native Chat Completions instance（如需开放入口）
  → 同协议转发，不强制先 Responses/Canonical
```

原生路径也要经过 auth/device/ACL/预算/计费/日志/取消；不能把“透传”做成绕过控制的代理。允许模型替换和认证隔离，不盲目透传客户端 Authorization、内部 Cookie、任意 URL。未知字段和未知 SSE 事件在原生路径保留；转换路径显式能力判断。以前冻结 V1 schema 缺字段，需制定 additive 兼容扩展/新协议 revision、同步两端 contract 与生成 artifact/hash，不直接改旧 hash 却仍称冻结。

计费从原生终止响应/事件旁路观察 usage，不能为取数重组全部协议事件。本站点数建议采用约定的扩展 header/usage 命名空间或既有 settlement 查询；具体 wire 位置必须由官方兼容测试确认。对 lack usage/provider response ID/previous response 的安全归属建立映射；只有客户端实际需要的响应读取/取消等路径才增加。

当前没有已验证的原生 Responses Provider：先使用 fixture server 验证该分流，不为此加入新商业 Provider。此阶段验证架构能原生透传，不宣称 DeepSeek 已提供 Responses 原生服务。

## 7. Phase 5：真实官方客户端兼容验收

在最终阶段进行正式兼容验收，但在 Phase 1–4 开发前可利用现有受限 trace 收集最小输入形状，避免先猜协议。使用专用测试账号/会话和人工创建的非敏感 fixture；不能把用户正在工作的会话当测试资产。

扩展现有日志：timestamp、method/path、trace/request/response/thread/session/conversation/call IDs、logicalModelId、instanceId、provider kind、in/out protocol、native/translated、stream、reasoning mode、tool types/count、tool_choice、parallel flag、previous_response_id、SSE event/index、elapsed/terminal/error category。支持 Local → Cloud → Provider 的共同 trace ID。只记录结构摘要、长度、匿名化关联与必要计数，默认不留正文。

需补齐正文抓取隐私：text/tool args/tool output/file data/image base64/local path/个人信息递归脱敏；使用受控 fixture 的安全样本生成回放 corpus。保留现有轮转上限，正文 capture 有时限/人工关闭/清理；Git 只收脱敏样本和事件序列，不收 key/token/用户文档/raw trace。

正式矩阵：

| 场景 | 需真实确认的链路 |
| --- | --- |
| 普通和长会话 | 多轮 input/previous response/compaction/reference 的实际形状 |
| 工具 | 单个、并行、custom/namespaced、失败、等待超过窗口、Bridge/官方应用重启后恢复 |
| 本地文件 | read/edit/shell 的调用回传，确认执行方仍为官方客户端 |
| 图片 | 粘贴/拖入/文件选择，隐藏 marker，不能提示预期答案 |
| DOCX/PPTX/XLSX/PDF | 原始文件 item、本地读取、提取结果的真实路径；分别验收 |
| 文件产物 | 本地生成、重开验证；下载卡/预览需独立 UI 证据 |
| 思考与预算 | 显式思考、思考工具链、接近余额、限额更新、provider 429/402 |
| 中断 | 取消、超时、网络断开、SSE truncated，核对 request/usage/ledger |

一次普通对话通过不能叫“完整 Agent 支持”；mock 文件工具测试也不能证明官方工具授权/执行或 Artifact UI。未观察的行为明确 UNKNOWN。

## 8. 测试、发布与回滚

每阶段独立提交，包含必要源码、迁移（如有）、contract、针对真实边界的测试和文档。先跑本轮已通过的 15 个客户端/16 个 API 测试作为回归，再补各阶段新行为测试；不把验证当前删历史/关闭思考的旧断言当长期目标。

Phase 1 迁移先在空库及脱敏生产副本执行：FK/ACL/历史 ID、rate-version pin、钱包并发幂等、未结算/重启恢复要真实 PostgreSQL 验证。路由和原生协议可用 fixture 测试；真实 Provider 与 Desktop E2E 单列，记录 runtime/model/build/date、脱敏请求 ID 和预期结果。

发布前验证数据库备份可恢复、旧 API/App 构件、磁盘余量、schema 兼容及 ledger/lot 对账。新路由使用 feature flag，先单实例行为，再内部测试账号多实例；未知状态禁止自动商业开放。先部署兼容新旧客户端的 Cloud，再发布 App，避免请求字段与实例选择行为不一致。

回滚优先关闭新路由/协议策略或恢复旧构件，保留 additive schema/历史 ID 和财务记录；不 drop 新表、不还原生产整库覆盖新账、不重写 immutable usage。已发生计费的修复只能新增补偿账本，并核对在途请求。

## 9. 推荐下一步与退出条件

下一步先做 Phase 1 的字段/回填/ACL/费率身份映射设计评审，再编码单实例等价迁移；同时准备脱敏真实请求样本。随后 Phase 2–5 按门槛推进。

本轮 Phase 0 已完成源码审计、离线基线验证和这两份文档；没有声称线上问题、DeepSeek 思考或官方 Agent 兼容已修复。后续完成标准是：用户只选逻辑模型，Cloud 内部选实例，DeepSeek 普通/思考/工具正确，原生与转换路径有证据，费用及错误可追踪，官方客户端完整流程逐项验收。
