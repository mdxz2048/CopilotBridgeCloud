# 0.3.2 custom工具流发布门槛

日期2026-10-11。修复范围见[产品方案](../product/IMPLEMENTATION_0_3_2.md)。App141/141/build/ASAR13与正式发布/真实生产回路PASS；Updater最终READY/Git待Root。Cloud原生协议不改，历史0.3.1文档不改。

| 门槛 | 所需证据 | 当前 |
| --- | --- | --- |
| 根因 | custom wrapper added空arguments提前JSON.parse复现，length28与本机trace吻合 | Root已定位 |
| 正常流 | added/delta/done/completed映射为合法custom input delta/done，转义Unicode及分片边界 | App141/141回归PASS |
| 隔离 | 每response/item/call独立state，并行与连续响应无污染，原生apply_patch/普通function保留 | App141/141回归PASS |
| 错误 | 坏finalargs单一SSE event:error/type:error/code:INVALID_SERVER_RESPONSE安全错误，不裸TCP断开、不泄参数；取消/断流区别 | App141/141回归PASS |
| 消费 | 不新增模型POST/不自动重试/不重放工具，settlement/history不虚构成功 | 同thread各2POST无自动retry、真实usage45点SETTLED PASS |
| 官方runtime | 未执行：host工具policy限制，不伪称官方Desktop/runtime通过；采用官方形状HTTP SSE→LocalBridge→生产Cloud→DeepSeek固定工具回路 | 生产normal/thinking官方形状固定工具回路PASS；官方host仍未执行 |
| 全量构建 | App141/141/build/ASAR13项（含version）PASS；安装包version/size/hash | 正式0.3.2 published，size/hash明确PASS |
| 发布升级 | 0.3.2 published，旧0.3.1 HTTP426、新0.3.2 refresh同UUID/models可用；真实下载最终READY | 待Updater完成 |
| Git | 两库main最终push/commit由Root记录 | 待Root |

最终发布：release efeec65f-e20f-4a02-9679-d9dffe96bff1，342838390bytes，SHA256 3ad9af20d3197a04eef0de8427e53fc938f80f40d13ab53bb5843539c1962563。修复只LocalSSE映射，服务端不重复执行请求/扣费，财务表不改。

官方Desktop Word拖拽/预览未验证，host执行policy阻止不绕过；0.3.1固定Word业务API证据不推广为桌面工具成功。真实UAC安装/host重启未执行，保持原边界。

## 正式发布与生产证据

0.3.2 release `efeec65f-e20f-4a02-9679-d9dffe96bff1`已published；[安装包](https://ai.mddxz.top/api/v1/releases/files/efeec65f-e20f-4a02-9679-d9dffe96bff1)，342838390bytes，SHA256 `3ad9af20d3197a04eef0de8427e53fc938f80f40d13ab53bb5843539c1962563`。

[生产custom SSE证据](evidence/0.3.2-custom-sse.json)PASS：normal2POST+thinking2POST各完整同thread工具回环无retry；额外探索thinking1POST因模型未逐字复制预设fixture但已completed/SETTLED，非SSE转换失败。总5付费POST均SETTLED45点¥0.0045。上游wrapped.input与Local input delta/done/completed逐字相同，namespace/Unicode/escape无wrapper泄漏；测试设备已撤销。

旧0.3.1请求426；0.3.2 refresh同UUID/P256版本登记后models可用PASS。全量141/141、build/ASAR13 PASS。真正验证的是官方请求形状HTTP SSE→Local RemoteBridgeServer→生产Cloud→DeepSeek；本轮官方host工具policy仍BLOCKED，不能宣称官方runtime执行、拖拽Word或DesktopUI完整成功。Updater完整下载最终READY和Git两库main commit由Root补真实证据。
发布收口：公开 UpdateManager 已完整下载 342838390 bytes，SHA256 验证通过并进入 READY（0.3.2-public-update.json）；两库 Git 最终提交及服务器源码同步记录由 Root 的 architecture-final-release-032.json 保存。
