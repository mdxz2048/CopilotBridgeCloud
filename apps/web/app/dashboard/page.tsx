'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, HardDrive, Layers3 } from 'lucide-react';
import { AppShell, type NavItem } from '../../components/app-shell';
import { api, del, post, type Account, type Device, type Release } from '../../lib/api';
import { V2AccountPanel } from '../../components/v2-account-panels';
import { TestActivationQr } from '../../components/test-activation-qr';

const items: NavItem[] = [
  { id: 'overview', label: '概览', icon: 'Home' }, { id: 'subscription', label: '订阅', icon: 'BadgeCheck' },
  { id: 'usage', label: 'AI 用量', icon: 'Activity' }, { id: 'devices', label: '设备', icon: 'HardDrive' },
  { id: 'models', label: '可用模型', icon: 'Boxes' }, { id: 'download', label: '软件下载', icon: 'Download' }, { id: 'account', label: '账号', icon: 'Settings2' },
  { id: 'points', label: 'AI 点数', icon: 'CreditCard' }, { id: 'referral', label: '邀请', icon: 'Users' }, { id: 'connections', label: 'Provider 连接', icon: 'Server' },
];
type Model = { id: string; publicId: string; displayName: string; supportsTools: boolean; supportsVision: boolean; supportsReasoning: boolean };
type BillingSummary = { balance: number; requests: number; pointsCharged: number };
export default function Dashboard() {
  const router = useRouter(); const [active, setActive] = useState('overview'); const [account, setAccount] = useState<Account | null>(null); const [models, setModels] = useState<Model[]>([]); const [release, setRelease] = useState<Release | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [action, setAction] = useState('');
  const [billing, setBilling] = useState<BillingSummary | null>(null); const [billingError, setBillingError] = useState(''); const [billingLoading, setBillingLoading] = useState(false); const [billingRevision, setBillingRevision] = useState(0);
  const [panelRevision, setPanelRevision] = useState(0); const refreshing = useRef(false);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const data = await api<Account>('/api/v1/account'); setAccount(data);
      const [m, r] = await Promise.allSettled([api<{ data: Model[] }>('/api/v1/models'), api<{ release: Release | null }>('/api/v1/releases/latest')]);
      if (m.status === 'fulfilled') setModels(m.value.data);
      if (r.status === 'fulfilled') setRelease(r.value.release);
    } catch (e) { if ((e as { code?: string }).code === 'UNAUTHORIZED') router.replace('/login'); else setError('暂时无法加载，请稍后重试。'); }
    finally { setLoading(false); }
  }, [router]);
  const refresh = useCallback(async (initial = false) => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      await load();
      if (!initial) {
        setBillingRevision(value => value + 1);
        setPanelRevision(value => value + 1);
      }
    } finally { refreshing.current = false; }
  }, [load]);
  useEffect(() => { void refresh(true); }, [refresh]);
  useEffect(() => {
    let away = false;
    const onBlur = () => { away = true; };
    const onReturn = () => {
      if (!document.hidden && away) { away = false; void refresh(); }
    };
    const onVisibility = () => { if (document.hidden) away = true; else onReturn(); };
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onReturn);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh]);
  useEffect(() => {
    if (active !== 'overview' && active !== 'usage') return;
    let cancelled = false;
    const controller = new AbortController();
    setBilling(null); setBillingError(''); setBillingLoading(true);
    void Promise.all([api<{ balance: number }>('/api/v1/me/wallet', { signal: controller.signal }),
      api<{ requests: number; pointsCharged: number }>('/api/v1/me/usage', { signal: controller.signal })])
      .then(([wallet, usage]) => { if (!cancelled) setBilling({ balance: wallet.balance, requests: usage.requests, pointsCharged: usage.pointsCharged }); })
      .catch(() => { if (!cancelled) { controller.abort(); setBillingError('无法读取计费状态，请重试。'); } })
      .finally(() => { if (!cancelled) setBillingLoading(false); });
    return () => { cancelled = true; controller.abort(); };
  }, [active, billingRevision]);
  async function revoke(device: Device) { if (!window.confirm(`停用设备 ${device.deviceName}？`)) return; try { await del(`/api/v1/devices/${device.id}`); await load(); } catch { setAction('设备操作失败，请重试。'); } }
  async function cancel() { if (!window.confirm('确认在当前周期结束时取消订阅？')) return; try { await post('/api/v1/subscription/cancel', {}); setAction('已设置在当前周期结束时取消。'); await load(); } catch { setAction('取消失败，请重试。'); } }
  if (loading && !account) return <div className="app-shell"><div className="app-main"><div className="loading-skeleton"/><div className="loading-skeleton"/></div></div>;
  if (error || !account) return <div className="auth-wrap"><div className="auth-card"><h1>暂时无法加载</h1><p>{error || '请稍后重试。'}</p><button className="button" onClick={load}>重试</button></div></div>;
  const sub = account.subscription; const plan = account.plan;
  const title = items.find(i => i.id === active)?.label ?? '概览';
  return <AppShell title={title} description={active === 'overview' ? '账号、订阅与使用状态，一目了然。' : '管理你的 Copilot Bridge Cloud 服务。'} items={items} active={active} onChange={setActive} email={account.user.email} canAccessAdmin={account.user.role === 'ADMIN'}>
    {action && <div className="notice" role="status">{action}</div>}
    {(active === 'points' || active === 'referral' || active === 'connections') && <V2AccountPanel section={active} refreshKey={panelRevision}/>}
    {active === 'overview' && <>
      {billingLoading && <div role="status">AI 点数与结算状态加载中…</div>}
      {billingError && <div className="error-text" role="alert">{billingError} <button className="mini-button" onClick={() => setBillingRevision(value => value + 1)}>重试</button></div>}
      <div className="stat-grid">
        {billing && <><div className="stat"><span className="stat-label">AI 点数余额</span><strong>{billing.balance}</strong><small>以服务端钱包为准</small></div><div className="stat"><span className="stat-label">累计实际扣费点数</span><strong>{billing.pointsCharged}</strong><small>不含 SHADOW 测试测算</small></div><div className="stat"><span className="stat-label">已计量请求数</span><strong>{billing.requests}</strong><small>OFF 模式请求不计入此数</small></div></>}
        <div className="stat"><span className="stat-label">当前套餐</span><strong>{plan?.name ?? '待管理员开通'}</strong><small>{sub?.status ?? '测试占位不自动开通'}</small></div><div className="stat"><span className="stat-label">设备</span><strong>{account.devices.filter(d => d.status === 'ACTIVE').length}</strong><small>最多 {plan?.maxDevices ?? 0} 台</small></div><div className="stat"><span className="stat-label">可用模型</span><strong>{models.length}</strong><small>按当前权限开放</small></div>
      </div>
      <div className="split"><section className="panel"><h2>结算说明</h2><p>实际扣费点数来自服务端已结算用量；SHADOW 仅测算、不扣费，OFF 模式不生成点数消费记录。详情可在“AI 用量”和“AI 点数”查看。</p></section><section className="panel"><h2>{sub ? '快速开始' : '待管理员开通'}</h2><p>{sub ? '安装 Desktop 并登录账号。设备激活后，即可选择你有权限使用的在线模型。' : '新账号可先在网页登录查看说明；测试占位不是支付，待管理员手工开通后才能首次绑定 Desktop 设备。'}</p><Link className="button button-small" href={sub ? '/download' : '/pricing'}>{sub ? '下载 Desktop' : '查看测试开通说明'} <ArrowUpRight size={15}/></Link></section></div>
    </>}
    {active === 'subscription' && <><section className="panel"><h2>当前订阅</h2>{sub && plan ? <><div className="stat-grid"><div className="stat"><span className="stat-label">套餐</span><strong>{plan.name}</strong></div><div className="stat"><span className="stat-label">状态</span><strong>{sub.status}</strong></div><div className="stat"><span className="stat-label">周期结束</span><strong style={{fontSize:18}}>{new Date(sub.currentPeriodEnd).toLocaleDateString('zh-CN')}</strong></div><div className="stat"><span className="stat-label">月费</span><strong>¥{Number(plan.monthlyPrice)}</strong></div></div><p>{sub.cancelAtPeriodEnd ? '已安排在当前周期结束时取消。' : '订阅当前有效。'}</p>{!sub.cancelAtPeriodEnd && <button className="mini-button" onClick={cancel}>周期结束时取消</button>}</> : <div className="empty"><strong>待管理员开通</strong>当前没有可用于首次绑定 Desktop 的订阅；请先了解测试流程并联系管理员。<br/><Link className="button button-small" href="/pricing" style={{marginTop:18}}>查看开通说明</Link></div>}</section>{!sub && <TestActivationQr/>}</>}
    {active === 'usage' && <>
      {billingLoading && <div role="status">AI 用量结算状态加载中…</div>}
      {billingError && <div className="error-text" role="alert">{billingError} <button className="mini-button" onClick={() => setBillingRevision(value => value + 1)}>重试</button></div>}
      {billing && <div className="stat-grid"><div className="stat"><span className="stat-label">AI 点数余额</span><strong>{billing.balance}</strong></div><div className="stat"><span className="stat-label">已计量请求数</span><strong>{billing.requests}</strong><small>OFF 模式请求不计入此数</small></div><div className="stat"><span className="stat-label">累计实际扣费点数</span><strong>{billing.pointsCharged}</strong><small>SHADOW 测算不计入扣费</small></div></div>}
      <p>下方仅显示实际扣费点数流水；SHADOW 测算与 OFF 请求均不代表实际扣费。</p>
      <V2AccountPanel section="points" usageOnly refreshKey={panelRevision}/>
    </>}
    {active === 'devices' && <section className="panel"><h2>我的设备</h2>{account.devices.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>设备</th><th>平台</th><th>状态</th><th>上次活动</th><th></th></tr></thead><tbody>{account.devices.map(device => <tr key={device.id}><td>{device.deviceName}</td><td>{device.platform}</td><td><span className={`badge ${device.status === 'ACTIVE' ? '' : 'muted'}`}>{device.status}</span></td><td>{device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString('zh-CN') : '—'}</td><td>{device.status === 'ACTIVE' && <button className="mini-button danger" onClick={() => revoke(device)}>下线</button>}</td></tr>)}</tbody></table></div> : <div className="empty"><HardDrive size={27}/><strong>还没有设备</strong>登录 Copilot Bridge Desktop 后，设备会出现在这里。<br/><Link href="/download" className="button button-small" style={{marginTop:18}}>下载 Copilot Bridge</Link></div>}</section>}
    {active === 'models' && <section className="panel"><h2>可用模型</h2>{models.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>模型</th><th>ID</th><th>能力</th></tr></thead><tbody>{models.map(model => <tr key={model.id}><td>{model.displayName}</td><td><code>{model.publicId}</code></td><td>{[model.supportsTools && 'Tools',model.supportsVision && 'Vision',model.supportsReasoning && 'Reasoning'].filter(Boolean).join(' · ') || 'Text'}</td></tr>)}</tbody></table></div> : <div className="empty"><Layers3 size={27}/><strong>暂无可用模型</strong>模型开放后会显示在这里。</div>}</section>}
    {active === 'download' && <section className="panel"><h2>Copilot Bridge Desktop</h2>{release ? <><p>Windows 版本 {release.version} · {release.arch}</p><a className="button button-small" href={release.downloadUrl}>下载</a><p>SHA256: <code>{release.sha256}</code></p></> : <div className="empty"><strong>尚未发布安装包</strong>发布后会在这里提供下载。</div>}</section>}
    {active === 'account' && <section className="panel"><h2>账号信息</h2><p>邮箱：{account.user.email}</p><p>角色：{account.user.role}</p><p>状态：{account.user.status}</p><p>如需重置密码，请联系管理员。</p></section>}
  </AppShell>;
}
