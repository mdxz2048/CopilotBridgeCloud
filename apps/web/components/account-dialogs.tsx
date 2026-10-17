'use client';
import { useEffect, useId, useRef, useState } from 'react';

export function AccountDialog({ title, busy = false, onClose, children }: { title: string; busy?: boolean; onClose: () => void; children: React.ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => { const element = dialog.current!; element.showModal(); return () => element.close(); }, []);
  return <dialog ref={dialog} className="account-dialog" aria-labelledby={titleId} onClose={onClose}
    onCancel={event => { if (busy) event.preventDefault(); }}>
    <div className="account-dialog-title"><h2 id={titleId}>{title}</h2><button type="button" className="mini-button" aria-label="关闭弹窗" disabled={busy} onClick={onClose}>×</button></div>
    {children}
  </dialog>;
}

export function TopupDialog({ email, onClose }: { email: string; onClose: () => void }) {
  const [feedback, setFeedback] = useState('');
  async function copy() {
    try { await navigator.clipboard.writeText(email); setFeedback('邮箱已复制。'); }
    catch { setFeedback('复制失败，请选中邮箱手动复制。'); }
  }
  return <AccountDialog title="联系管理员充值" onClose={onClose}>
    <p>使用微信扫码添加管理员，告知注册邮箱和充值金额。</p>
    <img className="account-topup-qr" src="/admin-wechat.png" width={300} height={294} alt="管理员微信二维码，扫码联系充值" />
    <div className="account-copy-email"><div><small>注册邮箱</small><strong>{email}</strong></div><button type="button" className="mini-button" onClick={() => void copy()}>复制邮箱</button></div>
    {feedback && <p role="status">{feedback}</p>}
    <p>管理员增加余额后，返回账号或账单页面查看。</p>
    <div className="account-dialog-actions"><button type="button" className="button button-small" onClick={onClose}>知道了</button></div>
  </AccountDialog>;
}
