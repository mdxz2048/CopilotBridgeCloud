# 0.3.7 大请求与长生成

日期：2026-10-12，Asia/Shanghai。状态：0.3.7正式发布，生产入口/诊断/升级与完整公网下载通过。Root负责nginx、构建、部署、生产验收与Git；App负责本地正文/等待/诊断统计，Cloud负责原生请求入口/时限/额度保护。

## 根因与目标

0.3.6自动反馈已定位真实写文件失败：`cloud_http`、HTTP413、`INVALID_SERVER_RESPONSE`，回复片段是nginx HTML。入口代理原`client_max_body_size 1m`拒绝请求，原`proxy_read_timeout 120s`也短于平台长生成预算。这不是依据Word格式猜测的模型能力问题。旧报告输入片段被截断且没有原始字节数，不能由64条输入推断真实请求大小。

Responses各入口统一64 MiB（67108864 bytes）正文上限，避免微小代理限制拒绝正常大上下文，同时保留内存保护。该值是请求正文上限，不是进程堆内存上限，也不是任意大附件/上下文均受模型支持的承诺。JSON解析、签名、历史和并发会有额外内存开销；需保留账号并发、频率、余额/额度预留、usage结算及未知费用审核规则，不把小正文或10分钟总时限当主要防刷手段。超限明确413 `PAYLOAD_TOO_LARGE`，不自动重发生成POST。

## 时限与工具边界

已部署实现：单次原生模型生成total65分钟（`NATIVE_TOTAL_TIMEOUT_MS=3900000`，允许600000–4200000）、有效内容idle5分钟（`NATIVE_IDLE_TIMEOUT_MS=300000`，允许120000–600000），客户端Responses等待70分钟；connect由provider.timeoutMs夹到10–120秒，常用默认60秒。有效文本/思考/工具内容进展重置idle；heartbeat/created/in_progress/空delta不延长时限，total不因进展重置。超时返回504 `GATEWAY_TIMEOUT`，嵌套response.error保持`timeout_phase`；total不冷却资源，connect/idle仍按资源异常健康规则处理。用户取消中止本次请求，不自动重试付费POST。

整个工具任务可包含多个模型请求和宿主工具运行，不能按一个模型请求的total判断整个任务时长。Bridge不执行工具或新增Agent循环。完整上下文继续转发不依赖一小时Cloud历史缓存；只有引用而缺完整历史仍受缓存规则限制，不能承诺任意长工具暂停与宿主命令必成功。

Cloud会话TTL改为2小时，请求开始及完成刷新。工具续接RPM豁免窗口65分钟、最多8步，严格验证call/history归属；超过豁免只是按正常RPM计数，不是工具禁止执行的硬限制。RUNNING额度预留/并发占用不能因等待时间跨周期自动释放；未知usage待审核和UNPAID仍阻断新消费。

输出预算取消统一人为32K cap，取模型配置`maxOutputTokens`（未配置才32768回退）、用户`max_output_tokens`和可用资金预算的最小值。仍受供应商模型上下文/输出能力约束，不是无限输出，也不能绕过余额。

## 失败反馈补充协议

在原报告增加可选 `requestStats.desktop` / `requestStats.forwarded`。每组包含 `bodyBytes`，以及可选 `declaredBodyBytes`、`bodyLimitBytes`、`inputCount`、`toolDefinitionCount`、`toolCallCount`、`toolOutputCount`、`toolArgumentBytes`、`toolOutputBytes`，均为非负整数。统计来源为诊断截断前实际输入/转发正文，不包含代码、参数或输出文本。无法解析/被本地提前拒绝时仅记录已知字节统计，不虚构项目数。declared值是请求头宣称长度，不能当实际已接收长度。

共享OpenAPI仍2.7.0，可选字段更新SHA256 `cc3c0a622c965c1a52ebe0ee50904d3a952d7b0590bfac2e4ef0cbb9ac2e04f6`。Cloud解析前日志`counts.declaredRequestBytes`可帮助识别提前413，但只是声明长度。

诊断96KiB/加密outbox与服务端128KiB/14天限额继续独立存在，不截断模型转发。原失败事件保留历史，不补造此前缺失统计。管理员可以对比请求字节、入口上限、阶段和reply，区分本地/代理/Cloud/上游拒绝。

## 运维与发布

Responses nginx要求见[入口运维要求](../operations/NGINX_RESPONSES_0_3_7.md)，发布门槛见[验收矩阵](../acceptance/LONG_REQUESTS_0_3_7.md)。仅Responses放宽，诊断/普通网站路由保持各自限制，安装包上传保留独立已有策略。实际生产nginx配置检测与reload、2MiB无鉴权请求穿透至401已通过；这是入口检查，无模型调用，不能替代有效模型大请求或真实65分钟生成验收。

当前实证：App完整186、最后getter guard定向21/type/build；Cloud117/contract10/type/build与真实隔离DB22通过。生产API已部署，无新迁移；20MiB签名未知模型经真实公网返回权限403，原始/转发统计入库、四阶段自动反馈和无计费变化验证通过。诊断异常隔离不能反向阻断生成；大文本脱敏栈溢出修复与真实nginx413区分。0.3.7正式发布、安装包20项检查、同设备升级与完整公网下载SHA/READY通过。四条合成报告及测试设备已清理，用户原413反馈保留；真实小时GUI未测。
