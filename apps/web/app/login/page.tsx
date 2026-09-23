'use client';
import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { SiteHeader } from '../../components/site-header';
import { post } from '../../lib/api';

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { await post('/api/v1/auth/login', { email, password }); router.push('/dashboard'); }
    catch (e) { setError((e as { message?: string }).message ?? '登录失败，请检查账号和密码。'); }
    finally { setBusy(false); }
  }
  return <><SiteHeader/><main className="auth-wrap"><form className="auth-card" onSubmit={submit}><span className="eyebrow">WELCOME BACK</span><h1>登录你的账号</h1><p>查看订阅、设备和本月 AI 用量。</p><div className="field"><label htmlFor="email">邮箱</label><input id="email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)}/></div><div className="field"><label htmlFor="password">密码</label><input id="password" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)}/></div>{error && <div className="error-text" role="alert">{error}</div>}<button className="button" disabled={busy}>{busy ? '登录中…' : '登录'}</button><div className="auth-switch">还没有账号？ <Link href="/register">创建账号</Link></div></form></main></>;
}
