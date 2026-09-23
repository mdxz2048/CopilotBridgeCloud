'use client';
import { useEffect, useState } from 'react';
import { ArrowDownToLine, Laptop2, ShieldCheck } from 'lucide-react';
import { SiteHeader } from '../../components/site-header';
import { api, type Release } from '../../lib/api';

export default function Download() {
  const [release, setRelease] = useState<Release | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { api<{ release: Release | null }>('/api/v1/releases/latest').then(r => setRelease(r.release)).catch(() => {}).finally(() => setLoading(false)); }, []);
  return <><SiteHeader/><main className="container"><div className="page-hero"><span className="eyebrow">DESKTOP APP</span><h1>把 Agent 带到你的工作台。</h1><p>Copilot Bridge Desktop 连接本地工具与云端模型。下载后登录你的账号，并激活这台设备。</p></div><div className="download-panel"><div><Laptop2 size={28} color="#517456"/><h2 style={{marginTop:15}}>Windows 版本</h2><p>{loading ? '正在检查最新版本…' : release ? `版本 ${release.version} · ${release.channel} · ${release.arch}` : '安装包尚未发布。请稍后再来。'}</p>{release && <p>SHA256: <code style={{wordBreak:'break-all'}}>{release.sha256}</code></p>}</div>{release && <a className="button" href={release.downloadUrl} rel="noopener noreferrer">下载 Desktop <ArrowDownToLine size={17}/></a>}</div><div className="notice" style={{marginBottom:90,display:'flex',gap:12,alignItems:'center'}}><ShieldCheck size={20}/> 本地文件读取和工具执行发生在 Desktop。发送给模型的上下文会经云端 Gateway 传递给相应 Provider。</div></main></>;
}
