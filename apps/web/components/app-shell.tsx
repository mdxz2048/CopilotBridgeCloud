'use client';
import Link from 'next/link';
import { Activity, BadgeCheck, Boxes, CreditCard, Download, Gauge, HardDrive, Home, Layers3, LogOut, Package, Settings2, ShieldCheck, Users, ScrollText, Server, ShoppingBag } from 'lucide-react';
import { post } from '../lib/api';

const icons = { Home, BadgeCheck, Activity, HardDrive, Boxes, Download, Settings2, Users, Gauge, CreditCard, Package, ShieldCheck, ScrollText, Server, ShoppingBag };
export type NavItem = { id: string; label: string; icon: keyof typeof icons };
export function AppShell({ title, description, items, active, onChange, email, admin, children }: { title: string; description: string; items: NavItem[]; active: string; onChange: (id: string) => void; email: string; admin?: boolean; children: React.ReactNode }) {
  async function logout() { try { await post('/api/v1/auth/logout', {}); } catch {} window.location.href = '/login'; }
  return <div className="app-shell"><aside className="app-sidebar"><Link href="/" className="brand"><span className="brand-mark"><Layers3 size={17}/></span> Bridge Cloud</Link><nav className="app-nav" aria-label={admin ? '管理员导航' : '用户中心导航'}><span className="nav-label">{admin ? 'ADMIN CONSOLE' : 'WORKSPACE'}</span>{items.map(item => { const Icon = icons[item.icon]; return <button key={item.id} className={active === item.id ? 'active' : ''} onClick={() => onChange(item.id)} aria-current={active === item.id ? 'page' : undefined}><Icon size={16}/>{item.label}</button>; })}{admin ? <Link href="/dashboard"><Home size={16}/>用户中心</Link> : <Link href="/admin"><ShieldCheck size={16}/>管理后台</Link>}</nav><div className="app-sidebar-foot"><strong>{email}</strong><button className="mini-button" onClick={logout}><LogOut size={13}/> 退出登录</button></div></aside><main className="app-main"><div className="app-top"><span>Copilot Bridge / {admin ? 'Admin' : 'Account'}</span><span><span className="mini-status"/> 服务控制台</span></div><div className="app-heading"><span className="eyebrow">{admin ? 'ADMINISTRATION' : 'YOUR WORKSPACE'}</span><h1>{title}</h1><p>{description}</p></div>{children}</main></div>;
}
