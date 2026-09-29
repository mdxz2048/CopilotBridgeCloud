'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, ArrowRight } from 'lucide-react';
import { SiteHeader } from '../../components/site-header';
import { api, type Plan } from '../../lib/api';
import { TestActivationQr } from '../../components/test-activation-qr';

export default function Pricing() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { api<{ data: Plan[] }>('/api/v1/plans').then(r => setPlans(r.data)).catch(() => {}).finally(() => setLoading(false)); }, []);
  return <><SiteHeader/><main className="container"><div className="page-hero"><span className="eyebrow">SIMPLE PLANS</span><h1>选择适合你的工作节奏。</h1><p>套餐决定设备、用量和模型访问范围。实际开放模型以账号中的模型目录为准。</p></div>
    {loading ? <div className="loading-skeleton"/> : plans.length ? <div className="pricing-grid">{plans.map(plan => <article className={`pricing-card ${plan.code === 'PRO' ? 'featured' : ''}`} key={plan.id}><span className="eyebrow">{plan.code === 'PRO' ? 'FOR MORE CAPACITY' : 'FOR EVERYDAY WORK'}</span><h2>{plan.name}</h2><p>{plan.description}</p><div className="pricing-price">¥{Number(plan.monthlyPrice).toLocaleString('zh-CN')} <small>/ 月 · 测试展示，无法在线购买</small></div><Link className="button" href="/register">注册并了解 {plan.name} <ArrowRight size={16}/></Link><ul><li><Check size={16}/> 最多 {plan.maxDevices} 台设备</li><li><Check size={16}/> 管理员开通后的套餐 AI 点数：{plan.monthlyPoints.toLocaleString('zh-CN')}</li><li><Check size={16}/> 实际扣费点数以服务端结算为准</li><li><Check size={16}/> {plan.maxConcurrentRequests} 路并发 · {plan.requestsPerMinute} RPM</li></ul></article>)}</div> : <div className="notice" style={{marginBottom:100}}>套餐尚未开放。管理员完成配置后，价格和额度会显示在这里。</div>}
    <TestActivationQr/>
    <div className="notice" style={{marginBottom:80}}>暂无真实支付渠道。套餐与二维码仅用于了解测试流程；请勿付款或将测试占位理解为订单已支付。</div></main></>;
}
