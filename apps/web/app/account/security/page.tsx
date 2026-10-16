'use client';
import { useEffect,useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { SiteHeader } from '../../../components/site-header';
import { PasswordForm } from '../../../components/password-form';
import { api } from '../../../lib/api';
export default function Security(){
  const router=useRouter();const [user,setUser]=useState<{email:string;role:string}|null>(null),[error,setError]=useState('');
  useEffect(()=>{const c=new AbortController();void api<{user:{email:string;role:string}}>('/api/v1/auth/me',{signal:c.signal}).then(r=>setUser(r.user)).catch(e=>{if(c.signal.aborted)return;if(e.status===401)router.replace('/login');else setError('暂时无法读取账号，请刷新重试。');});return()=>c.abort();},[router]);
  return <><SiteHeader/><main className="auth-wrap"><section className="auth-card"><span className="eyebrow">账号安全</span><h1>修改密码</h1>{user?<><p>{user.email}</p><PasswordForm change/><div className="auth-switch"><Link href={user.role==='ADMIN'?'/admin':'/dashboard'}>返回账户</Link></div></>:<p role={error?'alert':'status'}>{error||'正在读取账号…'}</p>}</section></main></>;
}
