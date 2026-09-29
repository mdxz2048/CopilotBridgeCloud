'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { copilotAuthErrorMessage, copilotAuthLabel, githubDeviceVerificationPage, githubVerificationUrl, isCopilotCodeExpired, startCopilotAuthorization, type CopilotAuthResponse } from './copilot-auth';

const authPath = '/api/v1/admin/copilot/auth';
const pollIntervalMs = 3000;

export function CopilotAuthCard() {
  const [auth, setAuth] = useState<CopilotAuthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [popupMessage, setPopupMessage] = useState('');
  const [copyMessage, setCopyMessage] = useState('');
  const [pollCycle, setPollCycle] = useState(0);
  const action = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void api<CopilotAuthResponse>(authPath, { signal: controller.signal })
      .then(setAuth)
      .catch(() => { if (!controller.signal.aborted) setError('无法读取认证状态，请重试。'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  const expired = isCopilotCodeExpired(auth?.expiresAt);
  const pending = auth?.status === 'PENDING' || auth?.status === 'VERIFYING';
  useEffect(() => {
    if (!pending || expired || busy) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void api<CopilotAuthResponse>(authPath, { signal: controller.signal })
        .then(next => {
          if (!controller.signal.aborted) {
            setAuth(next);
            setError('');
            setPollCycle(cycle => cycle + 1);
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setError('认证状态暂时无法更新，正在重试。');
            setPollCycle(cycle => cycle + 1);
          }
        });
    }, pollIntervalMs);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [pending, expired, busy, pollCycle]);

  useEffect(() => () => action.current?.abort(), []);

  async function request(method: 'GET' | 'POST') {
    if (busy) return;
    const controller = new AbortController();
    action.current = controller;
    setBusy(true);
    setError('');
    setCopyMessage('');
    setPopupMessage('');
    try {
      const next = method === 'POST'
        ? await startCopilotAuthorization(
          () => api<CopilotAuthResponse>(authPath, { method: 'POST', signal: controller.signal }),
          () => window.open('about:blank', '_blank'),
          controller.signal,
        )
        : { auth: await api<CopilotAuthResponse>(authPath, { signal: controller.signal }), popup: 'not-started' as const };
      if (!controller.signal.aborted) {
        setAuth(next.auth);
        if (next.popup === 'manual') setPopupMessage('新标签页未打开，请使用下方按钮或复制验证地址。');
        if (next.popup === 'unsafe') setPopupMessage('验证地址不安全，未打开新标签页，请联系管理员。');
        setPollCycle(cycle => cycle + 1);
      }
    } catch {
      if (!controller.signal.aborted) setError(method === 'POST' ? '无法启动认证，请稍后重试。' : '无法读取认证状态，请重试。');
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      if (action.current === controller) action.current = null;
    }
  }

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopyMessage(`${label}已复制`);
    } catch {
      setCopyMessage('复制失败，请手动选中并复制。');
    }
  }

  const verificationUrl = auth?.verificationUri
    ? githubVerificationUrl(auth.verificationUri)
    : githubDeviceVerificationPage;
  const showCode = pending && !expired;

  return <section className="panel copilot-auth" aria-labelledby="copilot-auth-heading">
    <h2 id="copilot-auth-heading">GitHub Copilot 认证</h2>
    <p>此处仅验证管理员的 GitHub 登录与模型授权，不展示具体模型。管理员认证不授权向所有终端共享使用；Provider、模型及网关仍需另行审批启用，本页不提供启用操作。</p>
    <div className="copilot-auth-state" role="status" aria-live="polite" aria-atomic="true">
      <span className={`badge ${auth?.status === 'AUTHENTICATED' ? '' : 'muted'}`}>
        {loading ? '正在读取…' : auth ? copilotAuthLabel(auth.status) : '状态未知'}
      </span>
      {auth?.status === 'NOT_CONFIGURED' && <span>服务端尚未配置 GitHub OAuth Client ID，请先完成配置。</span>}
      {auth?.status === 'NOT_AUTHENTICATED' && <span>点击开始认证，获取一次性设备码。</span>}
      {pending && !expired && <span>{auth.status === 'PENDING' ? '请在 GitHub 验证页输入设备码；本页将自动检查结果。' : '正在验证登录和模型权限，请稍候。'}</span>}
      {pending && expired && <span>设备码已过期，请重新开始认证。</span>}
      {auth?.status === 'AUTHENTICATED' && <span>登录名：{auth.login || '未返回'} · 服务端已通过 discover() 模型授权检查；这不代表 Provider、模型或网关已向用户开放。</span>}
      {auth?.status === 'ERROR' && <span>{copilotAuthErrorMessage(auth.message)}</span>}
    </div>
    {showCode && auth?.userCode && <div className="copilot-auth-code">
      <span>一次性设备码</span>
      <code>{auth.userCode}</code>
      <button type="button" className="mini-button" onClick={() => void copy(auth.userCode!, '设备码')}>复制设备码</button>
    </div>}
    {showCode && auth?.userCode && <div className="copilot-auth-link">
      {verificationUrl
        ? <>
          <span>验证地址：<code>{verificationUrl}</code></span>
          <a className="mini-button" href={verificationUrl} target="_blank" rel="noopener noreferrer">打开 GitHub 验证页</a>
          <button type="button" className="mini-button" onClick={() => void copy(verificationUrl, '验证地址')}>复制地址</button>
        </>
        : <p className="error-text" role="alert">返回的验证地址不安全，已禁止打开或复制，请联系管理员检查配置。</p>}
    </div>}
    {showCode && popupMessage && <p className="copilot-auth-feedback" role="status">{popupMessage}</p>}
    <div className="form-actions">
      {!loading && auth?.status !== 'NOT_CONFIGURED' && (!pending || expired) &&
        <button type="button" className="button button-small" disabled={busy} onClick={() => void request('POST')}>
          {busy ? '正在请求…' : auth?.status === 'AUTHENTICATED' ? '重新认证' : pending || auth?.status === 'ERROR' ? '重新开始认证' : '开始认证'}
        </button>}
      {!loading && <button type="button" className="mini-button" disabled={busy} onClick={() => void request('GET')}>刷新状态</button>}
    </div>
    {error && <p className="error-text" role="alert">{error}</p>}
    {copyMessage && <p className="copilot-auth-feedback" role="status">{copyMessage}</p>}
  </section>;
}
