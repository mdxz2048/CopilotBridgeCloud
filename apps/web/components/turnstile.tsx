'use client';
import { useEffect, useRef, useState } from 'react';

type TurnstileApi = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  remove: (id: string) => void;
};

function widgetApi(): TurnstileApi | undefined {
  return (window as Window & { turnstile?: TurnstileApi }).turnstile;
}

export function Turnstile({ siteKey, action, onToken, resetKey }: {
  siteKey: string; action: 'registration_email_code' | 'web_login';
  onToken: (token: string) => void; resetKey: number;
}) {
  const slot = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  const tokenCallback = useRef(onToken);
  useEffect(() => { tokenCallback.current = onToken; }, [onToken]);
  useEffect(() => {
    let active = true;
    let widgetId: string | undefined;
    function render() {
      const api = widgetApi();
      if (!active || !api || !slot.current || widgetId) return;
      widgetId = api.render(slot.current, {
        sitekey: siteKey, action,
        callback: (token: string) => { setError(false); tokenCallback.current(token); },
        'expired-callback': () => tokenCallback.current(''),
        'error-callback': () => { setError(true); tokenCallback.current(''); },
      });
    }
    if (widgetApi()) render();
    else {
      let script = document.querySelector<HTMLScriptElement>('script[data-bridge-turnstile]');
      if (!script) {
        script = document.createElement('script');
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        script.async = true;
        script.dataset.bridgeTurnstile = 'true';
        document.head.appendChild(script);
      }
      script.addEventListener('load', render);
      const listener = () => { if (active) setError(true); };
      script.addEventListener('error', listener);
      return () => {
        active = false;
        script.removeEventListener('load', render);
        script.removeEventListener('error', listener);
        if (widgetId) widgetApi()?.remove(widgetId);
      };
    }
    return () => { active = false; if (widgetId) widgetApi()?.remove(widgetId); };
  }, [action, siteKey, resetKey]);
  return <div className="turnstile-slot"><div ref={slot} aria-label="人机验证"/>{error && <p role="alert" className="error-text">人机验证暂不可用，请稍后重试。</p>}</div>;
}
