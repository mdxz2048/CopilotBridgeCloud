# 0.3.6 失败反馈验收

日期：2026-10-12，Asia/Shanghai。状态：0.3.6正式发布；API/Web及0011迁移、真实反馈闭环与公网完整更新下载通过。产品与字段协议见 [产品方案](../product/FAILURE_FEEDBACK_0_3_6.md)。Root负责构建、真实DB、部署、公开升级和Git；App/Cloud/UI Agent分别维护采集队列、服务存储与管理员入口。

## 已审查实现

App `electron/cloud/failure-feedback.ts` 与 `remote-bridge-server.ts` 分离诊断采集和原生模型转发；一次失败只发一次报告，主动取消不报告，正常终态不上传正文。`http-cloud-client.ts` 使用设备签名上传；加密队列按原 owner 隔离，当前登录不匹配时不发送。反馈重试不得变成模型重试。

Cloud `apps/api/src/diagnostics.ts` 使用认证用户邮箱/设备版本、owner 校验、重复 ID 校验、AES 正文、全局事务锁和持久每小时计数。128 KiB 接口、14 天、1,000 条和 128 MiB 加密载荷总上限分别生效。三个管理员查询/详情/删除接口不能被普通账号访问，删除须同源且只写无正文审计，不改财务账本。

## 验收矩阵

| 项目 | 判定证据 | 当前状态 |
| --- | --- | --- |
| Cloud 单元/typecheck/build | 最终完整执行结果 | PASS：Cloud115 unit/typecheck/build，contract10与2.7.0合同一致 |
| DB 权限与存储 | 真实隔离 DB22：owner、DPoP、加密、幂等、限额、删除审计 | PASS：真实隔离DB22，包含签名/身份/加密/限额/保留/无账本变化 |
| App 全量/构建 | 最终测试总数与产物一致 | PASS：完整179/179；最后生命周期补丁定向15/15、typecheck/build通过，不能写完整180 |
| HTTP、failed、incomplete、断连 | 一次失败报告，关联 request/response/thread；无重复模型 POST | App回归PASS；生产四阶段见下方，incomplete不称生产实测 |
| 正常与主动取消 | 正常不上传正文，主动取消无故障反馈 | App回归PASS |
| 账号与断网 | 同 owner 才上传；加密重启恢复；7天/20条/2MiB与反馈退避 | App回归PASS；身份生命周期补丁定向15/15 |
| 大正文与长工具暂停 | 100KB输出、模拟>1小时暂停后模型转发不被诊断截断 | App回归PASS；仅模拟暂停，不是实际小时命令 |
| UI 筛选/分页/删除 | 真实组件模拟浏览器、XSS不执行、窄屏无溢出、错误重试 | PASS，见下方证据；不是生产 API 验收 |
| 生产无付费闭环 | 合成失败→签名上传→服务端账号邮箱→管理员列表/详情/删除/审计；生成POST为0 | PASS：真实API与真实公网管理员浏览器；无模型调用或账本变化 |
| 0.3.6发布/升级 | 安装包版本/哈希、最新版本限制、同设备刷新、公开完整下载READY | PASS：安装包20检查、旧035426、同设备036模型可用、完整公网SHA验证READY |

UI 证据：[安全报告](evidence/0.3.6-ui-failure-feedback.json)，级别 `MOCK_BROWSER_REAL_COMPONENT`，`realApiWrites=0`。覆盖筛选编码、分页、删除、空态、失败重试、JSON文本安全展示、窄屏与弹窗边界；不将 mock PASS 写成生产管理员流程 PASS。

生产证据：[自动反馈](evidence/0.3.6-production-feedback.json)覆盖local_validation、cloud_http、stream_failed、stream_disconnected四类故障，通过真实反馈API关联邮箱/设备/版本、请求回复展示、脱敏、AES和幂等，无模型调用和计费变化；流失败使用固定合成SSE，不称真实供应商故障。[真实后台](evidence/0.3.6-real-admin.json)覆盖公网筛选、详情、390px无溢出、删除；测试报告清理、设备撤销完成。安全副本移除邮箱、报告/设备UUID、私人路径及正文，仅保留断言与范围。

发布记录：Windows x64 stable 0.3.6，release `33cc592f-06de-46b5-9121-c2745ade5cf7`，342848436 bytes，SHA256 `eb278d71eaa0b1e1e3f9ec4a2bf4e828216738684b4965ee5e4c3e1ba456c094`。[公开安装包](https://ai.mddxz.top/api/v1/releases/files/33cc592f-06de-46b5-9121-c2745ade5cf7)。证据：[包内容](evidence/0.3.6-package.json)、[发布](evidence/0.3.6-release.json)、[同设备升级](evidence/0.3.6-latest-upgrade.json)、[完整自动下载](evidence/0.3.6-public-update.json)。

## 发布条件与保留边界

本期功能发布门槛已通过；保留以下未实测能力边界。本期不要求额外备份，不删除既有财务历史。Git提交由Root最终发布报告记录，不写尚未提交的SHA。

诊断不是完整网络抓包，文本会脱敏并截断；不上传正常聊天全文、原始附件二进制或加密推理。诊断上传不计模型生成费用，但原失败模型请求仍按实际 usage/既有未知费用审核规则处理。本期不新增退款、重算或重新调用模型。

长工具由官方宿主执行；600秒为单次模型生成时限。模拟长暂停与大代码只验证转发/诊断隔离，不证明真实宿主允许任意命令。既有 Office 普通/思考固定外部工具12请求通过，不能泛化为用户原始Word拖拽、所有附件、真实>60秒任务或所有长命令成功。当前官方宿主 GUI、UAC安装、重启均未执行实测。
