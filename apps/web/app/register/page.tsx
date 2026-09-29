'use client';
import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { SiteHeader } from '../../components/site-header';
import { post } from '../../lib/api';

export default function Register() {
  const router = useRouter();
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [referralCode, setReferralCode] = useState('');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { setReferralCode(new URLSearchParams(window.location.search).get('ref')?.trim() ?? ''); }, []);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await post('/api/v1/auth/register', { email, password, ...(referralCode.trim() ? { referralCode: referralCode.trim() } : {}) });
      router.push('/login');
    }
    catch (e) { setError((e as { message?: string }).message ?? '注册失败，请稍后重试。'); }
    finally { setBusy(false); }
  }
  return <><SiteHeader/><main className="auth-wrap"><form className="auth-card" onSubmit={submit}><span className="eyebrow">GET STARTED</span><h1>创建你的账号</h1><p>注册后请在网页登录查看账号；待管理员手工开通后才能绑定 Desktop 设备。测试占位不代表付款或实际扣费。</p><div className="field"><label htmlFor="email">邮箱</label><input id="email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)}/></div><div className="field"><label htmlFor="password">密码（至少 12 位）</label><input id="password" type="password" autoComplete="new-password" minLength={12} required value={password} onChange={e => setPassword(e.target.value)}/></div><div className="field"><label htmlFor="referralCode">邀请码（可选）</label><input id="referralCode" value={referralCode} onChange={e => setReferralCode(e.target.value)} autoComplete="off" placeholder="可由分享链接预填，也可手动输入"/></div><p>邀请码在注册时绑定；注册不赠送点数。仅在符合已核实的付款资格、奖励规则和风控审核后才可能入账；测试占位二维码不会触发奖励。</p>{error && <div className="error-text" role="alert">{error}</div>}<button className="button" disabled={busy}>{busy ? '创建中…' : '创建账号'}</button><div className="auth-switch">已有账号？ <Link href="/login">登录</Link></div></form></main></>;
}
