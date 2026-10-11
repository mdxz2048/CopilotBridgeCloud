# 0.3.3 Native Responses 最终验收

2026-10-11：0.3.3已部署/公开发布，DeepSeek链路门槛通过。范围状态PARTIAL仅因为GPT无连接、官方GUI/UAC未验收、自动同请求failover未实现，不把这些写成PASS。032历史不改。

| 门槛 | 真实证据/结果 |
| --- | --- |
| App/Cloud | App151/151、Cloud105unit、APItypecheck/build、contract10、UI6+mock、Webbuild PASS；原26DBskip与独立Postgres21/21 PASS区分 |
| Provider隔离/NativeOnly | OpenAI adapter与DeepSeek策略隔离fixturePASS；生产20trace均native/attempt1；GPT真实8行BLOCKED_NO_GPT_CONNECTION |
| 路由 | 同profile/logical ACL/pinned/weight/健康冷却选择tests通过；执行后不重POST；自动同请求failover/健康TTL未实现 |
| 协议/隐私 | array/toolchoice/customSSE/profile/10MiB413回归；shapeBefore/After+modifiedFields只白名单结构，无正文 |
| 原生task | REAL_EXTERNAL_DRIVER N/W/C/T normal/thinking8行16POST全PASS；初轮W4POST，总20trace/96点¥0.0096全部SETTLED、无retry |
| 时序 | native/runner monotonic，Cloudstage Date.now相对值；Word单样本Local normal3.281s/thinking3.799s，无baseline/GPT/p95泛化 |
| 计费/余额 | 固定rate/账本/review/无GPT费率拒绝DB21 PASS；余额5sprovider缓存miss才GET，GET真实次数/独立耗时未记录 |
| 安装包 | 15checksPASS、342840394bytes SHA841f…87de；已published |
| 线上/升级 | API1fc558eec086/Webbad2760d8e82健康部署；public完整下载hashREADY；旧032426→sameDevice033models可用 |
| Git | Appmain b92631a已push；Cloudmain最终文档提交由Root汇报，避免自引用SHA |

## 发布标识与安全证据

release `12b72da5-6b24-4acb-bb47-6957bb96c50c`；[0.3.3安装包](https://ai.mddxz.top/api/v1/releases/files/12b72da5-6b24-4acb-bb47-6957bb96c50c)，342840394bytes，SHA256 `841f3f670dccc40e481e30e791cc97dbc4e37f259b3d8aa5a0214e1c0aa787de`。

Domain2.6 hash `59790292af2895672c65c0c770c066a1fcc7b0dd5009fcd6e6a8eac248c3d5f0`；Gateway1.2 `e5b0e179f02f31e9a2402325e73a424e1d872869cd4bd5ce0d2f74bb853aa68d`。

[test-summary](evidence/0.3.3-test-summary.json)、[native-tasks](evidence/0.3.3-native-tasks.json)、[native-production](evidence/0.3.3-native-production.json)、[installer](evidence/0.3.3-installer-payload.json)、[public-update](evidence/0.3.3-public-update.json)、[latest-upgrade](evidence/0.3.3-latest-upgrade.json)、[OpenAI UI](evidence/0.3.3-ui-openai.json)、[rates UI](evidence/0.3.3-ui-rates.json)、[platform rate](evidence/0.3.3-effective-platform-rate.json)。

## 成本、GET与测量解释

八行最终任务¥0.0077/16POST，初轮W¥0.0019/4POST，生产20trace合计96点¥0.0096。每生成attempt1，不包含辅助GET；真实reported supplierCost未知不伪称实际成本。Word为合成简单双题/固定安全工具、含headers单样本，不等同复杂文档/官方GUI，也不能比较GPT胜负。

20managed DeepSeek请求都调用upstreamBalance，providerId缓存5秒，仅miss发/user/balance GET（10s超时无重试）；providerFor仅DB配置/解密，普通请求不GET/models。余额命中/GET次数和独立耗时未记录，不声称20次GET或把preflight全归余额。20条routingDone→preflightDone为16–463ms、均值133.9ms，包含DB/rate-policy/费率/钱包review及可选balanceGET；nativeMetrics从Responses fetch开始不含preflight。

runner平台辅助GET包括每case/auth/me、每LocalPOST/models及预算/me、每CloudPOST后usage结算查询，不是生成POST/工具loop，不进付费POST计数。Cloud阶段Date.now相对值与native/runner monotonic分开，不能全称单调或跨机器walltime相减推性能。

## 保留限制

GPT无实例/凭据，8行BLOCKED；ChatGPT订阅非APIkey。官方host工具policy阻止，官方GUI/拖入附件/Artifact/UAC/host重启未验收；固定外部业务工具成功不替代这些。自动同请求failover/健康TTL未实现。10MiB不代表raw input_file/音视频支持。无新Harness/loop/工具执行器，调度/凭据/费用由Cloud、工具执行归外部固定诊断驱动。后续按真实配置补GPT A/B，先可审查实现，不擅申请Key/付费POST。
### 精确度量与compat口径

修正版Local/Cloud firstEvent/firstReasoning/TTFT/firstTool均含各自HTTP headers等待；TTFT只指首response.output_text.delta，思考首内容firstReasoning单列，created等firstEvent不是可见内容。Local firstTool收到事件时刻可能因DeepSeekserialfalse安全hold晚于Cloud原生首次观察工具。初轮W4请求旧Local首事件以headers后为起点，后16请求才统一含headers；不可混算同口径分布。

Word3.281/3.799s是两个localhost请求totalMs之和，包含模型lookupGET、driver预算GET、Cloudpreflight和settledterminal；不含DOCX固定读取/登录/Bridge启动/独立usage查询等待，不能称桌面拖拽完整墙钟。Cloudrunner total从createResponse前到SSE读完，不含此前预算GET或之后usageGET。96点¥0.0096为平台实际扣费，supplierCostKnown=false，非精确供应商成本。

DeepSeekprofile下非apply_patch custom→function {input:string} wrapper不保留custom.format grammar enforcement（沿用032必要compat），不能宣称无损。OpenAIprofile rawtools含format/grammar原样保留有fixture；DeepSeek复杂grammar官方宿主任务未验，简单T PASS不泛化全部custom语义。additional_tools提升、namespace flatten、完整history展开在shapeBefore/After与modifiedFields诊断可见，默认无正文。平台当前确实native-only无ChatCompletions fallback，但身份/model/mode/usage/history会改写，非byte-identical透传。