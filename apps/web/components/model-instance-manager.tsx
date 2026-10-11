'use client';
import {useEffect,useState} from 'react';
import {api,patch,post} from '../lib/api';
type Model={id:string;displayName:string;publicId:string;providerModelId:string};
type Provider={id:string;name:string;enabled:boolean;code:string};
type Instance={id:string;modelId:string;providerId:string;providerModelId:string;enabled:boolean;priority:number;weight:number;nativeProtocols:string[];capabilities:Record<string,unknown>;healthStatus:string;healthCheckedAt:string|null;cooldownUntil?:string|null};
export function ModelInstanceManager({refreshKey=''}:{refreshKey?:string}){
  const [models,setModels]=useState<Model[]>([]),[providers,setProviders]=useState<Provider[]>([]),[instances,setInstances]=useState<Instance[]>([]);
  const [modelId,setModelId]=useState(''),[providerId,setProviderId]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[message,setMessage]=useState('');
  async function load(){setLoading(true);try{const [m,p,i]=await Promise.all([api<{data:Model[]}>('/api/v1/admin/models'),api<{data:Provider[]}>('/api/v1/admin/providers'),api<{data:Instance[]}>('/api/v1/admin/model-instances')]);setModels(m.data.filter(model=>!model.publicId.startsWith('mock/')));setProviders(p.data.filter(provider=>provider.code==='DEEPSEEK'||provider.code.startsWith('DEEPSEEK_')));setInstances(i.data);setError('');}catch(e){showError(e);}finally{setLoading(false);}}
  function showError(e:unknown){const v=e as {message?:string;requestId?:string};setError(`${v.message||'请求失败，请重试。'}${v.requestId?` · 请求 ID：${v.requestId}`:''}`);}
  useEffect(()=>{void load();},[refreshKey]);
  async function run(action:()=>Promise<unknown>,text:string){if(busy)return;setBusy(true);setMessage('');setError('');try{await action();await load();setMessage(text);}catch(e){showError(e);}finally{setBusy(false);}}
  return <section className="panel"><h2>逻辑模型与实例绑定</h2><p>用户权限分配给逻辑模型；连接密钥仅由服务器管理。新增实例先检查能力，再启用，不会自动扩大用户权限。</p>
    {error&&<p role="alert" className="error-text">{error} <button className="mini-button" disabled={busy} onClick={()=>void load()}>重试读取</button></p>}{message&&<p role="status" className="notice">{message}</p>}
    <div className="form-grid"><div className="field"><label htmlFor="instance-model">逻辑模型</label><select id="instance-model" value={modelId} onChange={e=>setModelId(e.target.value)}><option value="">请选择模型</option>{models.map(m=><option key={m.id} value={m.id}>{m.displayName} · {m.publicId}</option>)}</select></div><div className="field"><label htmlFor="instance-provider">连接资源</label><select id="instance-provider" value={providerId} onChange={e=>setProviderId(e.target.value)}><option value="">请选择连接</option>{providers.map(p=><option key={p.id} value={p.id}>{p.name}{!p.enabled?'（已停用）':''}</option>)}</select></div></div>
    <button className="button button-small" disabled={busy||loading||!modelId||!providerId} onClick={()=>void run(()=>post('/api/v1/admin/model-instances',{modelId,providerId,providerModelId:models.find(m=>m.id===modelId)?.providerModelId,priority:0,weight:1}),'实例已创建，检查通过后可启用。')}>绑定新实例</button>
    <p><small>本期绑定沿用逻辑模型的上游模型 ID，避免混用费率。检查会执行少量真实模型请求，消耗连接的上游余额，不扣用户钱包。优先级越高越优先，同级按权重分配；权重 0 不参与新请求。</small></p>
    {loading?<p role="status">正在读取实例…</p>:!instances.length?<p>尚无模型实例。请先保存连接，再绑定并检查。</p>:<div className="instance-list">{instances.filter(i=>models.some(m=>m.id===i.modelId)).map(i=><InstanceEditor key={`${i.id}-${i.priority}-${i.weight}-${i.enabled}-${i.healthCheckedAt}`} instance={i} models={models} providers={providers} busy={busy} run={run}/>)}</div>}
  </section>;
}
function InstanceEditor({instance:i,models,providers,busy,run}:{instance:Instance;models:Model[];providers:Provider[];busy:boolean;run:(action:()=>Promise<unknown>,text:string)=>Promise<void>}){
  const [priority,setPriority]=useState(String(i.priority)),[weight,setWeight]=useState(String(i.weight));
  const capabilityNames:Record<string,string>={tools:'工具',vision:'图片输入',reasoning:'思考',streaming:'流式'};
  const validated=i.healthStatus==='READY';
  const healthLabels:Record<string,string>={READY:'已验证',UNKNOWN:'未验证',DEGRADED:'暂时降级',UNAVAILABLE:'不可用，需重新检查'};
  return <article className="model-instance-card"><h3>{models.find(m=>m.id===i.modelId)?.displayName||i.modelId} · {providers.find(p=>p.id===i.providerId)?.name||'未知连接'}</h3>
    <p>{i.providerModelId} · {i.enabled?'启用':'停用'} · 健康：{healthLabels[i.healthStatus]||i.healthStatus}</p>
    {i.cooldownUntil&&<p>冷却至：{new Date(i.cooldownUntil).toLocaleString('zh-CN')}；既有会话仍按固定实例处理。</p>}
    <p>检查时间：{i.healthCheckedAt?new Date(i.healthCheckedAt).toLocaleString('zh-CN'):'尚未检查'}<br/>原生协议：{i.nativeProtocols?.join(' / ')||'未验证'}<br/>能力：{Object.entries(capabilityNames).map(([k,v])=>`${v}${i.capabilities?.[k]===true?' ✓':' 未验证/不可用'}`).join(' · ')}</p>
    <div className="form-grid"><div className="field"><label htmlFor={`priority-${i.id}`}>优先级</label><input id={`priority-${i.id}`} type="number" min="-100000" max="100000" step="1" value={priority} onChange={e=>setPriority(e.target.value)}/></div><div className="field"><label htmlFor={`weight-${i.id}`}>权重</label><input id={`weight-${i.id}`} type="number" min="0" max="100000" step="1" value={weight} onChange={e=>setWeight(e.target.value)}/></div></div>
    <div className="inline-actions"><button className="mini-button" disabled={busy||!Number.isInteger(Number(priority))||!Number.isInteger(Number(weight))||Number(weight)<0} onClick={()=>void run(()=>patch(`/api/v1/admin/model-instances/${i.id}`,{priority:Number(priority),weight:Number(weight)}),'路由排序已保存。')}>保存排序</button><button className="mini-button" disabled={busy} onClick={()=>void run(()=>post(`/api/v1/admin/model-instances/${i.id}/check`,{}),'实例检查已完成，请核对健康和能力。')}>检查能力（少量付费）</button><button className="mini-button" disabled={busy||(!i.enabled&&!validated)} onClick={()=>void run(()=>patch(`/api/v1/admin/model-instances/${i.id}`,{enabled:!i.enabled}),i.enabled?'实例已停用，下次请求立即生效。':'实例已启用。')}>{i.enabled?'停用实例':validated?'启用实例':'检查通过后启用'}</button></div>
  </article>;
}
