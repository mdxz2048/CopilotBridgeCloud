'use client';

import { useEffect, useState } from 'react';
import { api, post, type ApiError } from '../lib/api';

type PendingUsage = { id: string; requestId: string; userId: string; billingStatus: string; pointsCharged: number; createdAt: string };

const responsibility = '平台承担无法确认的上游成本。此操作不退款、不修改已知用量或账本，也不将未知成本记为零。';
function errorText(error: unknown) {
  const detail = error as Partial<ApiError>;
  return `${detail.message || '计费审核操作失败，请重试。'}${detail.requestId ? `（请求编号：${detail.requestId}）` : ''}`;
}

export function AdminUsageReview({ userId, onReviewed }: { userId: string; onReviewed: () => void }) {
  const [entries, setEntries] = useState<PendingUsage[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setEntries(null); setError('');
    void api<{ data: PendingUsage[] }>(`/api/v1/admin/usage-events/review?userId=${encodeURIComponent(userId)}`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setEntries(result.data.filter(entry => entry.userId === userId)); })
      .catch(error => { if (!controller.signal.aborted) setError(errorText(error)); });
    return () => controller.abort();
  }, [userId, revision]);

  async function review(event: React.FormEvent) {
    event.preventDefault();
    const normalized = reason.trim();
    if (busy || !selected || !entries?.some(entry => entry.id === selected)) return;
    if (!normalized || normalized.length > 500) { setError('请填写 1 至 500 个字符的审核原因。'); return; }
    if (!window.confirm(`${responsibility}\n确认平台承担并解除该事件造成的计费限制？`)) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await post<{ alreadyReviewed: boolean }>(`/api/v1/admin/usage-events/${encodeURIComponent(selected)}/review`, { resolution: 'platform_waived', reason: normalized });
      setEntries(current => current?.filter(entry => entry.id !== selected) ?? []);
      setSelected(null); setReason('');
      setMessage(result.alreadyReviewed ? '该事件已审核，已刷新列表。' : '已记录审核原因，平台承担该事件的未知成本。若仍有其他待审核事件，用户限制会继续保留。');
      onReviewed();
    } catch (error) { setError(errorText(error)); }
    finally { setBusy(false); }
  }

  return <section className="panel" aria-label="待计费审核">
    <h3>待计费审核</h3>
    <p>只展示此用户的未审核事件；上游未提供可靠用量时，成本未知，用户新请求会暂时受限。</p>
    {error && <p className="error-text" role="alert">{error} <button type="button" className="mini-button" disabled={busy} onClick={() => setRevision(value => value + 1)}>重新读取</button></p>}
    {message && <p className="notice" role="status">{message}</p>}
    {entries === null ? !error && <p role="status">正在读取待审核事件…</p> : entries.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>时间／请求编号</th><th>状态</th><th>成本</th><th>操作</th></tr></thead><tbody>{entries.map(entry => <tr key={entry.id}>
      <td>{new Date(entry.createdAt).toLocaleString('zh-CN')}<br/><code>{entry.requestId}</code></td><td>{entry.billingStatus}</td><td>上游成本未知<br/>已记扣费 ¥{(entry.pointsCharged / 10000).toFixed(4)}</td>
      <td><button type="button" className="mini-button" disabled={busy} onClick={() => { setSelected(entry.id); setReason(''); setError(''); setMessage(''); }}>审核此事件</button></td>
    </tr>)}</tbody></table></div> : <p>此用户没有待审核事件。</p>}
    {selected && <form onSubmit={event => void review(event)}>
      <p>{responsibility}</p><div className="field"><label htmlFor="usage-review-reason">审核原因（必填，最多 500 字）</label><textarea id="usage-review-reason" required maxLength={500} value={reason} disabled={busy} onChange={event => setReason(event.target.value)}/></div>
      <div className="inline-actions"><button className="button button-small" disabled={busy || !reason.trim()}>{busy ? '正在提交审核…' : '平台承担并解除限制'}</button><button type="button" className="mini-button" disabled={busy} onClick={() => { setSelected(null); setReason(''); }}>取消</button></div>
    </form>}
  </section>;
}
