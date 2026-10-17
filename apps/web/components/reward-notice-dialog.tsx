"use client";
import {useEffect,useRef,useState} from 'react';
export type RewardNotice={id:string;amountRmb:number;createdAt:string;expiresAt:string};
export type RewardClient={list:()=>Promise<{data:RewardNotice[]}>;ack:(id:string)=>Promise<unknown>};
export function RewardNoticeDialog({client}:{client:RewardClient}){
 const [items,setItems]=useState<RewardNotice[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');const dialog=useRef<HTMLDialogElement>(null),running=useRef(false),acknowledged=useRef(new Set<string>());const first=items[0];
 useEffect(()=>{let active=true,inFlight=false;async function load(){if(inFlight||document.hidden)return;inFlight=true;try{const next=await client.list();if(active)setItems(next.data.filter(n=>!acknowledged.current.has(n.id)));}catch{}finally{inFlight=false;}}void load();const timer=setInterval(()=>void load(),30000);document.addEventListener('visibilitychange',load);return()=>{active=false;clearInterval(timer);document.removeEventListener('visibilitychange',load);};},[client]);
 useEffect(()=>{if(first&&!dialog.current?.open)dialog.current?.showModal();else if(!first&&dialog.current?.open)dialog.current.close();},[first?.id]);
 async function confirm(){if(!first||running.current)return;running.current=true;setBusy(true);setError('');try{await client.ack(first.id);acknowledged.current.add(first.id);setItems(list=>list.filter(n=>n.id!==first.id));}catch(e){setError(e&&typeof e==='object'&&'message'in e?String(e.message):'确认超时，请检查网络后重试。');}finally{running.current=false;setBusy(false);}}
 return <dialog className="reward-notice-dialog" ref={dialog} onKeyDown={e=>e.stopPropagation()} onCancel={e=>e.preventDefault()} aria-labelledby="reward-notice-title">{first&&<><span className="reward-notice-icon" aria-hidden="true">✓</span><h2 id="reward-notice-title">邀请奖励已到账</h2><p>首次购买已审核，奖励已发放。</p><strong className="reward-notice-amount">¥{first.amountRmb.toFixed(2)}</strong><p>有效期至 {new Date(first.expiresAt).toLocaleString('zh-CN')}。<br/>奖励余额优先使用，正常余额不受影响。</p>{error&&<p role="alert">{error}</p>}<button type="button" disabled={busy} onClick={()=>void confirm()}>{busy?'正在确认…':'确认到账'}</button></>}</dialog>;
}
