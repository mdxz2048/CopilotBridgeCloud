'use client';
import {useEffect,useRef,useState} from 'react';
import {api,patch,post,put} from '../lib/api';
import {DeepSeekConnectionCard} from './deepseek-connection-card';
import {ModelInstanceManager} from './model-instance-manager';
import styles from './admin-management.module.css';

type Model={id:string;providerId:string;displayName:string;publicId:string;providerModelId:string;enabled:boolean};
type Provider={id:string;name:string;code:string;enabled:boolean;baseUrl:string|null;timeoutMs:number};
type Instance={id:string;modelId:string;providerId:string;enabled:boolean;healthStatus:string;healthCheckedAt:string|null;cooldownUntil:string|null};
type Metrics={id:string;requests:number;inputTokens:number;cachedInputTokens:number;outputTokens:number;userDebitedRmb:number;knownCostRmb:number;knownCostRequests:number;unknownCostRequests:number;multiplier:number;revision:number;reference:unknown};
type Upstream={id:string;name:string;balance:Array<{currency:string;total:string}>|null;balanceStatus:string;checkedAt:string|null};
type Data={models:Model[];providers:Provider[];instances:Instance[];metrics:Metrics[];upstreams:Upstream[]};
const number=(value:number|undefined)=>(value??0).toLocaleString('zh-CN');
const money=(value:number)=>`¥${value.toFixed(4)}`;
const pickInstance=(instances:Instance[])=>instances.find(i=>i.enabled&&i.healthStatus==='READY')??instances.find(i=>i.enabled)??instances[0];
const time=(value:string|null)=>value?new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):'尚未检测';
const errorMessage=(e:unknown)=>(e as {message?:string}).message??'操作未完成，请稍后重试。';

export function AdminModels(){
 const [data,setData]=useState<Data|null>(null),[enabled,setEnabled]=useState(true),[selected,setSelected]=useState<string|null>(null),[connections,setConnections]=useState(false);
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState<string|null>(null),[error,setError]=useState(''),[message,setMessage]=useState('');
 const generation=useRef(0);
 async function load(){const current=++generation.current;setLoading(true);setError('');try{
  const [m,p,i,pricing]=await Promise.all([api<{data:Model[]}>('/api/v1/admin/models'),api<{data:Provider[]}>('/api/v1/admin/providers'),api<{data:Instance[]}>('/api/v1/admin/model-instances'),api<{models:Metrics[];providers:Upstream[]}>('/api/v1/admin/model-pricing')]);
  if(current===generation.current)setData({models:m.data.filter(m=>!m.publicId.startsWith('mock/')),providers:p.data,instances:i.data,metrics:pricing.models,upstreams:pricing.providers});
 }catch(e){if(current===generation.current)setError(errorMessage(e));}finally{if(current===generation.current)setLoading(false);}}
 useEffect(()=>{void load();return()=>{generation.current++;};},[]);
 async function run(id:string,action:()=>Promise<unknown>,text:string){if(busy)return;setBusy(id);setMessage('');setError('');try{await action();await load();setMessage(text);}catch(e){setError(errorMessage(e));}finally{setBusy(null);}}
 async function check(model:Model){const instance=pickInstance(data?.instances.filter(i=>i.modelId===model.id)??[]);if(!instance)return;
  if(!window.confirm(`检测 ${model.displayName} 将执行少量真实模型请求，消耗上游余额，不扣用户钱包。继续检测？`))return;
  await run(model.id,async()=>{try{await post(`/api/v1/admin/model-instances/${instance.id}/check`,{});}catch(e){await load();throw e;}},'模型实际生成检测通过，状态已更新。');
 }
 const model=data?.models.find(m=>m.id===selected),count=(state:boolean)=>data?.models.filter(m=>m.enabled===state).length??0;
 return <div className="admin-models">
  <div className={styles.toolbar}><div className="model-tabs" role="tablist" aria-label="模型启用状态">{[true,false].map(state=><button type="button" role="tab" aria-selected={enabled===state} key={String(state)} onClick={()=>setEnabled(state)}>{state?'已启用':'未启用'} <span>{count(state)}</span></button>)}</div><div className="inline-actions"><button className="mini-button" onClick={()=>setConnections(true)}>连接管理</button><button className="mini-button" disabled={loading||!!busy} onClick={()=>void load()}>{loading?'刷新中…':'刷新数据'}</button></div></div>
  <p className={styles.mobileHint}>左右滑动表格，查看完整数据与操作。</p><p className={styles.caption}>累计数据排除内部测试账号。上游余额由同一连接下的模型共用；成本只统计可核验或可估算的请求。</p>
  {error&&<p className="error-text" role="alert">{error}</p>}{message&&<p className="notice" role="status">{message}</p>}
  {!data&&loading?<p role="status">正在读取模型和上游数据…</p>:data&&<section className={`panel ${styles.tablePanel}`}><div className="table-wrap"><table className="data-table model-table"><thead><tr><th>模型</th><th>请求与 Token</th><th>用户扣款</th><th>上游成本</th><th>上游共享余额</th><th>模型与上游状态</th><th>操作</th></tr></thead><tbody>{data.models.filter(m=>m.enabled===enabled).map(m=>{
   const stats=data.metrics.find(v=>v.id===m.id),p=data.providers.find(p=>p.id===m.providerId),balance=data.upstreams.find(p=>p.id===m.providerId),instances=data.instances.filter(i=>i.modelId===m.id),instance=pickInstance(instances);
   const health=instance?.cooldownUntil&&Date.parse(instance.cooldownUntil)>Date.now()?'冷却中':instance?.healthStatus==='READY'?'已验证':instance?.healthStatus==='UNAVAILABLE'?'检测失败':'待检测';
   return <tr key={m.id}><td><strong>{m.displayName}</strong><small>{m.publicId}</small><small>{p?.name??'未配置上游'}</small></td><td><strong>{number(stats?.requests)} 次</strong><small>输入 {number(stats?.inputTokens)}</small><small>缓存 {number(stats?.cachedInputTokens)} · 输入子集</small><small>输出 {number(stats?.outputTokens)}</small></td><td>{money(stats?.userDebitedRmb??0)}</td><td>{stats?.knownCostRequests?money(stats.knownCostRmb):'未知'}<small>覆盖 {number(stats?.knownCostRequests)} / {number(stats?.requests)} 次</small>{Boolean(stats?.unknownCostRequests)&&<small>其余成本未知</small>}</td><td>{balance?.balanceStatus==='AVAILABLE'&&balance.balance?balance.balance.map(b=><div key={b.currency}>{b.currency==='CNY'?'¥':b.currency==='USD'?'$':b.currency+' '}{b.total}</div>):balance?.balanceStatus==='ERROR'?'查询失败':balance?.balanceStatus==='DISABLED'?'上游已停用':'未知'}<small>{balance?.balanceStatus==='UNSUPPORTED'?'上游未提供余额接口':'同连接共用，不按模型累加'}</small></td><td><span className={`badge ${health==='已验证'?'':health==='检测失败'?'warn':'muted'}`}>模型 · {health}</span><small>上游 · {!p?.enabled?'已停用':balance?'已配置':'缺少密钥'}</small><small>{time(instance?.healthCheckedAt??null)}</small></td><td><div className="inline-actions"><button className="mini-button" disabled={!!busy||!instance||!p?.enabled} onClick={()=>void check(m)}>{busy===m.id?'检测中…':'检测'}</button><button className="mini-button" disabled={!!busy} onClick={()=>setSelected(m.id)}>管理</button></div></td></tr>;
  })}</tbody></table></div>{count(enabled)===0&&<div className="empty">暂无{enabled?'已启用':'未启用'}模型。</div>}</section>}
  <p className={styles.caption}>“已配置”仅代表上游配置齐全；“已验证”是最近一次实际生成检测结果，当前可用性仍受网络和上游服务影响。</p>
  {model&&data&&<ModelDialog key={model.id} model={model} provider={data.providers.find(p=>p.id===model.providerId)} metrics={data.metrics.find(m=>m.id===model.id)} onClose={()=>setSelected(null)} onChanged={load}/>}
  {connections&&<AdminDialog title="连接管理" onClose={()=>setConnections(false)}><DeepSeekConnectionCard onReady={()=>void load()}/></AdminDialog>}
 </div>;
}

function AdminDialog({title,onClose,children}:{title:string;onClose:()=>void;children:React.ReactNode}){
 const ref=useRef<HTMLDialogElement>(null);useEffect(()=>{ref.current?.showModal();return()=>ref.current?.close();},[]);
 return <dialog ref={ref} className={`provider-dialog model-manager-dialog ${styles.dialog}`} aria-label={title} onCancel={e=>{e.preventDefault();onClose();}}><div className="provider-dialog-content"><div className={styles.dialogHeading}><h2>{title}</h2><button className="mini-button" onClick={onClose}>关闭</button></div>{children}</div></dialog>;
}
function ModelDialog({model,provider,metrics,onClose,onChanged}:{model:Model;provider?:Provider;metrics?:Metrics;onClose:()=>void;onChanged:()=>Promise<void>}){
 const [multiplier,setMultiplier]=useState(String(metrics?.multiplier??1)),[revision,setRevision]=useState(metrics?.revision??0),[endpoint,setEndpoint]=useState(provider?.baseUrl??''),[key,setKey]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[localEnabled,setLocalEnabled]=useState(model.enabled),[refresh,setRefresh]=useState(0),[planOpen,setPlanOpen]=useState(false);
 async function run(action:()=>Promise<unknown>,text:string){if(busy)return;setBusy(true);setError('');setMessage('');try{await action();setKey('');await onChanged();setRefresh(n=>n+1);setMessage(text);}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}
 return <AdminDialog title={`管理 ${model.displayName}`} onClose={onClose}>
  <p className={styles.caption}>{model.publicId}</p>{error&&<p className="error-text" role="alert">{error}</p>}{message&&<p className="notice" role="status">{message}</p>}
  <section className="panel"><div className={styles.dialogHeading}><div><h3>模型状态</h3><p>{localEnabled?'已向获得权限的用户开放':'未启用，用户目录不展示'}</p></div><button className="mini-button" disabled={busy} onClick={()=>void run(async()=>{await patch(`/api/v1/admin/models/${model.id}`,{enabled:!localEnabled});setLocalEnabled(!localEnabled);},'模型状态已保存。')}>{localEnabled?'停用模型':'启用模型'}</button></div></section>
  <section className="panel"><h3>模型售价</h3><div className={styles.inlineField}><label htmlFor={`markup-${model.id}`}>上游基准价 ×</label><input id={`markup-${model.id}`} aria-label="售价倍率" type="number" min={.01} max={100} step={.01} disabled={busy} value={multiplier} onChange={e=>setMultiplier(e.target.value)}/><button className="mini-button" disabled={busy||!metrics?.reference||!Number.isFinite(Number(multiplier))||Number(multiplier)<.01||Number(multiplier)>100} onClick={()=>void run(async()=>{const saved=await put<{revision:number}>(`/api/v1/admin/model-pricing/${model.id}`,{multiplier:Number(multiplier),expectedRevision:revision});setRevision(saved.revision);},'售价倍率已保存，仅影响新请求。')}>保存倍率</button></div><p>{metrics?.reference?'只影响新请求，历史账单保持原售价。':'该型号暂无基准价，请在“模型售价”设置费率。'}</p></section>
  {provider&&<details className={styles.details}><summary>上游连接 · {provider.name}</summary><p>该连接由多个模型共用；更改地址、密钥或停用会影响绑定的全部模型。</p><div className="field"><label htmlFor={`endpoint-${model.id}`}>上游 API 地址</label><input id={`endpoint-${model.id}`} value={endpoint} onChange={e=>setEndpoint(e.target.value)} disabled={busy}/></div><div className="field"><label htmlFor={`secret-${model.id}`}>更新 API Key（留空保留）</label><input id={`secret-${model.id}`} type="password" autoComplete="new-password" value={key} onChange={e=>setKey(e.target.value)} disabled={busy}/></div><div className="inline-actions"><button className="mini-button" disabled={busy||!endpoint.trim()} onClick={()=>void run(()=>patch(`/api/v1/admin/providers/${provider.id}`,{baseUrl:endpoint.trim(),...(key.trim()?{apiKey:key.trim()}:{})}),'上游配置已保存，请重新检测模型。')}>保存连接</button><button className="mini-button" disabled={busy} onClick={()=>void run(()=>patch(`/api/v1/admin/providers/${provider.id}`,{enabled:!provider.enabled}),provider.enabled?'上游已停用。':'上游已启用。')}>{provider.enabled?'停用上游':'启用上游'}</button></div></details>}
  <details className={styles.details} onToggle={e=>setPlanOpen(e.currentTarget.open)}><summary>套餐模型权限</summary>{planOpen&&<ModelPlanAccess modelId={model.id}/>}</details>
  <details className={styles.details}><summary>资源与高级配置</summary><ModelInstanceManager modelFilterId={model.id} refreshKey={String(refresh)} onChanged={onChanged}/></details>
 </AdminDialog>;
}

function ModelPlanAccess({modelId}:{modelId:string}){
 const [plans,setPlans]=useState<Array<{id:string;name:string}>>([]),[allowed,setAllowed]=useState<string[]>([]),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{const controller=new AbortController();void Promise.all([api<{data:Array<{id:string;name:string}>}>('/api/v1/admin/plans',{signal:controller.signal}),api<{planAccess:Array<{planId:string;modelId:string}>}>('/api/v1/admin/model-access',{signal:controller.signal})]).then(([p,a])=>{if(!controller.signal.aborted){setPlans(p.data);setAllowed(a.planAccess.filter(v=>v.modelId===modelId).map(v=>v.planId));}}).catch(()=>{if(!controller.signal.aborted)setError('套餐权限读取失败，请关闭后重试。');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[modelId]);
 async function toggle(planId:string){if(busy)return;setBusy(true);setError('');const next=!allowed.includes(planId);try{await put(`/api/v1/admin/models/${modelId}/plans/${planId}`,{allowed:next});setAllowed(current=>next?[...current,planId]:current.filter(id=>id!==planId));}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}
 return <div>{error&&<p role="alert" className="error-text">{error}</p>}{loading?<p role="status">正在读取套餐权限…</p>:plans.map(p=><div className={styles.dialogHeading} key={p.id}><p>{p.name} · {allowed.includes(p.id)?'已开放':'未开放'}</p><button className="mini-button" disabled={busy} onClick={()=>void toggle(p.id)}>{allowed.includes(p.id)?'关闭权限':'开放权限'}</button></div>)}<p>权限只控制模型分配，实际调用仍需模型、上游资源和用户状态符合要求。</p></div>;
}
