'use client';

import { useEffect, useRef, useState } from 'react';
import { api, post } from '../lib/api';
import { CopilotAuthCard } from './copilot-auth-card';
import { managedProviderKind } from './provider-kind';

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
  const [modelId,setModelId] = useState('');
  const [reasoning,setReasoning] = useState(false);
  const kind = managedProviderKind(provider.code);

  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  useEffect(() => {
    if (kind !== 'DEEPSEEK' || !provider.enabled) return;
    const controller = new AbortController();
    void api<{ ready: boolean }>(`/api/v1/admin/providers/${provider.id}/health`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted && result.ready) { setReady(true); setMessage('现有 Provider 连接正常，无需再次输入密钥。'); } })
      .catch(() => { if (!controller.signal.aborted) setMessage('无法检查现有连接，请重试绑定。'); });
    return () => controller.abort();
  }, [provider.id, kind, provider.enabled]);

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
      setMessage(`已保存 ${result.model.displayName}。请检查实例能力、配置费率和用户权限，再显式启用逻辑模型与实例；已有模型权限不会自动扩大。`);
    } catch (error) { setMessage((error as { message?: string }).message ?? '绑定或验证失败，请重试。'); }
    finally { setBusy(false); }
  }
  async function connectOpenAI() {
    if (!key.trim() || !modelId.trim()) {setMessage('请输入 OpenAI API Key 和上游模型 ID。');return;}
    setBusy(true);setMessage('');setReady(false);
    try {
      const result=await post<{ready:boolean;model:{displayName:string}}>(`/api/v1/admin/providers/${provider.id}/connect-openai`,{apiKey:key.trim(),modelId:modelId.trim(),reasoning});
      if(!result.ready)throw Error('原生能力尚未验证，请重试检查。');
      setKey('');setReady(true);
      setMessage(`已验证 ${result.model.displayName} 的原生 Responses。新模型和实例默认停用；请配置费率、授权用户，再显式启用逻辑模型与实例。图片输入尚未验证。`);
    } catch(error) {
      const value=error as {message?:string;requestId?:string};setMessage(`${value.message??'连接或能力检查失败，请重试。'}${value.requestId?` · 请求 ID：${value.requestId}`:''}`);
    } finally {setBusy(false);}
  }

  return <dialog ref={dialog} className="provider-dialog" aria-label={`配置 ${provider.name}`} onCancel={event => { event.preventDefault(); if(!busy)onClose(); }}>
    <div className="provider-dialog-content">
      <div className="inline-actions"><h2>连接 {provider.name}</h2><button type="button" className="mini-button" disabled={busy} onClick={onClose}>关闭</button></div>
      {provider.code === 'COPILOT' ? <><CopilotAuthCard/><button type="button" className="button button-small" disabled={busy} onClick={() => void verifyCopilot()}>检查认证结果</button></>
        : kind === 'OPENAI' ? <><p>需要独立的 OpenAI API Key；ChatGPT 订阅不能作为 API Key 使用。密钥加密保存，不回显。连接固定使用 https://api.openai.com/v1。</p>
          <div className="field"><label htmlFor="provider-api-key">OpenAI API Key</label><input id="provider-api-key" type="password" autoComplete="new-password" value={key} onChange={event=>setKey(event.target.value)}/></div>
          <div className="field"><label htmlFor="provider-model-id">上游模型 ID</label><input id="provider-model-id" value={modelId} placeholder="填写该 API 账号可用的模型 ID" onChange={event=>setModelId(event.target.value)}/></div>
          <label><input type="checkbox" checked={reasoning} onChange={event=>setReasoning(event.target.checked)}/> 检查思考能力（仅在上游模型支持时勾选）</label>
          <p>保存将执行少量正常与工具请求；勾选思考会检查相应能力。检查消耗上游账号余额，不扣用户钱包。不由型号名称推定能力。</p>
          <button type="button" className="button button-small" disabled={busy||!key.trim()||!modelId.trim()} onClick={()=>void connectOpenAI()}>{busy?'正在检查原生能力…':'保存并检查原生 Responses'}</button></>
        : kind === 'DEEPSEEK' ? <><p>输入管理员管理的 DeepSeek API Key；密钥在服务端加密保存，页面不会回显。</p>
          <div className="field"><label htmlFor="provider-api-key">DeepSeek API Key</label><input id="provider-api-key" type="password" autoComplete="new-password" value={key} onChange={event => setKey(event.target.value)}/></div>
          <button type="button" className="button button-small" disabled={busy} onClick={() => void connectDeepSeek()}>{busy ? '正在检查…' : '连接并同步可用模型'}</button></>
          : <p>此 Provider 暂无后台接入流程，请先在 Provider 管理中配置。</p>}
      {message && <p role="status" className={ready ? 'notice' : 'error-text'}>{message}</p>}
      {ready && <button type="button" className="button button-small" onClick={() => { onReady(); onClose(); }}>{kind ? '完成，刷新模型列表' : '继续添加模型草稿'}</button>}
    </div>
  </dialog>;
}
