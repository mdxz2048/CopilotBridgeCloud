# 0.3.3 Native Responses 策略合同

状态：2026-10-11 源码/offline审查完成，Domain2.6/Gateway1.2生成合同与10项测试通过；已部署；真实DeepSeek外部任务/公开升级通过，GPT未配置。旧032协议hash不由本文件擅改。接口沿用/v1/models与/v1/responses、JWT/设备DPoP/同thread/逻辑模型ACL/固定费率和唯一usage。

## Native-only策略

生产目录与请求只允许有原生Responses执行接口的启用/合法能力/健康候选；不能仅看nativeProtocols字符串绕过实际adapter能力。专用MOCK生产隐藏，旧ChatCompletions翻译路径可留源码但不选为native-only fallback。无候选明确MODEL_UNAVAILABLE/UNSUPPORTED_PROTOCOL，不改成聊天翻译偷偷重发。

provider策略由既有Adapter扩展表达：native请求准备/能力校验/思考映射/上游状态usage处理。Gateway承担平台权限、大小、实例与预算，不能无条件调用DeepSeek nativeReasoning/validate对GPT作判断。GPT未配置仍可审查adapter与fixture，不能把官方ChatGPT订阅当上游APIcredential。具体GPT能力以实例实际目录/官方资料与probe确定，不猜所有GPT模型支持相同工具/effort/file类型。

## 字段与compat

保留input/instructions/model/stream/tools/tool_choice/parallel_tool_calls/reasoning/text/previous_response_id/include/metadata以及原生未知字段/items/events；Provider确实不支持时安全拒绝或明确compatible行为。数组tool output不无条件转string；namespace/custom别名只对目标不支持结构时必要转换，原名回还与碰撞测试。原生apply_patch与普通function不受wrapper状态误改。032added空args/partialJSON、Unicode surrogate、delta/done安全机制保留。

每项compat必须记录：源字段/目标限制、变换规则、语义损失/被忽略标识、fixture和Provider范围。默认日志只记录字段/类型名/关联ID，不留prompt/file/tool/private reasoning。本站ID/model/usage扩展属于受控改写，不能称byte-identical透明代理。

## DeepSeek具体已知边界

已核对[Responses API](https://api-docs.deepseek.com/guides/responses_api/)与[Thinking mode](https://api-docs.deepseek.com/guides/thinking_mode/)；0.3.0–032真实生产证据存在，033改动仍需新测试。DeepSeekstateless完整input，上游previous_response_id/conversation不支持，由平台归属恢复后展开。normal=none、合法effort按实际none/low/high/max及官方映射，不推广GPT。thinking required/named tool_choice不能用；metadata/include/store/builtin定义部分官网忽略，不能声明对应工具执行。明文reasoning+opaque sidecar一起保留，只有无可用明文的加密/摘要历史才拒。

parallel_tool_calls=false被上游忽略，平台guard才是兼容理由。033拟在首工具前立即释放安全reasoning/text，工具执行事件开始后缓冲、最终<=1call释放；>1callfailed不释放工具，真实usage照常结算。平台不承诺上游一定单call，不截断多call或重新POST。缓冲/输出slot identity/call ID一致性须测试。

## 路由与failover

Logical Model是权限身份，instance是内部资源。同逻辑模型必须同Responses profile（openai/deepseek），混合配置拒绝，避免随机选路改变effort/tools兼容；A/B用各自逻辑模型不合并权限。native-only能力/价格/健康筛选，再priority降序/weight；续接固定instance和mode。weight0仅停止新分配，enabled=false停全部。安全failover只在执行前配置选择；自动候选切换若没实现明确不支持。任何可能付费POST后、流已到/私有state存在/结果未知均不重试不同实例，不重复工具执行。当前自动同请求failover、健康TTL/半开未实现，明确延期；当前仅执行前配置/资格选择，不声明永久持续健康。

## 请求上限与错误

Local/Cloud均10MiB UTF-8 body上限，超限413，安全可读payload错误。SSE event、串行held、加密history有各自独立限制，不因此取消。array output/schema验证不回显私密输入。426 latest-only、422能力、provider/rate/quota/timeout/invalid区分；Local坏wrapperfinal用event:error/type:error/INVALID_SERVER_RESPONSE安全结束，不裸断TCP。

## Timing与计费

摘要记录request/trace/thread/response/call/model/instance/provider/strategy，client_received、cloud_received、provider_post_sent、provider_headers、provider_first_content、cloud_first_forwarded、local_first_forwarded、provider_terminal、settled、local_terminal；native transport和runner使用monotonic，Cloud stageTimingsMs当前使用Date.now相对值；不得统称全部monotonic或跨机器减walltime伪造延迟。TTFT专指首response.output_text.delta；firstReasoning/firstTool单列，created/in_progress的firstEvent不当TTFT。串行firsttool后的buffer等待单列。

POST attempt数包括所有付费尝试，网络未知/模型fixture没答对的探索也计费用，不当转换重试隐藏。固定费率/usage/成本known/账本幂等保持；GPT无费率failclosed，未知上游cost保持UNKNOWN。仅经过安全metadata旁路观察，不为测量再次模型POST。

离线确认App结构诊断requestShapeBefore/After与modifiedFields仅白名单类型，不留正文；App151/Cloud105/APItypecheck-build/contract10/UI6与mock通过。无GPTcredential不做真实GPT付费请求，DB21与真实DeepSeek任务通过，timing时钟边界如上。

生产20trace全native/attempt1/SETTLED，共96点；仅代表生成POST一次，不自动等于余额/目录GET次数。新实例GPT真实未配置、自动同请求failover未实现、官方GUI/UAC未验收，范围状态PARTIAL。

余额/辅助GET只读核对：managed请求调用upstreamBalance，providerId5秒进程缓存miss才GET /user/balance（10s无retry）；providerFor仅DB/解密，正常不/models。cachehit/GETcount独立耗时未记录，不能说20次GET或把所有preflight归余额。20trace routingDone→preflightDone16–463ms/均值133.9ms，含DB政策/凭据/费率/钱包review/可选GET，nativeMetrics从Responses fetch开始不含preflight。runner平台/auth/me、/models、预算/me、usage GET是辅助请求，不是生成POST或工具loop。

### 精确度量与compat口径

修正版Local/Cloud firstEvent/firstReasoning/TTFT/firstTool均含各自HTTP headers等待；TTFT只指首response.output_text.delta，思考首内容firstReasoning单列，created等firstEvent不是可见内容。Local firstTool收到事件时刻可能因DeepSeekserialfalse安全hold晚于Cloud原生首次观察工具。初轮W4请求旧Local首事件以headers后为起点，后16请求才统一含headers；不可混算同口径分布。

Word3.281/3.799s是两个localhost请求totalMs之和，包含模型lookupGET、driver预算GET、Cloudpreflight和settledterminal；不含DOCX固定读取/登录/Bridge启动/独立usage查询等待，不能称桌面拖拽完整墙钟。Cloudrunner total从createResponse前到SSE读完，不含此前预算GET或之后usageGET。96点¥0.0096为平台实际扣费，supplierCostKnown=false，非精确供应商成本。

DeepSeekprofile下非apply_patch custom→function {input:string} wrapper不保留custom.format grammar enforcement（沿用032必要compat），不能宣称无损。OpenAIprofile rawtools含format/grammar原样保留有fixture；DeepSeek复杂grammar官方宿主任务未验，简单T PASS不泛化全部custom语义。additional_tools提升、namespace flatten、完整history展开在shapeBefore/After与modifiedFields诊断可见，默认无正文。平台当前确实native-only无ChatCompletions fallback，但身份/model/mode/usage/history会改写，非byte-identical透传。