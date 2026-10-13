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
  return <><SiteHeader/><main className="container"><div className="page-hero"><span className="eyebrow">USAGE-BASED ACCESS</span><h1>按实际使用量计费。</h1><p>余额、套餐、模型权限和设备数量由管理员统一管理。费用按模型输入、缓存命中和输出的实际用量结算，可在用户中心查看余额与使用记录。</p></div>
    <div className="notice">人民币用量计费已支持；在线收款尚未接入，请联系管理员人工开通或调整余额。已有分配账号可直接登录，账号开通请联系管理员。</div>
    {loading ? <div className="loading-skeleton"/> : plans.length ? <div className="pricing-grid">{plans.map(plan => <article className={`pricing-card ${plan.code === 'PRO' ? 'featured' : ''}`} key={plan.id}><span className="eyebrow">MODEL ACCESS</span><h2>{plan.name}</h2><p>{plan.description}</p><div className="pricing-price">{plan.code==='QUARTER'?`¥${plan.monthlyPrice} / 90 天`:'按实际用量计费'} <small>· 人工开通</small></div><Link className="button" href="/login">登录用户中心 <ArrowRight size={16}/></Link><ul><li><Check size={16}/> 最多 {plan.maxDevices} 台设备</li><li><Check size={16}/> 模型使用按服务端实际结算</li><li><Check size={16}/> 平台不按次数、并发或周期用量拦截模型请求</li></ul></article>)}</div> : <div className="notice" style={{marginBottom:100}}>套餐尚未开放，请联系管理员了解账号状态。</div>}
    <div className="notice" style={{marginBottom:80}}>模型权限与最大设备数以账号实际配置为准；供应商服务仍可能存在额度或频率限制。</div></main></>;
}
