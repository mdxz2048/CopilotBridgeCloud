# 硬件设备号与上线验证（2026-10-17）

已部署服务器/网页，App 0.3.21 已发布；未改首页宣传内容。

设备名称是系统主机名的展示字段，绑定设备号独立计算。hardware-v1 在本机规范化 SMBIOS UUID、CPU ProcessorId，以稳定的主板 UUID 和 CPU 为主；无有效 UUID 时以 CPU 与内置物理网卡永久地址派生。排除虚拟网卡、本地管理/组播地址，排序、去重，SHA256 硬件摘要后使用应用命名空间生成 RFC UUIDv5。原始硬件值只存在本地进程内存，不写文件、不上传、不写日志；本地只存算法版本、派生 UUID 与升级所需旧随机 UUID。资料依据：[SMBIOS UUID](https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-computersystemproduct)、[MSFT_NetAdapter](https://learn.microsoft.com/en-us/windows/win32/fwp/wmi/netadaptercimprov/msft-netadapter)。

相同硬件输入跨进程、重装、主机改名、App 版本变化稳定；临时读取失败保留已缓存身份，新安装读取失败明确报错，不生成随机替代号。真实更换硬件会生成新号，并要求手动登录，不走旧随机号的自动迁移路径。硬件号仅用于识别，不替代 DPoP 安装私钥。

启动恢复通过 /api/v1/auth/resume 校验令牌、安装签名、账户及设备状态与授权版本，成功后记 APP_START + TOKEN。一个进程 sessionId 对网络重试去重，下一次进程启动另记一条。手动登录校验密码并原子记录 APP_LOGIN + PASSWORD，网页登录同理；既有五分钟离线后的 APP_RECONNECT 保留。旧历史字段缺失显示 —。

合法签名或正确密码可将旧随机号迁移到原设备数据库行，保留用量历史，不新增设备名额；迁移增加授权版本并撤销旧刷新凭据。过期访问令牌先刷新，利用刷新返回的旧设备号执行签名迁移，避免递归刷新。恢复登录不能更换私钥；重装导致私钥变化，只有完整正确密码登录才可重绑并撤销旧密钥会话。封禁和停用设备不能自动恢复。

App 设备列表、网页用户设备、后台用户管理分别展示名称和设备号。上线记录增加设备号、校验方式及 App 启动来源。无数据库结构迁移，无真实模型生成验收；实际官方客户端安装/重启未执行。App 238、隔离 PostgreSQL 51、API 153（并行构建下一个导入超时单独复验通过）、Web 15、契约 10 和真实 Windows 两个独立进程设备号一致性验证通过。生产只读 UI、公开 HTTPS 完整下载 SHA256 READY 通过。
