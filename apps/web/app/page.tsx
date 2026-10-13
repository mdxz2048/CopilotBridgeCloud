import Link from 'next/link';
import { ArrowRight, Check, Globe2, Laptop2, Layers3, Sparkles } from 'lucide-react';
import { SiteHeader } from '../components/site-header';
import { QuickStart } from '../components/quick-start';
import styles from './marketing.module.css';

export default function Home() {
  return <><SiteHeader /><main>
    <section className={`container ${styles.hero}`}>
      <div><span className="eyebrow">CHATGPT DESKTOP × COPILOT BRIDGE</span><h1>原生 ChatGPT 体验，<br/><em>模型由你选择。</em></h1><p className={styles.lede}>在官方 ChatGPT 客户端里，使用已开通的国产或 GPT 模型。通过 Bridge 连接 Cloud，无需自行配置网络代理。</p><div className={styles.actions}><Link href="/download" className="button">下载 Bridge <ArrowRight size={18}/></Link><Link href="#how-it-works" className="button-quiet">三步开始使用 <ArrowRight size={16}/></Link></div><p className={styles.caption}>Windows 桌面版 · 使用已分配的账号登录</p></div>
      <div className={styles.preview} aria-label="产品流程示意，非官方客户端截图">
        <div className={styles.previewBar}><span className={styles.dots}>● ● ●</span><span>你的桌面工作空间</span><Laptop2 size={16}/></div>
        <div className={styles.workspace}><span className="eyebrow">CHATGPT</span><h2>从一个想法，<br/>到一项完成的任务。</h2><p className={styles.prompt}>帮我写一个网页，展示可以调节的抛物线。</p><div className={styles.task}><Check size={16}/><span>聊天、写代码、处理本地任务</span></div></div>
        <div className={styles.bridgePanel}><div className={styles.bridgeTitle}><span><Layers3 size={18}/> Copilot Bridge</span><span className={styles.cloud}>Cloud 已开启</span></div><div className={styles.modelRow}><span>模型选择</span><strong>账号已开通的模型 <Sparkles size={15}/></strong></div><p>在 Bridge 里选择，在 ChatGPT 里使用。</p></div>
        <p className={styles.previewNote}>原创流程示意 · 实际可用模型以账号目录为准</p>
      </div>
    </section>
    <section className={`container ${styles.benefits}`} aria-label="产品特点">
      {[{icon:Laptop2,title:'原生客户端',text:'继续在熟悉的 ChatGPT 客户端里聊天、写代码和处理本地任务。'},{icon:Globe2,title:'网络无需代理',text:'Bridge 帮你连接 Cloud，不必自行配置网络代理或运行命令行。'},{icon:Sparkles,title:'模型自由选择',text:'在 Bridge 中选择账号已授权的模型，模型目录会自动同步。'}].map(({icon:Icon,title,text})=><article key={title}><Icon size={23}/><h2>{title}</h2><p>{text}</p></article>)}
    </section>
    <section id="how-it-works" className={`container ${styles.section}`}><span className="eyebrow">GET STARTED</span><h2>三步，开始你的第一项任务。</h2><QuickStart/></section>
    <section className={styles.modelSection}><div className={`container ${styles.modelInner}`}><div><span className="eyebrow">YOUR MODEL, YOUR CHOICE</span><h2>国产模型与 GPT，<br/>一处选择。</h2><p>可用模型以账号权限和 Bridge 实时目录为准。更换模型后，新开会话开始下一项任务。</p></div><div className={styles.modelCards}><article><span>国产模型</span><h3>DeepSeek</h3><p>选择账号已开通的模型与思考方式。</p></article><article><span>GPT 模型</span><h3>GPT</h3><p>选择账号已开通的 GPT 模型，目录由服务器实时同步。</p></article></div></div></section>
    <section className={`container ${styles.section}`}><span className="eyebrow">GOOD TO KNOW</span><h2>开始前，你可能想知道。</h2><div className={styles.faq}>
      <details><summary>怎么回到自己的 ChatGPT 账号？</summary><p>关闭 Bridge 的 Cloud 开关，再按提示重新打开 ChatGPT，即可回到原账号使用。</p></details>
      <details><summary>使用期间要一直开着 Bridge 吗？</summary><p>需要。使用 Cloud 时保持 Bridge 运行；切换成功后按提示重新打开 ChatGPT。</p></details>
      <details><summary>账号和余额在哪里查看？</summary><p>在 Bridge 或网站用户中心查看。余额、模型权限和设备状态会在 Bridge 中自动同步；需要调整时联系管理员。</p></details>
    </div></section>
    <section className={`container ${styles.cta}`}><div><h2>下一项任务，从这里开始。</h2><p>下载 Bridge，登录账号，开启 Cloud。</p></div><Link href="/download" className="button">下载 Windows 版 <ArrowRight size={18}/></Link></section>
  </main><footer className="footer container"><div className="brand"><span className="brand-mark"><Layers3 size={17}/></span> Copilot Bridge</div><div><Link href="/pricing">套餐与余额</Link><Link href="/download">下载</Link><Link href="/dashboard">用户中心</Link></div><small>© {new Date().getFullYear()} Copilot Bridge · 非 ChatGPT 官方产品</small></footer></>;
}
