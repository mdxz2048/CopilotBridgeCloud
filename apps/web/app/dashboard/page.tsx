'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AppShell, type NavItem } from '../../components/app-shell';
import { AccountDialog, TopupDialog } from '../../components/account-dialogs';
import { UserBills } from '../../components/user-bills';
import './account.css';
import { api, del, post, type Account, type Device } from '../../lib/api';

const items: NavItem[] = [{ id: 'overview', label: '我的账号', icon: 'Home' }, { id: 'bills', label: '账单', icon: 'CreditCard' }];
type Overview = {
  account: Account;
  balance: number;
  regularBalance?:number;
  rewardBalance?:number;
  rewardExpiresAt?:string|null;
  rewardExpiringBalance?:number;
  referral: { code: string; registered: number };
};

export default function Dashboard() {
  const router = useRouter();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [active, setActive] = useState('overview');
  const [topup, setTopup] = useState(false), [clearConfirm, setClearConfirm] = useState(false);
  const [clearing, setClearing] = useState(false), [clearError, setClearError] = useState('');
  const [copying, setCopying] = useState(false);
  const [siteOrigin, setSiteOrigin] = useState('');
  const authExpired = useCallback(() => router.replace('/login'), [router]);
  useEffect(() => setSiteOrigin(window.location.origin), []);
  const away = useRef(false);
  const [revoking,setRevoking]=useState<string|null>(null);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError('');
    try {
      const { user } = await api<{ user: { role: string } }>('/api/v1/auth/me', { signal });
      if (signal?.aborted) return;
      if (user.role === 'ADMIN') { router.replace('/admin'); return; }
      const [account, wallet, referral] = await Promise.all([
        api<Account>('/api/v1/account', { signal }),
        api<{ balance: number;regularBalance?:number;rewardBalance?:number;rewardExpiresAt?:string|null;rewardExpiringBalance?:number }>('/api/v1/me/wallet', { signal }),
        api<{ code: string; registered: number }>('/api/v1/referral/stats', { signal }),
      ]);
      if (!signal?.aborted) setOverview({ account, balance: wallet.balance, regularBalance:wallet.regularBalance, rewardBalance:wallet.rewardBalance,rewardExpiresAt:wallet.rewardExpiresAt,rewardExpiringBalance:wallet.rewardExpiringBalance,referral });
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
    if (revoking||!window.confirm(`移除设备 ${device.deviceName}？该设备将退出登录，需要重新输入账号和密码。`)) return;
    setRevoking(device.id);
    setMessage('');
    try {
      await del(`/api/v1/devices/${device.id}`);
      setOverview(previous=>previous?{...previous,account:{...previous.account,devices:previous.account.devices.map(d=>d.id===device.id?{...d,status:'REVOKED'}:d)}}:previous);
      setMessage('设备已移除，该设备需要重新登录。');
    } catch {
      setMessage('设备操作失败，请重试。');
    } finally { setRevoking(null); }
  }

  async function clearDevices() {
    if (clearing) return;
    setClearing(true); setClearError('');
    try {
      await post('/api/v1/me/devices/revoke-all', { confirm: true });
      window.dispatchEvent(new Event('bridge:logout'));
      router.replace('/login');
    } catch (failure) {
      if ((failure as {status?:number}).status === 401) router.replace('/login');
      else setClearError('清空失败，设备列表未改变，请重试。');
    } finally { setClearing(false); }
  }
  async function copyInvite(text: string) {
    if (copying) return;
    setCopying(true); setMessage('');
    try { await navigator.clipboard.writeText(text); setMessage('邀请文案和链接已复制，可以粘贴分享。'); }
    catch { setMessage('复制失败，请选中下方邀请内容手动复制。'); }
    finally { setCopying(false); }
  }

  if (loading && !overview) return <div className="auth-wrap" role="status">正在读取账号状态…</div>;
  if (!overview) return <div className="auth-wrap"><div className="auth-card"><h1>暂时无法加载</h1><p role="alert">{error}</p><button className="button" onClick={() => void load()}>重试</button></div></div>;
  const { account, balance,regularBalance,rewardBalance,rewardExpiresAt,rewardExpiringBalance,referral } = overview;
  const activeDevices = account.devices.filter(device => device.status === 'ACTIVE');
  const invitationUrl = `${siteOrigin}/register?ref=${encodeURIComponent(referral.code)}`;
  const invitation = `原生 ChatGPT / Codex 体验，无需自行配置网络代理。\n自由选择账号已开通的国产或 GPT 模型，邀请你一起来体验。\n${invitationUrl}`;
  return <AppShell title={active === 'bills' ? '账单' : '我的账号'} description={active === 'bills' ? '查看余额变动，以及各台设备每次上线之间的消耗。' : '管理自己的余额、邀请和登录设备。'} items={items} active={active} onChange={id => { setMessage(''); setActive(id); }} email={account.user.email}>
    {error && <p className="error-text" role="alert">{error} <button className="mini-button" onClick={() => void load()}>重试</button></p>}
    {message && <p className="notice" role="status">{message}</p>}
    {active === 'bills' ? <UserBills onTopup={() => setTopup(true)} onAuthExpired={authExpired} /> : <>
    <div className="stat-grid">
      <div className="stat"><span className="stat-label">账号状态</span><strong>{account.user.status === 'ACTIVE' ? account.subscription ? '已开通' : '待开通' : '不可用'}</strong><small>{account.user.email}</small></div>
      <div className="stat"><span className="stat-label">已邀请人数</span><strong>{referral.registered}</strong><small>注册不代表奖励已入账</small></div>
      <div className="stat"><div className="account-card-heading"><span className="stat-label">人民币余额</span><button className="mini-button" onClick={() => setTopup(true)}>充值</button></div><strong>¥{(balance/10000).toFixed(4)}</strong><small>{regularBalance!=null&&rewardBalance!=null?`正常余额 ¥${(regularBalance/10000).toFixed(4)} · 奖励余额 ¥${(rewardBalance/10000).toFixed(4)}`:"以服务端钱包为准，调用后自动结算"}</small>{rewardExpiresAt&&<small>其中 ¥{((rewardExpiringBalance??0)/10000).toFixed(4)} 奖励于 {new Date(rewardExpiresAt).toLocaleString("zh-CN")} 到期</small>}</div>
      <div className="stat"><span className="stat-label">已绑定设备</span><strong>{activeDevices.length}</strong><small>{account.plan ? `当前上限 ${account.plan.maxDevices} 台` : '待开通后可绑定'}</small></div>
    </div>
    <section className="panel"><h2>下载客户端</h2><p>在 Windows 客户端登录后，已绑定设备会显示在这里。尚未发布安装包时，下载页会明确提示。</p><Link className="button button-small" href="/download">前往下载页面</Link></section>
    <section className="panel"><div className="account-section-heading"><h2>我的邀请</h2><button className="button button-small" disabled={!siteOrigin || copying} onClick={() => void copyInvite(invitation)}>{copying ? '正在复制…' : '复制邀请文案和链接'}</button></div>
      <p>邀请码：<code>{referral.code}</code> · 已邀请 {referral.registered} 人</p>
      <textarea className="account-invite-text" aria-label="邀请文案和链接" readOnly value={invitation} rows={4}/>
      <p>活动及奖励以邀请注册页面的当前规则为准。<Link className="text-link" href={`/register?ref=${encodeURIComponent(referral.code)}`}>打开邀请注册链接</Link></p>
    </section>
    <section className="panel"><div className="account-section-heading"><h2>我的设备</h2><button className="mini-button danger" disabled={revoking !== null} onClick={() => { setClearError(''); setClearConfirm(true); }}>清空全部登录设备</button></div>
      <p>设备名称与硬件设备号分别显示。移除后需重新登录；网页登录不占客户端设备名额。</p>
      {account.devices.length ? <div className="account-device-list">{account.devices.map(device => <div className="account-device-row" key={device.id}><div><strong>{device.deviceName}</strong><small>设备号：{device.deviceId}</small><small>{device.status === 'ACTIVE' ? '已登录' : device.status === 'BLOCKED' ? '已封禁' : '已移除'} · 上次活动 {device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '未记录'}</small></div>
        {device.status === 'ACTIVE' && <button className="mini-button danger" disabled={revoking !== null} onClick={() => void revoke(device)}>{revoking === device.id ? '正在移除…' : '移除设备'}</button>}
      </div>)}</div> : <p>还没有绑定设备。</p>}
    </section></>}
    {topup && <TopupDialog email={account.user.email} onClose={() => setTopup(false)}/>}
    {clearConfirm && <AccountDialog title="清空全部登录设备？" busy={clearing} onClose={() => { if (!clearing) setClearConfirm(false); }}>
      <p>所有客户端和网页（包括当前网页）都会退出，需要重新登录。</p>
      <p className="billing-explanation">账号、余额、账单及设备历史会保留。已封禁设备仍保持封禁。</p>
      {clearError && <p className="error-text" role="alert">{clearError}</p>}
      <div className="account-dialog-actions"><button className="mini-button" disabled={clearing} onClick={() => setClearConfirm(false)}>取消</button><button className="button button-small danger" disabled={clearing} onClick={() => void clearDevices()}>{clearing ? '正在清空…' : '确认清空并退出'}</button></div>
    </AccountDialog>}

  </AppShell>;
}
