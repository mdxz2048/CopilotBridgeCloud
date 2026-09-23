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
  return <><SiteHeader/><main className="container"><div className="page-hero"><span className="eyebrow">SIMPLE PLANS</span><h1>选择适合你的工作节奏。</h1><p>套餐决定设备、用量和模型访问范围。实际开放模型以账号中的模型目录为准。</p></div>
    {loading ? <div className="loading-skeleton"/> : plans.length ? <div className="pricing-grid">{plans.map(plan => <article className={`pricing-card ${plan.code === 'PRO' ? 'featured' : ''}`} key={plan.id}><span className="eyebrow">{plan.code === 'PRO' ? 'FOR MORE CAPACITY' : 'FOR EVERYDAY WORK'}</span><h2>{plan.name}</h2><p>{plan.description}</p><div className="pricing-price">¥{Number(plan.monthlyPrice).toLocaleString('zh-CN')} <small>/ 月</small></div><Link className="button" href="/register">选择 {plan.name} <ArrowRight size={16}/></Link><ul><li><Check size={16}/> 最多 {plan.maxDevices} 台设备</li><li><Check size={16}/> 每月 {plan.monthlyTokenLimit.toLocaleString('zh-CN')} Tokens</li><li><Check size={16}/> {Number(plan.monthlyUsageCreditLimit).toLocaleString('zh-CN')} 用量额度</li><li><Check size={16}/> {plan.maxConcurrentRequests} 路并发 · {plan.requestsPerMinute} RPM</li></ul></article>)}</div> : <div className="notice" style={{marginBottom:100}}>套餐尚未开放。管理员完成配置后，价格和额度会显示在这里。</div>}
    <div className="notice" style={{marginBottom:80}}>目前支持管理员手工开通订阅。微信和支付宝扫码支付尚未接入；页面不会展示不可用的付款二维码。</div></main></>;
}
