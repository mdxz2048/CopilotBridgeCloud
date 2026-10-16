'use client';
import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { post } from '../lib/api';

export function PasswordForm({ token, change = false }: { token?: string; change?: boolean }) {
  const [current,setCurrent]=useState(''),[password,setPassword]=useState(''),[confirm,setConfirm]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[done,setDone]=useState(false);
  async function submit(event:FormEvent){
    event.preventDefault();if(busy)return;setError('');
    if(password!==confirm){setError('两次输入的新密码不一致。');return;}
    setBusy(true);
    try{
      await post(change?'/api/v1/auth/change-password':'/api/v1/auth/reset-password',change?{currentPassword:current,password}:{token,password});
      setCurrent('');setPassword('');setConfirm('');setDone(true);
      window.dispatchEvent(new Event('bridge:logout'));
    }catch(e){const code=(e as {code?:string}).code;setError(code==='CURRENT_PASSWORD_INVALID'?'当前密码不正确，请重新输入。':code==='PASSWORD_UNCHANGED'?'新密码需要与当前密码不同。':code==='PASSWORD_RESET_INVALID'?'重置链接已失效或已被使用，请重新申请。':code==='RATE_LIMITED'?'操作过于频繁，请稍后再试。':code==='UNAUTHORIZED'?'登录已失效，请重新登录。':'密码暂时未能更新，请稍后重试。');}
    finally{setBusy(false);}
  }
  if(done)return <div role="status"><p className="notice">密码已更新，所有设备需要使用新密码重新登录。</p><Link className="button" href="/login">重新登录</Link></div>;
  return <form onSubmit={submit}>
    {change&&<div className="field"><label htmlFor="current-password">当前密码</label><input id="current-password" type="password" autoComplete="current-password" required maxLength={128} value={current} disabled={busy} onChange={e=>setCurrent(e.target.value)}/></div>}
    <div className="field"><label htmlFor="new-password">新密码</label><input id="new-password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={password} disabled={busy} onChange={e=>setPassword(e.target.value)}/><small>12～128 位，建议包含大小写字母、数字和符号。</small></div>
    <div className="field"><label htmlFor="confirm-password">确认新密码</label><input id="confirm-password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={confirm} disabled={busy} onChange={e=>setConfirm(e.target.value)}/></div>
    <p>保存后，网页和 App 上的旧登录会话将失效，需要重新登录。</p>
    {error&&<p className="error-text" role="alert">{error}</p>}
    <button className="button" disabled={busy}>{busy?'正在保存…':'保存新密码'}</button>
  </form>;
}
