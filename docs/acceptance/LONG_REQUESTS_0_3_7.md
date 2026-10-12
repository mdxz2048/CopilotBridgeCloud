# 0.3.7 大请求与长任务验收

日期：2026-10-12，Asia/Shanghai。状态：0.3.7正式发布，生产API/nginx入口、统计反馈、同设备升级及完整公网下载SHA/READY通过。产品协议见[方案](../product/LONG_REQUESTS_0_3_7.md)，运维见[nginx要求](../operations/NGINX_RESPONSES_0_3_7.md)。

| 门槛 | 必需证据 | 当前 |
| --- | --- | --- |
| 真实根因 | 失败反馈HTTP413、nginx HTML，读取生产1m/120s旧配置 | Root真实定位已确认；不公开私人正文/邮箱 |
| nginx生效 | nginx-t/reload，公网2MiB无鉴权→应用401 | PASS；无模型调用 |
| 入口统一64MiB | 本地/Cloud正文边界、413结构、非Responses路由保持限制 | App真实本地HTTP→fakeCloud64MiB逐字一致；+1字节413且无上游POST，HTML413中文摘要通过；Cloud117回归通过 |
| 大请求统计 | 原始/转发bodyBytes与项目数，在报告截断前统计，异常只填已知值 | App完整186及最后guard定向21、Cloud117/contract10通过；公网原始/转发20MiB计数入库PASS |
| 计时 | connect夹取、idle有效进展reset/heartbeat不reset、65min总限、70min客户端 | App完整186及最后guard定向21、Cloud117回归通过；不称真实小时运行 |
| 额度与并发 | 余额/额度预留、并发/频率、usage结算、未知费用审核保持 | 真实隔离DB22 PASS；跨周期3个RUNNING继续阻止上游且保留预留 |
| 工具长暂停 | 模拟暂停后完整上下文/大工具输出可继续，且不依赖短历史缓存 | App回归通过；真实小时命令未测 |
| 会话与长预留 | sessionTTL2h开始/完成刷新，RPM65min/8步豁免仅免计数，RUNNING跨周期保留并发/预算 | Cloud回归与真实隔离DB22通过 |
| 生产有限大正文 | 20MiB签名未知模型，经本地→nginx→Cloud鉴权/权限判定，诊断统计入库，无付费模型 | PASS：HTTP403，20MiB原始/转发统计入库；无AIRequests/账本变化，不是供应商生成验收 |
| 版本与交付 | 最终全量、build、ASAR/安装包、部署、latest-only、同设备升级、公开下载hash READY | PASS：安装包20项检查、旧036426、同设备037模型可用、完整公网下载SHA/READY |

当前测试汇总：App完整186/186；随后最后failure getter guard定向21/typecheck/build PASS，未再次执行补丁后的完整186；Cloud117单元（另28项DB测试常规运行skip，真实隔离DB22单独执行通过）、typecheck/build与contract10 PASS。DB专用容器`bridge-architecture-test-20261012014741` exit0。OpenAPI2.7.0可选requestStats更新hash `cc3c0a622c965c1a52ebe0ee50904d3a952d7b0590bfac2e4ef0cbb9ac2e04f6`。公网20MiB签名未知模型零消费链路及统计持久化PASS，API生产部署exit0（image `fdd40dfd14f8`，stage `20261012014746`），无需新迁移；037安装包20项检查/正式发布/同设备升级/完整下载SHA及READY通过，Web未改未重建，原036管理站可展示stats JSON。

时限修改不是延长任意宿主工具执行权限。600秒旧模型total已改为65分钟；整个任务包含多轮和工具，不等于一次生成。不会声称真实一小时GUI、用户原始Word官方界面或所有Office/代码任务均已测。0.3.6已验证失败诊断价值，但当时无原始字节数，旧记录不能倒推大小。最终Git提交由Root发布报告记录。

安全证据：[公网20MiB与自动反馈](evidence/0.3.7-production-large-feedback.json)、[声明长度超限JSON413](evidence/0.3.7-public-413.json)。前置413测试声明67108865字节、实际仅发送{}，验证nginx提前拒绝，不声称公网传输了完整超限正文。四阶段合成反馈验证签名身份/邮箱/AES/脱敏/幂等，四条合成报告及设备已清理，原用户真实反馈保留。


## 发布记录

Windows x64 stable 0.3.7，release `78847be8-e9d6-4640-b332-b50a71c42625`；342849360 bytes，SHA256 `88faeb04a455586973fe802a787860dc71915a9c99c23cbdbff5692f15197e64`。[公开安装包](https://ai.mddxz.top/api/v1/releases/files/78847be8-e9d6-4640-b332-b50a71c42625)。安全证据：[包内容20项](evidence/0.3.7-package.json)、[发布](evidence/0.3.7-release.json)、[同设备升级](evidence/0.3.7-latest-upgrade.json)、[完整自动下载](evidence/0.3.7-public-update.json)。本期必要发布门槛通过，真实一小时官方GUI仍未测；Git提交由Root最终报告记录。
