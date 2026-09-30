'use client';
import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { SiteHeader } from '../../components/site-header';
import { Turnstile } from '../../components/turnstile';
import { useRegistrationConfig } from '../../components/registration-config';
import { useAuthRedirect } from '../../components/use-auth-redirect';
import { post } from '../../lib/api';

function registrationMessage(error: unknown) {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
  if (code === 'EMAIL_IN_USE') return '这个邮箱已经注册，请直接登录或换一个邮箱。';
  if (code === 'EMAIL_CODE_INVALID') return '验证码错误、已过期或已使用，请重新输入或获取新验证码。';
  if (code === 'EMAIL_DELIVERY_UNAVAILABLE') return '邮件暂时无法发送，请稍后重试。';
  if (code === 'TURNSTILE_INVALID') return '人机验证失败，请重新完成验证后再试。';
  if (code === 'TURNSTILE_UNAVAILABLE') return '人机验证服务暂不可用，请稍后重试。';
  if (code === 'INVALID_REFERRAL_CODE') return '邀请码无效，请核对；没有邀请码也可以留空注册。';
  if (code === 'RATE_LIMITED') return '操作太频繁，请稍后再试。';
  if (code === 'VALIDATION_ERROR') return '邮箱、密码、验证码或邀请码格式不正确，请检查后重试。';
  return '注册暂时未完成，请稍后重试；若持续出现，请联系管理员。';
}

export default function Register() {
  const router = useRouter();
  const { checking: checkingAuth, identityError } = useAuthRedirect();
  const { capabilities, loading, unavailable } = useRegistrationConfig();
  const staged = capabilities?.verificationRequired === true;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [sent, setSent] = useState(false);
  const [token, setToken] = useState('');
  const [widgetKey, setWidgetKey] = useState(0);
  const [retryAt, setRetryAt] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setReferralCode(new URLSearchParams(window.location.search).get('ref')?.trim() ?? ''); }, []);
  useEffect(() => {
    if (!retryAt) return;
    const tick = () => setSeconds(Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [retryAt]);

  async function sendCode() {
    if (busy || loading || unavailable || !staged || seconds > 0) return;
    if (!token) { setError('请先完成人机验证，再发送验证码。'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      await post('/api/v1/auth/email-code', { email: email.trim(), turnstileToken: token });
      setSent(true);
      setRetryAt(Date.now() + 60_000);
      setNotice('如该邮箱可注册，验证码已发送；已有账号可直接登录。');
    } catch (e) { setError(registrationMessage(e)); }
    finally { setBusy(false); setToken(''); setWidgetKey(key => key + 1); }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (loading || unavailable || busy) return;
    if (staged && !sent) { await sendCode(); return; }
    setBusy(true); setError('');
    try {
      await post('/api/v1/auth/register', {
        email: email.trim(), password,
        ...(staged ? { emailCode: emailCode.trim() } : {}),
        ...(referralCode.trim() ? { referralCode: referralCode.trim() } : {}),
      });
      router.push('/login');
    } catch (e) { setError(registrationMessage(e)); }
    finally { setBusy(false); }
  }

  if (checkingAuth) return <><SiteHeader/><main className="auth-wrap"><p role="status">正在检查登录状态…</p></main></>;
  return <><SiteHeader/><main className="auth-wrap"><form className="auth-card" onSubmit={submit}>
    <span className="eyebrow">GET STARTED</span><h1>创建你的账号</h1>
    <p>仅需邮箱和密码创建账号；邮箱用于登录与账号安全通知，不对其他用户公开。请保护邮箱和密码，不要将邮件验证码告诉任何人。{staged ? '注册时会发送验证码确认邮箱。' : !loading && !unavailable ? '当前未启用邮箱验证码，注册不代表邮箱已核验。' : ''}待管理员手工开通后才能绑定 Desktop 设备。</p>
    {identityError && <p className="auth-unavailable" role="alert">暂时无法确认登录状态；你仍可尝试注册，或稍后刷新重试。</p>}
    {loading ? <p role="status">正在检查注册方式…</p> : unavailable ? <p className="auth-unavailable" role="alert">注册验证暂不可用：邮件或人机验证可能尚未完成配置，或服务暂时无法连接。请稍后重试或联系管理员；不会跳过验证直接注册。</p> : <>
      {staged && <div className="auth-step" aria-live="polite">{sent ? '第 2 步：输入邮箱验证码并创建账号' : '第 1 步：验证邮箱'}</div>}
      <div className="field"><label htmlFor="email">邮箱</label><input id="email" type="email" autoComplete="email" required value={email} readOnly={sent} onChange={e => { setEmail(e.target.value); setError(''); }}/></div>
      {sent && <button type="button" className="mini-button" onClick={() => { setSent(false); setEmailCode(''); setRetryAt(0); setSeconds(0); setToken(''); setWidgetKey(key => key + 1); setError(''); setNotice(''); }}>更换邮箱</button>}
      <div className="field"><label htmlFor="password">密码（至少 12 位）</label><input id="password" type="password" autoComplete="new-password" minLength={12} maxLength={256} required value={password} onChange={e => { setPassword(e.target.value); setError(''); }}/></div>
      <div className="field"><label htmlFor="referralCode">邀请码（可选）</label><input id="referralCode" value={referralCode} onChange={e => { setReferralCode(e.target.value); setError(''); }} minLength={8} maxLength={24} autoComplete="off" placeholder="可由分享链接预填，也可手动输入"/></div>
      <p className="auth-note">邀请码在注册时绑定；注册不赠送点数。仅在符合已核实的付款资格、奖励规则和风控审核后才可能入账；测试占位二维码不会触发奖励。</p>
      {staged && sent && <div className="field"><label htmlFor="emailCode">邮箱验证码</label><input id="emailCode" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={emailCode} onChange={e => { setEmailCode(e.target.value); setError(''); }} placeholder="6 位验证码"/><span className="auth-note">验证码 10 分钟内有效。若未收到邮件，请检查垃圾邮件文件夹。</span></div>}
      {staged && <><Turnstile key={widgetKey} siteKey={capabilities!.turnstileSiteKey!} action="registration_email_code" onToken={setToken} resetKey={widgetKey}/>{sent && <div className="auth-resend"><button type="button" className="mini-button" disabled={busy || seconds > 0} onClick={sendCode}>重新发送验证码</button>{seconds > 0 && <span role="status">{seconds} 秒后可重发</span>}</div>}</>}
      {notice && <div className="auth-note" role="status">{notice}</div>}
      {error && <div className="error-text" role="alert">{error}</div>}
      <button className="button" disabled={busy}>{busy ? '请稍候…' : staged && !sent ? '发送验证码' : '创建账号'}</button>
    </>}
    <div className="auth-switch">已有账号？ <Link href="/login">登录</Link></div>
  </form></main></>;
}
