'use client';
import { useEffect, useRef, useState } from 'react';
import { api, del, patch, post, put, type Usage } from '../lib/api';
import { AdminPasswordReset } from './admin-password-reset';
import { AdminUserDetails } from './admin-user-details';
import { AdminUsageReview } from './admin-usage-review';

type Model = {id:string;displayName:string;publicId:string;enabled:boolean};
type Plan = {id:string;code:string;name:string;enabled:boolean};
type Access = {effectiveModelIds:string[];overrides:Array<{modelId:string;access:string}>;planAccess:Array<{modelId:string;planId:string}>;subscription:{planId:string}|null};
type Device = {id:string;deviceId:string;deviceName:string;status:string;lastSeenAt:string|null};
type Detail = {user:{email:string;status:string;role:string};wallet:{balance:number;regularBalance?:number;rewardBalance?:number;rewardExpiresAt?:string|null;rewardExpiringBalance?:number};plan:{code:string;name:string}|null;devices:Device[];usage:Usage|null;limits:{maxDevices:number};billingRisks:{pendingReview:number;unpaidRequests:number;unpaidPoints:number}};
const online = (device:Device) => device.status==='ACTIVE' && device.lastSeenAt!==null && Date.now()-Date.parse(device.lastSeenAt)<300000;

export function AdminUserDialog({userId,onClose,onChanged}:{userId:string;onClose:()=>void;onChanged:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null), adjustment=useRef<{direction:number;key:string}|null>(null);
  const [detail,setDetail]=useState<Detail|null>(null),[models,setModels]=useState<Model[]>([]),[plans,setPlans]=useState<Plan[]>([]);
  const [selected,setSelected]=useState<string[]>([]),[effective,setEffective]=useState<string[]>([]);
  const [amount,setAmount]=useState(''),[planCode,setPlanCode]=useState(''),[maxDevices,setMaxDevices]=useState('3');
  const [error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0);
  useEffect(()=>{dialog.current?.showModal();return()=>dialog.current?.close();},[]);
  useEffect(()=>{
    const controller=new AbortController();setError('');
    void Promise.all([api<Detail>(`/api/v1/admin/users/${userId}`,{signal:controller.signal}),api<Access>(`/api/v1/admin/model-access?userId=${userId}`,{signal:controller.signal}),api<{data:Model[]}>('/api/v1/admin/models',{signal:controller.signal}),api<{data:Plan[]}>('/api/v1/admin/plans',{signal:controller.signal})]).then(([d,a,m,p])=>{
      if(controller.signal.aborted)return;
      setDetail(d);setModels(m.data.filter(model=>model.enabled&&!model.publicId.startsWith('mock/')));setPlans(p.data.filter(plan=>['STANDARD','PRO','PAYG','QUARTER'].includes(plan.code)&&(plan.enabled||plan.code==='PRO'||plan.code===d.plan?.code)));
      setEffective(a.effectiveModelIds);setPlanCode(d.plan?.code??'');setMaxDevices(String(d.limits.maxDevices));
      setSelected(m.data.filter(model=>{if(model.publicId.startsWith('mock/'))return false;const override=a.overrides.find(o=>o.modelId===model.id)?.access;return override==='ALLOW'||(override!=='DENY'&&a.planAccess.some(row=>row.modelId===model.id&&row.planId===a.subscription?.planId));}).map(model=>model.id));
    }).catch(e=>{if(!controller.signal.aborted)setError(e.message);});return()=>controller.abort();
  },[userId,revision]);
  async function run(action:()=>Promise<unknown>,success:string){if(busy)return;setBusy(true);setError('');setMessage('');try{await action();setMessage(success);setRevision(value=>value+1);onChanged();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  const points=Math.round(Number(amount)*10000);
  async function adjust(direction:1|-1){
    if(!Number.isSafeInteger(points)||points<=0||points>1_000_000_000)return;
    if(adjustment.current?.direction!==direction)adjustment.current={direction,key:crypto.randomUUID()};
    await run(async()=>{await post(`/api/v1/admin/users/${userId}/wallet/adjust`,{points:direction*points,reason:direction===1?'管理员人工增加账户余额，即时生效':'管理员人工减少账户余额，即时生效',idempotencyKey:adjustment.current!.key});adjustment.current=null;setAmount('');},direction===1?'余额已增加，即时生效，无需审核':'余额已减少，即时生效，无需审核');
  }
  async function remove(){if(!window.confirm('删除此用户并撤销所有登录？付款和用量记录会保留。'))return;await run(async()=>{await del(`/api/v1/admin/users/${userId}`);onClose();},'用户已删除');}
  return <dialog ref={dialog} className="provider-dialog user-dialog" aria-label="管理用户" onCancel={event=>{event.preventDefault();if(!busy)onClose();}}><div className="provider-dialog-content">
    <div className="inline-actions"><h2>{detail?.user.email??'用户管理'}</h2><button className="mini-button" disabled={busy} onClick={onClose}>关闭</button></div>
    {error&&<p className="error-text" role="alert">{error} <button className="mini-button" disabled={busy} onClick={()=>setRevision(value=>value+1)}>重新读取</button></p>}
    {message&&<p className="notice" role="status">{message}</p>}
    {!detail?<p role="status">正在读取…</p>:<>
      <section className="panel"><h3>用户状态</h3><div className="field"><label htmlFor="user-status">状态</label><select id="user-status" disabled={busy} value={detail.user.status==='ACTIVE'?'ACTIVE':'DISABLED'} onChange={event=>void run(()=>patch(`/api/v1/admin/users/${userId}`,{status:event.target.value}),event.target.value==='ACTIVE'?'用户已解锁':'用户已锁定，App 会显示锁定状态')}><option value="ACTIVE">正常</option><option value="DISABLED">锁定</option></select></div></section>
      <AdminPasswordReset userId={userId} busy={busy} setBusy={setBusy} onChanged={()=>{setRevision(v=>v+1);onChanged();}}/>
      <section className="panel"><h3>余额</h3><p>当前余额 <strong>¥{(detail.wallet.balance/10000).toFixed(4)}</strong></p>{detail.wallet.regularBalance!=null&&detail.wallet.rewardBalance!=null&&<p>正常余额 ¥{(detail.wallet.regularBalance/10000).toFixed(4)} · 奖励余额 ¥{(detail.wallet.rewardBalance/10000).toFixed(4)}</p>}{detail.wallet.rewardExpiresAt&&<p>其中 ¥{((detail.wallet.rewardExpiringBalance??0)/10000).toFixed(4)} 奖励将于 {new Date(detail.wallet.rewardExpiresAt).toLocaleString("zh-CN")} 到期</p>}<div className="field"><label htmlFor="user-balance-amount">调整金额（元）</label><input id="user-balance-amount" type="number" min={.0001} max={100000} step={.0001} value={amount} disabled={busy} onChange={event=>{setAmount(event.target.value);adjustment.current=null;}}/></div><div className="inline-actions"><button className="mini-button" disabled={busy||!Number.isSafeInteger(points)||points<=0||points>1_000_000_000} onClick={()=>void adjust(1)}>增加余额</button><button className="mini-button" disabled={busy||!Number.isSafeInteger(points)||points<=0||points>detail.wallet.balance} onClick={()=>void adjust(-1)}>减少余额</button></div><p>管理员调整即时生效，无需审核。可用总余额由正常余额和奖励余额组成；总余额不足时暂停模型请求。</p></section>
      <section className="panel"><h3>套餐类型</h3><div className="field"><label htmlFor="user-plan">套餐</label><select id="user-plan" value={planCode} disabled={busy} onChange={event=>setPlanCode(event.target.value)}><option value="">未分配</option>{plans.map(plan=><option key={plan.id} value={plan.code}>{plan.name}</option>)}</select></div><p>保存后更新用户的套餐权限。正常账号使用资格长期有效；季度套餐赠送额度仍按套餐规则到期。人工开通不代表已付款。</p><button className="mini-button" disabled={busy||!planCode||planCode===detail.plan?.code} onClick={()=>void run(()=>post('/api/v1/admin/subscriptions/grant',{userId,planCode,days:planCode==='QUARTER'?90:30}),'套餐已更新，请核对可使用的模型')}>保存套餐</button></section>
      <section className="panel"><h3>可使用的模型</h3><div className="model-choice-grid">{models.map(model=><label key={model.id} className="model-choice"><input type="checkbox" checked={selected.includes(model.id)} disabled={busy} onChange={event=>setSelected(ids=>event.target.checked?[...ids,model.id]:ids.filter(id=>id!==model.id))}/><span>{model.displayName}<br/><small>{!model.enabled?'模型停用':effective.includes(model.id)?'当前可用':'当前未生效'}</small></span></label>)}</div><button className="mini-button" disabled={busy} onClick={()=>void run(()=>put(`/api/v1/admin/users/${userId}/models`,{modelIds:selected}),'模型权限已保存')}>保存模型</button></section>
      <section className="panel"><h3>在线设备 / 最大设备</h3><p>在线 {detail.devices.filter(online).length} 台 · 已授权 {detail.devices.filter(device=>device.status==='ACTIVE').length} 台。在线按最近 5 分钟活动判断。</p><div className="field"><label htmlFor="user-max-devices">最大设备数</label><input id="user-max-devices" type="number" min={1} max={100} value={maxDevices} disabled={busy} onChange={event=>setMaxDevices(event.target.value)}/></div><button className="mini-button" disabled={busy||!Number.isInteger(Number(maxDevices))||Number(maxDevices)<1||Number(maxDevices)>100} onClick={()=>void run(()=>put(`/api/v1/admin/users/${userId}/devices-limit`,{maxDevices:Number(maxDevices)}),'最大设备数已保存')}>保存设备上限</button><p>降低上限不自动踢出已有设备；可在下方停用设备。</p>{detail.devices.length?<div className="table-wrap"><table className="data-table"><thead><tr><th>设备</th><th>状态</th><th>最近活动</th><th>操作</th></tr></thead><tbody>{detail.devices.map(device=><tr key={device.id}><td>{device.deviceName}<br/><small style={{overflowWrap:"anywhere"}}>设备号：{device.deviceId}</small></td><td>{online(device)?'在线':device.status==='ACTIVE'?'离线':'已停用'}</td><td>{device.lastSeenAt?new Date(device.lastSeenAt).toLocaleString('zh-CN'):'—'}</td><td><button className="mini-button" disabled={busy} onClick={()=>void run(()=>patch(`/api/v1/admin/devices/${device.id}`,{status:device.status==='ACTIVE'?'REVOKED':'ACTIVE'}),'设备状态已更新')}>{device.status==='ACTIVE'?'停用':'恢复'}</button></td></tr>)}</tbody></table></div>:<p>暂无设备。</p>}</section>
      <details className="panel"><summary>更多记录与风险核对</summary><p>待核对 {Number(detail.billingRisks.pendingReview)} 条 · 待结算 {Number(detail.billingRisks.unpaidRequests)} 条，¥{(Number(detail.billingRisks.unpaidPoints)/10000).toFixed(4)}。异常不会自动锁定账号。</p><AdminUsageReview userId={userId} onReviewed={()=>setRevision(value=>value+1)}/><AdminUserDetails key={`${userId}-${revision}`} userId={userId}/>{detail.user.role!=='ADMIN'&&<button className="mini-button danger" disabled={busy} onClick={()=>void remove()}>删除用户</button>}</details>
    </>}
  </div></dialog>;
}
export function CreateUserDialog({onClose,onCreated}:{onClose:()=>void;onCreated:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null);const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{dialog.current?.showModal();return()=>dialog.current?.close();},[]);
  async function create(){if(busy)return;setBusy(true);setError('');try{await post('/api/v1/admin/users',{email,password,role:'USER'});onCreated();onClose();}catch(e){setError((e as Error).message);setBusy(false);}}
  return <dialog ref={dialog} className="provider-dialog" aria-label="创建用户" onCancel={e=>{e.preventDefault();if(!busy)onClose();}}><form className="provider-dialog-content" onSubmit={e=>{e.preventDefault();void create();}}><h2>创建用户</h2><div className="field"><label htmlFor="new-user-email">邮箱</label><input id="new-user-email" type="email" required value={email} onChange={e=>setEmail(e.target.value)}/></div><div className="field"><label htmlFor="new-user-password">初始密码（至少 12 位）</label><input id="new-user-password" type="password" minLength={12} required autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)}/></div><p>创建后可在用户弹窗分配模型；没有有效服务周期的账号不能调用模型。</p>{error&&<p className="error-text" role="alert">{error}</p>}<div className="inline-actions"><button className="button" disabled={busy}>{busy?'正在创建…':'创建用户'}</button><button type="button" className="mini-button" disabled={busy} onClick={onClose}>取消</button></div></form></dialog>;
}
