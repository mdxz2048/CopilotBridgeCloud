# Web UI / UX PRD

## 下一阶段：分角色控制台与按量计费（规划，尚未全部上线）

公开网站 `/`、`/pricing`、`/download` 对访客开放。登录后 USER 默认进入
`/dashboard`，ADMIN 默认进入 `/admin`；两者使用独立导航与数据加载。
普通用户首页只显示本人账号状态、已邀请人数、AI 点数余额、已绑定设备数，
以及客户端下载入口。需要详情时从对应卡片进入，仅能读取本人数据。
管理员界面不混入用户中心；普通用户不能通过直接访问 URL 或调用 API
获取管理数据。身份未确认时不得先渲染任何一方的私有界面。

管理员后台按以下业务分组，而不是平铺各类数据表：

- 总览/网站状态：用户、设备、请求量、Provider/数据库/Gateway 健康，
  访问趋势、异常和模型使用统计；区分访问记录与操作审计，不记录密钥或提示词。
- 用户管理：用户列表和独立详情，详情集中展示账号、设备、邀请、
  点数/付款历史和模型权限。切换用户时清空前一用户的数据与表单，
  异步旧请求不得覆盖新用户资料。
- 模型与 Provider：管理员添加 Copilot 时进入授权界面，添加 DeepSeek
  时进入 API Key 绑定界面；连接成功后再设置模型能力、可见范围和费率。
  私密凭据只显示配置状态，认证失败的模型不能开放。Copilot 的正式
  商用/公开接入仍须单独通过授权和发布审查。
- 套餐与计费：套餐编辑展示内容、绑定模型和设备权益；现阶段不收月费、
  不按周期赠送点数、不宣称自动续费。不同模型的输入/输出等按量单价由
  版本化费率卡管理，服务端实际结算是扣费唯一依据。测试测算不能显示为
  实际消费；支付/充值未接通时不得提供虚假付款入口。
- 网站配置与版本：Turnstile、Resend SMTP、邮件模板；安装包上传、
  校验 SHA-256、草稿预览、发布及回退。没有已发布安装包时下载页显示
  明确空状态，不能链接旧包。
- 运营与系统：访问统计、模型使用、Provider 成本、运行诊断、操作审计
  分开呈现；收入只有真实支付与结算可核对后才能显示。

发布前至少验证：USER 访问 `/admin` 和管理 API 均被拒绝；两个 USER
互不可见设备/邀请/余额；ADMIN 快速切换用户不会显示前一人的详情；
模型认证失败或安装包未发布时对普通用户不可见。

## 当前网站信息架构（2026-09-30）

品牌蓝色与 Desktop App 统一；下方早期灰色值是历史视觉参考，不能覆盖
现有主题变量。官网优先展示“官方 ChatGPT Desktop + 独立 Bridge 环境”
的原创图示和三步流程。不能复制第三方截图或宣称 Copilot/Cloud 模型
是 OpenAI 官方模型。“无需代理”仅指无需用户手工配置代理，不能承诺
绕过地区、网络或官方账号限制。切换环境需要 Windows 注销重登。

公共页头须在首页、套餐、下载、登录和注册页保持相同身份状态：
访客可登录/注册；已登录用户看“我的账户”，ADMIN 才有后台入口；
状态未确认时不显示错误身份的操作。用户中心仅呈现本人套餐/实际扣费
点数、用量、邀请、可用模型、设备与账户；管理员后台单独呈现运营功能，
并由 API 的角色检查保护，不以隐藏按钮代替鉴权。

App 内“注册 Cloud”统一跳转网站，不再维护另一套邮件/人机验证表单。
网站注册流程为邮箱与密码→Turnstile→发送邮件码→填写邮件码→创建
账号→未开通提示→管理员测试开通→App 登录绑定设备。登录页单独做人机
验证；验证码发送失败、过期、错误、频繁操作都必须明确说明并允许安全
重试。SMTP 和 Turnstile 参数未配置前不得假装验证码已发送。

管理员“网站配置”要把公开的站点密钥、服务端私密密钥、Resend SMTP
发件地址和邮件模板分组呈现。密钥输入框保持空白，仅显示“已配置/
未配置”，不允许回显；留空表示不更换。模板正文支持 `{{code}}`
占位符和即时预览，保存时阻止缺少占位符的内容。明确提示测试发件
地址只能给指定测试邮箱发送，且保存配置不会自动开启强制验证；
发布开关与真实投递验收属于独立步骤。

这是 Web UI 唯一事实源。

实现和本文件冲突时：

以本文件为准。


## 1. Design Goal

整体风格：

高级

克制

简洁

功能明确

消费级科技产品


视觉语言：

参考 Apple 官网

Apple Account

iCloud

macOS Settings


但：

不得机械复制 Apple。


必须避免：

传统企业后台

开源 Dashboard

AdminLTE

默认 shadcn demo


## 2. 设计关键词

少

清楚

高级

舒服

可信赖


Admin：

高效

克制

信息清晰


## 3. 基础颜色

Background：

#F5F5F7


Card：

#FFFFFF


Primary Text：

#1D1D1F


Secondary：

#6E6E73


Muted：

#86868B


Primary Blue：

#0071E3


边框：

rgba(0,0,0,0.06~0.10)


颜色只服务于：

Primary

Success

Warning

Danger


禁止：

紫蓝赛博渐变

霓虹

满屏彩色卡片


## 4. Typography

系统字体：

-apple-system
BlinkMacSystemFont
Segoe UI
PingFang SC
Microsoft YaHei


Hero：

52–64


Page Hero：

36–44


Page title：

28–32


Section：

20–24


Body：

15–17


Secondary：

13–14


## 5. Radius

Button：

10~12


Input：

10~12


Card：

18~20


Modal：

20~24


必须 Token 化。


## 6. Spacing

统一：

4

8

12

16

24

32

48

64

96


禁止随意 spacing。


## 7. Homepage

结构：

Navigation

Hero

核心价值

Provider

Local Agent

使用流程

Pricing

Download

FAQ

Footer


Hero：

Copilot Bridge

让 ChatGPT Desktop
连接更多 AI 模型。

GitHub Copilot、DeepSeek，
以及更多模型，
同时保留熟悉的 ChatGPT
和本地 Agent 体验。

[下载 Windows 版]

[了解更多]


第一屏不要：

注册表单

Token

Provider 技术信息

Gateway 技术信息


## 8. 首页 Local Agent

文案方向：

模型负责思考。
文件留在你的电脑。

Copilot Bridge 允许 Agent
在本机读取、修改和创建文件。


不要向普通用户介绍：

Tool Bridge。


## 9. Pricing

只展示：

Standard

Pro


Standard：

部分模型

标准 AI 用量

较少设备


Pro：

全部模型

更高 AI 用量

更多设备


Pro 可以轻微突出。

禁止：

闪烁

金色大渐变

夸张推荐标签。


## 10. Login

中央小卡片。

不要左右营销大图布局。


包含：

Logo/Product Name

邮箱

密码

登录

忘记密码


## 11. User Dashboard

风格参考：

Apple Account。


Header：

下午好，xxx


主要卡：

Pro

订阅有效

下次续费


第二主要区：

AI 用量

42%

Progress


下面：

设备

可用模型

客户端版本


不要：

10+ KPI Card。


## 12. Sidebar

用户：

概览

订阅

AI 用量

设备

可用模型

下载


Admin：

概览

用户

设备

套餐

订阅

用量

订单

Providers

模型

版本

审计

系统


Sidebar 不使用：

深蓝黑色传统后台。


## 13. Usage

用户重点看：

AI 用量百分比。


详情：

请求

Input Token

Output Token

Total Token


普通用户不显示：

成本

usage_weight


## 14. Device

用户设备：

优先 Card。


Admin 大量设备：

允许 Table。


当前设备清楚标记。


Revoke：

二次确认。


## 15. Subscription

显示：

当前套餐

价格

权益

有效期

下次续费


Standard：

主要 CTA：

升级 Pro


## 16. QR Payment

未来扫码：

套餐

金额

支付方式

QR Code

订单倒计时


支付成功：

简单成功状态

返回账户


不要复杂结果页。


## 17. Admin Dashboard

顶部最多 4 个主要 KPI：

用户

有效订阅

在线设备

今日请求


然后：

Provider Health

Database

Gateway


再：

最近用户

最近订单


## 18. Admin Table

弱分割线

足够行高

Hover

Search

Filter

Pagination

Sticky Header


禁止每个 Cell 都有 Border。


操作：

...

菜单。


## 19. Providers

使用 Card。

GitHub Copilot：

Connected

Account

Models

Health


DeepSeek：

Enabled

Models

Health


[管理]


## 20. Model Management

表格：

Display Name

Provider

Status

Standard

Pro


低频参数放：

Sheet / Detail。


## 21. Empty State

必须设计。

例如：

还没有设备

登录 Copilot Bridge Desktop 后，
设备会自动出现在这里。

[下载 Copilot Bridge]


禁止：

No Data

null

[]


## 22. Loading

优先 Skeleton。

不要整页 Spinner。


## 23. Error

用户：

暂时无法加载

请稍后重试。

[重试]


真实 stack：

只进 log。


## 24. Motion

150–250ms

轻微。

支持：

prefers-reduced-motion。


## 25. Responsive

官网：

Mobile 必须优秀。


Dashboard：

Desktop first

Mobile 可正常使用。


至少测试：

375

768

1280

1440

1920


## 26. Accessibility

Keyboard

Focus

Semantic HTML

Label

ARIA

Contrast

Reduced motion


## 27. shadcn

允许使用。

但是：

只是 Component Primitive。

禁止最终结果看起来像默认 shadcn 示例。


## 28. Hard No

禁止：

传统 AdminLTE

深色后台 Sidebar

大面积渐变

霓虹

滥用 Glassmorphism

每个内容都 Card

Card 套 Card

一个页面几十个按钮

一个页面几十个开关

Emoji 作为功能 Icon

混用 Icon System


Icon：

统一 Lucide。


============================================================
