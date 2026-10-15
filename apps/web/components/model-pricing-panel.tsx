'use client';
import {useEffect,useRef,useState} from 'react';
import {api,put} from '../lib/api';

type Summary={requests:number;userDebitedRmb:number;knownCostRmb:number;pairedUserDebitedRmb:number;knownCostRequests:number;unknownCostRequests:number;estimatedMarginRmb:number|null};
type Reference={source:string;label:string;periods:Array<{id:string;label:string;prices:{input:number;cached:number;output:number}}>};
type Model=Summary&{id:string;name:string;publicId:string;providerId:string;enabled:boolean;multiplier:number;revision:number;reference:Reference|null};
type Upstream=Summary&{id:string;name:string;balance:Array<{currency:string;total:string}>|null;balanceStatus:string;checkedAt:string|null};
type Overview={models:Model[];providers:Upstream[];summary:Summary;checkedAt:string};
const money=(n:number)=>`¥${n.toFixed(4)}`;
const valid=(n:number)=>Number.isFinite(n)&&n>=.01&&n<=100;

export function ModelPricingPanel(){
 const [data,setData]=useState<Overview|null>(null),[drafts,setDrafts]=useState<Record<string,string>>({}),[busy,setBusy]=useState<Record<string,boolean>>({}),[messages,setMessages]=useState<Record<string,string>>({});
 const [error,setError]=useState(''),[loading,setLoading]=useState(false),[selected,setSelected]=useState<string|null>(null);
 const sequence=useRef(0),dialog=useRef<HTMLDialogElement>(null);
 async function load(){const revision=++sequence.current;setLoading(true);setError('');try{const next=await api<Overview>('/api/v1/admin/model-pricing');if(revision!==sequence.current)return;setData(next);setDrafts(old=>Object.fromEntries(next.models.map(m=>[m.id,old[m.id]??String(m.multiplier)])));}catch(e){if(revision===sequence.current)setError((e as Error).message);}finally{if(revision===sequence.current)setLoading(false);}}
 useEffect(()=>{void load();return()=>{sequence.current++;};},[]);
 useEffect(()=>{if(selected)dialog.current?.showModal();return()=>dialog.current?.close();},[selected]);
 async function save(model:Model){const multiplier=Number(drafts[model.id]);if(!valid(multiplier)||busy[model.id])return;
  setBusy(old=>({...old,[model.id]:true}));setMessages(old=>({...old,[model.id]:''}));
  try{const result=await put<{multiplier:number;revision:number}>(`/api/v1/admin/model-pricing/${model.id}`,{multiplier,expectedRevision:model.revision});setData(old=>old?{...old,models:old.models.map(m=>m.id===model.id?{...m,...result}:m)}:old);setMessages(old=>({...old,[model.id]:'已保存，新请求使用此倍率'}));await load();}
  catch(e){setMessages(old=>({...old,[model.id]:(e as Error).message}));}finally{setBusy(old=>({...old,[model.id]:false}));}
 }
 const model=data?.models.find(m=>m.id===selected),factor=model?Number(drafts[model.id]):NaN;
 return <>
  <section className="panel"><div className="inline-actions"><h2>上游余额与用户扣款</h2><button className="mini-button" disabled={loading} onClick={()=>void load()}>{loading?'正在刷新…':'刷新数据'}</button></div>
   {error&&<p role="alert" className="error-text">{error}</p>}
   {!data?<p role="status">正在读取余额和价格…</p>:<>
    <div className="stat-grid pricing-upstreams">{data.providers.map(p=><div className="pricing-stat" key={p.id}><strong>{p.name}</strong><p>{p.balanceStatus==='AVAILABLE'&&p.balance?.length?p.balance.map(b=><span key={b.currency}>{b.currency==='CNY'?'¥':b.currency==='USD'?'$':`${b.currency} `}{b.total} </span>):p.balanceStatus==='ERROR'?'读取失败，请刷新重试':p.balanceStatus==='DISABLED'?'连接未启用':'未获取（上游未提供余额接口）'}</p><small>累计扣用户余额 {money(p.userDebitedRmb)}</small>{p.checkedAt&&<small>余额更新 {new Date(p.checkedAt).toLocaleString('zh-CN')}</small>}</div>)}</div>
    <div className="stat-grid pricing-summary"><div className="pricing-stat"><span>服务端累计扣用户余额</span><strong>{money(data.summary.userDebitedRmb)}</strong></div><div className="pricing-stat"><span>已知成本（含估算）</span><strong>{data.summary.knownCostRequests?money(data.summary.knownCostRmb):'未知'}</strong></div><div className="pricing-stat"><span>同批请求估算毛利</span><strong>{data.summary.estimatedMarginRmb===null?'未知':money(data.summary.estimatedMarginRmb)}</strong></div></div>
    <p><small>成本覆盖 {data.summary.knownCostRequests} / {data.summary.requests} 笔；另有 {data.summary.unknownCostRequests} 笔成本未知。毛利仅比较成本已知的同批请求，不含服务器费用。余额扣款不等于现金收入，估算不等于实际账单；统计默认排除内部测试账号。</small></p>
   </>}
  </section>
  {data&&<section className="panel"><h2>模型售价倍率</h2><p>用户售价 = 上游价格基准 × 倍率。1× 不加价，1.1× 加价 10%；低于 1× 表示补贴。只影响新请求，历史账单不重算。</p><div className="table-wrap"><table className="data-table pricing-model-table"><thead><tr><th>模型</th><th>售价倍率</th><th>累计与估算</th><th>操作</th></tr></thead><tbody>{data.models.map(m=>{const value=Number(drafts[m.id]),changed=value!==m.multiplier;return <tr key={m.id}><td><strong>{m.name}</strong><small className="pricing-subline">{m.publicId}{!m.enabled?' · 未启用':''}</small></td><td>{m.reference?<><div className="pricing-multiplier"><input aria-label={`${m.name} 售价倍率`} type="number" min={.01} max={100} step={.01} value={drafts[m.id]??''} disabled={busy[m.id]} onChange={e=>{setDrafts(old=>({...old,[m.id]:e.target.value}));setMessages(old=>({...old,[m.id]:''}));}}/><span>×</span></div><small className={valid(value)&&value<1?'error-text':'pricing-subline'}>{valid(value)?`按基准预计毛利率 ${((1-1/value)*100).toFixed(2)}%${changed?' · 未保存':''}`:'请输入 0.01–100 的倍率'}</small></>:<small>缺少上游价格基准</small>}</td><td><span>用户扣款 {money(m.userDebitedRmb)}</span><small className="pricing-subline">估算毛利 {m.estimatedMarginRmb===null?'未知':money(m.estimatedMarginRmb)}</small></td><td><div className="inline-actions"><button className="mini-button" disabled={!m.reference||!changed||!valid(value)||busy[m.id]} onClick={()=>void save(m)}>{busy[m.id]?'保存中…':'保存'}</button><button className="mini-button" onClick={()=>setSelected(m.id)}>Token 价格</button></div>{messages[m.id]&&<small role="status" className="pricing-subline">{messages[m.id]}</small>}</td></tr>;})}</tbody></table></div></section>}
  {model&&<dialog className="provider-dialog" ref={dialog} aria-label={`${model.name} Token 价格`} onCancel={e=>{e.preventDefault();setSelected(null);}}><div className="provider-dialog-content"><div className="inline-actions"><h2>{model.name} · Token 价格</h2><button className="mini-button" onClick={()=>setSelected(null)}>关闭</button></div>
   <p>人民币 / 百万 Token · {valid(factor)?`${factor}×`:'倍率无效'}{factor!==model.multiplier?' · 售价预览，尚未保存':''}</p><p><small>{model.reference?.label??'尚未导入已确认的价格基准，暂不能配置倍率。'}</small></p>
   {model.reference&&<div className="table-wrap"><table className="data-table"><thead><tr><th>时段</th><th>项目</th><th>上游价格基准</th><th>用户售价</th></tr></thead><tbody>{model.reference.periods.flatMap(period=>([['input','输入'],['cached','缓存输入'],['output','输出']] as const).map(([part,label])=><tr key={`${period.id}-${part}`}><td>{period.label}</td><td>{label}</td><td>¥{period.prices[part]}</td><td>{valid(factor)?`¥${Number((period.prices[part]*factor).toFixed(6))}`:'—'}</td></tr>))}</tbody></table></div>}
   {model.reference?.periods.some(p=>p.id==='peak')&&<p><small>北京时间工作日 9–12、14–18 点为高峰，其他时段为空闲；法定节假日按计费日历设置。每笔消费向上取整至 ¥0.0001。</small></p>}
  </div></dialog>}
 </>;
}
