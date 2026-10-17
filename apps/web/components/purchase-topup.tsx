"use client";
import {useEffect,useRef,useState} from 'react';
import {QRCodeSVG} from 'qrcode.react';
import type {PurchaseClient,PurchaseClaim,PurchaseTicket} from '../purchase-types';
const labels={PENDING:'待审核',APPROVED:'已到账',REJECTED:'未通过'};
const text=(error:unknown)=>error&&typeof error==='object'&&'message' in error?String(error.message):'网络可能不稳定，请稍后重试。';
export function PurchaseTopup({client,qrSource,onCredited,mobileDirect=false}:{client:PurchaseClient;qrSource:string;onCredited?:()=>void;mobileDirect?:boolean}){
 const [ticket,setTicket]=useState<PurchaseTicket|null>(null),[claims,setClaims]=useState<PurchaseClaim[]>([]),[total,setTotal]=useState(0),[page,setPage]=useState(1),[filter,setFilter]=useState('all'),[revision,setRevision]=useState(0),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState(''),[clock,setClock]=useState(Date.now());
 const needsPolling=useRef(true);const credited=useRef(onCredited);credited.current=onCredited;const known=useRef(new Map<string,string>()),initialized=useRef(false);
 useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer);},[]);
 useEffect(()=>{
  let active=true,running=false;setLoading(true);
  const sync=async()=>{
   if(running||!active||document.visibilityState==='hidden')return;running=true;
   try{const result=await client.list(page,filter);if(!active)return;let changed=false;for(const claim of result.data){if(initialized.current&&known.current.get(claim.id)==='PENDING'&&claim.status==='APPROVED')changed=true;known.current.set(claim.id,claim.status);}initialized.current=true;needsPolling.current=Boolean(ticket)||result.data.some(c=>c.status==='PENDING');setClaims(result.data);setTotal(result.total);setError('');if(changed){setNotice('审核通过，余额已到账。');credited.current?.();}
    if(ticket){const state=await client.status(ticket.id);if(!active)return;if(state.state==='SUBMITTED'){setTicket(null);setNotice('订单已提交，等待管理员审核。');}else if(state.state==='EXPIRED')setTicket(current=>current?{...current,expiresAt:new Date(0).toISOString()}:null);}
   }catch(reason){if(active)setError(text(reason));}finally{running=false;if(active)setLoading(false);}
  };
  void sync();const timer=setInterval(()=>{if(needsPolling.current)void sync();},30000);document.addEventListener('visibilitychange',sync);
  return()=>{active=false;clearInterval(timer);document.removeEventListener('visibilitychange',sync);};
 },[client,page,filter,revision,ticket?.id]);
 async function create(){if(busy)return;setBusy(true);setError('');try{const next=await client.create();if(mobileDirect&&window.matchMedia('(max-width: 640px)').matches){window.location.assign(next.url);return;}setTicket(next);setNotice('');}catch(reason){setError(text(reason));}finally{setBusy(false);}}
 const remaining=ticket?Math.max(0,Math.ceil((Date.parse(ticket.expiresAt)-clock)/1000)):0;
 return <div className="purchase-flow">
  <p className="purchase-intro">购买“远程学习”服务，实付多少，到账多少。</p>
  {error&&<p className="purchase-error" role="alert">{error}</p>}{notice&&<p className="purchase-notice" role="status">{notice}</p>}
  {ticket?<section className="purchase-scan"><h3>3. 扫码提交订单号</h3><p>到账账号：<strong>{ticket.maskedAccount}</strong></p>{remaining>0?<><QRCodeSVG value={ticket.url} size={208} marginSize={4} level="M" title="用手机扫描，在专属网页提交订单号"/><p>二维码有效期 <strong>{Math.floor(remaining/60)}:{String(remaining%60).padStart(2,'0')}</strong></p><p className="purchase-caption">已绑定当前账号，手机填写订单号即可。</p></>:<p className="purchase-error">二维码已过期，请重新生成后扫码。</p>}<div className="purchase-actions"><button type="button" disabled={busy} onClick={()=>setTicket(null)}>返回充值</button><button type="button" className="purchase-primary" disabled={busy} onClick={()=>void create()}>{busy?'正在生成…':'重新生成二维码'}</button><button type="button" onClick={()=>setRevision(n=>n+1)}>已提交，刷新</button></div></section>:<section className="purchase-buy"><div className="purchase-prices"><span>¥10</span><span>¥20</span><span>¥50</span></div><img width={208} height={208} src={qrSource} alt="用闲鱼扫码进入个人主页，选择远程学习商品下单"/><strong>用闲鱼扫码下单</strong><p className="purchase-caption">1. 扫码下单付款。<br/>2. 付款后点击下方按钮。</p><button type="button" className="purchase-primary" disabled={busy} onClick={()=>void create()}>{busy?'正在生成提交二维码…':'已支付，提交订单号'}</button><p className="purchase-caption">提交后 10 分钟内审核，按实付金额到账。</p></section>}
  <section className="purchase-history"><div className="purchase-history-title"><h3>我的订单</h3><button type="button" disabled={loading} onClick={()=>setRevision(n=>n+1)}>{loading?'正在读取…':'刷新'}</button></div><div className="purchase-filters">{[['all','全部'],['PENDING','待审核'],['APPROVED','已到账'],['REJECTED','未通过']].map(([value,label])=><button type="button" key={value} aria-pressed={filter===value} onClick={()=>{setFilter(value);setPage(1);}}>{label}</button>)}</div>
  {!loading&&!claims.length&&<p className="purchase-caption">暂无订单记录。</p>}{claims.map(claim=><article className="purchase-row" key={claim.id}><div><strong className={'purchase-state purchase-'+claim.status.toLowerCase()}>{labels[claim.status]}</strong><span>{claim.creditedRmb!==null?`+¥${claim.creditedRmb.toFixed(2)}`:''}</span></div><p className="purchase-order">订单号：{claim.orderNo}</p><p className="purchase-caption">提交：{new Date(claim.submittedAt).toLocaleString('zh-CN')}</p>{claim.status==='PENDING'&&<p className="purchase-caption">{Date.parse(claim.deadlineAt)<clock?'审核稍有延迟，请稍后刷新。':`预计 ${new Date(claim.deadlineAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})} 前审核。`}</p>}{claim.reason&&<p className="purchase-caption">审核说明：{claim.reason}</p>}{claim.status==='REJECTED'&&<button type="button" disabled={busy} onClick={()=>void create()}>核对订单号后重新提交</button>}</article>)}
  {total>20&&<div className="purchase-actions"><button type="button" disabled={page<=1||loading} onClick={()=>setPage(n=>n-1)}>上一页</button><span>{page} / {Math.ceil(total/20)}</span><button type="button" disabled={page*20>=total||loading} onClick={()=>setPage(n=>n+1)}>下一页</button></div>}</section>
 </div>;
}
