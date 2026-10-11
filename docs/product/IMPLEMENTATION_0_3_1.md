# Copilot Bridge 0.3.1 产品方案与最终状态

日期2026-10-11。0.3.1已公开发布；产品维护协议/功能，UI负责交互，App负责桌面，Cloud负责网关，Root负责发布与真实验收。沿用0.3.0逻辑模型/实例/财务架构，不新增Agent harness，不删除历史账号与账本。本轮无新增服务备份，仅保留最新Bridge安装包。

## 六项交付

| 项目 | 当前行为与证据 | 验收边界 |
| --- | --- | --- |
| 1 下载进度 | App角落绿色进度环表示自动检查/下载 | 最终App tests/build通过 |
| 2 READY安装 | 下载完用户主动点击安装，取消自动弹窗干扰 | public UpdateManager完整下载/hash READY通过 |
| 3 串行工具/Word | false保留，单call策略+8MiB缓冲，最多1执行call释放，多callfailed且实际usage结算 | native真实两请求200/COMPLETED/SETTLED；官方runtime读取被host policy阻止，不称Word桌面成功 |
| 4 长等待/重试 | Responses15min/control30s；request/stream retries0；取消不再POST | 旧Bridge retry0迁移保留外部设置；升级同UUID/P256当前version登记 |
| 5 重启/下载并安装 | EncodedCommand避免中文/转义与退出竞态；Store失败可点击下载并安装 | 固定manifest/hash/size、5entry仅MSIX/license、不执行ZIP脚本、签名identity、自有UAC脚本/注册detect；真实UAC安装和官方host重启未执行 |
| 6 官方包与latest-only | 官方ZIP/download#chatgpt、min=latest0.3.1、旧App426、admin不受限；只保留latestexe与official目录 | 官方ZIP公开完整hash/网站双尺寸PASS、最新manifest/完整升级PASS，历史usage/账本不删 |

## 串行与附件语义

DeepSeek官方parallel字段被忽略，Bridge提供安全guard而非上游原生串行。false与单调用instructions发上游，SSE只先发created/in_progress，其余输出暂存<=8MiB，终止确认执行call总数<=1才释放。>1时response.failed/UNSUPPORTED_CAPABILITY、无工具执行，真实usage仍按固定费率结算。串行delta会延迟，不能保证每次生成成功；禁重复付费POST或截断多call假装成功。

官方runtime Word fixture的exec_command受到host执行policy阻止，包括读取GetContent；不绕过policy。native单call→function_call_output两请求200/COMPLETED/SETTLED证明失败结果也可正常续接，未证明读出文档。固定read_word_quiz安全应用工具只读真实844B合成DOCX，普通/思考各2请求原生JSON工具回环已通过，不执行模型生成脚本，也不等于官方桌面拖入/工具读取/预览完整回路。

原始input_file仍不支持，官方附件拖拽/Artifact/Office-PDF原始理解UNKNOWN。不宣传所有门槛/Word完整LIVE；真实UAC自动安装和重启host未执行。

## 官方离线包

官方MSIX+license原样ZIP附安装脚本，App自动安装不执行ZIP内脚本，只验签/identity后提取MSIX/license并用自身EncodedCommand申请UAC。版本26.1007.2314.0/x64，944698333 bytes，SHA256 `51b8bb192e6dee8da92421605d59b61b4bd424678ac36676a7df95b02bf1d88d`。固定manifest GET `/api/v1/official-client/windows`、固定ZIP `/api/v1/official-client/files/ChatGPT-Windows-x64.zip`；未知filename拒绝。

公开完整ZIP/hash PASS；真实Edge155 1280/390 /download#chatgpt两区无横溢、HEAD200，报告outputs/ui-live-download-0-3-1/report.json。prepare.py/InstallPS/README在Cloud Git；不保证任意Windows环境安装成功。

## 最终测试与发布

App最终137/137 PASS、build/asar关键13files一致；Cloud96unit PASS（26DBskip），另隔离真实DB20/20 PASS；完整contract10/10 PASS。Domain2.5 hash `01d5d70e80919a88e21a3ae38a8bda027ff0e2e44639625a3ff47b1c254d2be8`，Gateway1.1 hash `e522763e7e3cea1a9edc4c9d3aa5b06c047697847b2d9165efef2168c21991f7`。

0.3.1 release55b65673-0d6e-4283-af85-9bcbacbaa9ba已published，342837015 bytes，SHA256 `20993362821c42becb8456361bf072038164c6122aac5dd2154093b280d76ea6`；下载 https://ai.mddxz.top/api/v1/releases/files/55b65673-0d6e-4283-af85-9bcbacbaa9ba。真实UpdateManager0.3.0→0.3.1完整下载/hash READY，outputs/architecture-public-update-031.json；client/config latest=min0.3.1。volume只剩最新exe和official目录。

Git两库main当前提交由Root最后汇报。安全证据：[manual-word](../acceptance/evidence/0.3.1-manual-word.json)、[public-update](../acceptance/evidence/0.3.1-public-update.json)、[latest-upgrade](../acceptance/evidence/0.3.1-latest-upgrade.json)、[official-download](../acceptance/evidence/0.3.1-official-download.json)、[public-download-ui](../acceptance/evidence/0.3.1-public-download-ui.json)。业务Word直接API理解/续接/计费PASS：normal/thinking共4HTTP200/completed/SETTLED、隐藏marker+15/54正确、thinking前序完整plaintext+opaque恢复、总21点¥0.0021，临时设备已撤销；真实官方Wordhost执行阻止、UAC安装/重启未测为明确限制，不作为已通过宣传。