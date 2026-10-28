import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '../../components/site-header';
import { SiteFooter } from '../../components/site-footer';
import { QuickStart } from '../../components/quick-start';
import styles from '../marketing.module.css';

export const metadata: Metadata = { title: '使用指南' };
export default function Guide() {
  return <><SiteHeader/><main className={`container ${styles.guidePage}`}><div className="page-hero"><span className="eyebrow">GET STARTED</span><h1>三步，开始你的第一项任务。</h1><p>从安装 Bridge，到在熟悉的官方客户端里开始工作。</p></div><QuickStart/>
    <div className={`notice ${styles.guideNotice}`}><strong>开始前确认</strong><p>使用已开通的账号登录，检查可用模型和账户余额。Bridge 会引导准备官方客户端；已经安装可以直接继续。开启 Cloud 或切回原账号，都需要确认后按提示重新打开官方客户端。</p></div>
    <div className={styles.guideActions}><Link className="button" href="/download">下载 Bridge ↗</Link><Link className="text-link" href="/faq">查看常见问题 ›</Link></div>
  </main><SiteFooter/></>;
}
