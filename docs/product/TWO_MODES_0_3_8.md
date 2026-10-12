# 客户端两种使用模式

主开关是唯一模式切换入口：开启使用 Cloud，关闭恢复用户自己的 ChatGPT。没有 GitHub Copilot、本地订阅、自有 API 或首次服务选择弹窗。Cloud 模型类型和思考方式仍可选择。

切换前显示目标模式确认；取消不写配置。开启需要安装官方客户端并登录 Cloud，完成后提示重启 ChatGPT。关闭不需要 Cloud 在线或登录。账号登录本身不改变当前模式。

沿用 `switchAiService(REMOTE)` 与 `activateProfile(bridge/original)` 现有接口。原账号由 profile=original 表示，不以历史 backendMode=LOCAL 表示。旧本地服务设置收敛为原账号状态，Cloud 连接不会继续使用旧自有 API 绑定。

不改 Cloud 模型资源路由、Responses 协议、额度和计费；本期交付新的客户端安装包，服务器继续只提供和准入最新版。验证和正式发布见验收文档。
