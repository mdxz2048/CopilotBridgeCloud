import type { Metadata } from 'next';
import './styles.css';

export const metadata: Metadata = {
  title: { default: 'Copilot Bridge Cloud', template: '%s · Copilot Bridge Cloud' },
  description: 'Your desktop agent, connected to the models you choose.',
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
