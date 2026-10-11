# Copilot Bridge 0.3.0 架构与上线报告

日期：2026-10-11。状态：生产normal/thinking各两轮官方runtime工具回环与单笔取消审计已通过；API/Web真实管理入口、0.3.0公开发布和真实自动升级下载全部通过。最后Git push和最终Web image由Root记录，未观察官方附件UI不列发布承诺。

本报告覆盖用户原始要求第32节指定的12项输出，并在末尾对全部32节要求逐项映射。权威当前执行合同见 [Gateway1.1](../protocol/GATEWAY_REVISION_1_1.md)，任务与门槛见 [LIVE](../product/IMPLEMENTATION_0_3_0.md) / [Release Gate](RELEASE_0_3_0_GATE.md)。Phase0根目录审计是当时源码快照，不是本期发布能力。

## Architecture

```text
官方 ChatGPT / Codex / bundled app-server
  -> Local Bridge（127.0.0.1:8787 Responses、协议适配/受限历史）
  -> Cloud（平台JWT + DPoP、用户/设备/ACL、RMB预算）
  -> Logical Model（稳定publicId与权限）
  -> Instance Router（能力/状态/native优先/priority/weight）
  -> 既有ProviderAdapter扩展
     -> DeepSeek native Responses（当前优先）
     -> 必要Chat Completions翻译（兼容路径）
  -> 唯一usage event / 固定费率 / 钱包账本 / 余额反馈
```

开发Agent团队是交付人员角色，产品未新增planner、Agent loop、memory、subagents或工具执行器。官方runtime提供工具定义、执行工具并回传结果；Bridge负责模型/协议。官方桌面内部规划和附件UI未观察，不能据app-server推断。

## Existing Reused Components

保留用户/设备UUID与P-256证明、JWT/refresh、订阅/逻辑模型ACL、providers与两套加密credentials、rate cards/费率版本、usage event/钱包/lots/幂等账本、管理站与发布manifest。App保留loopback鉴权、共享官方config快照与会话存储、安装/重启/更新、RemoteBridgeServer、safeStorage缓存与轮转trace。既有Copilot/LOCAL/Mock保留，不增加其OAuth/SDK/runtime功能。

## Changed Components

Cloud增加实例绑定和选择、请求/会话instance固定、DeepSeek executeNative、原生SSE/usage旁路观察、明确能力/上游错误、加密stateless历史、transport不稳定字段排除的工具指纹。App保留root请求字段、native items/events、必要custom/namespace aliases、data-onlySSE、不可变前序response快照、normal/thinking/auto和递归trace脱敏。UI改逻辑模型/资源绑定状态、模式能力、RMB/账号共享余额，并接力用户详情中的取消计费审核。

## Database Migration

additive `0010_sudden_morlocks`：model_instances表与模型/Provider FK，唯一(model_id,provider_id,provider_model_id)，能力/协议/priority/weight/健康/时间；ai_requests增加instance_id/protocol_mode；model_sessions增加instance_id。旧模型一对一回填实例及旧会话绑定，保留models旧provider字段/旧ID/ACL/财务外键。weight范围0..100000。

空库全部migration、DB19项PASS；现有生产短命clone0010 PASS，users/models/ACL/wallet/ledger/usage/aiRequests/modelSessions旧字段hash不变。生产0010已应用。取消review复用system_settings追加不可变决策与auditLogs，没有新增账本表/改写旧usage；生产单笔platform_waived、重复审核幂等、财务记录不变PASS。最后审核扩展DB报告由Root补。

## API Changes

Gateway1.1和Domain2.5生成artifact，账号/设备proof不变；AI仍`/v1/models`与`/v1/responses`。models能力增加nativeResponses/reasoningModes/defaultReasoningMode，客户端只接收逻辑模型，不接收实例key/endpoint。

管理API新增GET/POST/PATCH `/api/v1/admin/model-instances`（PATCH含/:id）、POST `/:id/check`；用户ACL仍logical model。新增GET `/api/v1/admin/usage-events/review?userId=…`、POST `/api/v1/admin/usage-events/:id/review`供当前用户待核对。审核原因必填、CSRF/ADMIN检查、actor/time/一次audit/幂等，平台承担未知成本，不退款或虚构zero usage/cost。

升级仍服务端manifest下发0.3.0 version/downloadUrl/sha256，启动App自动检查，下载完提示立即/稍后安装。用户不要求新旧客户端兼容，已完成无害兼容路径保留。

## Routing

逐请求权限/预算最终由Cloud判断。按logical model加载候选；续接固定instance/mode；筛enabled、健康/冷却、请求能力，再native Responses优先、priority降序、同组正weight随机。weight0停止新分配，固定续接仍可用；enabled=false完全停用。新连接READY后可用；legacy UNKNOWN不扩能力；READY无自动TTL，检测时间/成功刷新可见，DEGRADED60秒、auth失败UNAVAILABLE需check。

禁用/限额在下一请求生效；不跨实例继续Provider私有历史，不在已可能计费POST后盲目重试。资源余额是共享上游账号快照而非硬全局锁。成本/负载优化和持续健康TTL延期。

## Protocol Handling

native输入不先强制Canonical转译；保留unknown请求/items/events（受实际DeepSeek能力限制），Gateway改写本站response ID/逻辑model和已有billing usage，是受控改写而非byte-identical。terminal等待结算，SSE以completed/incomplete/failed结束。DeepSeekstateless展开完整input，不向上游发previous_response_id；Local多response snapshots，Cloud仅最后response ID，历史AES-GCM<=900k/TTL1h+最长5分钟物理清理。

必要翻译仍沿既有Adapter/Canonical，custom/namespace别名恢复名称；apply_patch原生。不存在通用客户端Chat Completions路由，本期入口先Responses。compaction、原始input_file/audio/video、无可用明文的加密/摘要推理明确拒绝；metadata/include/store/builtin定义按官网忽略，只日志字段/类型名，不能宣传内建工具已执行。parallel_tool_calls=false+tools明确422。

## DeepSeek

官网当前支持原生Responses，真实Flash/Pro连接probe READY。normal->none、thinking默认high、auto官方thinking high，显式合法none/low/high/max按能力；minimal->low，medium/xhigh->high官方兼容。thinking不支持required/named tool_choice，明确422建议normal或auto。

真实直接模型普通、图片、思考与工具已通过；Flash完整推理history工具续接/cache usage通过。生产官方runtime normal两轮exec_command、4请求同Cloudthread、SETTLED109点PASS。thinking原生reasoning同时plaintext+opaque已按真实协议整体保留；取消审计恢复后，最终连续两轮工具完整PASS：4请求COMPLETED/SETTLED、56点（¥0.0056）、439 reasoning tokens，各轮exec_command随机marker由官方执行器真实执行并回function_call_output。安全证据 `outputs/production-runtime-thinking-acceptance.json`；临时测试设备已撤销。App无需追加代码/重打包。

价格/资料日期及URL见协议；人民币按请求固定rate version+倍率。usage缓存/推理子集用于结算，未知实际成本继续UNKNOWN。

## ChatGPT Compatibility

REAL_APP_SERVER不是REAL_DESKTOP：官方bundle `2e5e00daee91c61d`隔离CODEX_HOME，合成上游文本/exec_command回环PASS；请求shape corpus不含私人正文。生产官方runtime normal与thinking均经LocalBridge->Cloud->真实DeepSeek连续两轮工具PASS；这是完整真实协议/执行链证据，不代表官方桌面附件/产物UI。Bridge自有UI/管理站可自动验收，官方桌面自动操作被本机技能限制，拖拽/下载卡/Office-PDF原始附件/预览仍UNKNOWN。

不需要Windows重启，官方Store本机版本26.1007.2314.0；共享会话存储保留，但不同模型间所有旧历史并非必然可续接。测试不读取用户工作会话/真实私人文档。

## Tests

已完成：App完整build+113/113，额外核心Responses 5项边界；Cloud API91unit/typecheck/build，新增review最终完整contract10/10；空库full migration/DB19项、现有库clone与旧字段hash一致；安装包0.3.0 342832124 bytes，SHA256 `fe56cb66a3bb812ca00a4648a3abbcd5227d6ef71729c27cc63b373bb96e67ff`，asar版本/关键源码hashPASS。Domain最终hash `20269272a7f5e429d73036f96b0fad3dc4e89f126e4bb02f10e40bdc9a8ee6a8`，Gateway1.1 `706ee93f9223bb676c0b38cf3736d6c8a52306e09a085c2168901c8e95cb3619`。

UI mock browser `outputs/ui-0-3-0/report.json`：390px/nooverflow/错误requestId/retry/weight0 PASS。新增用户详情审核：tsc/next生产build PASS、Chrome全API mock PASS（userId scoped/隐藏外用户/空白原因禁用/责任确认/503 requestId/保留原因重试/成功刷新）；截图 `outputs/usage-review-ui-verified.png` 已肉眼检查。真实浏览器入口REAL_BROWSER PASS：outputs/architecture-real-admin/report.json，审核empty/native READY、无独立设备/用量页、390无溢出/adminFailures0。

取消真实probe产生METERING_ERROR/0客户扣点符合未知usage保护；管理员生产单笔platform_waived审计、重复幂等、usage与财务不改、解除该记录限制PASS。不是退款，未知供应商成本由平台承担。修复后的normal/thinking生产连续两轮均COMPLETED/SETTLED，最终临时设备已撤销。

## Remaining Risks

1. 未知usage需要人核对；平台承担未知上游费属于明确财务决策，不能以核销宣称上游免费。
2. 上游共享余额/输入估算不能保证零超额或零亏损；无全局硬预算锁、无自动成本优化。
3. Cloud仅最后response、TTL/size限额，Local有多分支快照；跨App/直接API较旧历史引用可能失效。
4. 健康TTL/持续probe延期；检查时间与状态供管理员判断，不伪称持续健康。
5. 未观察官方附件/ArtifactUI不宣传完整支持；file工具文本提取与原始文件item必须分开。
6. 核心thinking两轮/计费审计已通过；管理入口与公开自动下载均已通过；最后Git备份记录由Root完成。

## Next Step

API/Web真实入口与0.3.0公开自动下载已经完成；Root最后推送两库Git并记录最终Web image。核心normal/thinking各两轮工具和生产取消审计已完成，不重复消耗付费模型测试。后续按实际需求补健康TTL、旧响应分支与逐种附件真实证据，不新增Agent harness。

## 原始32节要求覆盖映射

| 原要求 | 本期结论/位置 |
| --- | --- |
| 1 产品定位 | Architecture；官方入口/Cloud资源控制 |
| 2 Harness边界 | 无Bridge planner/工具执行器；执行归官方runtime |
| 3 官方内部未知 | Compatibility分证据等级；DesktopUI UNKNOWN |
| 4 Local职责 | 协议/鉴权/受限历史/trace |
| 5 不Local调度 | Cloud Router；App只logical model/mode |
| 6 模型实例分离 | Database model_instances+旧models复用 |
| 7 logical ACL | Routing每请求原ACL，不合并放宽 |
| 8 Cloud控制平面 | API/model与实例、预算/禁用即时 |
| 9 Router | native/priority/weight、pinned规则 |
| 10 能透传就透传 | Protocol native优先，受控ID/billing改写 |
| 11 翻译路径 | 仅必要现有Canonical/Adapter |
| 12 Canonical定位 | 不强制native过Canonical转换 |
| 13 实例协议能力 | nativeProtocols/capabilities实例字段 |
| 14 能力registry | checked catalog/probe；未支持不假开放 |
| 15 reasoning抽象 | normal/thinking/auto，真实effort |
| 16 DeepSeek优先 | Flash真实normal/thinking两轮工具COMPLETED/SETTLED，推理/缓存usage；原始附件不承诺 |
| 17 不扩Copilot | 保留旧代码不新增runtime/OAuth |
| 18 Provider非Model | 连接资源与logical model分别管理 |
| 19 Bridge不绑provider | Provider差异Cloud；必要alias兼容 |
| 20 /models | 授权logical publicId+能力，不泄资源 |
| 21 state | Local snapshots/Cloud加密lastprev/pinned |
| 22 Harness probe | 官方隔离appserver安全shape corpus+生产真实双模式连续两轮执行 |
| 23 tests | Tests离线/真实provider/appserver分层 |
| 24 native priority测试 | Router定向native优先及降级测试 |
| 25 errors | auth/ACL/quota/rate/provider/protocol明确；422能力；未知费经管理员审计解除 |
| 26 observability | IDs/instance/protocol/终止、正文脱敏/轮转 |
| 27 phased顺序 | 审计->模型/路由->native->真实->部署 |
| 28 修改前阅读 | Phase0两repo审计与基线不变量 |
| 29 不过度设计 | 单实例绑定表/复用credentials/ledger/Adapter |
| 30 Case A-G验收 | 模型ACL/实例池/native/翻译/官方tool loop；ChatCompletions新入口未开放 |
| 31 分层思考 | Agent职责/文件归属；不跨层接工具执行 |
| 32 最终输出 | 本报告12项及证据/延期/实际发布记录 |

## 最终上线记录

- Cloud部署：API image4be63c09cafa；Web真实验收image a98aa8512434，最终文字image由Root记录；0010已应用。
- 新审核合同hash：Domain `20269272…a8ee6a8`、contract10/10；生产审核API幂等/财务不变PASS；UI本地build/mock与生产REAL_BROWSER均PASS。
- 官方runtime normal/thinking两轮最终报告：均PASS；normal109点，thinking56点/439reasoning tokens；安全证据见`outputs/production-runtime-thinking-acceptance.json`。
- App0.3.0 release96c4ab92-b904-48d3-9a11-4015cbb3c422已published；342832124bytes/fe56…67ff；outputs/architecture-public-update-030.json完整下载与sha256 READY。
- Git两库备份commit/线上观察结果：待。

下载：https://ai.mddxz.top/api/v1/releases/files/96c4ab92-b904-48d3-9a11-4015cbb3c422。UpdateManager当前0.2.7真实获得0.3.0并完成下载/hash READY，client/config.latestVersion=0.3.0。thinking四行native/同instance、rateCounted=true,false,true,false均COMPLETED/SETTLED，DB证据outputs/architecture-final-db.json。Git最终commit/push由Root最后消息记录，避免文档自引用。
