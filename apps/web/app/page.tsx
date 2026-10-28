import type { Metadata } from 'next';
import { SiteHeader } from '../components/site-header';
import { ScreenshotCarousel } from '../components/screenshot-carousel';
import { ProductIllustration } from '../components/product-illustration';
import { SiteFooter } from '../components/site-footer';
import { QuickStart } from '../components/quick-start';
import { HelpFaq } from '../components/help-faq';
import { Laptop2, Sparkles, ShieldCheck } from 'lucide-react';
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
<ul className="hero-lede hero-points">
  <li>使用最新版 ChatGPT / Codex 官方客户端。</li>
  <li>连接已开通的 DeepSeek 或 GPT-6。</li>
  <li>写工具、读资料、出试卷，在熟悉的对话里，把想法变成可用的成果。</li>
</ul>
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
<ProductIllustration/>
</section>
<section id="features" className="benefits wrap" aria-label="产品优势">
<article>
<Laptop2 size={24} aria-hidden="true"/>
<h2>熟悉的官方客户端体验</h2>
<p>继续在 ChatGPT / Codex 官方客户端里聊天与工作，保留熟悉的界面和使用习惯。</p>
</article>
<article>
<Sparkles size={24} aria-hidden="true"/>
<h2>DeepSeek 与 GPT-6</h2>
<p>在同一个工作环境中使用国产 DeepSeek 或平台已开通的 GPT-6，适应不同任务。</p>
</article>
<article>
<ShieldCheck size={24} aria-hidden="true"/>
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
<QuickStart/>
</div>
</section>
<section className="faq-section wrap" id="faq"><HelpFaq/></section>
<section className="cta wrap">
<div>
<h2>下一项任务，从这里开始。</h2>
<p>下载 Bridge，打开你熟悉的 ChatGPT。</p>
</div>
<a className="btn" href="/download">下载 Windows 版 <span className="arrow">↗</span>
</a>
</section>
</main>
<SiteFooter/>
  </div>;
}
