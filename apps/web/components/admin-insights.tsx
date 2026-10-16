'use client';
import {useEffect,useState} from 'react';
import {api} from '../lib/api';
import styles from './admin-management.module.css';
type Totals={total:number;today:number;last30Days:number};
type Summary={pageViews:Totals;downloads:Totals&{data:Array<{day:string;version:string;platform:string;arch:string;downloads:number}>};trackingSince:string|null;timezone:string;uniqueVisitorsAvailable:boolean};
type Visits={data:Array<{day:string;page:string;views:number}>};
const pages:Record<string,string>={'/':'首页','/download':'下载页','/pricing':'套餐页','/login':'登录页','/register':'注册页'};
export function AdminInsights({totals}:{totals:Record<string,number>}){
 const [summary,setSummary]=useState<Summary|null>(null),[visits,setVisits]=useState<Visits|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[revision,setRevision]=useState(0);
 useEffect(()=>{const controller=new AbortController();setLoading(true);setError('');void Promise.all([api<Summary>('/api/v1/admin/site/summary',{signal:controller.signal}),api<Visits>('/api/v1/admin/site/page-views',{signal:controller.signal})]).then(([s,v])=>{if(!controller.signal.aborted){setSummary(s);setVisits(v);}}).catch(()=>{if(!controller.signal.aborted)setError('网站统计读取失败，请稍后重试。');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[revision]);
 return <div className="site-stats"><div className={styles.toolbar}><p className={styles.caption}>注册用户 {totals.users??0} · 已登记设备 {totals.devices??0}</p><button className="mini-button" disabled={loading} onClick={()=>setRevision(v=>v+1)}>刷新统计</button></div>{error&&<p className="error-text" role="alert">{error}</p>}{loading&&!summary&&<p role="status">正在读取网站访问与下载统计…</p>}
 {summary&&<><div className={styles.stats}>{[['累计页面访问',summary.pageViews.total,`近 30 天 ${summary.pageViews.last30Days.toLocaleString()} 次`],['今日页面访问',summary.pageViews.today,'页面浏览次数（PV）'],['客户端下载请求',summary.downloads.total,`近 30 天 ${summary.downloads.last30Days.toLocaleString()} 次`],['今日下载请求',summary.downloads.today,'有效安装包 GET 响应次数']].map(([label,n,note])=><div className={styles.stat} key={label}><span>{label}</span><strong>{Number(n).toLocaleString('zh-CN')}</strong><small>{note}</small></div>)}</div>
 <p className={styles.caption}>访问量统计公开页面成功上报的浏览次数，不等于独立访客。日统计按 UTC 汇总；北京时间每天 08:00 切换统计日。下载请求包含重复下载、重试与 App 更新，不代表完成下载或安装人数。{summary.trackingSince?`下载统计自 ${new Date(summary.trackingSince).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})} 开始。`:'下载统计从此功能上线后开始。'}</p>
 <section className={`panel ${styles.statTable}`}><h2>客户端下载 · 最近 30 天</h2>{summary.downloads.data.length?<div className="table-wrap"><table className="data-table"><thead><tr><th>日期（UTC）</th><th>版本</th><th>平台 / 架构</th><th>下载请求</th></tr></thead><tbody>{summary.downloads.data.map(row=><tr key={`${row.day}-${row.version}-${row.platform}-${row.arch}`}><td>{row.day}</td><td>{row.version}</td><td>{row.platform} / {row.arch}</td><td>{row.downloads.toLocaleString()}</td></tr>)}</tbody></table></div>:<div className="empty">统计上线后，首次客户端下载将显示在这里。</div>}</section></>}
 {visits&&<section className={`panel ${styles.statTable}`}><h2>页面访问 · 最近 30 天</h2>{visits.data.length?<div className="table-wrap"><table className="data-table"><thead><tr><th>日期（UTC）</th><th>页面</th><th>浏览次数</th></tr></thead><tbody>{visits.data.map(row=><tr key={`${row.day}-${row.page}`}><td>{row.day}</td><td>{pages[row.page]??row.page}</td><td>{row.views.toLocaleString()}</td></tr>)}</tbody></table></div>:<div className="empty">暂无页面访问记录。</div>}</section>}
 </div>;
}
