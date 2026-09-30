'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, put } from '../lib/api';

type WebsiteSettingsData = {
  verificationRequired: boolean;
  turnstile: { siteKey: string; secretConfigured: boolean; expectedHostname: string };
  email: { smtpHost: string; smtpPort: number; smtpUser: string; passwordConfigured: boolean; from: string };
  template: { subject: string; body: string };
};
type Draft = {
  siteKey: string; expectedHostname: string; secretKey: string;
  smtpHost: string; smtpPort: string; smtpUser: string; password: string; from: string;
  subject: string; body: string;
};
const endpoint = '/api/v1/admin/website-settings';

function toDraft(value: WebsiteSettingsData): Draft {
  return {
    siteKey: value.turnstile.siteKey, expectedHostname: value.turnstile.expectedHostname, secretKey: '',
    smtpHost: value.email.smtpHost, smtpPort: String(value.email.smtpPort), smtpUser: value.email.smtpUser,
    password: '', from: value.email.from, subject: value.template.subject, body: value.template.body,
  };
}

export function WebsiteSettings() {
  const [settings, setSettings] = useState<WebsiteSettingsData | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState(false);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const value = await api<WebsiteSettingsData>(endpoint);
      setSettings(value); setDraft(toDraft(value));
    } catch (e) {
      setError((e as { message?: string }).message ?? '网站配置加载失败，请重试。');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  function update(key: keyof Draft, value: string) {
    setDraft(current => current ? { ...current, [key]: value } : current);
    setMessage('');
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || saving) return;
    if (!draft.body.includes('{{code}}')) {
      setError('邮件正文必须包含 {{code}} 占位符。'); return;
    }
    setSaving(true); setError(''); setMessage('');
    try {
      const result = await put<WebsiteSettingsData>(endpoint, {
        turnstile: {
          siteKey: draft.siteKey, expectedHostname: draft.expectedHostname,
          ...(draft.secretKey ? { secretKey: draft.secretKey } : {}),
        },
        email: {
          smtpHost: draft.smtpHost, smtpPort: Number(draft.smtpPort), smtpUser: draft.smtpUser, from: draft.from,
          ...(draft.password ? { password: draft.password } : {}),
        },
        template: { subject: draft.subject, body: draft.body },
      });
      setSettings(result); setDraft(toDraft(result));
      setMessage('网站配置已保存。');
    } catch (e) {
      setError((e as { message?: string }).message ?? '保存失败，请重试。');
    } finally {
      setSaving(false);
    }
  }
  if (loading) return <div role="status">正在加载网站配置…</div>;
  if (!settings || !draft) return <section className="panel"><p role="alert">{error}</p><button className="mini-button" onClick={() => void load()}>重试</button></section>;
  return <form onSubmit={event => void save(event)}>
    <section className="panel">
      <h2>注册验证</h2>
      <p>当前验证状态：{settings.verificationRequired ? '服务端已要求验证' : '服务端未要求验证'}。是否启用注册验证由服务端环境变量控制，保存此处配置不会启用验证。</p>
      <div className="form-grid">
        <div className="field"><label htmlFor="website-site-key">Cloudflare Turnstile Site Key</label><input id="website-site-key" value={draft.siteKey} maxLength={256} onChange={e => update('siteKey', e.target.value)}/></div>
        <div className="field"><label htmlFor="website-secret-key">Cloudflare Turnstile Secret Key</label><input id="website-secret-key" type="password" autoComplete="new-password" value={draft.secretKey} maxLength={4096} placeholder={settings.turnstile.secretConfigured ? '已配置，留空保持不变' : '尚未配置'} onChange={e => update('secretKey', e.target.value)}/></div>
        <div className="field"><label htmlFor="website-hostname">验证域名</label><input id="website-hostname" value={draft.expectedHostname} readOnly/><small>由服务端站点地址确定，不可在此修改。</small></div>
      </div>
    </section>
    <section className="panel">
      <h2>Resend SMTP 邮件</h2>
      <p>使用 Resend SMTP 发送注册邮件。{draft.from === 'onboarding@resend.dev'
        ? '当前是仅供测试的发件地址；正式发送须使用已验证域名的地址。'
        : '请确认此发件域名已在 Resend 启用发送，并先完成真实收件测试。'}</p>
      <div className="form-grid">
        <div className="field"><label htmlFor="website-smtp-host">SMTP Host</label><input id="website-smtp-host" value={draft.smtpHost} maxLength={255} onChange={e => update('smtpHost', e.target.value)}/></div>
        <div className="field"><label htmlFor="website-smtp-port">SMTP Port</label><input id="website-smtp-port" type="number" min={1} max={65535} step={1} required value={draft.smtpPort} onChange={e => update('smtpPort', e.target.value)}/></div>
        <div className="field"><label htmlFor="website-smtp-user">SMTP User</label><input id="website-smtp-user" value={draft.smtpUser} maxLength={255} onChange={e => update('smtpUser', e.target.value)}/></div>
        <div className="field"><label htmlFor="website-smtp-password">SMTP Password</label><input id="website-smtp-password" type="password" autoComplete="new-password" value={draft.password} maxLength={4096} placeholder={settings.email.passwordConfigured ? '已配置，留空保持不变' : '尚未配置'} onChange={e => update('password', e.target.value)}/></div>
        <div className="field"><label htmlFor="website-smtp-from">发件邮箱（From）</label><input id="website-smtp-from" type="email" value={draft.from} maxLength={255} onChange={e => update('from', e.target.value)}/></div>
      </div>
    </section>
    <section className="panel">
      <h2>注册邮件模板</h2>
      <p>纯文本邮件。正文必须包含 {'{{code}}'}，发送时由服务端替换为实际验证码；预览只展示示例，不会发送邮件。</p>
      <div className="field"><label htmlFor="website-email-subject">邮件主题</label><input id="website-email-subject" value={draft.subject} required maxLength={200} onChange={e => update('subject', e.target.value)}/></div>
      <div className="field"><label htmlFor="website-email-body">邮件正文（纯文本）</label><textarea id="website-email-body" rows={8} value={draft.body} required maxLength={4000} onChange={e => update('body', e.target.value)}/></div>
      <button type="button" className="mini-button" aria-expanded={preview} onClick={() => setPreview(value => !value)}>{preview ? '关闭预览' : '预览邮件'}</button>
      {preview && <div aria-label="邮件预览"><h3>{draft.subject.replaceAll('{{code}}', '123456')}</h3><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{draft.body.replaceAll('{{code}}', '123456')}</pre></div>}
    </section>
    {error && <p className="error-text" role="alert">{error}</p>}
    {message && <p className="notice" role="status">{message}</p>}
    <button type="submit" className="button button-small" disabled={saving}>{saving ? '保存中…' : '保存网站配置'}</button>
  </form>;
}
