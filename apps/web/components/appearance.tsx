'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

type Appearance = 'light' | 'dark';
const AppearanceContext = createContext<{ appearance: Appearance; change: (value: Appearance) => void } | null>(null);

export function AppearanceProvider({ children }: { children: React.ReactNode }) {
  const [appearance, setAppearance] = useState<Appearance>('light');
  useEffect(() => {
    setAppearance(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
    function synchronize(event: StorageEvent) {
      if (event.key !== 'cb-theme' && event.key !== null) return;
      const next = event.key === null ? 'light' : event.newValue === 'dark' ? 'dark' : 'light';
      document.documentElement.dataset.theme = next;
      setAppearance(next);
    }
    window.addEventListener('storage', synchronize);
    return () => window.removeEventListener('storage', synchronize);
  }, []);
  function change(next: Appearance) {
    document.documentElement.dataset.theme = next;
    setAppearance(next);
    try { localStorage.setItem('cb-theme', next); } catch { /* The appearance still changes when storage is unavailable. */ }
  }
  return <AppearanceContext.Provider value={{ appearance, change }}>{children}</AppearanceContext.Provider>;
}

export function AppearanceToggle() {
  const context = useContext(AppearanceContext);
  if (!context) return null;
  const dark = context.appearance === 'dark';
  return <button className="appearance-toggle" type="button" aria-label={dark ? '切换到浅色外观' : '切换到深色外观'}
    title={dark ? '浅色外观' : '深色外观'} onClick={() => context.change(dark ? 'light' : 'dark')}>
    {dark ? <Sun size={17} aria-hidden="true"/> : <Moon size={17} aria-hidden="true"/>}
  </button>;
}
