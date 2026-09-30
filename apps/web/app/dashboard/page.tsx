'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AppShell, type NavItem } from '../../components/app-shell';
import { api, del, type Account, type Device } from '../../lib/api';

const items: NavItem[] = [{ id: 'overview', label: '我的账号', icon: 'Home' }];
type Overview = {
  account: Account;
  balance: number;
  referral: { code: string; registered: number };
};

export default function Dashboard() {
  const router = useRouter();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const away = useRef(false);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setOverview(null);
    setError('');
    try {
      const { user } = await api<{ user: { role: string } }>('/api/v1/auth/me', { signal });
      if (signal?.aborted) return;
      if (user.role === 'ADMIN') { router.replace('/admin'); return; }
      const [account, wallet, referral] = await Promise.all([
        api<Account>('/api/v1/account', { signal }),
        api<{ balance: number }>('/api/v1/me/wallet', { signal }),
        api<{ code: string; registered: number }>('/api/v1/referral/stats', { signal }),
      ]);
      if (!signal?.aborted) setOverview({ account, balance: wallet.balance, referral });
    } catch (reason) {
      if (signal?.aborted) return;
      const authError = reason as { status?: number; code?: string };
      if (authError.status === 401 || authError.code === 'TOKEN_EXPIRED') router.replace('/login');
      else setError('账号状态暂时无法读取，请重试。');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [router]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  useEffect(() => {
    const loggedOut = () => setOverview(null);
    window.addEventListener('bridge:logout', loggedOut);
    return () => window.removeEventListener('bridge:logout', loggedOut);
  }, []);
  useEffect(() => {
    const onBlur = () => { away.current = true; };
    const onReturn = () => {
      if (away.current && !document.hidden) { away.current = false; void load(); }
    };
    const onVisibility = () => { if (document.hidden) away.current = true; else onReturn(); };
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onReturn);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [load]);

  async function revoke(device: Device) {
    if (!window.confirm(`停用设备 ${device.deviceName}？`)) return;
    setMessage('');
    try {
      await del(`/api/v1/devices/${device.id}`);
      await load();
      setMessage('设备已停用。');
    } catch {
      setMessage('设备操作失败，请重试。');
    }
  }

  if (loading && !overview) return <div className="auth-wrap" role="status">正在读取账号状态…</div>;
  if (!overview) return <div className="auth-wrap"><div className="auth-card"><h1>暂时无法加载</h1><p role="alert">{error}</p><button className="button" onClick={() => void load()}>重试</button></div></div>;
  const { account, balance, referral } = overview;
  const activeDevices = account.devices.filter(device => device.status === 'ACTIVE');
  return <AppShell title="我的账号" description="这里只显示你自己的账号和设备信息。" items={items} active="overview" onChange={() => {}} email={account.user.email}>
    {error && <p className="error-text" role="alert">{error} <button className="mini-button" onClick={() => void load()}>重试</button></p>}
    {message && <p className="notice" role="status">{message}</p>}
    <div className="stat-grid">
      <div className="stat"><span className="stat-label">账号状态</span><strong>{account.user.status === 'ACTIVE' ? account.subscription ? '已开通' : '待开通' : '不可用'}</strong><small>{account.user.email}</small></div>
      <div className="stat"><span className="stat-label">已邀请人数</span><strong>{referral.registered}</strong><small>注册不代表奖励已入账</small></div>
      <div className="stat"><span className="stat-label">剩余 AI 点数</span><strong>{balance}</strong><small>以服务端钱包为准；测试测算不扣点</small></div>
      <div className="stat"><span className="stat-label">已绑定设备</span><strong>{activeDevices.length}</strong><small>{account.plan ? `当前上限 ${account.plan.maxDevices} 台` : '待开通后可绑定'}</small></div>
    </div>
    <section className="panel"><h2>下载客户端</h2><p>在 Windows 客户端登录后，已绑定设备会显示在这里。尚未发布安装包时，下载页会明确提示。</p><Link className="button button-small" href="/download">前往下载页面</Link></section>
    <section className="panel"><h2>我的邀请</h2><p>邀请码：<code>{referral.code}</code>。只有符合规则的邀请才可能获得点数；目前没有在线支付或自动奖励承诺。</p><Link className="mini-button" href={`/register?ref=${encodeURIComponent(referral.code)}`}>打开邀请注册链接</Link></section>
    <section className="panel"><h2>我的设备</h2>{account.devices.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>设备</th><th>状态</th><th>上次活动</th><th>操作</th></tr></thead><tbody>{account.devices.map(device => <tr key={device.id}><td>{device.deviceName}</td><td>{device.status}</td><td>{device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString('zh-CN') : '—'}</td><td>{device.status === 'ACTIVE' && <button className="mini-button danger" onClick={() => void revoke(device)}>停用</button>}</td></tr>)}</tbody></table></div> : <p>还没有绑定设备。</p>}</section>
  </AppShell>;
}
