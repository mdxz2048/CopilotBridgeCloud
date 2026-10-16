'use client';
import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { Activity, BadgeCheck, Boxes, CreditCard, Download, Gauge, HardDrive, Home, Layers3, LogOut, Package, Settings2, ShieldCheck, Users, ScrollText, Server, ShoppingBag } from 'lucide-react';
import { post } from '../lib/api';

const icons = { Home, BadgeCheck, Activity, HardDrive, Boxes, Download, Settings2, Users, Gauge, CreditCard, Package, ShieldCheck, ScrollText, Server, ShoppingBag };
export type NavItem = { id: string; label: string; icon: keyof typeof icons };
export function AppShell({ title, description, items, active, onChange, email, admin, canAccessAdmin, children }: { title: string; description: string; items: NavItem[]; active: string; onChange: (id: string) => void; email: string; admin?: boolean; canAccessAdmin?: boolean; children: React.ReactNode }) {
  const main = useRef<HTMLElement>(null);
  useEffect(() => { main.current?.scrollTo({ top: 0 }); }, [active]);
  function canLeave() { return window.dispatchEvent(new Event('bridge:before-navigate', { cancelable: true })); }
  async function logout() { if (!canLeave()) return; window.dispatchEvent(new Event('bridge:logout')); try { await post('/api/v1/auth/logout', {}); } catch {} window.location.href = '/login'; }
  return <div className="app-shell"><aside className="app-sidebar"><Link href="/" className="brand" onClick={event => { if (!canLeave()) event.preventDefault(); }}><span className="brand-mark"><Layers3 size={17}/></span> Bridge Cloud</Link><nav className="app-nav" aria-label={admin ? '管理员导航' : '用户中心导航'}><span className="nav-label">{admin ? '管理后台' : '用户中心'}</span>{items.map(item => { const Icon = icons[item.icon]; return <button key={item.id} className={active === item.id ? 'active' : ''} onClick={() => { if (item.id !== active && canLeave()) onChange(item.id); }} aria-current={active === item.id ? 'page' : undefined}><Icon size={16}/>{item.label}</button>; })}{!admin && canAccessAdmin && <Link href="/admin" onClick={event => { if (!canLeave()) event.preventDefault(); }}><ShieldCheck size={16}/>管理后台</Link>}</nav><div className="app-sidebar-foot"><strong>{email}</strong><Link className="mini-button" href="/account/security" onClick={event=>{if(!canLeave())event.preventDefault();}}>修改密码</Link><button className="mini-button" onClick={logout}><LogOut size={13}/> 退出登录</button></div></aside><main ref={main} className="app-main" tabIndex={-1}><div className="app-top"><span>Copilot Bridge / {admin ? '管理后台' : '用户中心'}</span><span><span className="mini-status"/> 服务控制台</span></div><div className="app-heading"><span className="eyebrow">{admin ? '管理后台' : '用户中心'}</span><h1>{title}</h1><p>{description}</p></div>{children}</main></div>;
}
