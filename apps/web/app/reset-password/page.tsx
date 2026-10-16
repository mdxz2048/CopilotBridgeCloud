'use client';
import { useEffect,useState } from 'react';
import Link from 'next/link';
import { SiteHeader } from '../../components/site-header';
import { PasswordForm } from '../../components/password-form';
export default function ResetPassword(){
  const [token,setToken]=useState<string|null>(null);
  useEffect(()=>{const value=new URLSearchParams(window.location.hash.slice(1)).get('token')??'';setToken(current=>current??value);window.history.replaceState(null,'','/reset-password');},[]);
  return <><SiteHeader/><main className="auth-wrap"><section className="auth-card"><span className="eyebrow">账号恢复</span><h1>设置新密码</h1>{token===null?<p role="status">正在读取重置链接…</p>:!/^[A-Za-z0-9_-]{43}$/.test(token)?<><p role="alert">重置链接不完整，请重新申请恢复邮件。</p><Link className="button" href="/forgot-password">重新申请</Link></>:<PasswordForm token={token}/>}</section></main></>;
}
