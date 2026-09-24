'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, post, del } from '../lib/api';

type Section = 'points' | 'referral' | 'connections';
type LedgerRow = { id:string; type:string; points:number; balanceAfter:number; createdAt:string };
type ReferralRow = { id:string; status:string; registeredAt:string };
type Connection = { id:string; providerId:string; label:string; status:string; ownership:string };
type Provider = { id:string; code:string; name:string };
export function V2AccountPanel({ section }: { section: Section }) {
  const [balance, setBalance] = useState(0); const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [referral, setReferral] = useState<{code:string;registered:number;rewarded:number;pointsEarned:number}|null>(null);
  const [history, setHistory] = useState<ReferralRow[]>([]); const [connections, setConnections] = useState<Connection[]>([]); const [providers, setProviders] = useState<Provider[]>([]);
  const [input, setInput] = useState(''); const [label, setLabel] = useState('My DeepSeek'); const [apiKey, setApiKey] = useState('');
  const [providerId, setProviderId] = useState(''); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (section === 'points') {
        const [wallet, transactions] = await Promise.all([api<{balance:number}>('/api/v1/me/wallet'), api<{data:LedgerRow[]}>('/api/v1/me/wallet/transactions')]);
        setBalance(wallet.balance); setLedger(transactions.data);
      }
      if (section === 'referral') {
        const [stats, entries] = await Promise.all([api<{code:string;registered:number;rewarded:number;pointsEarned:number}>('/api/v1/referral/stats'), api<{data:ReferralRow[]}>('/api/v1/referral/history')]);
        setReferral(stats); setHistory(entries.data);
      }
      if (section === 'connections') {
        const [entries, available] = await Promise.all([api<{data:Connection[]}>('/api/v1/me/provider-connections'), api<{data:Provider[]}>('/api/v1/providers')]);
        setConnections(entries.data); setProviders(available.data.filter(item => item.code === 'DEEPSEEK'));
      }
    } catch (error) { setMessage((error as {message?:string}).message ?? '加载失败'); }
    finally { setLoading(false); }
  }, [section]);
  useEffect(() => { void load(); }, [load]);
  async function run(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true); setMessage('');
    try { await action(); setMessage('已保存'); setInput(''); setApiKey(''); await load(); }
    catch (error) { setMessage((error as {message?:string}).message ?? '操作失败'); }
    finally { setBusy(false); }
  }
  return <>
    {message && <div className="notice" role="status">{message}</div>}
    {loading && <div className="loading-skeleton"/>}
    {!loading && section === 'points' && <><div className="stat-grid"><div className="stat"><span className="stat-label">AI 点数余额</span><strong>{balance}</strong><small>点数与 Token 独立计算</small></div></div><section className="panel"><h2>点数流水</h2>{ledger.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>时间</th><th>类型</th><th>变动</th><th>余额</th></tr></thead><tbody>{ledger.map(row => <tr key={row.id}><td>{new Date(row.createdAt).toLocaleString('zh-CN')}</td><td>{row.type}</td><td>{row.points > 0 ? '+' : ''}{row.points}</td><td>{row.balanceAfter}</td></tr>)}</tbody></table></div> : <div className="empty"><strong>暂无点数记录</strong>订阅点数或用量结算后会显示在这里。</div>}</section></>}
    {!loading && section === 'referral' && <><div className="stat-grid"><div className="stat"><span className="stat-label">我的邀请码</span><strong style={{fontSize:20}}>{referral?.code ?? '—'}</strong></div><div className="stat"><span className="stat-label">已邀请</span><strong>{referral?.registered ?? 0}</strong></div><div className="stat"><span className="stat-label">已奖励</span><strong>{referral?.rewarded ?? 0}</strong></div><div className="stat"><span className="stat-label">奖励点数</span><strong>{referral?.pointsEarned ?? 0}</strong></div></div><section className="panel"><h2>填写邀请码</h2><p>邀请码须在开通订阅前填写；奖励在满足付款资格后发放。</p><div className="field"><label>邀请码</label><input value={input} onChange={event => setInput(event.target.value)}/></div><button disabled={busy || !input.trim()} className="button button-small" onClick={() => run(() => post('/api/v1/referral/apply', {code:input.trim()}))}>提交邀请码</button></section><section className="panel"><h2>邀请记录</h2>{history.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>时间</th><th>状态</th></tr></thead><tbody>{history.map(row => <tr key={row.id}><td>{new Date(row.registeredAt).toLocaleString('zh-CN')}</td><td>{row.status}</td></tr>)}</tbody></table></div> : <div className="empty"><strong>暂无邀请记录</strong>受邀用户使用邀请码后会显示在这里。</div>}</section></>}
    {!loading && section === 'connections' && <><section className="panel"><h2>我的 Provider 连接</h2>{connections.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>名称</th><th>类型</th><th>状态</th><th>操作</th></tr></thead><tbody>{connections.map(row => <tr key={row.id}><td>{row.label}</td><td>{row.ownership}</td><td>{row.status}</td><td>{row.status === 'ACTIVE' && <button disabled={busy} className="mini-button danger" onClick={() => run(() => del(`/api/v1/me/provider-connections/${row.id}`))}>断开</button>}</td></tr>)}</tbody></table></div> : <div className="empty"><strong>暂无连接</strong>可添加自己的 DeepSeek API Key。</div>}</section><section className="panel"><h2>添加 DeepSeek 连接</h2><p>密钥提交后加密保存，不会再次显示。创建连接前将验证密钥是否可用。</p>{providers.length ? <><div className="form-grid"><div className="field"><label>Provider</label><select value={providerId || providers[0].id} onChange={event => setProviderId(event.target.value)}>{providers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div><div className="field"><label>名称</label><input value={label} onChange={event => setLabel(event.target.value)}/></div><div className="field"><label>API Key</label><input type="password" value={apiKey} onChange={event => setApiKey(event.target.value)}/></div></div><button disabled={busy || apiKey.length < 8} className="button button-small" onClick={() => run(() => post('/api/v1/me/provider-connections', {providerId:providerId || providers[0].id,label,apiKey}))}>验证并保存</button></> : <p>DeepSeek Provider 尚未开放。</p>}</section></>}
  </>;
}
