import { BridgeMark } from './bridge-mark';

/** Marketing illustration, never a representation of the visitor's session or live service state. */
export function ProductIllustration() {
  return <figure className="hero-art" aria-label="官方客户端与 Bridge 的连接示意">
    <div className="mini-app" aria-hidden="true">
      <div className="window-bar"><i/><i/><i/><span>官方客户端</span></div>
      <div className="mini-app-body">
        <aside className="mini-rail"><strong>◉　官方客户端</strong><span className="rail-new">＋　新建聊天</span><span>自己的项目目录</span><span>阅读资料</span><span>整理文档</span></aside>
        <div className="mini-chat"><strong className="chat-brand">ChatGPT⌄</strong>
          <div className="mini-center"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/></svg><h2>今天想完成什么？</h2></div>
          <div className="mini-composer">只需用一句话，说说你的想法。<div><span>＋</span><span className="send-circle">↑</span></div></div>
          <div className="sample-chips"><span>写一个小工具</span><span>整理阅读摘要</span><span>出一份试卷</span></div>
        </div>
      </div>
    </div>
    <div className="bridge-status" aria-hidden="true"><BridgeMark/><strong>Copilot Bridge</strong><span><i/>Cloud 连接示意</span></div>
    <figcaption>客户端布局示意，用于说明连接关系；界面与功能以实际版本为准。</figcaption>
  </figure>;
}
