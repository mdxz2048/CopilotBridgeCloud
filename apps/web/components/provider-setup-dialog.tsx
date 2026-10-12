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
  const [verifyGeneration,setVerifyGeneration] = useState(false);
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
    if (!modelId.trim()) {setMessage('请选择或填写上游模型 ID。');return;}
    setBusy(true);setMessage('');setReady(false);
    try {
      const result=await post<{ready:boolean;configured:boolean;model:{displayName:string}}>(`/api/v1/admin/providers/${provider.id}/connect-openai`,{...(key.trim()?{apiKey:key.trim()}:{}),modelId:modelId.trim(),reasoning,verifyGeneration});
      setKey('');setReady(true);
      setMessage(result.ready?`已验证 ${result.model.displayName} 的原生 Responses。请配置费率和用户权限，再启用实例。`:`已保存 ${result.model.displayName}，没有发起生成请求。授权后客户端可选择并显示待开通；充值后检查连接、配置费率并启用实例即可使用。`);
    } catch(error) {
      const value=error as {message?:string;requestId?:string};setMessage(`${value.message??'连接或能力检查失败，请重试。'}${value.requestId?` · 请求 ID：${value.requestId}`:''}`);
    } finally {setBusy(false);}
  }

  return <dialog ref={dialog} className="provider-dialog" aria-label={`配置 ${provider.name}`} onCancel={event => { event.preventDefault(); if(!busy)onClose(); }}>
    <div className="provider-dialog-content">
      <div className="inline-actions"><h2>连接 {provider.name}</h2><button type="button" className="mini-button" disabled={busy} onClick={onClose}>关闭</button></div>
      {provider.code === 'COPILOT' ? <><CopilotAuthCard/><button type="button" className="button button-small" disabled={busy} onClick={() => void verifyCopilot()}>检查认证结果</button></>
        : kind === 'OPENAI' ? <><p>需要独立的 OpenAI API Key；ChatGPT 订阅不能作为 API Key 使用。密钥加密保存，不回显。连接固定使用 https://api.openai.com/v1。</p>
          <div className="field"><label htmlFor="provider-api-key">OpenAI API Key（可稍后添加，留空保留现有 Key）</label><input id="provider-api-key" type="password" autoComplete="new-password" value={key} onChange={event=>setKey(event.target.value)}/></div>
          <div className="field"><label htmlFor="provider-model-id">上游模型 ID</label><input id="provider-model-id" list="openai-model-presets" value={modelId} placeholder="选择或填写 API 模型 ID" onChange={event=>setModelId(event.target.value)}/><datalist id="openai-model-presets"><option value="gpt-6.1-sol">GPT-6.1 Sol</option><option value="gpt-6-astra">GPT-6 Astra</option><option value="gpt-6-luna">GPT-6 Luna</option></datalist></div>
          <label><input type="checkbox" checked={reasoning} onChange={event=>setReasoning(event.target.checked)}/> 自定义模型支持思考（预置型号按官方文档配置）</label>
          <label><input type="checkbox" checked={verifyGeneration} onChange={event=>setVerifyGeneration(event.target.checked)}/> 同时执行生成检查（少量付费）</label>
          <p>默认只保存配置，不调用模型，尚未充值也可以先配置。只有勾选生成检查才消耗上游额度；实例启用与用户授权单独管理。</p>
          <button type="button" className="button button-small" disabled={busy||!modelId.trim()} onClick={()=>void connectOpenAI()}>{busy?'正在保存…':verifyGeneration?'保存并检查原生 Responses':'保存配置，不发起生成'}</button></>
        : kind === 'DEEPSEEK' ? <><p>输入管理员管理的 DeepSeek API Key；密钥在服务端加密保存，页面不会回显。</p>
          <div className="field"><label htmlFor="provider-api-key">DeepSeek API Key</label><input id="provider-api-key" type="password" autoComplete="new-password" value={key} onChange={event => setKey(event.target.value)}/></div>
          <button type="button" className="button button-small" disabled={busy} onClick={() => void connectDeepSeek()}>{busy ? '正在检查…' : '连接并同步可用模型'}</button></>
          : <p>此 Provider 暂无后台接入流程，请先在 Provider 管理中配置。</p>}
      {message && <p role="status" className={ready ? 'notice' : 'error-text'}>{message}</p>}
      {ready && <button type="button" className="button button-small" onClick={() => { onReady(); onClose(); }}>{kind ? '完成，刷新模型列表' : '继续添加模型草稿'}</button>}
    </div>
  </dialog>;
}
