'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, HardDrive, Layers3 } from 'lucide-react';
import { AppShell, type NavItem } from '../../components/app-shell';
import { api, del, post, type Account, type Device, type Release } from '../../lib/api';

const items: NavItem[] = [
  { id: 'overview', label: '概览', icon: 'Home' }, { id: 'subscription', label: '订阅', icon: 'BadgeCheck' },
  { id: 'usage', label: 'AI 用量', icon: 'Activity' }, { id: 'devices', label: '设备', icon: 'HardDrive' },
  { id: 'models', label: '可用模型', icon: 'Boxes' }, { id: 'download', label: '软件下载', icon: 'Download' }, { id: 'account', label: '账号', icon: 'Settings2' },
];
type Model = { id: string; publicId: string; displayName: string; supportsTools: boolean; supportsVision: boolean; supportsReasoning: boolean };
type UsageRecord = { id: string; status: string; inputTokens: number; outputTokens: number; totalTokens: number; usageCredit: string; createdAt: string };
export default function Dashboard() {
  const router = useRouter(); const [active, setActive] = useState('overview'); const [account, setAccount] = useState<Account | null>(null); const [models, setModels] = useState<Model[]>([]); const [history, setHistory] = useState<UsageRecord[]>([]); const [release, setRelease] = useState<Release | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [action, setAction] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const data = await api<Account>('/api/v1/account'); setAccount(data);
      const [m, h, r] = await Promise.allSettled([api<{ data: Model[] }>('/api/v1/models'), api<{ data: UsageRecord[] }>('/api/v1/usage/history'), api<{ release: Release | null }>('/api/v1/releases/latest')]);
      if (m.status === 'fulfilled') setModels(m.value.data);
      if (h.status === 'fulfilled') setHistory(h.value.data);
      if (r.status === 'fulfilled') setRelease(r.value.release);
    } catch (e) { if ((e as { code?: string }).code === 'UNAUTHORIZED') router.replace('/login'); else setError('暂时无法加载，请稍后重试。'); }
    finally { setLoading(false); }
  }, [router]);
  useEffect(() => { void load(); }, [load]);
  async function revoke(device: Device) { if (!window.confirm(`停用设备 ${device.deviceName}？`)) return; try { await del(`/api/v1/devices/${device.id}`); await load(); } catch { setAction('设备操作失败，请重试。'); } }
  async function cancel() { if (!window.confirm('确认在当前周期结束时取消订阅？')) return; try { await post('/api/v1/subscription/cancel', {}); setAction('已设置在当前周期结束时取消。'); await load(); } catch { setAction('取消失败，请重试。'); } }
  if (loading && !account) return <div className="app-shell"><div className="app-main"><div className="loading-skeleton"/><div className="loading-skeleton"/></div></div>;
  if (error || !account) return <div className="auth-wrap"><div className="auth-card"><h1>暂时无法加载</h1><p>{error || '请稍后重试。'}</p><button className="button" onClick={load}>重试</button></div></div>;
  const usage = account.usage; const sub = account.subscription; const plan = account.plan;
  const title = items.find(i => i.id === active)?.label ?? '概览';
  return <AppShell title={title} description={active === 'overview' ? '账号、订阅与使用状态，一目了然。' : '管理你的 Copilot Bridge Cloud 服务。'} items={items} active={active} onChange={setActive} email={account.user.email}>
    {action && <div className="notice" role="status">{action}</div>}
    {active === 'overview' && <><div className="stat-grid"><div className="stat"><span className="stat-label">当前套餐</span><strong>{plan?.name ?? '未开通'}</strong><small>{sub?.status ?? '需要订阅'}</small></div><div className="stat"><span className="stat-label">本月 AI 用量</span><strong>{usage?.percent ?? 0}%</strong><small>{usage?.credit ?? 0} / {usage?.creditLimit ?? 0} Credits</small></div><div className="stat"><span className="stat-label">设备</span><strong>{account.devices.filter(d => d.status === 'ACTIVE').length}</strong><small>最多 {plan?.maxDevices ?? 0} 台</small></div><div className="stat"><span className="stat-label">可用模型</span><strong>{models.length}</strong><small>按当前权限开放</small></div></div><div className="split"><section className="panel"><h2>本月使用情况</h2><p>使用周期截至 {sub ? new Date(sub.currentPeriodEnd).toLocaleDateString('zh-CN') : '—'}</p><div className="progress-track"><div className="progress-fill" style={{width:`${Math.min(100,usage?.percent ?? 0)}%`}}/></div><p>已用 {usage?.tokens.toLocaleString('zh-CN') ?? 0} / {usage?.tokenLimit.toLocaleString('zh-CN') ?? 0} Tokens</p>{usage && usage.threshold >= 90 && <div className="notice">本月用量已达到 {usage.threshold}% 阈值。</div>}</section><section className="panel"><h2>快速开始</h2><p>安装 Desktop 并登录账号。设备激活后，即可选择你有权限使用的在线模型。</p><Link className="button button-small" href="/download">下载 Desktop <ArrowUpRight size={15}/></Link></section></div></>}
    {active === 'subscription' && <section className="panel"><h2>当前订阅</h2>{sub && plan ? <><div className="stat-grid"><div className="stat"><span className="stat-label">套餐</span><strong>{plan.name}</strong></div><div className="stat"><span className="stat-label">状态</span><strong>{sub.status}</strong></div><div className="stat"><span className="stat-label">周期结束</span><strong style={{fontSize:18}}>{new Date(sub.currentPeriodEnd).toLocaleDateString('zh-CN')}</strong></div><div className="stat"><span className="stat-label">月费</span><strong>¥{Number(plan.monthlyPrice)}</strong></div></div><p>{sub.cancelAtPeriodEnd ? '已安排在当前周期结束时取消。' : '订阅当前有效。'}</p>{!sub.cancelAtPeriodEnd && <button className="mini-button" onClick={cancel}>周期结束时取消</button>}</> : <div className="empty"><strong>尚未开通订阅</strong>查看套餐后联系管理员开通。<br/><Link className="button button-small" href="/pricing" style={{marginTop:18}}>查看套餐</Link></div>}</section>}
    {active === 'usage' && <><div className="stat-grid"><div className="stat"><span className="stat-label">请求数</span><strong>{usage?.requests ?? 0}</strong></div><div className="stat"><span className="stat-label">Tokens</span><strong>{usage?.tokens ?? 0}</strong></div><div className="stat"><span className="stat-label">Usage Credit</span><strong>{usage?.credit ?? 0}</strong></div><div className="stat"><span className="stat-label">使用比例</span><strong>{usage?.percent ?? 0}%</strong></div></div><section className="panel"><h2>最近请求</h2>{history.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>时间</th><th>状态</th><th>Input</th><th>Output</th><th>Credit</th></tr></thead><tbody>{history.map(r => <tr key={r.id}><td>{new Date(r.createdAt).toLocaleString('zh-CN')}</td><td><span className={`badge ${r.status === 'COMPLETED' ? '' : 'muted'}`}>{r.status}</span></td><td>{r.inputTokens}</td><td>{r.outputTokens}</td><td>{r.usageCredit}</td></tr>)}</tbody></table></div> : <div className="empty"><strong>还没有 AI 用量</strong>在 Desktop 使用模型后，请求会显示在这里。</div>}</section></>}
    {active === 'devices' && <section className="panel"><h2>我的设备</h2>{account.devices.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>设备</th><th>平台</th><th>状态</th><th>上次活动</th><th></th></tr></thead><tbody>{account.devices.map(device => <tr key={device.id}><td>{device.deviceName}</td><td>{device.platform}</td><td><span className={`badge ${device.status === 'ACTIVE' ? '' : 'muted'}`}>{device.status}</span></td><td>{device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString('zh-CN') : '—'}</td><td>{device.status === 'ACTIVE' && <button className="mini-button danger" onClick={() => revoke(device)}>下线</button>}</td></tr>)}</tbody></table></div> : <div className="empty"><HardDrive size={27}/><strong>还没有设备</strong>登录 Copilot Bridge Desktop 后，设备会出现在这里。<br/><Link href="/download" className="button button-small" style={{marginTop:18}}>下载 Copilot Bridge</Link></div>}</section>}
    {active === 'models' && <section className="panel"><h2>可用模型</h2>{models.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>模型</th><th>ID</th><th>能力</th></tr></thead><tbody>{models.map(model => <tr key={model.id}><td>{model.displayName}</td><td><code>{model.publicId}</code></td><td>{[model.supportsTools && 'Tools',model.supportsVision && 'Vision',model.supportsReasoning && 'Reasoning'].filter(Boolean).join(' · ') || 'Text'}</td></tr>)}</tbody></table></div> : <div className="empty"><Layers3 size={27}/><strong>暂无可用模型</strong>模型开放后会显示在这里。</div>}</section>}
    {active === 'download' && <section className="panel"><h2>Copilot Bridge Desktop</h2>{release ? <><p>Windows 版本 {release.version} · {release.arch}</p><a className="button button-small" href={release.downloadUrl}>下载</a><p>SHA256: <code>{release.sha256}</code></p></> : <div className="empty"><strong>尚未发布安装包</strong>发布后会在这里提供下载。</div>}</section>}
    {active === 'account' && <section className="panel"><h2>账号信息</h2><p>邮箱：{account.user.email}</p><p>角色：{account.user.role}</p><p>状态：{account.user.status}</p><p>如需重置密码，请联系管理员。</p></section>}
  </AppShell>;
}
