# 已注册邮箱提示与中文注册邮件（2026-10-16）

用户要求：注册时识别已注册邮箱并提示直接登录；注册页面与邮件沟通使用中文。此前的统一成功提示/已注册邮箱提醒邮件为旧规则，本次按用户明确要求替换。

## 行为

- 发送验证码仍先完成服务器端 Turnstile 校验，再按规范化小写邮箱查重。已有账号返回 409 EMAIL_IN_USE，不发送任何提醒或验证码邮件；SUPPRESSED 限流记录继续提交，保持原有邮箱/IP冷却与配额。最终注册在消费验证码前检查已有账号，唯一约束继续处理并发碰撞。
- 前端显示“该邮箱已注册，请直接登录。”与“前往登录”链接，阻止该邮箱继续提交；更换邮箱清除提示并恢复操作。未注册邮箱成功发送后显示中文收件提示，原邀请码/首次充值奖励、密码、验证码与人机验证要求保持。
- 默认及后台当前生效模板均为中文，主题“【Copilot Bridge】注册验证码”，正文包含验证码、10分钟有效期和非本人操作说明；发件人显示名为“Copilot Bridge 账号服务”。管理员仍可编辑模板。
- 注册/登录英文眉题改为“注册账号”/“欢迎回来”，登录错误使用中文映射，Turnstile 固定 language=zh-cn（官方支持：https://developers.cloudflare.com/turnstile/reference/supported-languages/）。

## 验证

API 153 单元、36 项独立 PostgreSQL 集成、Web 15 单元及两端构建/类型检查通过。独立测试库迁移后运行并删除；集成测试实际覆盖大小写重复邮箱、无邮件发送、SUPPRESSED无codeHash/sentAt、冷却、最终重复提交、邀请码回滚/首充奖励及中文默认/自定义邮件。真实 React renderer 结合模拟API/Turnstile在375/768/1440px验证提示、登录链接、更换邮箱、验证码独立发送和language参数；账户页模拟IPC回归保持通过。

没有向真实邮箱发送测试邮件，没有完成真人 Turnstile 流程；邮件内容验证使用模拟 SMTP 和生产模板读取。App 按用户要求继续保留本地修改，不上传安装包。

## 上线

2026-10-16 API/Web已部署，API镜像8f589cac0ad1、Web镜像aea9b736fe0f，生产源码与本地9文件hash一致，编译server.js SHA256 d6aa71a27df0db58c0d2cf73f579b6aaaeb72bec3ff2244164dadbbb4330bac9。候选Web容器检查成功后切换，生产注册/登录页面375/768/1440px及health验证通过；通过现有管理员API保存并读回中文模板，保留SMTP/Turnstile凭据，操作留审计，临时管理会话finally删除。

生产已注册邮箱的大小写形式在最终注册接口返回409 EMAIL_IN_USE，未发送任何真实邮件，未修改已有账号；人机验证仍true/READY。公开App latest/minimum均0.3.18，App充值入口继续仅本地，不上传。独立DB测试库已删除。证据见docs/acceptance/registration-accounts-{tests,production}-20261016.json。
