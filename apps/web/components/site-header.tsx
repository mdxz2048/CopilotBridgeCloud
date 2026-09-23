import Link from 'next/link';
import { ArrowUpRight, Layers3 } from 'lucide-react';

export function SiteHeader() {
  return <header className="site-header"><div className="container header-inner">
    <Link href="/" className="brand"><span className="brand-mark"><Layers3 size={19} strokeWidth={2.2} /></span><span>Copilot Bridge <span className="brand-light">Cloud</span></span></Link>
    <nav aria-label="主导航"><Link href="/#how-it-works">产品</Link><Link href="/pricing">套餐</Link><Link href="/download">下载</Link></nav>
    <div className="header-actions"><Link className="text-link" href="/login">登录</Link><Link className="button button-small" href="/register">开始使用 <ArrowUpRight size={15}/></Link></div>
  </div></header>;
}
