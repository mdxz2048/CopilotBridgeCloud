# 0.3.0 发布门槛与最终证据

日期：2026-10-11。Root负责集成/部署，Product复核合同/能力/交互。Cloud与客户端0.3.0已发布，真实公开自动下载完成；两库Git push与最终Web image由Root最后记录。完整架构及32节要求映射见[上线报告](RELEASE_0_3_0_REPORT.md)，职责见[LIVE](../product/IMPLEMENTATION_0_3_0.md)。

## 门槛结果

| 门槛 | 最终证据 | 结果 |
| --- | --- | --- |
| 数据安全 | 空库migration、DB19/19、生产clone0010、旧账号/模型/ACL/wallet/ledger/usage/requests/session字段hash不变、生产0010应用 | PASS |
| 路由 | native/priority/weight/健康能力/停用/pinned定向tests；Flash/Pro READY、thinking4行native同instance | PASS |
| 会话与工具 | 官方runtime经LocalBridge/Cloud/DeepSeek，normal/thinking各连续两轮真实执行/回传/completed | PASS |
| DeepSeek | normal109点、thinking56点/439reasoning tokens、四请求COMPLETED/SETTLED；直接图片/tools/官网能力价格 | PASS |
| 协议 | App字段/历史/SSE5项边界；明文+opaque推理保留、incomplete/failed、明确422；contract10/10 | PASS |
| 财务 | 固定费率/唯一usage/DB回归；取消未知usage审核platform_waived、幂等和原财务不变 | PASS |
| RPM续接 | thinking四行rateCounted=true,false,true,false | PASS |
| 隐私 | trace正文/tool/file/key隐藏、轮转/限期、加密账号隔离cache、安全shape corpus | PASS |
| App | typecheck/build、113/113、asar版本与源码hash | PASS |
| UI本地 | 390px/nooverflow/requestId/retry/weight0；审核用户筛选/原因/责任/失败重试/刷新、next build | PASS |
| 真实管理站 | architecture-real-admin/report.json：审核empty、native READY、无独立设备/用量页、390无溢出/adminFailures0 | PASS |
| 安装包 | release96c4ab92-b904-48d3-9a11-4015cbb3c422，0.3.0/342832124bytes/sha256 fe56…67ff | PASS |
| 真实自动升级 | architecture-public-update-030.json：UpdateManager0.2.7获得0.3.0、公开完整下载、sha256校验READY、config.latestVersion0.3.0 | PASS |
| Git备份 | Root最后push与commit在最终发布消息记录 | 待记录 |

核心协议/工具/财务门槛均通过。用户取消旧客户端兼容门槛；启动自动升级。真实官方runtime工具链为REAL_APP_SERVER+REAL_PROVIDER，不称全部REAL_DESKTOP附件UI通过。

## 发布记录

- API image短ID `4be63c09cafa`；Web已验收image `a98aa8512434`，Root完成最终文字构建后记录最终image。
- DB `0010_sudden_morlocks`已应用，历史账本/usage不改。
- Domain2.5 hash `20269272a7f5e429d73036f96b0fad3dc4e89f126e4bb02f10e40bdc9a8ee6a8`；Gateway1.1 hash `706ee93f9223bb676c0b38cf3736d6c8a52306e09a085c2168901c8e95cb3619`。
- [0.3.0安装包](https://ai.mddxz.top/api/v1/releases/files/96c4ab92-b904-48d3-9a11-4015cbb3c422)，342832124 bytes；SHA256 `fe56cb66a3bb812ca00a4648a3abbcd5227d6ef71729c27cc63b373bb96e67ff`。
- 真实证据：outputs/production-runtime-thinking-acceptance.json、outputs/architecture-final-db.json、outputs/architecture-real-admin/report.json、outputs/architecture-public-update-030.json。
- 两库最后Git push/commit与最终Web image由Root发布消息记录，避免文档自引用commit。

## 部署与恢复约束

生产/home/linuxuser/copilot-bridge-cloud/src保留runtime-release env、DB/release卷。用户要求直接替换不新增备份门槛；旧账本不覆盖。Cloud/additive迁移先行、App随后，仅重启官方客户端，无需Windows重启。

恢复旧构件/停用新策略保留additive schema/历史ID/实际费用。禁止drop表、覆盖整库、重写immutable usage/账本。金额纠错用补偿事务；未知成本review由平台承担，不退款、不改已知费用。

## 明确延期

官方Desktop拖拽/下载卡/附件预览、逐种Office/PDF原始input_file理解、音视频、compaction/无明文加密摘要reasoning、Cloud任意旧response分支、健康TTL/连续探测、共享账号硬预算和成本路由延期。文件工具文本提取不替代各原始文件/UI验收。

技能不允许自动操作官方ChatGPT/Codex UI；隔离app-server与Bridge自有UI已验证。fixture/corpus只安全shape，未观察附件/AgentUI明确UNKNOWN，不宣传完整支持。