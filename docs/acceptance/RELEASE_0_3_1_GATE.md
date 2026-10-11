# 0.3.1 发布验收与边界

日期2026-10-11。0.3.1已经公开发布；发布成功不代表官方Word/附件、UAC安装和host重启均通过。[产品六项](../product/IMPLEMENTATION_0_3_1.md)为当前合同，0.3.0文档为历史。

| 场景 | 最终结果 |
| --- | --- |
| App | 137/137 PASS，build、asar关键13files一致 |
| Cloud | 96unit PASS/26DBskip；隔离实际DB20/20 PASS；contract10/10 PASS |
| native串行 | 单call→policy失败function_call_output两请求200/COMPLETED/SETTLED；多callguard/缓冲/结算测试通过 |
| 官方Wordruntime | host执行policy阻止读取，未读文档；不绕过，不能标完整Word工具回路PASS |
| 固定业务WordAPI | 固定read_word_quiz只读844B真合成DOCX：双模式4HTTP200/completed/SETTLED、隐藏marker+15/54正确、thinking前序明文+opaque恢复、21点¥0.0021；非桌面附件回路 |
| 官方ZIP | 944698333bytes/51b8…d88d公开完整下载hash PASS；真实Edge155 1280/390/HEAD200/nooverflow PASS |
| 自动安装代码 | 固定manifest/hash/size、5entry仅MSIX/license、禁止ZIP脚本、签名identity/UAC脚本/注册detect最终tests PASS；真实本机UAC未执行 |
| 重启/慢响应 | EncodedCommand/竞态中文、15min/control30s、retry0迁移与取消不POST测试通过；真实官方host重启未执行 |
| 发布/升级 | 0.3.1已published，UpdateManager0.3.0→0.3.1完整下载/hash READY |
| 最新策略 | config min=latest0.3.1；旧App426/admin不受限；volume只latestexe+official；财务不删 |
| Git | 两库main当前提交由Root最后汇报 |

## 发布标识

release `55b65673-0d6e-4283-af85-9bcbacbaa9ba`；[安装包](https://ai.mddxz.top/api/v1/releases/files/55b65673-0d6e-4283-af85-9bcbacbaa9ba)，342837015bytes，SHA256 `20993362821c42becb8456361bf072038164c6122aac5dd2154093b280d76ea6`。升级证据outputs/architecture-public-update-031.json，官方ZIP网站证据outputs/ui-live-download-0-3-1/report.json。

Domain2.5 hash `01d5d70e80919a88e21a3ae38a8bda027ff0e2e44639625a3ff47b1c254d2be8`；Gateway1.1 `e522763e7e3cea1a9edc4c9d3aa5b06c047697847b2d9165efef2168c21991f7`。官方ZIP26.1007.2314.0 x64/944698333bytes SHA256 `51b8bb192e6dee8da92421605d59b61b4bd424678ac36676a7df95b02bf1d88d`。

## 安全验收证据

[manual-word](evidence/0.3.1-manual-word.json)、[public-update](evidence/0.3.1-public-update.json)、[latest-upgrade](evidence/0.3.1-latest-upgrade.json)、[official-download](evidence/0.3.1-official-download.json)、[public-download-ui](evidence/0.3.1-public-download-ui.json)。Word测试设备已撤销，未执行模型命令或绕host policy。installer/真实updater/minstrict/versionrefresh PASS，Git两库main最终commit由Root汇报。

## 限制与财务保护

DeepSeek不是原生串行，Bridgeguard可失败且真实生成收费；8MiB缓冲延迟delta。官方Wordhost policy阻止不能以业务API手动文本取代官方附件成功。原始input_file/Office-PDF拖入/预览UNKNOWN。离线包原签名/架构未改，但UAC安装与host重启未执行，不宣称真实成功。

本轮无新增服务备份、只最新版本，不删除历史账号/设备/usage/不可变账本。未知usage继续原审计保护，平台承担review不退款不改已知消费。禁重复模型POST，取消不重发。后续真实host授权与人工安装验收应独立记录，当前不绕执行policy。