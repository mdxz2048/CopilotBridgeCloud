'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, ArrowRight } from 'lucide-react';
import { SiteHeader } from '../../components/site-header';
import { api, type Plan } from '../../lib/api';

export default function Pricing() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { api<{ data: Plan[] }>('/api/v1/plans').then(r => setPlans(r.data)).catch(() => {}).finally(() => setLoading(false)); }, []);
  return <><SiteHeader/><main className="container"><div className="page-hero"><span className="eyebrow">USAGE-BASED ACCESS</span><h1>按实际使用量计费。</h1><p>产品方向是不收月费、按模型的实际用量扣 AI 点数。套餐决定可用模型和设备权益；具体费率以正式发布的模型费率为准。</p></div>
    <div className="notice">目前生产点数扣费及在线支付尚未开放。下方只展示已配置的测试权益，不是可购买的付费套餐；不会因注册而自动开通。</div>
    {loading ? <div className="loading-skeleton"/> : plans.length ? <div className="pricing-grid">{plans.map(plan => <article className={`pricing-card ${plan.code === 'PRO' ? 'featured' : ''}`} key={plan.id}><span className="eyebrow">MODEL ACCESS</span><h2>{plan.name}</h2><p>{plan.description}</p><div className="pricing-price">按量计费 <small>· 尚未开放正式付款</small></div><Link className="button" href="/register">注册并了解 {plan.name} <ArrowRight size={16}/></Link><ul><li><Check size={16}/> 最多 {plan.maxDevices} 台设备</li><li><Check size={16}/> 模型使用按服务端实际结算</li><li><Check size={16}/> {plan.maxConcurrentRequests} 路并发 · {plan.requestsPerMinute} RPM</li></ul></article>)}</div> : <div className="notice" style={{marginBottom:100}}>套餐尚未开放，注册后可在账号中心查看状态。</div>}
    <div className="notice" style={{marginBottom:80}}>请勿向测试占位二维码付款。真实支付和正式费率上线前，任何测试结果都不代表已经扣费。</div></main></>;
}
