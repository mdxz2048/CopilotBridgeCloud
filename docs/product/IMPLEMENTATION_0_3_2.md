# Copilot Bridge 0.3.2 最小修复方案

日期2026-10-11。状态：0.3.2已公开发布，完整141/141 tests/build/ASAR13项与生产normal/thinking固定工具回路PASS；仅Updater最终READY与Git记录待Root。仅修Local Bridge custom工具SSE映射；Cloud原生协议/数据库/财务架构不改，0.3.1文档保持历史证据。Root负责集成验收和latest-only自动更新发布。

## 问题与证据

custom工具经必要function wrapper转换后，上游`response.output_item.added`中arguments可能是空字符串或分片尚不完整。现有desktopEvent过早JSON.parse产生`SyntaxError: Unexpected end of JSON input`，错误文本length28；Root实证与本机trace10f2b2ab的06:42:52 LOCAL_ERROR length28吻合。因此该已定位流断开不能定性为一般公网故障。复现不包含用户正文，不重复发送用户的真实付费请求。

## 修复职责与合同

App在每次response内部维护独立custom SSE状态，绑定item/call ID与tool alias，added阶段不解析空/partial JSON。function wrapper argument delta逐步累积并按已确认字符串内容生成custom input delta；done/final完整校验后输出对应input done/item done与completed，保留namespace/name恢复。原生apply_patch与普通function不被wrapper逻辑错误改写。

禁止跨响应共享arguments状态，混合/并行items保持各自索引/call ID。合法空input与不完整JSON区分；完整非法finalargs返回单一SSE `event:error` / `type:error` / `code:INVALID_SERVER_RESPONSE`及安全请求ID，不裸断TCP或将半成品当成功。完成/失败状态与settlement/history保持一致，坏工具不能泄露参数正文。

本修复不新增模型POST、不自动重试当前会话、不重放已执行工具或重复收费；只纠正一次上游响应到官方客户端的事件表达。0.3.2版本用于发布自动更新，Cloudlatest-only指向0.3.2后旧App提示升级，平台账本和历史usage不修改。

## 验收要求

added空arguments、跨网络chunk分片、转义与Unicode、input增量/结束、并行custom/function/原生apply_patch、响应隔离、done/completed一致、坏finalargs安全failed、客户端取消与上游断流分别测试。全量App tests/typecheck/build、官方形状HTTP SSE→Local RemoteBridgeServer→生产Cloud→DeepSeek固定工具回路以及public UpdateManager0.3.1→0.3.2完整hash READY由Root收口，付费生产样本只在必要受控fixture验证。

## 边界

不把此SSE修复宣称官方Word拖拽/预览完整成功。0.3.1固定应用WordAPI成功是另一证据；官方host工具读取被执行policy阻止仍保持未验证，不绕policy。真实本机UAC安装/官方host重启尚未执行。Cloudprotocol/hash不改，正式发布与真实生产回路已通过；Updater最终READY/Git由Root记录。

最终离线基线：0.3.1为137项，本补丁4新增，合计141/141 PASS；build/ASAR13项含version PASS。新增Unicode surrogate跨delta与缺arguments.done补齐。官方runtime受host工具policy限制本轮未执行，不列通过；已用官方请求形状HTTP SSE→Local RemoteBridgeServer→生产Cloud→DeepSeek固定安全工具normal/thinking续接验证真正跨层协议。

## 正式发布与生产证据

0.3.2 release `efeec65f-e20f-4a02-9679-d9dffe96bff1`已published；[安装包](https://ai.mddxz.top/api/v1/releases/files/efeec65f-e20f-4a02-9679-d9dffe96bff1)，342838390bytes，SHA256 `3ad9af20d3197a04eef0de8427e53fc938f80f40d13ab53bb5843539c1962563`。

[生产custom SSE证据](../acceptance/evidence/0.3.2-custom-sse.json)PASS：normal2POST+thinking2POST各完整同thread工具回环无retry；额外探索thinking1POST因模型未逐字复制预设fixture但已completed/SETTLED，非SSE转换失败。总5付费POST均SETTLED45点¥0.0045。上游wrapped.input与Local input delta/done/completed逐字相同，namespace/Unicode/escape无wrapper泄漏；测试设备已撤销。

旧0.3.1请求426；0.3.2 refresh同UUID/P256版本登记后models可用PASS。全量141/141、build/ASAR13 PASS。真正验证的是官方请求形状HTTP SSE→Local RemoteBridgeServer→生产Cloud→DeepSeek；本轮官方host工具policy仍BLOCKED，不能宣称官方runtime执行、拖拽Word或DesktopUI完整成功。Updater完整下载最终READY和Git两库main commit由Root补真实证据。
发布收口：公开 UpdateManager 已完整下载 342838390 bytes，SHA256 验证通过并进入 READY（0.3.2-public-update.json）；两库 Git 最终提交及服务器源码同步记录由 Root 的 architecture-final-release-032.json 保存。
