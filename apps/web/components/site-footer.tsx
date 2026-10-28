import Link from 'next/link';
import { BridgeMark } from './bridge-mark';

export function SiteFooter() {
  return <footer className="site-footer container">
    <Link href="/" className="brand"><BridgeMark/>Copilot Bridge</Link>
    <nav aria-label="页脚导航"><Link href="/download">下载</Link><Link href="/guide">使用指南</Link><Link href="/faq">常见问题</Link><Link href="/pricing">套餐与余额</Link><Link href="/dashboard">用户中心</Link></nav>
    <small>© {new Date().getFullYear()} Copilot Bridge · 非 ChatGPT 官方产品</small>
  </footer>;
}
