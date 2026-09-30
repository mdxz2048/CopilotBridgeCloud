'use client';

import { useState, type FormEvent } from 'react';

export function ReleaseUpload({ onUploaded }: { onUploaded: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [version, setVersion] = useState('');
  const [channel, setChannel] = useState<'stable' | 'beta'>('stable');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!file || busy) return;
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/v1/admin/releases/upload', {
        method: 'POST', credentials: 'include', body: file,
        headers: { 'Content-Type': 'application/octet-stream', 'X-Release-Version': version, 'X-Release-Channel': channel, 'X-Release-Notes': notes },
      });
      if (!response.ok) {
        const result = await response.json() as { error?: { message?: string } };
        throw new Error(result.error?.message ?? '上传失败，请重试。');
      }
      setMessage('安装包已上传并计算 SHA-256，当前为未发布草稿。请核对后再发布。');
      form.reset();
      setFile(null); setVersion(''); setNotes('');
      onUploaded();
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }

  return <section className="panel"><h2>上传 Windows 安装包</h2><p>文件会保存在服务端持久化目录，并由服务端计算 SHA-256；上传后默认不公开，发布才会出现在下载页。单个文件最大 512 MiB。</p>
    <form onSubmit={event => void submit(event)}><div className="form-grid">
      <div className="field"><label htmlFor="release-version">版本</label><input id="release-version" required pattern="[A-Za-z0-9][A-Za-z0-9._-]{0,63}" value={version} onChange={event => setVersion(event.target.value)}/></div>
      <div className="field"><label htmlFor="release-channel">频道</label><select id="release-channel" value={channel} onChange={event => setChannel(event.target.value as 'stable' | 'beta')}><option value="stable">stable</option><option value="beta">beta</option></select></div>
      <div className="field"><label htmlFor="release-file">安装包（.exe）</label><input id="release-file" type="file" accept=".exe" required onChange={event => setFile(event.target.files?.[0] ?? null)}/></div>
      <div className="field"><label htmlFor="release-notes">版本说明</label><input id="release-notes" maxLength={4000} value={notes} onChange={event => setNotes(event.target.value)}/></div>
    </div><button className="button button-small" disabled={busy || !file || file.size > 512 * 1024 * 1024}>{busy ? '正在上传…' : '上传为草稿'}</button></form>
    {message && <p role="status">{message}</p>}
  </section>;
}
