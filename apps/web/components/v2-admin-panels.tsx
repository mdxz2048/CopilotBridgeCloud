'use client';
import { useCallback, useEffect, useId, useState } from 'react';
import { api, post, put } from '../lib/api';
import {ModelPricingPanel} from './model-pricing-panel';
import {CostAnalyticsPanel} from './cost-analytics-panel';

type Row = Record<string, unknown> & { id?: string };
type V2Section = 'v2-wallets' | 'v2-rates' | 'v2-referrals' | 'v2-costs';
const show = (value: unknown) => value === null || value === undefined ? '—' : String(value);
function CellInput({ label, value, set, type = 'text' }: { label: string; value: string; set: (value: string) => void; type?: string }) {
  const id=useId();
  return <div className="field"><label htmlFor={id}>{label}</label><input id={id} type={type} step={type==='number'?'any':undefined} value={value} onChange={event => set(event.target.value)}/></div>;
}

export function V2AdminPanel({ section }: { section: V2Section }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<Row | null>(null); const [form, setForm] = useState<Record<string,string>>({});
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const update = (key: string, value: string) => setForm(previous => ({ ...previous, [key]: value }));
  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (section === 'v2-wallets') setRows((await api<{data:Row[]}>('/api/v1/admin/wallets')).data);
      if (section === 'v2-referrals') {
        const [list, settings] = await Promise.all([api<{data:Row[]}>('/api/v1/admin/referrals'), api<{policy:{enabled:boolean;minPaidAmount:number;referrerPoints:number;referredPoints:number}}>('/api/v1/admin/referral-policy')]);
        setRows(list.data); setForm(previous => ({ ...previous, policyEnabled: String(settings.policy.enabled), minPaidAmount: String(settings.policy.minPaidAmount),
          referrerPoints: String(settings.policy.referrerPoints), referredPoints: String(settings.policy.referredPoints) }));
      }
    } catch (error) { setMessage((error as {message?:string}).message ?? '加载失败'); }
    finally { setLoading(false); }
  }, [section]);
  useEffect(() => { void load(); }, [load]);
  async function run(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true); setMessage('');
    try { await action(); setMessage('已保存'); await load(); }
    catch (error) { setMessage((error as {message?:string}).message ?? '操作失败'); }
    finally { setBusy(false); }
  }
  return <>
    {message && <div className="notice" role="status">{message}</div>}
    {loading && <div className="loading-skeleton"/>}
    {!loading && section === 'v2-wallets' && <>
      <section className="panel"><h2>AI 点数钱包</h2><p>余额来自账本；调整点数需要填写原因并生成审计记录。</p><div className="table-wrap"><table className="data-table"><thead><tr><th>用户</th><th>余额</th><th>更新时间</th><th>操作</th></tr></thead><tbody>{rows.map(row => <tr key={row.userId as string}><td>{show(row.email)}</td><td>{show(row.balance)} 点</td><td>{show(row.updatedAt)}</td><td><button className="mini-button" onClick={() => { setSelected(row); setForm({}); }}>调整</button></td></tr>)}</tbody></table></div></section>
      {selected && <section className="panel"><h2>调整 {show(selected.email)} 的点数</h2><div className="form-grid"><CellInput label="点数（负数为扣减）" value={form.points ?? ''} set={value => update('points', value)} type="number"/><CellInput label="原因（至少 10 字）" value={form.reason ?? ''} set={value => update('reason', value)}/></div><button disabled={busy} className="button button-small" onClick={() => run(() => post(`/api/v1/admin/users/${selected.userId}/wallet/adjust`, { points: Number(form.points), reason: form.reason, idempotencyKey: crypto.randomUUID() }))}>记录调整</button></section>}
    </>}
    {section === 'v2-rates' && <ModelPricingPanel/>}
    {!loading && section === 'v2-referrals' && <>
      <section className="panel"><h2>邀请资格与风控</h2><div className="table-wrap"><table className="data-table"><thead><tr><th>邀请人</th><th>受邀人</th><th>状态</th><th>风险标记</th><th>操作</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td>{show(row.referrerUserId)}</td><td>{show(row.referredUserId)}</td><td>{show(row.status)}</td><td>{Array.isArray(row.riskFlags) ? row.riskFlags.join(', ') || '—' : '—'}</td><td>{['PENDING','REGISTERED'].includes(String(row.status)) && <button className="mini-button" onClick={() => { setSelected(row); setForm({}); }}>审核</button>}</td></tr>)}</tbody></table></div></section>
      {selected && <section className="panel"><h2>审核邀请</h2><p>{show(selected.id)}</p><CellInput label="审核原因" value={form.reviewReason ?? ''} set={value => update('reviewReason', value)}/><div className="inline-actions"><button disabled={busy} className="mini-button" onClick={() => run(() => post(`/api/v1/admin/referrals/${selected.id}/review`, {decision:'APPROVE',reason:form.reviewReason}))}>批准</button><button disabled={busy} className="mini-button danger" onClick={() => run(() => post(`/api/v1/admin/referrals/${selected.id}/review`, {decision:'REJECT',reason:form.reviewReason}))}>拒绝</button></div></section>}
      <section className="panel"><h2>邀请奖励规则</h2><p>默认关闭；仅符合已付款订单门槛的邀请可发奖。</p><div className="form-grid"><div className="field"><label>状态</label><select value={form.policyEnabled ?? 'false'} onChange={event => update('policyEnabled',event.target.value)}><option value="false">关闭</option><option value="true">开启</option></select></div><CellInput label="最低付款金额" value={form.minPaidAmount ?? '0'} set={value => update('minPaidAmount',value)} type="number"/><CellInput label="邀请人点数" value={form.referrerPoints ?? '0'} set={value => update('referrerPoints',value)} type="number"/><CellInput label="受邀人点数" value={form.referredPoints ?? '0'} set={value => update('referredPoints',value)} type="number"/></div><button disabled={busy} className="button button-small" onClick={() => run(() => put('/api/v1/admin/referral-policy', {enabled: form.policyEnabled === 'true',minPaidAmount:Number(form.minPaidAmount ?? 0),referrerPoints:Number(form.referrerPoints ?? 0),referredPoints:Number(form.referredPoints ?? 0)}))}>保存规则</button></section>
    </>}
    {!loading && section === 'v2-costs' && <CostAnalyticsPanel/>}
  </>;
}
