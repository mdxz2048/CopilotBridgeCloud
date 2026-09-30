'use client';

import { useEffect, useState } from 'react';
import { api } from '../lib/api';

type Insights = {
  periodDays: number;
  requests: Array<{ status: string; count: number }>;
  models: Array<{ publicId: string; model: string; requests: number; inputTokens: number; outputTokens: number; pointsRated: number; pointsCharged: number }>;
};
type System = { database: string; gateway: string };
type Visits = { metric: string; uniqueVisitorsAvailable: boolean; data: Array<{ day: string; page: string; views: number }> };

export function AdminInsights({ totals }: { totals: Record<string, number> }) {
  const [insights, setInsights] = useState<Insights | null>(null);
  const [system, setSystem] = useState<System | null>(null);
  const [visits, setVisits] = useState<Visits | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    void Promise.all([
      api<Insights>('/api/v1/admin/insights', { signal: controller.signal }),
      api<System>('/api/v1/admin/system', { signal: controller.signal }),
      api<Visits>('/api/v1/admin/site/page-views', { signal: controller.signal }),
    ]).then(([usage, health, traffic]) => {
      if (!controller.signal.aborted) { setInsights(usage); setSystem(health); setVisits(traffic); }
    }).catch((reason) => {
      if (!controller.signal.aborted) setError((reason as { message?: string }).message ?? '运行情况加载失败。');
    });
    return () => controller.abort();
  }, [revision]);
  return <>
    <div className="stat-grid">
      {[['users','注册用户'],['devices','设备总数'],['orders','订单记录'],['requests','累计网关请求']].map(([key,label]) =>
        <div className="stat" key={key}><span className="stat-label">{label}</span><strong>{totals[key] ?? 0}</strong></div>)}
    </div>
    {error && <p className="error-text" role="alert">{error} <button className="mini-button" onClick={() => setRevision(value => value + 1)}>重试</button></p>}
    {!error && (!insights || !system || !visits) && <p role="status">正在读取运行、访问和模型统计…</p>}
    {system && <section className="panel"><h2>运行情况</h2><p>数据库：{system.database} · Gateway：{system.gateway}</p><p>这里显示服务端检查结果，不等同于端到端 Provider 可用性；Provider 请到连接管理检查。</p></section>}
    {insights && <><section className="panel"><h2>最近 {insights.periodDays} 天网关请求</h2>{insights.requests.length
      ? <div className="inline-actions">{insights.requests.map(item => <span key={item.status}>{item.status}：{item.count} 次</span>)}</div>
      : <p>暂无网关请求记录。</p>}</section>
      <section className="panel"><h2>模型使用统计</h2><p>“测算点数”包括 SHADOW；只有“实际扣点”影响钱包。当前无法据此推算收入。</p>{insights.models.length
        ? <div className="table-wrap"><table className="data-table"><thead><tr><th>模型</th><th>请求</th><th>输入 Token</th><th>输出 Token</th><th>测算点数</th><th>实际扣点</th></tr></thead><tbody>{insights.models.map(item => <tr key={item.publicId}><td>{item.model}</td><td>{item.requests}</td><td>{item.inputTokens}</td><td>{item.outputTokens}</td><td>{item.pointsRated}</td><td>{item.pointsCharged}</td></tr>)}</tbody></table></div>
        : <p>暂无已计量模型请求。</p>}</section>
      {visits && <section className="panel"><h2>网站页面访问</h2><p>最近 30 天公开页面浏览次数（按天、页面汇总）；不记录访问者身份、IP 或原始请求，也不等于独立访客数。只统计成功上报的浏览器页面。</p>{visits.data.length
        ? <div className="table-wrap"><table className="data-table"><thead><tr><th>日期</th><th>页面</th><th>浏览次数</th></tr></thead><tbody>{visits.data.map(row => <tr key={`${row.day}-${row.page}`}><td>{row.day}</td><td>{row.page}</td><td>{row.views}</td></tr>)}</tbody></table></div>
        : <p>暂无页面访问记录。</p>}</section>}</>}
  </>;
}
