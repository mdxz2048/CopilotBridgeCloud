'use client';
import { useEffect, useState } from 'react';
import { ArrowDownToLine, Laptop2, ShieldCheck } from 'lucide-react';
import { SiteHeader } from '../../components/site-header';
import { QuickStart } from '../../components/quick-start';
import { api, type Release } from '../../lib/api';
import styles from '../marketing.module.css';
type OfficialClient = {version:string;arch:string;size:number;sha256:string;downloadUrl:string};

export default function Download() {
  const [release, setRelease] = useState<Release | null>(null);
  const [loading, setLoading] = useState(true);
  const [releaseError,setReleaseError] = useState('');
  const [official, setOfficial] = useState<OfficialClient|null>(null);
  const [officialLoading,setOfficialLoading] = useState(true);
  const [officialError,setOfficialError] = useState('');
  async function loadRelease() {
    setLoading(true);setReleaseError('');
    try {const result=await api<{release:Release|null}>('/api/v1/releases/latest');setRelease(result.release);}
    catch {setReleaseError('暂时无法读取 Bridge 最新版本，请重试。');}
    finally {setLoading(false);}
  }
  async function loadOfficial() {
    setOfficialLoading(true);setOfficialError('');
    try {setOfficial(await api<OfficialClient>('/api/v1/official-client/windows'));}
    catch {setOfficialError('暂时无法读取官方客户端安装包，请稍后重试。');}
    finally {setOfficialLoading(false);}
  }
  useEffect(()=>{void loadOfficial();void loadRelease();},[]);
  return <><SiteHeader/><main className="container"><div className="page-hero"><span className="eyebrow">START WITH BRIDGE</span><h1>先下载 Bridge，<br/>再打开你的 ChatGPT。</h1><p>用分配给你的账号登录，跟随提示安装官方 ChatGPT 客户端。开启 Cloud 后，按提示重新打开 ChatGPT，即可使用已开通的模型。</p></div>
    <div className={`download-panel ${styles.downloadCard}`}><div><Laptop2 size={28} color="var(--brand)"/><h2 style={{marginTop:15}}>Copilot Bridge · Windows</h2>
      {loading?<p role="status">正在检查最新版本…</p>:releaseError?<p role="alert">{releaseError} <button type="button" className="mini-button" onClick={()=>void loadRelease()}>重试</button></p>:release?<><p>版本 {release.version} · {release.channel} · {release.arch}</p><details className={styles.checksum}><summary>查看 SHA256 校验信息</summary><code>{release.sha256}</code></details></>:<p>暂未发布可下载的安装包，请稍后再来。</p>}
    </div>{release&&!loading&&!releaseError&&<a className="button" href={release.downloadUrl} rel="noopener noreferrer">下载 Bridge <ArrowDownToLine size={17}/></a>}</div>
    <section className={styles.downloadSteps} aria-label="使用步骤"><h2>从下载到使用，只需三步。</h2><QuickStart/></section>
    <details id="chatgpt" className={styles.fallback}><summary>ChatGPT 安装遇到问题？下载备用安装包</summary><div className={styles.fallbackContent}><p>优先使用 Bridge 内的安装引导。微软商店或自动安装失败时，可使用完整离线安装包。</p>
      {officialLoading?<p role="status">正在读取安装包…</p>:officialError?<p role="alert">{officialError} <button type="button" className="mini-button" onClick={()=>void loadOfficial()}>重试</button></p>:official&&<><p>官方 ChatGPT · 版本 {official.version} · {official.arch} · {(official.size/1048576).toFixed(0)} MB</p><ol><li>下载 ZIP，并将全部文件解压到同一个文件夹。</li><li>双击 Install-ChatGPT.cmd，允许 Windows 的管理员确认。</li><li>安装完成后回到 Bridge，选择可用模型，开启 Cloud。</li></ol><p>包含 OpenAI 原始签名 MSIX、离线许可证和安装脚本。<a className="text-link" href="https://learn.chatgpt.com/docs/enterprise/windows-deployment" target="_blank" rel="noopener noreferrer">官方安装说明</a></p><a className="button" href={official.downloadUrl}>下载官方安装包 <ArrowDownToLine size={17}/></a><details className={styles.checksum}><summary>查看 SHA256 校验信息</summary><code>{official.sha256}</code></details></>}
    </div></details>
    <div className={`notice ${styles.privacy}`}><ShieldCheck size={20}/><span>本地文件和命令由 ChatGPT 客户端处理；使用 Cloud 时，任务所需的上下文会发送给对应模型服务。Copilot Bridge 非 ChatGPT 官方产品。</span></div></main></>;
}
