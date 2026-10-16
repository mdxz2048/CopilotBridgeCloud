import type { Metadata } from 'next';
import { SiteHeader } from '../components/site-header';
import { ScreenshotCarousel } from '../components/screenshot-carousel';
import './homepage.css';

export const metadata: Metadata = {
  title: '一句话，把想法变成成果',
  description: '使用 ChatGPT / Codex 官方客户端，连接已开通的 DeepSeek 或 GPT-6。写工具、读资料、出试卷，在熟悉的对话里把想法变成成果。',
};

export default function Home() {
  return <div className="homepage" id="top">
<SiteHeader />
<main>
<section className="hero wrap">
<div>
<span className="eyebrow">CHATGPT / CODEX × COPILOT BRIDGE</span>
<h1>一句话，<br />把想法变成<em>成果。</em>
</h1>
<p className="hero-lede">使用最新版 ChatGPT / Codex 官方客户端，连接已开通的 DeepSeek 或 GPT-6。写工具、读资料、出试卷，在熟悉的对话里，把想法变成可用的成果。</p>
<div className="hero-actions">
<a className="btn" href="/download">下载 Bridge <span className="arrow">↗</span>
</a>
<a className="text-link" href="#examples">看看它能做什么 <span className="arrow">↓</span>
</a>
</div>
<p className="hero-note">
<span className="green-dot">
</span>Windows 桌面版 · 模型以账号实际开通为准</p>
</div>
<div className="hero-art">
<div className="mini-app">
<div className="window-bar">
<i>
</i>
<i>
</i>
<i>
</i>
<span className="window-name">ChatGPT</span>
</div>
<div className="mini-app-body">
<aside className="mini-rail">
<div className="rail-logo">◉   ChatGPT</div>
<div className="rail-new">＋   新建聊天</div>
<p className="active">一个实用的小工具</p>
<p>整理我的阅读资料</p>
<p>准备一份数学试卷</p>
</aside>
<div className="mini-chat">
<div className="chat-brand">ChatGPT <span className="chevron">⌄</span>
</div>
<div className="mini-center">
<div className="sparkle-mark">✳</div>
<h3>今天想完成什么？</h3>
</div>
<div className="mini-composer">帮我把这个想法，做成能用的东西。<div className="composer-tools">
<span>＋</span>
<div className="send-circle">↑</div>
</div>
</div>
<div className="sample-chips">
<span>写一个小工具</span>
<span>整理阅读摘要</span>
<span>排版一份试卷</span>
</div>
</div>
</div>
</div>
<div className="bridge-status">
<span className="brand-icon">
<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
<path d="m3 8 9-5 9 5-9 5-9-5Zm0 4 9 5 9-5M3 16l9 5 9-5" />
</svg>
</span>
<strong>Copilot Bridge</strong>
<span className="status-fill">
<span className="green-dot">
</span>Cloud 已连接</span>
</div>
<p className="visual-note">界面为原创视觉示意，非真实客户端操作截图</p>
</div>
</section>
<section className="benefits wrap" aria-label="产品优势">
<article>
<div className="benefit-icon">▣</div>
<h2>熟悉的官方客户端体验</h2>
<p>继续在 ChatGPT / Codex 官方客户端里聊天与工作，保留熟悉的界面和使用习惯。</p>
</article>
<article>
<div className="benefit-icon">◇</div>
<h2>DeepSeek 与 GPT-6</h2>
<p>在同一个工作环境中使用国产 DeepSeek 或平台已开通的 GPT-6，适应不同任务。</p>
</article>
<article>
<div className="benefit-icon">♧</div>
<h2>安全连接，轻松切换</h2>
<p>通过加密连接使用 Cloud，保留原账号配置；关闭 Cloud，即可按提示切回原账号。</p>
</article>
</section>
<section className="demo-section wrap" id="examples">
<div className="section-heading">
<div>
<span className="eyebrow">FROM A PROMPT TO A RESULT</span>
<h2>少一点操作。<br />多一个做完的结果。</h2>
</div>
<p>一句话请求，看看三种任务如何变成成果。</p>
</div>
<ScreenshotCarousel />
</section>
<section className="start" id="how-it-works">
<div className="wrap">
<span className="eyebrow">GET STARTED</span>
<h2>三步，开始你的第一项任务。</h2>
<div className="steps">
<article className="step">
<span className="num">01</span>
<h3>下载 Bridge</h3>
<p>安装 Windows 版 Bridge，使用已开通的账号登录。</p>
</article>
<article className="step">
<span className="num">02</span>
<h3>准备官方客户端</h3>
<p>跟随提示安装 ChatGPT 官方桌面客户端，已安装可直接继续。</p>
</article>
<article className="step">
<span className="num">03</span>
<h3>开启 Cloud，开始对话</h3>
<p>开启 Cloud，按提示重新打开 ChatGPT。在熟悉的对话里开始任务。</p>
</article>
</div>
<p className="step-note">使用 Cloud 时请保持 Bridge 运行。可用模型与功能以账号权限及实际客户端为准；涉及本地操作时，请按客户端提示确认权限。</p>
</div>
</section>
<section className="faq wrap" id="faq">
<span className="eyebrow">GOOD TO KNOW</span>
<h2>开始前，你可能想知道。</h2>
<div className="faq-list">
<details>
<summary>怎么回到自己的 ChatGPT 账号？</summary>
<p>关闭 Bridge 的 Cloud 开关，再按提示重新打开 ChatGPT，即可回到原账号使用。</p>
</details>
<details>
<summary>需要一直开着 Bridge 吗？</summary>
<p>需要。使用 Cloud 时保持 Bridge 运行；模式切换成功后，按提示重新打开官方客户端。</p>
</details>
<details>
<summary>余额与模型权限在哪里查看？</summary>
<p>在 Bridge 账户页或网站用户中心查看。可用模型以账号目录为准；充值或权限调整请联系管理员。</p>
</details>
</div>
</section>
<section className="cta wrap">
<div>
<h2>下一项任务，从这里开始。</h2>
<p>下载 Bridge，打开你熟悉的 ChatGPT。</p>
</div>
<a className="btn" href="/download">下载 Windows 版 <span className="arrow">↗</span>
</a>
</section>
</main>
<footer className="footer wrap">
<a className="brand" href="#top">
<span className="brand-icon">
<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
<path d="m3 8 9-5 9 5-9 5-9-5Zm0 4 9 5 9-5M3 16l9 5 9-5" />
</svg>
</span>Copilot Bridge</a>
<div className="footer-links">
<a href="/pricing">套餐与余额</a>
<a href="/download">下载</a>
<a href="/dashboard">用户中心</a>
</div>
<small>© {new Date().getFullYear()} Copilot Bridge · 非 ChatGPT 官方产品</small>
</footer>
  </div>;
}
