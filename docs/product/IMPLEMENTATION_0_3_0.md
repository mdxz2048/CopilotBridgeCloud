# Copilot Bridge 0.3.0 产品方案与 LIVE 实施状态

日期：2026-10-11。产品负责人：Product Agent；集成与部署负责人：Root。适用于现有 App 和 Cloud 的增量开发。审计基线见 [CURRENT_ARCHITECTURE](../../CURRENT_ARCHITECTURE.md)，长期迁移约束见 [MIGRATION_PLAN](../../MIGRATION_PLAN.md)。本文件描述目标与执行安排，未完成项不能视作已上线。

## 产品目标

用户先安装官方 ChatGPT/Codex，再登录 Bridge 平台并启用连接；切换连接后只需重启官方客户端，不注销或重启 Windows。保留共享官方会话存储。用户只选择有权限的逻辑模型和该模型支持的真实思考模式；Cloud 管理密钥、连接、实例和路由。Bridge 不增加 Agent loop、工具执行器或记忆系统。

本期解决模型与资源混杂、思考被关闭、请求字段丢失、工具续接与错误难排查的问题。普通文本、工具、思考及费用链路必须形成可复现验收；图片和 Office/PDF 按真实输入形态分别验证，不能统一宣传“全部附件已支持”。

## 用户与管理交互

| 场景 | 用户可见行为 | 产品约束 |
| --- | --- | --- |
| 未安装官方客户端 | 安装按钮可点，Bridge 开关禁用并解释原因 | 安装检查不能以当前开关状态代替 |
| 原账号/Bridge 切换 | 成功后弹窗“立即重启 / 稍后重启”，显示待生效状态 | Bridge 自身保持运行，官方进程退出竞态不报失败 |
| 选择模型 | 显示逻辑名称、可用能力、普通/思考/自动 | 不显示资源 ID、Key、上游 base URL 或 BYOS 选择器 |
| 使用与余额 | RMB 为主，点数次级；每轮结算后更新 | 服务端鉴权/限额是最终依据，客户端数字不是授权 |
| 额度或 ACL 更新 | 下次请求立即按新设置判断；客户端获取最新摘要 | 已经输出的请求不能撤回，进行中费率不重算 |
| 续接资源失效 | 显示“当前会话资源已停用，请新建会话或联系管理员”及请求 ID | 不混用另一个实例的私有推理/工具历史 |
| 模型能力不足 | 显示缺少的能力和操作建议 | 不静默删除文件、思考、工具约束 |
| 上游限流 | 说明模型服务限流，区分平台 RPM 和模型服务 | 不把所有错误返回 429，让官方客户端无限重试 |

管理员导航保留“用户与权限”“模型与连接”“套餐/计费”“发布”。设备属于用户详情；独立用量记录页面不恢复。用户弹窗显示设备、付费/余额/周期消费、RMB 限额、RPM、模型多选和锁定状态。创建/删除用户保留审计及历史财务约束，不通过物理删除破坏账本。

“模型与连接”分为逻辑模型与连接资源。逻辑模型的权限身份稳定，每个模型可绑定多个实例。连接只输入/更新 Key、endpoint 和名称；验证成功后发现上游目录。实例显示模型绑定、上游模型、启用、健康及检测时间、协议、思考/工具/输入能力、priority/weight。Key 保存后仅显示掩码。账号余额标注“该连接账号共享余额”；本站模型用量与站外消费不可混为一谈。售价展示与实例成本/账号余额分别标注。

新增连接不自动扩大用户权限，不自动合并旧模型。不支持/未验证能力展示“未验证/不可用”，不能由模型名字推定。对已有连接新增实例保持旧模型 ID 和 ACL。管理员合并资源到一个逻辑模型需要显式选择绑定。

## 执行边界与职责

| Agent | 写权限与工作 | 首要交付 | 依赖 |
| --- | --- | --- | --- |
| Product | docs 产品、协议、发布门槛及状态 | 本文件、Gateway revision、发布矩阵 | 汇总各 Agent 证据 |
| Cloud | API、DB additive migration、contract、Cloud 单元/DB测试 | 实例路由、固定实例/费率、DeepSeek 思考/SSE/错误、协议策略 | 协议字段约定与官方资料 |
| App | electron、客户端 contract、缓存/trace、相关测试 | 字段保真、逻辑模型/模式、续接恢复、脱敏、0.3.0包 | Cloud additive 元数据与最终字段合同 |
| UI | renderer 与管理站交互/相关组件 | 逻辑模型/实例界面、模式可用性、额度与错误解释 | Cloud API 和 App domain；不得改财务/网关内核 |
| Root | 跨库集成、发布构建、真实验证与部署 | Cloud 先上线、App 后发布、Git 备份、在线报告 | 所有门槛及回滚 |

跨 Agent 修改同一文件需先说明归属。UI 接力前，Cloud 提供管理员端点与实例结构，App 提供模式 domain/回调。协议冲突写回本文件与协议文档，不能两端独立猜字段。

App 已确认 UI 合同：`settings.reasoningMode`，`BridgeModel.reasoningModes/defaultReasoningMode`；旧 `reasoningEffort` 仅用于 LOCAL 兼容，REMOTE 不发送。UI 直接使用这些字段，不并行发明同义设置。Cloud wire 元数据到 BridgeModel 的映射由 App 完成；管理端接口由 UI 与 Cloud 直接协调。

## 实施任务及验收归属

1. **Cloud 数据与路由**：复用 models/providers/credentials，仅新增绑定实例、关联请求/会话实例与协议；旧模型一对一回填。定向测试 ACL 不扩大、实例停用、priority/weight、原生优先、续接固定、并发和账本不变。
2. **两端协议**：保留明确支持字段和未知结构，原生保真，翻译路径拒绝不支持语义；Gateway additive revision 1.1.0。共享 fixtures 覆盖 JSON、SSE、tool arguments、工具返回与前序响应。
3. **Cloud DeepSeek**：官网能力/定价附日期和 URL；已确认官方支持原生 Responses，本期优先落实并真实 probe，保留必要 Chat Completions 翻译兼容。普通/思考/自动、工具推理历史、finish_reason、usage 子集、429/402/401、截断与取消。完整 input stateless、parallel约束与effort按协议文档，不继续以旧“DeepSeek只有Chat Completions”假设消耗开发。
4. **App 诊断与恢复**：默认不保留文本、文件、参数/结果；关联 trace/request/thread/response/call IDs；受限缓存账号隔离，不能延长 TTL 代替归属校验。以前完整私密 trace 不入 Git。
5. **UI**：模型能力驱动控件；Cloud 管理逻辑模型/连接/实例，查看健康时间/账号共享余额/本站用量；在 requestId 与错误建议间建立可理解交互。精简现有界面，不新建聊天应用。
6. **Root 发布**：迁移 dry-run、测试和真实内部账号验收，部署新版 Cloud，构建 0.3.0 安装包、服务端版本/哈希校验、App 升级下载、Git 备份及观察。

用户明确服务器仅本人使用，后续直接替换最新版，不新增部署备份门槛；保留迁移/账本关键验证。

## LIVE 状态（最终证据）

| 项目 | 状态 | 证据 |
| --- | --- | --- |
| 架构/产品/协议 | 完成 | Phase0审计+本期产品/合同/12项上线报告和32节映射 |
| Cloud/API与模型路由 | 已部署、核心验证PASS | API91unit/build/typecheck，image 4be63c09cafa，Flash/Pro原生READY |
| 数据迁移和财务 | 完成 | 0010生产应用；DB19/19、clone旧字段hash不变；平台承担review幂等/财务不改PASS |
| App 0.3.0 | 已构建并published | 113/113完整tests、asar/hash PASS；release96c4ab92-b904-48d3-9a11-4015cbb3c422 |
| UI | REAL_BROWSER PASS | outputs/architecture-real-admin/report.json：待审核空、实例native READY、无独立设备/用量页、390px无溢出、adminFailures0 |
| 真实normal/thinking工具链 | 全部PASS | 官方runtime各连续两轮，thinking4请求native/同instance/COMPLETED/SETTLED、56点/439reasoning tokens |
| 请求计数 | PASS | outputs/architecture-final-db.json：thinking四行rateCounted true,false,true,false |
| 下载/自动升级 | 完成，公开下载/hash READY | outputs/architecture-public-update-030.json：UpdateManager获0.3.0并下载342832124bytes，config.latestVersion0.3.0 |
| Git两库备份 | 待最后push记录 | Root最终发布消息记录commit，避免文档自引用commit |

完整生产工具链证据为REAL_APP_SERVER+REAL_PROVIDER，不是REAL_DESKTOP附件UI。测试账号临时设备已撤销；默认诊断不存私密正文。最终Web文案构建由Root完成，当前已验收Web image a98aa8512434；其最终替换image记录由Root提供。
## 费用和风险边界

10000 AI_POINT = ¥1 保持；费用按固定费率版本和唯一 usage event/钱包事务结算。价格由 Cloud 按官网资料核实，余额是共享账号快照；不承诺绝不超额/零亏损。可能收费的 POST 后禁止盲目切实例重试。没有终止 usage 的请求保留审核状态，不能当零成本。上游推理文本属于私密内容，只能保存受限、加密的会话状态，默认日志不展示。

## 产品接力与部署交付

产品首批交付后释放执行 slot 给 UI；Root 持续集成并维护 LIVE 状态。UI 提交须标注 App/管理站截图、空态/失败态/窄窗口表现和使用的真实 API。发布前产品复核协议实现、能力宣传、错误说明及门槛证据；缺项只能明确延期相应能力或停发，不把未知写成通过。

本机 Computer Use 技能禁止自动操作官方 ChatGPT/Codex 桌面 UI。使用隔离官方 bundled app-server 验证真实协议和工具执行，Bridge 自有 UI/管理站可自动验收。官方拖拽、下载卡、预览等未观察行为保持 UNKNOWN；不会以 mock 或 app-server 通过冒充官方桌面 UI 全功能。该边界不阻碍已通过的接口/Bridge版本上线，但不能宣传所有附件与 Agent UI 已完整支持。

### 首轮产品review（源码与测试证据）

App 已保留 root fields、reasoning/unknown items/events与data-only SSE；custom apply_patch原生，namespace/其他custom仅必要alias适配。Local response ID对应不可变历史快照并进入加密cache；未知前序拒绝，账号/会话边界继续保留。`test/responses-compatibility.test.mjs`覆盖不可变prev、原生apply_patch续接、incomplete/id/retry、trace脱敏、已知非法call拒绝。官方runtime shape corpus为`test/fixtures/responses/official-runtime-shapes.json`，probe脚本` scripts/official-runtime-probe.mjs`，build `2e5e00daee91c61d`。该probe实际执行官方exec_command，两次请求完成；其上游为synthetic，不能扩大成真实Cloud/附件结论。

Cloud Router符合enabled/能力/native优先/priority/weight/固定实例；provider adapter仍为既有接口增量。DeepSeeknative正文和事件不先转Canonical重组，但Gateway会替换本站response ID/逻辑model并添加既有billing usage；这是受控协议改写，不是byte-identical proxy。原生terminal延后到费用事务结算。新资源经过验证后READY；legacy UNKNOWN保持旧绑定且不增加能力。

本期明确限制：Cloud前序映射只保存最后response ID，AES-GCM加密历史<=900k、TTL1h；Local多响应snapshot覆盖正常App路径，直接Cloud任意历史分支以后补。READY暂无自动健康TTL，显示检测时间，DEGRADED冷却60s、认证失败UNAVAILABLE需管理员check恢复；不做自动跨实例重试。metadata/include/store及builtin定义按DeepSeek官网忽略，日志仅记录字段/工具类型，不宣称内建web/tool_search由Cloud执行。compaction、仅加密/摘要无可用明文的推理、原始Office/PDF/audio/video明确拒绝；文件工具路径与官方UI附件分别验收。共享上游硬预算锁、自动成本路由、持续健康探测延期。

用户最新要求取消旧App/旧Cloud兼容发布门槛，启动App自动检查升级后使用最新版。已完成无害兼容代码保留；不为删除兼容投入额外开发，也不修改历史财务数据。

### 发布与验收记录

最终Domain2.5 hash `20269272a7f5e429d73036f96b0fad3dc4e89f126e4bb02f10e40bdc9a8ee6a8`，Gateway1.1 hash `706ee93f9223bb676c0b38cf3736d6c8a52306e09a085c2168901c8e95cb3619`；完整contract10/10 PASS。

0.3.0 installer342832124bytes，SHA256 `fe56cb66a3bb812ca00a4648a3abbcd5227d6ef71729c27cc63b373bb96e67ff`，已published；下载：https://ai.mddxz.top/api/v1/releases/files/96c4ab92-b904-48d3-9a11-4015cbb3c422。真实自动下载/哈希复核READY；Git最后push结果由Root记录；已有完整工具/计费/管理入口门槛均已通过，没有尚待核心复验。

详细真实证据、延期边界和32节要求映射见[上线报告](../acceptance/RELEASE_0_3_0_REPORT.md)。公开版本不宣传未验收官方Office/PDF拖入/ArtifactUI；未知上游费仅通过原因/actor/time/幂等审计平台承担，不修改原usage/钱包账本。