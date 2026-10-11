# 文档与长生成超时修复：0.3.5

日期：2026-10-12，Asia/Shanghai。状态：Cloud111unit/typecheck/build与隔离Postgres21/21 PASS；API已部署，固定外部工具Office生成通过；真实>60s任务未验。仅改计时和原生错误表达，保留native工具透传、平台鉴权/ACL/实例固定/计费，不新增Harness或模型POST重试。

## 已定位根因

Root生产证据确认Word生成失败为GATEWAY_TIMEOUT：Provider统一hard60s到期，持续生成仍被abort。属于生成链路时限问题，可影响Word/Excel/PPT/代码等长任务；不能定性为某个文档格式不支持或图片能力不足。日志/报告只保存request/trace/时长/终止类别等摘要，不记录私人文档或工具参数。

## 最小计时方案

分离有边界的active/idle/overall计时，记录具体起止与终止原因：

- **connect**：从Provider fetch到headers，当前实例60s；配置clamp为10–120s，到headers清connect并启动idle。
- **idle**：当前120s（按配置clamp120–180s）；有效非空delta与已定义output/content/text/reasoning/function/custom added/done重置。created/in_progress/ping/空delta等heartbeat不延时，不因总时长超过60s误杀有效生成。
- **total**：600s总体硬上限，持续输出不能无限占用。total超时不将资源cooldown；终止/断连/取消清理timer/reader与parent listener。

时限须与App Responses默认15min/control30s及实例配置协调；current connect60/idle120/total600已确认，不将旧timeoutMs全部扩大或关闭。用户取消/客户端断连立即abort；执行后不自动重发、换实例或重复工具。

## 原生错误与健康/计费

处理response.error以及response.failed等终止响应中的嵌套error，提取安全code/category/requestId，保留终止失败语义；禁止将失败response当completed、直接回显上游私密body或裸断TCP。兼容错误/用户协议错误不把实例错误冷却；真实Provider timeout/资源故障按已明确健康分类处理，区分connect/idle/total；total为平台任务上限，不cooldown资源。

观察到真实usage按固定费率/唯一usage event结算；可能已生成但无usage保留METERING_ERROR/review保护，不伪称零成本。未知费平台承担须原管理员审计，不重写旧账本。计时修复不能靠取消费用保护或重复POST掩盖问题。

## 验收门槛

| 场景 | 预期 | 当前 |
| --- | --- | --- |
| 首响应无活动 | active上限安全timeout，timer/reader清理，一次POST | 111unit回归PASS |
| 持续长生成 | 连续有效活动跨旧60s仍继续，直到合法终止或overall截止 | fake-clock真实SSEfixture跨旧60s/单POST/清timer PASS；生产normal/thinking各docx/xlsx/pptx固定工具写入并重读PASS（非真实>60s/GUI任务） |
| 中途静默 | 有活动后idle到期，明确终止原因 | 111unit回归PASS |
| 无限活动 | overall上限生效，不能无限重置 | 111unit回归PASS |
| 取消/断连 | 立即abort、timer释放，不自动retry | 111unit回归PASS |
| 嵌套错误 | response.error/failed安全映射、非completed、请求ID可追踪 | 111unit回归PASS |
| 财务/健康 | 真实usage settled/未知review、错误类型正确健康处理，旧账本不改 | 隔离DB21/21 PASS；生产Office固定工具12请求native completed/attempt1 PASS |
| 发布 | 全量API/contract/build/隔离DB与部署hash/health/真实任务摘要 | 111unit/typecheck/build、真实隔离DB21 PASS；生产source/container hash与health200、Office固定工具12/12 PASS；App正式发布/同device升级/完整下载READY PASS |

## 保留边界

此修复不证明官方Desktop拖入Word/Excel/PPT/预览完整成功，不操作当前官方host。App安装/重启回归可能使用mock/隔离进程，真实UAC和host重启须单列证据。user latest-only授权沿用，无新审批流，历史032–034报告不修改。

上述实现时限/tests/image/Office任务/release/完整下载已有实际证据；Git最终两库main提交由Root最后汇报，不预填commit。

已核对native-timeouts.ts与tests：fake-clock持续SSE跨60s到终止只1fetch，timer全部释放；600s上限/heartbeat不续idle/嵌套response.error包含request_id与timeout_phase回归通过。该fake-clock测试不冒充真实长文档生成或用户原始Word验收，生产docx/xlsx/pptx双模式固定工具写入/重读已通过，用户原始WordGUI/真实>60s任务仍未验。

## 已部署与真实Office证据

API生产image `94ff69a4b66862c8fcd0747d67028dcb3c437275215a657b9b5d75961ce61472`，source/container hash匹配，publichealth200。

[normal](evidence/035-office-write-normal.json)、[thinking](evidence/035-office-write-thinking.json)、[最终报告](evidence/035-office-write-final.json)：normal/thinking各docx/xlsx/pptx通过固定外部安全工具写文件并重读，总12/12请求native completed、每请求1上游attempt、无自动retry；normal平台扣费¥0.0031、thinking¥0.0037。测试设备已撤销。此为固定外部工具业务生成，不是Bridge产品工具执行器；未验证用户原始WordGUI或真实>60s任务，不把fakeclock长流测试冒充真实长生成。

[旧超时审计](evidence/035-office-timeout-review.json)：原60s Word失败造成reviewblock，既有admin review platform_waived幂等/audit1/remaining0，原finance/ledger不变、不补扣，supplierCostKnown=false由平台承担未知费。

App0.3.5 ASAR全hash PASS；installer342844761bytes，SHA256 `6cca11c5436932a384074d545a1ae65e231ebba6f1ad74d4855b34a1209eec76`。正式publicrelease/同device升级PASS；自动升级完整公网下载/sha256/UpdateManagerREADY通过；本机host安装/重启/UAC未执行。
## 已公开发布与安装回退时限

[0.3.5发布](evidence/035-release.json)已published，release `17946352-c168-46a9-be6f-c8aac0dd1529`；[安装包](https://ai.mddxz.top/api/v1/releases/files/17946352-c168-46a9-be6f-c8aac0dd1529)，342844761bytes，SHA256 `6cca11c5436932a384074d545a1ae65e231ebba6f1ad74d4855b34a1209eec76`。[同设备升级](evidence/035-latest-upgrade.json)PASS：旧0.3.4 HTTP426 CLIENT_UPGRADE_REQUIRED，同device0.3.5 refresh后模型可用，测试设备已撤销。公开完整自动下载342844761bytes、sha256 verified、UpdateManager READY0.3.5 PASS。

Store30秒无非零递增下载进度自动offline；已开始下载后90秒无进度或15分钟总限触发有界回退。Windows真实UAC仍需用户允许，不能宣传无权限静默安装；当前host真实安装/重启未执行。App安装包18项version/关键ASAR文件检查全部PASS，App安全证据docs/evidence/035-package.json。Git最终由Root报告。
最终公网升级证据：Cloud docs/acceptance/evidence/035-public-update.json（已去除私人本机路径），publicLatest/automaticDownload/sha256Verified/READY035 PASS。旧034下载已删除，服务器仅一份latest Bridge安装包并保留officialZIP；Root最终服务器核对和Git提交由最后发布报告记录，不提前写GitSHA。真实本机host安装/重启/UAC与用户原始WordGUI、真实>60s生产任务仍未验证。
