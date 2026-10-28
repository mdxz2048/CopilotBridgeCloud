import type { Metadata } from 'next';
import './styles.css';
import { AppearanceProvider } from '../components/appearance';

export const metadata: Metadata = {
  title: { default: 'Copilot Bridge Cloud', template: '%s · Copilot Bridge Cloud' },
  description: '原生 ChatGPT 桌面体验，无需自行配置网络代理。通过 Copilot Bridge 选择账号已开通的国产与 GPT 模型，三步开启 Cloud。',
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: 'try{document.documentElement.dataset.theme=localStorage.getItem("cb-theme")==="dark"?"dark":"light"}catch{document.documentElement.dataset.theme="light"}' }}/></head><body><AppearanceProvider>{children}</AppearanceProvider></body></html>;
}
