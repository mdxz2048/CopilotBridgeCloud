"use client";
import {useEffect,useState} from 'react';
import {api,put} from '../lib/api';
type Notice={id:string;title:string;content:string;enabled:boolean};
type Settings={revision:number;campaign:{enabled:boolean;announcementEnabled:boolean};notices:Notice[]};
export function EngagementManager(){
 const [data,setData]=useState<Settings|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 async function load(){setError('');try{setData(await api<Settings>('/api/v1/admin/engagement'));}catch(e){setError((e as Error).message);}}
 useEffect(()=>{void load();},[]);
 function edit(id:string,patch:Partial<Notice>){setMessage('');setData(current=>current?{...current,notices:current.notices.map(n=>n.id===id?{...n,...patch}:n)}:current);}
 async function save(){if(!data||busy)return;setBusy(true);setError('');setMessage('');try{setData(await put<Settings>('/api/v1/admin/engagement',data));setMessage('已保存，在线 App 通常在 5 秒内自动同步；多条通知每 10 秒切换。');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <section className="panel"><div className="inline-actions"><h2>活动与站内通知</h2><button className="mini-button" disabled={busy} onClick={()=>void load()}>重新读取</button></div>{error&&<p className="error-text" role="alert">{error}</p>}{message&&<p role="status">{message}</p>}{!data?<p role="status">正在读取…</p>:<>
 <h3>邀请好友首次充值，双方各得 ¥5</h3><label className="model-choice"><input aria-label="启用邀请注册奖励" type="checkbox" disabled={busy} checked={data.campaign.enabled} onChange={e=>{setMessage('');setData({...data,campaign:{...data.campaign,enabled:e.target.checked}});}}/>启用邀请奖励活动</label>
 <label className="model-choice"><input type="checkbox" disabled={busy} checked={data.campaign.announcementEnabled} onChange={e=>{setMessage('');setData({...data,campaign:{...data.campaign,announcementEnabled:e.target.checked}});}}/>在 App 底栏显示邀请活动通知</label><p>隐藏活动通知不会关闭奖励活动，邀请文案仍按实际活动规则生成。</p>
 <p>活动期间，通过有效邀请注册后，仅在新用户首次充值或后台首次正额增加余额时，新用户与邀请人各得 ¥5 奖励余额；注册只绑定邀请关系，不发钱。账号和按量使用资格长期有效，双方奖励自到账起 7 天有效，仅限模型消费。异常邀请进入下方待核对队列，审核通过后发放；管理员创建、老账号补绑或重复提交不发注册奖励。减少余额、赠送奖励和重复加款不重复触发。关闭活动只停止新注册参与，已经到账的奖励和待核对资格保留。</p>

 <h3>站内通知</h3><p>最多 10 条。App 底栏只展示标题，长标题自动省略；点击查看完整正文。多条通知每 10 秒切换，阅读时暂停。没有活动和显示中的通知时，保持原底栏。修改后点击保存，在线新版 App 通常在 5 秒内同步。</p>
 {data.notices.length===0&&<p>暂无站内通知，可添加后选择是否显示。</p>}
 {data.notices.map((notice,i)=><div className="panel" key={notice.id} aria-label={`通知 ${i+1}`}><div className="inline-actions"><h4>通知 {i+1}</h4><span>{notice.enabled?'显示中':'已隐藏'}</span></div><div className="field"><label htmlFor={`notice-title-${notice.id}`}>通知标题</label><input id={`notice-title-${notice.id}`} maxLength={80} disabled={busy} value={notice.title} placeholder="一句话说明通知主题" onChange={e=>edit(notice.id,{title:e.target.value})}/><small>{notice.title.length}/80</small></div><div className="field"><label htmlFor={`notice-content-${notice.id}`}>通知内容</label><textarea id={`notice-content-${notice.id}`} maxLength={6000} rows={5} disabled={busy} value={notice.content} placeholder="用户点击标题后查看的完整内容，支持换行" onChange={e=>edit(notice.id,{content:e.target.value})}/><small>{notice.content.length}/6000 · 纯文本</small></div><div className="inline-actions"><label><input type="checkbox" disabled={busy} checked={notice.enabled} onChange={e=>edit(notice.id,{enabled:e.target.checked})}/>显示通知</label><button className="mini-button" disabled={busy} onClick={()=>{setMessage('');setData({...data,notices:data.notices.filter(n=>n.id!==notice.id)});}}>删除通知</button></div></div>)}
 <div className="inline-actions"><button className="mini-button" disabled={busy||data.notices.length>=10} onClick={()=>{setMessage('');setData({...data,notices:[...data.notices,{id:crypto.randomUUID(),title:'',content:'',enabled:false}]});}}>新增通知</button><button className="button button-small" disabled={busy||data.notices.some(n=>!n.title.trim()||!n.content.trim())} onClick={()=>void save()}>{busy?'保存中…':'保存活动与通知'}</button></div>
 </>}</section>;
}
