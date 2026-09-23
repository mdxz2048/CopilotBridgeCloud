# Web UI / UX PRD

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
