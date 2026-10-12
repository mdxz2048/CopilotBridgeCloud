# 0.3.9 取消模型RPM验收

App191项测试通过；Cloud119项单元、类型检查和构建通过；真实隔离PostgreSQL的22项测试通过，包括同一分钟账号/设备/套餐低RPM时新请求和工具续接仍可用，以及并发/余额预留继续保护。独立Fastify测试验证超过1000次状态查询和超过600次模型POST不被传输次数拦截；通用公共写接口仍受防刷限制。工具续接覆盖100轮及滚动历史有效期，伪造或变更历史仍不能被认定为有效续接。

隔离数据库为bridge_v2_test_arch_20261012040355，测试容器bridge-architecture-test-20261012040355退出0；仅使用隔离数据和上游固定fixture，不是实际供应商生成或官方桌面工具执行。此次不关闭、重启官方ChatGPT/Codex宿主。

## 正式交付

生产24秒内700次状态查询PASS，模型列表仍正常，未鉴权模型入口401，无付费模型调用且余额未变。0.3.9正式发布，公开安装包完整自动下载和SHA校验进入READY；同设备038升级039通过，账户返回accountRpm/deviceRpm=0并可读取模型。服务器仅保留最新Bridge安装包，官方离线安装包保留。

release `af00e895-8377-4d15-9344-89bf20c4a8ce`；SHA256 `527e7b44f518bfcd696e68fb0e87b2352f5d73654e2a9c843ecceaf99f89a1be`。[安装包](https://ai.mddxz.top/api/v1/releases/files/af00e895-8377-4d15-9344-89bf20c4a8ce)。证据：[测试](evidence/0.3.9-tests.json)、[包内容](evidence/0.3.9-package.json)、[生产查询](evidence/0.3.9-production-read.json)、[同设备升级](evidence/0.3.9-latest-upgrade.json)、[完整下载](evidence/0.3.9-public-update.json)。真实官方宿主和用户原始网页任务未在验收中重跑。
