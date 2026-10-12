# Responses nginx部署要求

日期：2026-10-12，Asia/Shanghai。本要求针对ai.mddxz.top现有反向代理，不包含TLS密钥、账号或上游凭证。0.3.7应用发布状态见[验收](../acceptance/LONG_REQUESTS_0_3_7.md)。

## 固定入口策略

生产已将exact `/v1/responses`配置为以下要求；保留现有真实upstream、转发/代理头和安全配置，不用示例覆盖整站server块。

```nginx
location = /v1/responses {
    client_max_body_size 64m;
    client_body_timeout 300s;
    proxy_read_timeout 4200s;
    proxy_send_timeout 300s;
    proxy_buffering off;
    error_page 413 = @responses_payload_too_large;
    # 这里保留现有proxy_pass与原有转发头配置。
}

location @responses_payload_too_large {
    default_type application/json;
    return 413 '{"error":{"code":"PAYLOAD_TOO_LARGE","message":"Responses request body exceeds 64MiB."}}';
}
```

`proxy_read_timeout`是两次读取间的等待，并非请求总时限；应用仍需独立connect/idle/total策略。body/send超时也是传输阶段约束，不表示所有阶段都可等待70分钟。`proxy_buffering off`保持SSE及时传输。exact location须指向现有API，防止被普通1m路由覆盖；普通路由1m限制未全站放宽。诊断API仍由Cloud限制128KiB，release upload保持独立流式上传策略。

## 每次部署必查

1. 读取实际`nginx -T`，确认目标域名exact location、继承配置、upstream和错误处理，不能只查仓库模板。
2. `nginx -t`通过后reload，重新读取生效配置。
3. 无鉴权合成JSON正文大于1MiB（本次2MiB），公网Responses应返回应用401而不是nginx HTML413；不触发模型POST，不携带私人文本。
4. 核对超限路径返回HTTP413和JSON `PAYLOAD_TOO_LARGE`；保留请求体保护，不能无限放大正文。
5. 验证SSE未被代理缓冲，应用total、客户端等待与代理read超时一致；小时级边界可用fake clock覆盖，不冒充真实小时生产实测。

当前Root已确认nginx-t/reload与公网2MiB→401 PASS。公网20MiB未知模型到权限403/统计入库、声明64MiB+1仅发送{}提前JSON413、App本地64MiB逐字与超限边界及计时回归已通过，详见验收文档；不称真实小时生成。恢复或重建代理后重复本清单，避免默认1m/120s回归。配置变更不删除历史账本、用户与release卷，不要求新增备份或许可流程。
