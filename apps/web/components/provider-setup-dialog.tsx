'use client';

import { useEffect, useRef, useState } from 'react';
import { api, post } from '../lib/api';
import { CopilotAuthCard } from './copilot-auth-card';

type Provider = { id: string; code: string; name: string; enabled?: boolean };

export function ProviderSetupDialog({ provider, onClose, onReady }: {
  provider: Provider;
  onClose: () => void;
  onReady: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  useEffect(() => {
    if (provider.code !== 'DEEPSEEK' || !provider.enabled) return;
    const controller = new AbortController();
    void api<{ ready: boolean }>(`/api/v1/admin/providers/${provider.id}/health`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted && result.ready) { setReady(true); setMessage('现有 Provider 连接正常，无需再次输入密钥。'); } })
      .catch(() => { if (!controller.signal.aborted) setMessage('无法检查现有连接，请重试绑定。'); });
    return () => controller.abort();
  }, [provider.id, provider.code, provider.enabled]);

  async function verifyCopilot() {
    setBusy(true); setMessage('');
    try {
      const auth = await api<{ status: string }>('/api/v1/admin/copilot/auth');
      if (auth.status !== 'AUTHENTICATED') { setMessage('认证尚未完成。请完成 GitHub 验证后重试。'); return; }
      setReady(true);
      setMessage('认证已完成。可创建停用状态的模型草稿；正式开放还需单独审核。');
    } catch (error) { setMessage((error as { message?: string }).message ?? '认证状态读取失败。'); }
    finally { setBusy(false); }
  }

  async function connectDeepSeek() {
    if (!key.trim()) { setMessage('请输入 API Key。'); return; }
    setBusy(true); setMessage(''); setReady(false);
    try {
      const result = await post<{ ready: boolean; model: { displayName: string }; billingMode: string }>(`/api/v1/admin/providers/${provider.id}/connect-deepseek`, { apiKey: key.trim() });
      setKey('');
      setReady(true);
      setMessage(`已连接并启用 ${result.model.displayName}。${result.billingMode === 'SHADOW' ? '当前为测试计量，不扣用户余额；上游 API 仍产生费用。' : '请检查该模型的费率配置。'}请在模型权限中授权用户，并确认用户已开通服务。`);
    } catch (error) { setMessage((error as { message?: string }).message ?? '绑定或验证失败，请重试。'); }
    finally { setBusy(false); }
  }

  return <dialog ref={dialog} className="provider-dialog" aria-label={`配置 ${provider.name}`} onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="provider-dialog-content">
      <div className="inline-actions"><h2>连接 {provider.name}</h2><button type="button" className="mini-button" onClick={onClose}>关闭</button></div>
      {provider.code === 'COPILOT' ? <><CopilotAuthCard/><button type="button" className="button button-small" disabled={busy} onClick={() => void verifyCopilot()}>检查认证结果</button></>
        : provider.code === 'DEEPSEEK' ? <><p>输入管理员管理的 DeepSeek API Key；密钥在服务端加密保存，页面不会回显。</p>
          <div className="field"><label htmlFor="provider-api-key">DeepSeek API Key</label><input id="provider-api-key" type="password" autoComplete="new-password" value={key} onChange={event => setKey(event.target.value)}/></div>
          <button type="button" className="button button-small" disabled={busy} onClick={() => void connectDeepSeek()}>{busy ? '正在检查…' : '连接并同步可用模型'}</button></>
          : <p>此 Provider 暂无后台接入流程，请先在 Provider 管理中配置。</p>}
      {message && <p role="status" className={ready ? 'notice' : 'error-text'}>{message}</p>}
      {ready && <button type="button" className="button button-small" onClick={() => { onReady(); onClose(); }}>{provider.code === 'DEEPSEEK' ? '完成，刷新模型列表' : '继续添加模型草稿'}</button>}
    </div>
  </dialog>;
}
