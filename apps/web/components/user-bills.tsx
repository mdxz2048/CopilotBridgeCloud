'use client';
import { useEffect, useState } from 'react';
import { api, type ApiError } from '../lib/api';

export type BillRow = { id: string; category: 'BALANCE' | 'CONSUMPTION'; type: string; points: number; balanceAfter: number | null;
  occurredAt: string; startedAt: string | null; endedAt: string | null; deviceName: string | null; deviceId: string | null; periodKind: string | null };
type Pending = { id: string; deviceId: string; deviceName: string; startedAt: string };
export type BillList = { data: BillRow[]; pending: Pending[]; total: number; page: number; pageSize: number;
  summary: { balance: number; totalAdded: number; totalConsumed: number } };
export const money = (points: number) => `¥${(points / 10000).toFixed(4)}`;
const date = (value: string) => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
function balanceTitle(row: BillRow) {
  const names: Record<string, string> = { PURCHASE: '充值入账', REFERRAL_REWARD: '邀请奖励', SUBSCRIPTION_GRANT: '套餐赠送', EXPIRATION: '奖励 / 赠送余额到期', REFUND: '退款入账' };
  return row.type === 'ADMIN_ADJUSTMENT' ? row.points > 0 ? '管理员增加余额' : '管理员减少余额' : names[row.type] ?? '余额调整';
}

export function UserBills({ onTopup, onAuthExpired }: { onTopup: () => void; onAuthExpired: () => void }) {
  const [kind, setKind] = useState<'all' | 'recharge' | 'consumption'>('all');
  const [page, setPage] = useState(1), [revision, setRevision] = useState(0);
  const [result, setResult] = useState<BillList | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    void api<BillList>(`/api/v1/me/bills?${new URLSearchParams({ kind, page: String(page), pageSize: '20' })}`, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setResult(data); })
      .catch((failure: ApiError) => { if (!controller.signal.aborted) { if (failure.status === 401) onAuthExpired(); else setError('账单加载失败，请重试。'); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [kind, page, revision, onAuthExpired]);
  const summary = result?.summary;
  const pending = page === 1 && kind !== 'recharge' ? result?.pending ?? [] : [];
  return <div className="user-billing">
    <div className="stat-grid billing-stats">
      <div className="stat"><div className="account-card-heading"><span className="stat-label">当前余额</span><button className="mini-button" onClick={onTopup}>充值</button></div><strong>{summary ? money(summary.balance) : '—'}</strong><small>以服务端钱包为准</small></div>
      <div className="stat"><span className="stat-label">累计充值 / 增加</span><strong>{summary ? money(summary.totalAdded) : '—'}</strong><small>含管理员增加、奖励与赠送</small></div>
      <div className="stat"><span className="stat-label">已结算消耗</span><strong>{summary ? money(summary.totalConsumed) : '—'}</strong><small>未包含当前待结算区间</small></div>
    </div>
    <section className="panel billing-panel" aria-busy={loading}>
      <div className="account-section-heading"><div className="billing-tabs" role="tablist" aria-label="账单分类">
        {([['all', '全部'], ['recharge', '充值'], ['consumption', '消耗']] as const).map(([id, title]) => <button type="button" role="tab" key={id} aria-selected={kind === id}
          onClick={() => { if (kind === id && page === 1) return; setLoading(true); setKind(id); setPage(1); }}>{title}</button>)}
      </div><button className="mini-button" disabled={loading} onClick={() => { setLoading(true); setRevision(value => value + 1); }}>刷新</button></div>
      <p className="billing-explanation">同一台设备再次上线时，归集上一次上线后的实际扣款。当前区间显示“待结算”，不会重复扣费；余额仍按实际使用扣减。时间为北京时间。</p>
      {error && <div className="billing-error" role="alert">{error} <button className="mini-button" onClick={() => { setLoading(true); setRevision(value => value + 1); }}>重试</button></div>}
      {loading ? <div className="billing-loading" role="status">正在读取账单…<div/><div/><div/></div> : !error && <>
        <table className="data-table billing-table"><thead><tr><th>项目 / 设备</th><th>时间 / 结算区间</th><th>明细 / 状态</th><th>金额</th></tr></thead><tbody>
          {pending.map(row => <tr key={`pending:${row.id}`}><td><strong>{row.deviceName}</strong><small>设备号：{row.deviceId}</small></td><td>{date(row.startedAt)} → 至今<small>设备消耗</small></td><td>下次上线时结算<small className="billing-badge pending">待结算</small></td><td className="billing-amount">—</td></tr>)}
          {result?.data.map(row => <tr key={row.id}><td><strong>{row.category === 'CONSUMPTION' ? row.deviceName ?? '未知设备' : balanceTitle(row)}</strong>
            <small>{row.deviceId ? `设备号：${row.deviceId}` : row.points > 0 ? '余额增加' : '余额调整'}</small></td>
            <td>{row.category === 'CONSUMPTION' && row.startedAt ? <>{date(row.startedAt)} → {date(row.endedAt!)}</> : date(row.occurredAt)}
              <small>{row.periodKind === 'HISTORICAL' ? '历史消耗汇总（未按上线区间拆分）' : row.category === 'CONSUMPTION' ? '设备消耗' : '余额变动'}</small></td>
            <td>{row.balanceAfter !== null ? <span>余额 {money(row.balanceAfter - row.points)} → {money(row.balanceAfter)}</span> : <span>结算于 {date(row.occurredAt)}</span>}
              <small className="billing-badge">{row.category === 'CONSUMPTION' ? '已结算' : '已入账'}</small></td>
            <td className={`billing-amount ${row.points > 0 ? 'credit' : ''}`}>{row.points > 0 ? '+' : row.points < 0 ? '−' : ''}{money(Math.abs(row.points))}</td></tr>)}
        </tbody></table>
        {!result?.data.length && !pending.length && <div className="empty">暂无{kind === 'recharge' ? '充值' : kind === 'consumption' ? '消耗' : '账单'}记录。</div>}
        {result && <div className="billing-pagination"><span>已入账记录 {result.total} 条 · 第 {page} / {Math.max(1, Math.ceil(result.total / result.pageSize))} 页{pending.length > 0 ? ` · 另有 ${pending.length} 个待结算区间` : ''}</span><div className="inline-actions">
          <button className="mini-button" disabled={page <= 1} onClick={() => { setLoading(true); setPage(value => value - 1); }}>上一页</button>
          <button className="mini-button" disabled={page * result.pageSize >= result.total} onClick={() => { setLoading(true); setPage(value => value + 1); }}>下一页</button>
        </div></div>}
      </>}
    </section>
  </div>;
}
