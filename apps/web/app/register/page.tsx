'use client';
import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { SiteHeader } from '../../components/site-header';
import { post } from '../../lib/api';

export default function Register() {
  const router = useRouter();
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { await post('/api/v1/auth/register', { email, password }); router.push('/login'); }
    catch (e) { setError((e as { message?: string }).message ?? '注册失败，请稍后重试。'); }
    finally { setBusy(false); }
  }
  return <><SiteHeader/><main className="auth-wrap"><form className="auth-card" onSubmit={submit}><span className="eyebrow">GET STARTED</span><h1>创建你的账号</h1><p>注册后可查看套餐。订阅目前由管理员开通。</p><div className="field"><label htmlFor="email">邮箱</label><input id="email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)}/></div><div className="field"><label htmlFor="password">密码（至少 12 位）</label><input id="password" type="password" autoComplete="new-password" minLength={12} required value={password} onChange={e => setPassword(e.target.value)}/></div>{error && <div className="error-text" role="alert">{error}</div>}<button className="button" disabled={busy}>{busy ? '创建中…' : '创建账号'}</button><div className="auth-switch">已有账号？ <Link href="/login">登录</Link></div></form></main></>;
}
