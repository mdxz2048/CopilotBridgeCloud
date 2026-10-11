# 0.3.3 真实任务 A/B 矩阵与runner规约

日期2026-10-11。A=GPT native，B=DeepSeek native。生产库存只有DeepSeek Flash/Pro READY，没有GPT实例/Key；A全部BLOCKED_NOT_CONFIGURED，不申请Key或付费POST。先完成可审查代码/fixture，后续有已授权配置再真实测试。DeepSeek真实外部固定任务N/W/C/T双模式八行已PASS；GPT八行仍BLOCKED_NO_GPT_CONNECTION。

## 任务矩阵

| 任务 | 固定安全fixture与工具 | 正确性判定 | 预期POST | A GPT | B DeepSeek |
| --- | --- | --- | --- | --- | --- |
| N 普通对话 | 隐藏marker+确定算术/JSONschema，禁工具 | 内容/结构/终止一致，无额外call | 1 | BLOCKED | REAL_EXTERNAL_DRIVER双模式PASS |
| W Word | 受控合成DOCX，固定read_word_quiz只读提取，文件里marker+15/54题目 | 1call→output→答案，不提示marker | 2 | BLOCKED | REAL_EXTERNAL_DRIVER双模式PASS |
| C 代码 | 小型合成source+固定read_source/run_known_tests白名单 | 定位bug/返回patch解释/既定tests结果，不执行模型任意脚本 | 按固定工具计划声明2或3 | BLOCKED | REAL_EXTERNAL_DRIVER双模式PASS |
| T tool协议 | namespace/customwrapper/普通function，固定无副作用echo，前序响应续接 | 原名/参数input与delta/done一致、call归属、无wrapper泄漏 | 2 | BLOCKED | REAL_EXTERNAL_DRIVER双模式PASS |
| E 边界 | >10MiB、arrayoutput、tool_choice、坏args、并行/串行、stream取消 | 413/422/安全error，不执行违规call，不重POST | fixture优先 | OFFLINE待 | OFFLINE待 |
| R 路由 | native/健康/禁用/weight/pinned/执行前故障 | 逻辑ACL不扩大、执行后不切实例 | fixture0付费 | OFFLINE待 | OFFLINE待 |

每Provider支持的normal/thinking分别运行；合法mode/effort不能强制相等来宣称推理能力一致。参数、prompt、工具schema、执行器、上下文、预算、并发1、fixture版本固定；不同Provider/model如实记录，不能把两个后端强合一个逻辑模型作为A/B捷径。

## runner记录

记录caseId/fixtureHash/runtime/App/Cloud commit/logicalModel/内部匿名instance/provider/native版本/mode/合法effort。脱敏结构diff记录字段/item/event类型和数量、别名映射、ignored字段、delta/done/final一致、expected与actualPOST attempts、工具数/归属/策略失败，不存文档正文/秘密/私人tool结果。

时序分段：client→Cloud上传、provider发POST→headers、provider首内容TTFT、Cloud/Local可见TTFT、firsttool→guard_release、provider总时间、结算时间、端到端总时间。created/in_progress不是TTFT；串行buffer与推理首内容/最终文本首内容分开。跨机器walltime只关联；native transport和runner采用monotonic，Cloud stageTimingsMs采用Date.now相对值，分别记录不统称monotonic。无新timing字段/精度时标UNKNOWN，不猜变快。

计费记录input/output/cache/reasoning tokens、固定费率版本、本站points/RMB、供应商reportedCost/costKnown、实际settled请求数。总成本包括探索/取消/格式不符但上游生成请求。样本未获得真实usage按audit状态记录，不补零。

## 执行与结论

第一轮先offline和DB，再一个受控DeepSeek实例烟测；Root限定次数与预算后才重复统计。没有GPTcredential，真实A/B不出胜负结论；单provider优化只能与自身固定baseline对比，并标串行mode和缓存冷热。至少记录样本数、中位/p95（样本不足不列p95）、错误率/额外POST数和明确版本，不能从单条TTFT推泛化。

当前official host policy阻工具，不能操作当前官方App或绕policy。用固定业务工具API/HTTPshape验证W/C/T不等于官方Desktop拖入/自动tool/ArtifactUI PASS。所有证据标OFFLINE/REAL_PROVIDER/REAL_HTTP_SHAPE/BLOCKED_HOST_TOOL_POLICY/UNKNOWN，原文不入Git。真实UAC安装/host重启未执行。

## 最终实测结果

证据[native-tasks](evidence/0.3.3-native-tasks.json)、[production](evidence/0.3.3-native-production.json)：普通/思考八行任务16POST¥0.0077全部PASS，初轮W4POST¥0.0019；共20trace native/attempt1/SETTLED96点¥0.0096，无retry。GPT八行BLOCKED，无跨ProviderA/B胜负结论。Word单样本normal2requests Local3.281s/thinking3.799s（含headers），合成简单题与固定工具，无baseline/GPT/p95，不推广复杂真实Word或GUI。实际执行为REAL_EXTERNAL_DRIVER，不是Bridge生产Harness/official DesktopUI；blocked host工具policy不绕过。

余额/辅助GET只读核对：managed请求调用upstreamBalance，providerId5秒进程缓存miss才GET /user/balance（10s无retry）；providerFor仅DB/解密，正常不/models。cachehit/GETcount独立耗时未记录，不能说20次GET或把所有preflight归余额。20trace routingDone→preflightDone16–463ms/均值133.9ms，含DB政策/凭据/费率/钱包review/可选GET，nativeMetrics从Responses fetch开始不含preflight。runner平台/auth/me、/models、预算/me、usage GET是辅助请求，不是生成POST或工具loop。

### 精确度量与compat口径

修正版Local/Cloud firstEvent/firstReasoning/TTFT/firstTool均含各自HTTP headers等待；TTFT只指首response.output_text.delta，思考首内容firstReasoning单列，created等firstEvent不是可见内容。Local firstTool收到事件时刻可能因DeepSeekserialfalse安全hold晚于Cloud原生首次观察工具。初轮W4请求旧Local首事件以headers后为起点，后16请求才统一含headers；不可混算同口径分布。

Word3.281/3.799s是两个localhost请求totalMs之和，包含模型lookupGET、driver预算GET、Cloudpreflight和settledterminal；不含DOCX固定读取/登录/Bridge启动/独立usage查询等待，不能称桌面拖拽完整墙钟。Cloudrunner total从createResponse前到SSE读完，不含此前预算GET或之后usageGET。96点¥0.0096为平台实际扣费，supplierCostKnown=false，非精确供应商成本。

DeepSeekprofile下非apply_patch custom→function {input:string} wrapper不保留custom.format grammar enforcement（沿用032必要compat），不能宣称无损。OpenAIprofile rawtools含format/grammar原样保留有fixture；DeepSeek复杂grammar官方宿主任务未验，简单T PASS不泛化全部custom语义。additional_tools提升、namespace flatten、完整history展开在shapeBefore/After与modifiedFields诊断可见，默认无正文。平台当前确实native-only无ChatCompletions fallback，但身份/model/mode/usage/history会改写，非byte-identical透传。