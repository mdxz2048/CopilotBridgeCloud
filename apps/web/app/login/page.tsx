'use client';
import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { SiteHeader } from '../../components/site-header';
import { Turnstile } from '../../components/turnstile';
import { useRegistrationConfig } from '../../components/registration-config';
import { useAuthRedirect } from '../../components/use-auth-redirect';
import { post } from '../../lib/api';

export default function Login() {
  const router = useRouter();
  const { checking: checkingAuth, identityError } = useAuthRedirect();
  const { capabilities, loading, unavailable } = useRegistrationConfig();
  const [token, setToken] = useState('');
  const [widgetKey, setWidgetKey] = useState(0);
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (loading || unavailable || busy) return;
    if (capabilities?.verificationRequired && !token) { setError('请先完成人机验证后再登录。'); return; }
    setBusy(true); setError('');
    try {
      await post('/api/v1/auth/login', { email, password, ...(capabilities?.verificationRequired ? { turnstileToken: token } : {}) });
      router.push('/dashboard');
    }
    catch (e) {
      const code = (e as { code?: string }).code;
      setError(code === 'TURNSTILE_INVALID' ? '人机验证失败，请重新完成验证后再试。'
        : code === 'TURNSTILE_UNAVAILABLE' ? '人机验证服务暂不可用，请稍后重试。'
        : (e as { message?: string }).message ?? '登录失败，请检查账号和密码。');
      setToken(''); setWidgetKey(key => key + 1);
    }
    finally { setBusy(false); }
  }
  if (checkingAuth) return <><SiteHeader/><main className="auth-wrap"><p role="status">正在检查登录状态…</p></main></>;
  return <><SiteHeader/><main className="auth-wrap"><form className="auth-card" onSubmit={submit}><span className="eyebrow">WELCOME BACK</span><h1>登录你的账号</h1><p>查看订阅、设备和本月 AI 用量。</p>{identityError && <p className="auth-unavailable" role="alert">暂时无法确认登录状态；你仍可尝试登录，或稍后刷新重试。</p>}<div className="field"><label htmlFor="email">邮箱</label><input id="email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)}/></div><div className="field"><label htmlFor="password">密码</label><input id="password" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)}/></div>{loading ? <p role="status">正在检查登录方式…</p> : unavailable ? <p className="auth-unavailable" role="alert">登录验证暂不可用：人机验证可能尚未完成配置，或服务暂时无法连接。请稍后重试或联系管理员。</p> : capabilities?.verificationRequired && <Turnstile key={widgetKey} siteKey={capabilities.turnstileSiteKey!} action="web_login" onToken={setToken} resetKey={widgetKey}/>}
    {error && <div className="error-text" role="alert">{error}</div>}<button className="button" disabled={busy || loading || unavailable}>{busy ? '登录中…' : '登录'}</button><div className="auth-switch">还没有账号？ <Link href="/register">创建账号</Link></div></form></main></>;
}
