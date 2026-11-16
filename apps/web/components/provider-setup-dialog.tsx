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
  const [verifyGeneration,setVerifyGeneration] = useState(true);
  const [baseUrl,setBaseUrl]=useState(managedProviderKind(provider.code)==='BAILIAN'?'https://dashscope.aliyuncs.com/compatible-mode/v1':'https://api.openai.com/v1');
  const [workaround,setWorkaround]=useState(false);
  const [catalog,setCatalog]=useState<string[]>([]);
  useEffect(()=>{const savedKind=managedProviderKind(provider.code);if(savedKind!=='OPENAI'&&savedKind!=='BAILIAN')return;const controller=new AbortController();void api<{data:Array<{id:string;baseUrl?:string;config?:{emptyToolsWorkaround?:boolean}}>} >('/api/v1/admin/providers',{signal:controller.signal}).then(result=>{if(controller.signal.aborted)return;const saved=result.data.find(p=>p.id===provider.id);if(saved?.baseUrl)setBaseUrl(saved.baseUrl);setWorkaround(saved?.config?.emptyToolsWorkaround===true);}).catch(()=>{});return()=>controller.abort();},[provider.id,provider.code]);
  async function syncCatalog(){setBusy(true);setMessage('');try{const result=await post<{catalog:string[]}>(`/api/v1/admin/providers/${provider.id}/sync-openai`,{baseUrl,...(key.trim()?{apiKey:key.trim()}:{}),emptyToolsWorkaround:workaround});setCatalog(result.catalog);setKey('');if(!result.catalog.includes(modelId))setModelId(result.catalog[0]??'');onReady();setMessage('已导入这把密钥实际提供的模型，默认停用。选择模型检查后，再启用并分配用户权限。');}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}
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
      const result=await post<{ready:boolean;configured:boolean;model:{displayName:string}}>(`/api/v1/admin/providers/${provider.id}/connect-openai`,{...(key.trim()?{apiKey:key.trim()}:{}),modelId:modelId.trim(),reasoning,verifyGeneration,baseUrl,emptyToolsWorkaround:workaround});
      setKey('');setReady(true);
      setMessage(result.ready?`已验证 ${result.model.displayName} 的原生 Responses。请配置费率和用户权限，再启用实例。`:`已保存 ${result.model.displayName}，没有发起生成请求。检查连接、配置费率并启用实例与模型后，授权用户才能在客户端看到。`);
    } catch(error) {
      const value=error as {message?:string;requestId?:string};setMessage(`${value.message??'连接或能力检查失败，请重试。'}${value.requestId?` · 请求 ID：${value.requestId}`:''}`);
    } finally {setBusy(false);}
  }
  async function connectBailian() {
    if (!baseUrl.trim()) { setMessage('请填写百炼工作空间的兼容模式地址。'); return; }
    setBusy(true);setMessage('');setReady(false);
    try {
      const result=await post<{ready:boolean;results:Array<{id:string;name:string;status:string;message?:string}>}>(`/api/v1/admin/providers/${provider.id}/connect-bailian`,{baseUrl,...(key.trim()?{apiKey:key.trim()}:{}),verifyGeneration});
      setKey('');
      const readyCount=result.results.filter(item=>item.status==='READY').length;
      const failed=result.results.filter(item=>item.status==='FAILED'||item.status==='MISSING');
      setReady(readyCount>0);
      setMessage(`已导入 ${readyCount} 个通过生成检查的模型${failed.length?`；未通过：${failed.map(item=>`${item.name}（${item.status==='MISSING'?'目录中不存在':item.message??'检查失败'}）`).join('、')}`:''}。请配置费率和套餐权限后再开放给用户。`);
    } catch(error) {
      const value=error as {message?:string;requestId?:string};setMessage(`${value.message??'连接或能力检查失败，请重试。'}${value.requestId?` · 请求 ID：${value.requestId}`:''}`);
    } finally {setBusy(false);}
  }

  return <dialog ref={dialog} className="provider-dialog" aria-label={`配置 ${provider.name}`} onCancel={event => { event.preventDefault(); if(!busy)onClose(); }}>
    <div className="provider-dialog-content">
      <div className="inline-actions"><h2>连接 {provider.name}</h2><button type="button" className="mini-button" disabled={busy} onClick={onClose}>关闭</button></div>
      {provider.code === 'COPILOT' ? <><CopilotAuthCard/><button type="button" className="button button-small" disabled={busy} onClick={() => void verifyCopilot()}>检查认证结果</button></>
        : kind === 'OPENAI' ? <><p>OpenAI 官方与兼容中转均使用 Responses。地址、密钥和兼容选项仅保存在服务器，客户端无需配置。</p>
          <div className="field"><label htmlFor="provider-base-url">API 地址</label><input id="provider-base-url" value={baseUrl} placeholder="https://api.openai.com/v1" onChange={event=>setBaseUrl(event.target.value)}/></div>
          <div className="field"><label htmlFor="provider-api-key">API Key（留空保留现有密钥）</label><input id="provider-api-key" type="password" autoComplete="new-password" value={key} onChange={event=>setKey(event.target.value)}/></div>
          <label><input type="checkbox" checked={workaround} onChange={event=>setWorkaround(event.target.checked)}/> 中转空工具兼容（仅对存在此问题的中转开启）</label>
          <p>纯文本请求使用禁止调用的占位定义；不会执行工具。官方接口请关闭此选项。</p>
          <button type="button" className="button button-small" disabled={busy||!baseUrl.trim()} onClick={()=>void syncCatalog()}>{busy?'正在处理…':'保存连接并导入上游模型'}</button>
          <div className="field"><label htmlFor="provider-model-id">检查模型</label><input id="provider-model-id" list="openai-model-presets" value={modelId} placeholder="从导入目录选择模型 ID" onChange={event=>setModelId(event.target.value)}/><datalist id="openai-model-presets">{catalog.map(id=><option key={id} value={id}/>)}</datalist></div>
          <label><input type="checkbox" checked={reasoning} onChange={event=>setReasoning(event.target.checked)}/> 同时验证思考能力</label>
          <label><input type="checkbox" checked={verifyGeneration} onChange={event=>setVerifyGeneration(event.target.checked)}/> 执行生成检查（少量付费）</label>
          <p>模型目录不等于生成验证。检查成功后启用连接实例与模型，再到用户管理分配权限。</p>
          <button type="button" className="button button-small" disabled={busy||!modelId.trim()} onClick={()=>void connectOpenAI()}>{busy?'正在保存…':verifyGeneration?'检查所选模型':'保存所选模型'}</button></>
        : kind === 'BAILIAN' ? <><p>阿里云百炼（DashScope）提供原生 Responses 接口。填写百炼工作空间的 compatible-mode 地址，服务器会按类别导入最新模型并逐项检查文本、思考与工具能力。</p>
          <div className="field"><label htmlFor="bailian-base-url">百炼兼容模式地址</label><input id="bailian-base-url" value={baseUrl} placeholder="https://llm-xxxx.cn-beijing.maas.aliyuncs.com/compatible-mode/v1" onChange={event=>setBaseUrl(event.target.value)}/></div>
          <div className="field"><label htmlFor="bailian-api-key">百炼 API Key（留空保留现有密钥）</label><input id="bailian-api-key" type="password" autoComplete="new-password" value={key} onChange={event=>setKey(event.target.value)}/></div>
          <label><input type="checkbox" checked={verifyGeneration} onChange={event=>setVerifyGeneration(event.target.checked)}/> 执行生成检查（每个模型少量付费）</label>
          <p>检查失败的模型保持停用。桌面端图片以 data URL 发送，百炼当前只接受可下载的图片地址，因此图片输入暂不开放。</p>
          <button type="button" className="button button-small" disabled={busy||!baseUrl.trim()} onClick={()=>void connectBailian()}>{busy?'正在导入并检查…':'保存连接并导入精选模型'}</button></>
        : kind === 'DEEPSEEK' ? <><p>输入管理员管理的 DeepSeek API Key；密钥在服务端加密保存，页面不会回显。</p>
          <div className="field"><label htmlFor="provider-api-key">DeepSeek API Key</label><input id="provider-api-key" type="password" autoComplete="new-password" value={key} onChange={event => setKey(event.target.value)}/></div>
          <button type="button" className="button button-small" disabled={busy} onClick={() => void connectDeepSeek()}>{busy ? '正在检查…' : '连接并同步可用模型'}</button></>
          : <p>此 Provider 暂无后台接入流程，请先在 Provider 管理中配置。</p>}
      {message && <p role="status" className={ready ? 'notice' : 'error-text'}>{message}</p>}
      {ready && <button type="button" className="button button-small" onClick={() => { onReady(); onClose(); }}>{kind ? '完成，刷新模型列表' : '继续添加模型草稿'}</button>}
    </div>
  </dialog>;
}
