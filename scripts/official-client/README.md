# 官方客户端离线安装包

由运维手动执行 `python3 scripts/official-client/prepare.py`，从 OpenAI 官方 HTTPS 下载原始 x64 MSIX 和许可证，检查包标识与签名文件，封装安装脚本后写入 release volume 的 `official-client` 目录。下载文件和 ZIP 不提交 Git。

默认目录适用于当前部署；其他环境用 `BRIDGE_OFFICIAL_RELEASE_DIR` 指定发布目录。需要 Python 3.11+、curl、约 2 GB 临时可用空间和目录写权限。

发布后检查 `/api/v1/official-client/windows` 返回的版本、大小和 SHA256，并完整下载验证。此流程检查官方来源和签名文件存在；真正的签名验证由 Windows 安装原始 MSIX 时执行。

用户将 ZIP 全部解压，运行 `Install-ChatGPT.cmd`。脚本会请求管理员许可，按官方文档安装离线许可证并为当前用户注册，无需重启 Windows。安装失败会保留错误，不会报告成功。
