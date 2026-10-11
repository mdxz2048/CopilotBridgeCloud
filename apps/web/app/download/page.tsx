'use client';
import { useEffect, useState } from 'react';
import { ArrowDownToLine, Laptop2, ShieldCheck } from 'lucide-react';
import { SiteHeader } from '../../components/site-header';
import { api, type Release } from '../../lib/api';
type OfficialClient = {version:string;arch:string;size:number;sha256:string;downloadUrl:string};

export default function Download() {
  const [release, setRelease] = useState<Release | null>(null);
  const [loading, setLoading] = useState(true);
  const [official, setOfficial] = useState<OfficialClient|null>(null);
  const [officialLoading,setOfficialLoading] = useState(true);
  const [officialError,setOfficialError] = useState('');
  async function loadOfficial() {
    setOfficialLoading(true);setOfficialError('');
    try {setOfficial(await api<OfficialClient>('/api/v1/official-client/windows'));}
    catch {setOfficialError('暂时无法读取官方客户端安装包，请稍后重试。');}
    finally {setOfficialLoading(false);}
  }
  useEffect(()=>{void loadOfficial();},[]);
  useEffect(() => { api<{ release: Release | null }>('/api/v1/releases/latest').then(r => setRelease(r.release)).catch(() => {}).finally(() => setLoading(false)); }, []);
  return <><SiteHeader/><main className="container"><div className="page-hero"><span className="eyebrow">DESKTOP APP</span><h1>把 Agent 带到你的工作台。</h1><p>先安装官方 ChatGPT，再安装 Copilot Bridge。登录平台账号后，即可连接已授权模型；Cloud 仅接受最新版 Bridge。</p></div><div className="download-panel"><div><Laptop2 size={28} color="var(--brand)"/><h2 style={{marginTop:15}}>Copilot Bridge · Windows</h2><p>{loading ? '正在检查最新版本…' : release ? `版本 ${release.version} · ${release.channel} · ${release.arch}` : '网站暂未发布可下载的安装包；请勿使用旧版安装包连接 Cloud。'}</p>{release && <p>SHA256: <code style={{wordBreak:'break-all'}}>{release.sha256}</code></p>}</div>{release && <a className="button" href={release.downloadUrl} rel="noopener noreferrer">下载 Bridge <ArrowDownToLine size={17}/></a>}</div>
    <section id="chatgpt" className="download-panel" aria-label="官方 ChatGPT 离线安装"><div><Laptop2 size={28} color="var(--brand)"/><h2 style={{marginTop:15}}>官方 ChatGPT · 备用安装</h2><p>微软商店或自动安装失败时，下载此完整离线安装包。</p>
      {officialLoading?<p role="status">正在读取安装包…</p>:officialError?<p role="alert">{officialError} <button type="button" className="mini-button" onClick={()=>void loadOfficial()}>重试</button></p>:official&&<><p>版本 {official.version} · {official.arch} · {(official.size/1048576).toFixed(0)} MB</p><ol><li>下载 ZIP，并将全部文件解压到同一个文件夹。</li><li>双击 Install-ChatGPT.cmd，允许 Windows 的管理员确认。</li><li>安装完成后回到 Bridge，再开启模型连接。</li></ol><p>包含 OpenAI 原始签名 MSIX、离线许可证和安装脚本。<a href="https://learn.chatgpt.com/docs/enterprise/windows-deployment" target="_blank" rel="noopener noreferrer">官方安装说明</a></p><p>SHA256: <code style={{wordBreak:'break-all'}}>{official.sha256}</code></p></>}
    </div>{official&&!officialLoading&&!officialError&&<a className="button" href={official.downloadUrl}>下载官方安装包 <ArrowDownToLine size={17}/></a>}</section>
    <div className="notice" style={{marginBottom:90,display:'flex',gap:12,alignItems:'center'}}><ShieldCheck size={20}/> 本地文件读取和工具执行发生在官方客户端；选用 Cloud 时，模型所需上下文会经 Gateway 传递给相应 Provider。</div></main></>;
}
