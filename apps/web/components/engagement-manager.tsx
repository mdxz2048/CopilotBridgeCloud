"use client";
import {useEffect,useState} from 'react';
import {api,put} from '../lib/api';
type Settings={revision:number;campaign:{enabled:boolean};notices:Array<{id:string;text:string;enabled:boolean}>};
export function EngagementManager(){
 const [data,setData]=useState<Settings|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 async function load(){setError('');try{setData(await api<Settings>('/api/v1/admin/engagement'));}catch(e){setError((e as Error).message);}}
 useEffect(()=>{void load();},[]);
 async function save(){if(!data||busy)return;setBusy(true);setError('');setMessage('');try{setData(await put<Settings>('/api/v1/admin/engagement',data));setMessage('已保存，客户端会在下一次配置同步后更新。');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <section className="panel"><div className="inline-actions"><h2>活动与站内通知</h2><button className="mini-button" disabled={busy} onClick={()=>void load()}>重新读取</button></div>{error&&<p className="error-text" role="alert">{error}</p>}{message&&<p role="status">{message}</p>}{!data?<p role="status">正在读取…</p>:<>
 <h3>邀请好友首次充值，双方各得 ¥5</h3><label className="model-choice"><input aria-label="启用邀请注册奖励" type="checkbox" disabled={busy} checked={data.campaign.enabled} onChange={e=>setData({...data,campaign:{...data.campaign,enabled:e.target.checked}})}/>启用活动，并在 App 广播和邀请文案中展示</label>
 <p>活动期间，通过有效邀请注册后，仅在新用户首次充值或后台首次正额增加余额时，新用户与邀请人各得 ¥5 奖励余额；注册只绑定邀请关系，不发钱。账号和按量使用资格长期有效，双方奖励自到账起 7 天有效，仅限模型消费。异常邀请进入下方待核对队列，审核通过后发放；管理员创建、老账号补绑或重复提交不发注册奖励。减少余额、赠送奖励和重复加款不重复触发。关闭活动只停止新注册参与，已经到账的奖励和待核对资格保留。</p>

 <h3>站内通知</h3><p>纯文本、最多 160 字。无活动或已启用通知时，App 保持原底栏。活动自动生成，无需重复添加。</p>
 {data.notices.map((notice,i)=><div className="panel" key={notice.id}><div className="field"><label htmlFor={`notice-${notice.id}`}>通知内容</label><textarea id={`notice-${notice.id}`} maxLength={160} rows={2} disabled={busy} value={notice.text} onChange={e=>setData({...data,notices:data.notices.map((n,j)=>j===i?{...n,text:e.target.value}:n)})}/></div><div className="inline-actions"><label><input type="checkbox" disabled={busy} checked={notice.enabled} onChange={e=>setData({...data,notices:data.notices.map((n,j)=>j===i?{...n,enabled:e.target.checked}:n)})}/>展示这条通知</label><button className="mini-button" disabled={busy} onClick={()=>setData({...data,notices:data.notices.filter((_,j)=>j!==i)})}>移除</button></div></div>)}
 <div className="inline-actions"><button className="mini-button" disabled={busy||data.notices.length>=10} onClick={()=>setData({...data,notices:[...data.notices,{id:crypto.randomUUID(),text:'',enabled:false}]})}>添加通知</button><button className="button button-small" disabled={busy||data.notices.some(n=>!n.text.trim())} onClick={()=>void save()}>{busy?'保存中…':'保存活动与通知'}</button></div>
 </>}</section>;
}
