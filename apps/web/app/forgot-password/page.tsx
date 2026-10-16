'use client';
import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { SiteHeader } from '../../components/site-header';
import { Turnstile } from '../../components/turnstile';
import { useRegistrationConfig } from '../../components/registration-config';
import { post } from '../../lib/api';

export default function ForgotPassword(){
  const {capabilities,loading,unavailable}=useRegistrationConfig();
  const [email,setEmail]=useState(''),[token,setToken]=useState(''),[key,setKey]=useState(0),[busy,setBusy]=useState(false),[sent,setSent]=useState(false),[error,setError]=useState(''),[cooldown,setCooldown]=useState(0);
  useEffect(()=>{if(!cooldown)return;const id=setTimeout(()=>setCooldown(c=>Math.max(0,c-1)),1000);return()=>clearTimeout(id);},[cooldown]);
  async function submit(e:FormEvent){
    e.preventDefault();if(busy||cooldown||loading||unavailable)return;setBusy(true);setError('');setSent(false);
    try{await post('/api/v1/auth/forgot-password',{email,...(capabilities?.verificationRequired?{turnstileToken:token}:{})});setSent(true);setCooldown(60);}
    catch(reason){const code=(reason as {code?:string}).code;setError(code==='RATE_LIMITED'?'发送过于频繁，请稍后再试。':code==='TURNSTILE_INVALID'?'请重新完成人机验证。':code==='EMAIL_DELIVERY_UNAVAILABLE'?'邮件暂时无法发送，请稍后重试或联系管理员。':'暂时无法发送，请稍后重试。');}
    finally{setBusy(false);setToken('');setKey(k=>k+1);}
  }
  return <><SiteHeader/><main className="auth-wrap"><section className="auth-card"><span className="eyebrow">账号恢复</span><h1>忘记密码</h1><p>填写注册邮箱，我们会发送重置密码的链接。</p><form onSubmit={submit}><div className="field"><label htmlFor="recovery-email">注册邮箱</label><input id="recovery-email" type="email" autoComplete="email" required maxLength={320} value={email} disabled={busy} onChange={e=>{setEmail(e.target.value);setSent(false);}}/></div>
  {loading?<p role="status">正在检查验证方式…</p>:unavailable?<p role="alert">验证服务暂不可用，请稍后重试。</p>:capabilities?.verificationRequired&&<Turnstile key={key} siteKey={capabilities.turnstileSiteKey!} action="password_reset" onToken={setToken} resetKey={key}/>}
  {sent&&<p className="notice" role="status">如果该邮箱已注册且账号可用，你将收到一封中文恢复邮件。请检查收件箱及垃圾邮件，链接在 30 分钟内有效。</p>}{error&&<p className="error-text" role="alert">{error}</p>}
  <button className="button" disabled={busy||cooldown>0||loading||unavailable||Boolean(capabilities?.verificationRequired&&!token)}>{busy?'正在发送…':cooldown?`${cooldown} 秒后可重新发送`:'发送恢复邮件'}</button></form><div className="auth-switch"><Link href="/login">返回登录</Link></div></section></main></>;
}
