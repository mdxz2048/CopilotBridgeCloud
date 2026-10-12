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
  return <><SiteHeader/><main className="container"><div className="page-hero"><span className="eyebrow">USAGE-BASED ACCESS</span><h1>按实际使用量计费。</h1><p>支持按量付费和季度套餐。1 元 = 10,000 AI 点，按输入、缓存命中和输出的实际用量分别计费。套餐决定周期额度、设备和访问频率。</p></div>
    <div className="notice">人民币用量计费已支持；在线收款尚未接入，请联系管理员人工开通或调整余额。注册不会自动赠送套餐。</div>
    {loading ? <div className="loading-skeleton"/> : plans.length ? <div className="pricing-grid">{plans.map(plan => <article className={`pricing-card ${plan.code === 'PRO' ? 'featured' : ''}`} key={plan.id}><span className="eyebrow">MODEL ACCESS</span><h2>{plan.name}</h2><p>{plan.description}</p><div className="pricing-price">{plan.code==='QUARTER'?`¥${plan.monthlyPrice} / 90 天`:'按实际用量计费'} <small>· 人工开通</small></div><Link className="button" href="/register">注册并了解 {plan.name} <ArrowRight size={16}/></Link><ul><li><Check size={16}/> 最多 {plan.maxDevices} 台设备</li><li><Check size={16}/> 模型使用按服务端实际结算</li><li><Check size={16}/> 模型次数、并发与周期用量不限</li></ul></article>)}</div> : <div className="notice" style={{marginBottom:100}}>套餐尚未开放，注册后可在账号中心查看状态。</div>}
    <div className="notice" style={{marginBottom:80}}>请勿向测试占位二维码付款。管理员测试余额与真实付款记录分别管理，人工开通不代表已付款。</div></main></>;
}
