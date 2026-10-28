import type { Metadata } from 'next';
import { SiteHeader } from '../../components/site-header';
import { SiteFooter } from '../../components/site-footer';
import { HelpFaq } from '../../components/help-faq';
import styles from '../marketing.module.css';

export const metadata: Metadata = { title: '常见问题' };
export default function Faq() {
  return <><SiteHeader/><main className={`container ${styles.faqPage}`}><HelpFaq standalone/></main><SiteFooter/></>;
}
