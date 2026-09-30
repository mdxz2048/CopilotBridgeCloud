'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Layers3 } from 'lucide-react';
import { api, type ApiError } from '../lib/api';

export function SiteHeader() {
  const [identity, setIdentity] = useState<{ email: string; role: string } | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let mounted = true;
    let request = 0;
    let controller: AbortController | undefined;
    function refresh() {
      controller?.abort();
      controller = new AbortController();
      const currentController = controller;
      const current = ++request;
      const timeout = window.setTimeout(() => currentController.abort(), 5000);
      api<{ user: { email: string; role: string } }>('/api/v1/auth/me', { signal: currentController.signal })
        .then(result => { if (mounted && current === request) setIdentity(result.user); })
        .catch((error: ApiError) => {
          if (mounted && current === request
            && (error.status === 401 || error.code === 'TOKEN_EXPIRED' || error.code === 'ACCOUNT_DISABLED')) setIdentity(null);
        })
        .finally(() => { window.clearTimeout(timeout); if (mounted && current === request) setLoading(false); });
    }
    function visible() { if (document.visibilityState === 'visible') refresh(); }
    function loggedOut() { ++request; controller?.abort(); setIdentity(null); setLoading(false); }
    refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('bridge:logout', loggedOut);
    return () => {
      mounted = false;
      controller?.abort();
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('bridge:logout', loggedOut);
    };
  }, []);
  return <header className="site-header"><div className="container header-inner">
    <Link href="/" className="brand"><span className="brand-mark"><Layers3 size={19} strokeWidth={2.2} /></span><span>Copilot Bridge <span className="brand-light">Cloud</span></span></Link>
    <nav aria-label="主导航"><Link href="/#how-it-works">产品</Link><Link href="/pricing">套餐</Link><Link href="/download">下载</Link></nav>
    <div className="header-actions" aria-live="polite">{loading ? <span className="header-auth-loading" role="status">正在检查登录状态…</span> : identity ? <>
      {identity.role === 'ADMIN' && <Link className="text-link header-admin" href="/admin">管理后台</Link>}
      <Link className="header-account" href="/dashboard" aria-label={`账号中心：${identity.email}`}><span className="header-avatar" aria-hidden="true">{identity.email.charAt(0).toUpperCase()}</span><span className="header-email">{identity.email}</span></Link>
    </> : <><Link className="text-link" href="/login">登录</Link><Link className="button button-small" href="/register">开始使用 <ArrowUpRight size={15}/></Link></>}</div>
  </div></header>;
}
