'use client';
import {useEffect,useState} from 'react';
import {api,patch} from '../lib/api';
import styles from './admin-feedback.module.css';
type Status='OPEN'|'IN_PROGRESS'|'RESOLVED';
type Row={id:string;email:string;userId:string;title:string;content:string;kind:'FEATURE'|'ISSUE'|'OTHER';status:Status;createdAt:string;updatedAt:string};
type Result={data:Row[];total:number;page:number;pageSize:number};
const statuses:Record<Status,string>={OPEN:'待处理',IN_PROGRESS:'处理中',RESOLVED:'已处理'};
const kinds={FEATURE:'功能建议',ISSUE:'问题反馈',OTHER:'其他意见'};
const date=(value:string)=>new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
export function AdminFeedback(){
  const [filter,setFilter]=useState('OPEN'),[page,setPage]=useState(1),[revision,setRevision]=useState(0),[result,setResult]=useState<Result|null>(null);
  const [selected,setSelected]=useState<Row|null>(null),[draft,setDraft]=useState<Status>('OPEN');
  const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  useEffect(()=>{const controller=new AbortController();setLoading(true);setError('');
    void api<Result>(`/api/v1/admin/feedback?status=${filter}&page=${page}`,{signal:controller.signal}).then(value=>{
      if(controller.signal.aborted)return;setResult(value);setSelected(null);
    }).catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();
  },[filter,page,revision]);
  async function save(){if(!selected||saving)return;setSaving(true);setError('');setMessage('');
    try{await patch(`/api/v1/admin/feedback/${selected.id}`,{status:draft,expectedUpdatedAt:selected.updatedAt});setMessage('处理状态已保存，用户可在“我的反馈”查看。');setRevision(v=>v+1);}
    catch(e){setError((e as Error).message);}finally{setSaving(false);}
  }
  return <div className={styles.root}><div className={styles.heading}><div><h2>用户反馈</h2><p>用户主动提交的建议与问题。自动上报的故障请前往“失败反馈”。</p></div><button className="mini-button" disabled={loading||saving} onClick={()=>setRevision(v=>v+1)}>刷新</button></div>
    <nav className={styles.filters} aria-label="反馈状态">{[...Object.entries(statuses),['all','全部']].map(([value,label])=><button key={value} aria-pressed={filter===value} disabled={saving} onClick={()=>{setFilter(value);setPage(1);setSelected(null);setMessage('');}}>{label}</button>)}</nav>
    {error&&<p className="error-text" role="alert">{error} <button className="mini-button" disabled={saving} onClick={()=>setRevision(v=>v+1)}>重新读取</button></p>}{message&&<p className="notice" role="status">{message}</p>}
    {loading?<div className="panel" role="status">正在读取用户反馈…</div>:result&&<><div className={styles.workspace}><section className={styles.list} aria-label="反馈列表">{result.data.map(row=><button key={row.id} className={selected?.id===row.id?styles.selected:''} disabled={saving} onClick={()=>{setSelected(row);setDraft(row.status);setError('');}}><span className={styles.listTop}><small>{kinds[row.kind]}</small><span className={styles.badge} data-status={row.status}>{statuses[row.status]}</span></span><strong>{row.title}</strong><span className={styles.email}>{row.email}</span><small>{date(row.createdAt)}</small></button>)}{result.data.length===0&&<div className="empty">暂无{filter==='all'?'':statuses[filter as Status]}反馈。</div>}</section>
      <section className={styles.detail} aria-label="反馈详情">{selected?<><div className={styles.detailHeader}><small>{kinds[selected.kind]} · 编号 {selected.id.slice(0,8)}</small><h3>{selected.title}</h3><p>{selected.email}</p><small>提交于 {date(selected.createdAt)} · 更新于 {date(selected.updatedAt)}</small></div><p className={styles.content}>{selected.content}</p><div className={styles.actions}><div className={styles.statusField}><label htmlFor="feedback-status">处理状态</label><select id="feedback-status" disabled={saving} value={draft} onChange={e=>setDraft(e.target.value as Status)}>{Object.entries(statuses).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></div><button className="button button-small" disabled={saving||draft===selected.status} onClick={()=>void save()}>{saving?'正在保存…':'保存状态'}</button></div><small className={styles.caption}>状态会同步到用户的“我的反馈”。本页不发送邮件。</small></>:<div className="empty">选择左侧反馈查看详情与处理状态。</div>}</section>
    </div><div className={styles.pagination}><span>{result.total} 条 · 第 {page} / {Math.max(1,Math.ceil(result.total/result.pageSize))} 页</span><div className="inline-actions"><button className="mini-button" disabled={saving||page<=1} onClick={()=>setPage(v=>v-1)}>上一页</button><button className="mini-button" disabled={saving||page*result.pageSize>=result.total} onClick={()=>setPage(v=>v+1)}>下一页</button></div></div></>}
  </div>;
}
