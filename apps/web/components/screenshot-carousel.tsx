'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type TouchEvent } from 'react';

const scenes = [
  {
    "title": "屏幕检测工具",
    "alt": "演示对话一：用户要求制作 Windows 屏幕检测工具；最终回复展示纯色、渐变、坏点检查的软件成果。",
    "desktop": "/homepage/scene-1-desktop-20261017.png",
    "mobile": "/homepage/scene-1-mobile-20261017.png"
  },
  {
    "title": "阅读摘要",
    "alt": "演示对话二：用户提供在 GitHub 查找《高性价比人生指南》并了解内容；最终回复展示 HowToLiveBetter.pdf 和阅读提纲示意。",
    "desktop": "/homepage/scene-2-desktop-20261017.png",
    "mobile": "/homepage/scene-2-mobile-20261017.png"
  },
  {
    "title": "试卷排版",
    "alt": "演示对话三：用户要求出七年级数学试卷并排版；最终回复展示试卷、答案与 Word、PDF 成果。",
    "desktop": "/homepage/scene-3-desktop-20261017.png",
    "mobile": "/homepage/scene-3-mobile-20261017.png"
  }
];
const INTERVAL_MS = 2000;

export function ScreenshotCarousel() {
  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(true);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pageHidden, setPageHidden] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const touch = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPaused(media.matches);
    setPageHidden(document.hidden);
    const reduceMotion = (event: MediaQueryListEvent) => { if (event.matches) setPaused(true); };
    const visibility = () => setPageHidden(document.hidden);
    media.addEventListener('change', reduceMotion);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      media.removeEventListener('change', reduceMotion);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);

  useEffect(() => {
    if (paused || hovered || focused || pageHidden) return;
    const timer = window.setTimeout(() => setCurrent(index => (index + 1) % scenes.length), INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [current, paused, hovered, focused, pageHidden]);

  function show(index: number) {
    const next = (index + scenes.length) % scenes.length;
    setCurrent(next);
    setAnnouncement(`第 ${next + 1} 张：${scenes[next].title}`);
  }
  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    const next = { ArrowLeft: current - 1, ArrowRight: current + 1, Home: 0, End: scenes.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    show(next);
  }
  function swipe(event: TouchEvent<HTMLDivElement>) {
    const start = touch.current;
    touch.current = null;
    if (!start) return;
    const end = event.changedTouches[0];
    const dx = end.clientX - start.x;
    const dy = end.clientY - start.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.3) show(current + (dx < 0 ? 1 : -1));
  }

  return <div className="screenshot-carousel" role="region" aria-roledescription="轮播"
    aria-label="三种任务的演示对话截图" tabIndex={0} onKeyDown={keyDown}
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocusCapture={() => setFocused(true)}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}
    onTouchStart={event => { const start = event.changedTouches[0]; touch.current = { x: start.clientX, y: start.clientY }; }}
    onTouchEnd={swipe} onTouchCancel={() => { touch.current = null; }}>
    <div className="demo-screen"><div className="demo-screen-bar"><span className="demo-screen-light" aria-hidden="true"/><span>任务演示</span><span className="demo-screen-caption">Codex 工作区</span></div>
    <div className="screenshot-viewport">
      {scenes.map((scene, index) => <div className="screenshot-slide" key={scene.title} hidden={index !== current}
        role="group" aria-roledescription="幻灯片" aria-label={`${index + 1} / ${scenes.length}：${scene.title}`}>
        <picture>
          <source media="(max-width:760px)" srcSet={scene.mobile} width={780} height={1640} />
          <img src={scene.desktop} alt={scene.alt} width={2400} height={1480} decoding="async" />
        </picture>
      </div>)}
    </div>
    </div>
    <div className="screenshot-controls">
      <button type="button" className="shot-arrow" onClick={() => show(current - 1)} aria-label="上一张截图">‹</button>
      <div className="shot-dots" role="group" aria-label="切换演示截图">
        {scenes.map((scene, index) => <button type="button" key={scene.title} className="shot-dot"
          aria-label={`第 ${index + 1} 张：${scene.title}`} aria-current={index === current} onClick={() => show(index)} />)}
      </div>
      <button type="button" className="shot-play" onClick={() => setPaused(value => !value)}
        aria-label={paused ? '开始自动播放' : '暂停自动播放'} aria-pressed={paused}>{paused ? '▶' : 'Ⅱ'}</button>
      <button type="button" className="shot-arrow" onClick={() => show(current + 1)} aria-label="下一张截图">›</button>
    </div>
    <div className="sr-only" role="status" aria-live="polite">{announcement}</div>
  </div>;
}
