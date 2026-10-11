# 0.3.3 Native Responses 平台方案与工作流

日期2026-10-11。状态：0.3.3已部署并公开发布，DB21、安装包与完整自动下载、真实DeepSeek外部任务通过；GPT/官方GUI未验收，自动同请求failover未实现。0.3.2收尾基线App `65385d9` / Cloud `0d7af34`，生产source11项hash/health200/latest-only0.3.2/旧下载404/公开完整升级READY已通过。本文件不修改历史发布报告。

## 目标与库存

官方客户端/兼容HTTP输入→Local Bridge→Cloud逻辑模型→内部实例选择→原生Responses Provider；客户端只使用模型与合法思考模式，不看实例/key/base URL。Bridge不运行planner/Agent loop、不执行模型工具。当前生产只有enabled DeepSeek Flash/Pro native READY，没有OpenAI/GPT实例或credential；专用MOCK仍在DB，但native-only生产目录隐藏。ChatGPT订阅不是API Key；没有GPT Key不执行真实GPT A/B，不先向用户索取Key，先交付可审查实现。

## 最小实施顺序与负责人

| 阶段 | 内容/文件边界 | 负责人 | 当前证据 |
| --- | --- | --- | --- |
| 1 合同 | NativeOnly、Provider策略、明确compat、10MiB、错误/timing、A/B矩阵 | Product | 本文件及native policy/matrix/gate完成 |
| 2 Provider隔离 | 既有ProviderAdapter原生接口复用；通用传输与DeepSeek专用validation/reasoning隔离；增加GPT原生adapter与管理连接配置 | Root/API | OpenAI native adapter与目录配置fixture通过；无GPT真实credential |
| 3 Cloud | native-only候选/目录，provider能力，串行首tool前释放安全reasoning/text、10MiB/413、分段timing | Cloud | native-only/provider策略/首tool前安全转发/10MiB/timing源码完成，105unit/typecheck/build通过 |
| 4 App | profile最小兼容、array输出/tool_choice保真、客户端分段timing | App | App151/151全量通过，profile/array/toolchoice/结构诊断完成，032stateful SSE不回归 |
| 5 UI | 仅必要新增Provider类型/连接与能力说明 | UI接力 | UI6unit+mock浏览器通过；多实例费率绑定/RMB正售价草稿不自动发布 |
| 6 验收/发布 | offline/DB/timing runner、真实DeepSeek任务、缺GPT标BLOCKED、构建/升级/Git | Root+Product | DB21/部署/真实DeepSeek任务/公开升级全部PASS，GPT八行BLOCKED |

共享文件必须协调归属；Product维护声明/证据，API实际字段发生变化需同步合同而非两端猜。新增GPT仍复用providers/credentials/model_instances/ACL/钱包，不能新增平行账户域。GPT费率必须先配置真实固定rate version，未知费率failclosed，不能默认免费。

## 平台与Provider边界

native-only是上线选择策略，不是宣称零兼容转换。同协议尽量保留字段/events，替换平台认证/上游model/本站响应身份与旁路计费属于受控变化；Developer/custom namespace适配必须有确切原因、可逆名称和fixture。禁止DeepSeek特有限制全局应用GPT。不支持类型明确拒绝，不能剥离后宣传无损。

平台逻辑模型ACL不等于资源选择。Cloud只从native Responses、启用、健康、能力及合法价格候选选择；内部priority/weight/pinned续接保留。安全failover本期只允许执行前配置选择，未实现自动候选切换如实记待；POST已发/可能生成/有私有历史时不重新选择或重发，未知结果走计费审核。

## 性能与大小

串行false仍单callguard。首tool前可及时释放安全reasoning/text，只在工具执行事件开始后保留必要缓冲，后续多call不释放执行；禁止以牺牲call安全/usage准确换TTFT。测量provider首内容、Cloud发首内容、Local发首内容、终止/结算与POST attempts，预期性能改进必须实测，不猜成功。

Local/Cloud统一请求UTF-8 body上限10MiB，超限413，不用增大限制宣称原始文档支持；单SSE事件/历史缓存/串行缓冲各有独立限额。Array function output必须保留native结构或按Provider实际支持明确拒绝，不能任意stringify冒充语义。profile仅设置官方兼容必需项，保留原账号外部设置、不重启Windows。

## 完成标准与限制

033已证实App151/151、Cloud105unit（原26DBskip）、APItypecheck/build与contract10PASS、UI6unit+mock浏览器通过。DB21真实隔离、安装包15项、生产部署/paid外部任务和自动升级均已PASS；单元原26DBskip与独立Postgres21通过分别记录。GPTadapter必须offline fixture验证，真实GPT任务无credential标BLOCKED_NOT_CONFIGURED而非PASS。当前官方host policy不允许工具执行，不操作当前官方App/绕policy；Word固定安全业务API可验证模型理解，不能代替官方附件拖入/UI成功。真实UAC安装/官方host重启仍未执行。

实施证据和任务矩阵见[验收矩阵](../acceptance/NATIVE_RESPONSES_AB_0_3_3.md)，协议见[Native policy](../protocol/NATIVE_RESPONSES_POLICY_0_3_3.md)，发布门槛见[Gate](../acceptance/RELEASE_0_3_3_GATE.md)。Product按代码真实进度更新本表与限制，禁止先写优化成功/全Agent支持。

## 当前实现审查结论

OpenAIProvider已复用既有Adapter原生接口；OpenAI字段/tools/effort保持自身语义，不套DeepSeekaliases，429不自动重POST，目录校验无generation。生产没有GPT凭据，因此真实A/B仍BLOCKED。同逻辑模型不能混合openai/deepseek Responses profile，Router明确拒绝，避免配置语义随实例随机变化；单Provider多个实例仍内部priority/weight/pinned。自动同请求failover未实现，当前只执行前候选过滤选择。

ApprequestShapeBefore/After与modifiedFields诊断只白名单type结构，不含正文/未知私密值；151tests为本期证据。安全首tool前reasoning及时释放与真实DeepSeek任务已验证；没有baseline/GPT/p95样本，不能据单样本宣称性能优势。GPT真实/官方GUI/UAC/host工具policy保持未验证，这些未验收能力保持PARTIAL，已发布DeepSeek任务门槛通过。

Domain2.6.0生成hash59790292af2895672c65c0c770c066a1fcc7b0dd5009fcd6e6a8eac248c3d5f0；Gateway1.2.0生成hashe5b0e179f02f31e9a2402325e73a424e1d872869cd4bd5ce0d2f74bb853aa68d，contract10PASS。最终metadata若Root代码变更重新生成需同步；032历史不改。

## 最终生产证据与限制

安全证据位于[0.3.3-test-summary](../acceptance/evidence/0.3.3-test-summary.json)、[native-tasks](../acceptance/evidence/0.3.3-native-tasks.json)、[native-production](../acceptance/evidence/0.3.3-native-production.json)、[installer](../acceptance/evidence/0.3.3-installer-payload.json)、[public-update](../acceptance/evidence/0.3.3-public-update.json)、[latest-upgrade](../acceptance/evidence/0.3.3-latest-upgrade.json)。App151/Cloud105/contract10/UI6+mock/API-Web build、隔离Postgres21全部PASS；安装包15check通过。

API image1fc558eec086/Webbad2760d8e82已部署。release12b72da5-6b24-4acb-bb47-6957bb96c50c，公开342840394bytes完整下载SHA256 841f3f670dccc40e481e30e791cc97dbc4e37f259b3d8aa5a0214e1c0aa787de READY；旧032HTTP426→同device033models可用PASS。App main b92631a已push，Cloud最后文档提交由Root最终汇报，不填自引用SHA。

REAL_EXTERNAL_DRIVER普通/思考N/W/C/T共八行全部PASS（16POST、¥0.0077）；初轮W四POST¥0.0019，脱敏生产日志合计20trace全native/attempt1/SETTLED、96点¥0.0096，无自动重试。Word最终normal两个请求Local合计3.281s、thinking3.799s，含headers，单样本合成简单双题/固定工具；不是复杂Word/官方GUI性能，也无GPT/baseline/p95泛化。GPT八行BLOCKED_NO_GPT_CONNECTION。

Cloud stageTimingsMs为Date.now相对值，native transport与runner为monotonic；不能称所有阶段单调时钟，跨主机walltime不相减得精确延迟。自动同请求failover/持续健康TTL未实现，官方GUI/UAC/host工具policy未验证；当前PARTIAL表示这些范围缺失，不表示已发布DeepSeek链路失败。

余额/辅助GET只读核对：managed请求调用upstreamBalance，providerId5秒进程缓存miss才GET /user/balance（10s无retry）；providerFor仅DB/解密，正常不/models。cachehit/GETcount独立耗时未记录，不能说20次GET或把所有preflight归余额。20trace routingDone→preflightDone16–463ms/均值133.9ms，含DB政策/凭据/费率/钱包review/可选GET，nativeMetrics从Responses fetch开始不含preflight。runner平台/auth/me、/models、预算/me、usage GET是辅助请求，不是生成POST或工具loop。

### 精确度量与compat口径

修正版Local/Cloud firstEvent/firstReasoning/TTFT/firstTool均含各自HTTP headers等待；TTFT只指首response.output_text.delta，思考首内容firstReasoning单列，created等firstEvent不是可见内容。Local firstTool收到事件时刻可能因DeepSeekserialfalse安全hold晚于Cloud原生首次观察工具。初轮W4请求旧Local首事件以headers后为起点，后16请求才统一含headers；不可混算同口径分布。

Word3.281/3.799s是两个localhost请求totalMs之和，包含模型lookupGET、driver预算GET、Cloudpreflight和settledterminal；不含DOCX固定读取/登录/Bridge启动/独立usage查询等待，不能称桌面拖拽完整墙钟。Cloudrunner total从createResponse前到SSE读完，不含此前预算GET或之后usageGET。96点¥0.0096为平台实际扣费，supplierCostKnown=false，非精确供应商成本。

DeepSeekprofile下非apply_patch custom→function {input:string} wrapper不保留custom.format grammar enforcement（沿用032必要compat），不能宣称无损。OpenAIprofile rawtools含format/grammar原样保留有fixture；DeepSeek复杂grammar官方宿主任务未验，简单T PASS不泛化全部custom语义。additional_tools提升、namespace flatten、完整history展开在shapeBefore/After与modifiedFields诊断可见，默认无正文。平台当前确实native-only无ChatCompletions fallback，但身份/model/mode/usage/history会改写，非byte-identical透传。