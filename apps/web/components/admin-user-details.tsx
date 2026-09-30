'use client';

import { useEffect, useState } from 'react';
import { api, patch } from '../lib/api';

type Detail = {
  user: { email: string; status: string };
  devices: Array<{ id: string; deviceName: string; status: string; lastSeenAt: string | null }>;
  subscriptions: Array<{ id: string; status: string; currentPeriodEnd: string }>;
};
type Finance = {
  wallet: { balance: number };
  transactions: Array<{ id: string; type: string; points: number; createdAt: string }>;
};
type Activity = {
  inviteCount: number;
  invited: Array<{ status: string; registeredAt: string; qualifiedAt: string | null }>;
  referredBy: { status: string } | null;
  orders: Array<{ id: string; amount: string; status: string; createdAt: string }>;
};

export function AdminUserDetails({ userId }: { userId: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [finance, setFinance] = useState<Finance | null>(null);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setDetail(null); setFinance(null); setActivity(null); setError('');
    void Promise.all([
      api<Detail>(`/api/v1/admin/users/${userId}`, { signal: controller.signal }),
      api<Finance>(`/api/v1/admin/users/${userId}/finance`, { signal: controller.signal }),
      api<Activity>(`/api/v1/admin/users/${userId}/activity`, { signal: controller.signal }),
    ]).then(([user, money, history]) => {
      if (!controller.signal.aborted) { setDetail(user); setFinance(money); setActivity(history); }
    }).catch((reason) => {
      if (!controller.signal.aborted) setError((reason as { message?: string }).message ?? '用户详情加载失败。');
    });
    return () => controller.abort();
  }, [userId, revision]);

  async function toggleDevice(id: string, status: string) {
    if (!window.confirm(status === 'ACTIVE' ? '确定停用此设备？' : '确定恢复此设备？')) return;
    setBusy(true); setError('');
    try {
      await patch(`/api/v1/admin/devices/${id}`, { status: status === 'ACTIVE' ? 'REVOKED' : 'ACTIVE' });
      setRevision(value => value + 1);
    } catch (reason) { setError((reason as { message?: string }).message ?? '设备操作失败。'); }
    finally { setBusy(false); }
  }

  if (error && !detail) return <p className="error-text" role="alert">{error} <button className="mini-button" onClick={() => setRevision(value => value + 1)}>重试</button></p>;
  if (!detail || !finance || !activity) return <p role="status">正在读取用户详情…</p>;
  return <div>
    {error && <p className="error-text" role="alert">{error}</p>}
    <div className="stat-grid"><div className="stat"><span className="stat-label">账号</span><strong>{detail.user.status}</strong><small>{detail.user.email}</small></div>
      <div className="stat"><span className="stat-label">AI 点数余额</span><strong>{finance.wallet.balance}</strong><small>以服务端钱包为准</small></div>
      <div className="stat"><span className="stat-label">活跃设备</span><strong>{detail.devices.filter(device => device.status === 'ACTIVE').length}</strong></div>
      <div className="stat"><span className="stat-label">邀请人数</span><strong>{activity.inviteCount}</strong><small>最近 100 条记录；{activity.referredBy ? '由其他用户邀请' : '未填写邀请'}</small></div></div>
    <h3>设备</h3>{detail.devices.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>名称</th><th>状态</th><th>最后活动</th><th>操作</th></tr></thead><tbody>{detail.devices.map(device => <tr key={device.id}><td>{device.deviceName}</td><td>{device.status}</td><td>{device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString('zh-CN') : '—'}</td><td><button className="mini-button" disabled={busy} onClick={() => void toggleDevice(device.id, device.status)}>{device.status === 'ACTIVE' ? '停用' : '恢复'}</button></td></tr>)}</tbody></table></div> : <p>暂无设备。</p>}
    <h3>测试开通记录</h3>{detail.subscriptions.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>状态</th><th>周期截止</th></tr></thead><tbody>{detail.subscriptions.map(entry => <tr key={entry.id}><td>{entry.status}</td><td>{new Date(entry.currentPeriodEnd).toLocaleString('zh-CN')}</td></tr>)}</tbody></table></div> : <p>暂无开通记录。当前不提供自动续费。</p>}
    <h3>点数记录</h3>{finance.transactions.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>时间</th><th>类型</th><th>变动</th></tr></thead><tbody>{finance.transactions.map(entry => <tr key={entry.id}><td>{new Date(entry.createdAt).toLocaleString('zh-CN')}</td><td>{entry.type}</td><td>{entry.points}</td></tr>)}</tbody></table></div> : <p>暂无点数流水。测算用量不代表实际扣费。</p>}
    <h3>邀请情况</h3>{activity.invited.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>注册时间</th><th>状态</th></tr></thead><tbody>{activity.invited.map((entry, index) => <tr key={`${entry.registeredAt}-${index}`}><td>{new Date(entry.registeredAt).toLocaleString('zh-CN')}</td><td>{entry.status}</td></tr>)}</tbody></table></div> : <p>暂无邀请记录。</p>}
    <h3>付款记录</h3>{activity.orders.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>时间</th><th>金额</th><th>状态</th></tr></thead><tbody>{activity.orders.map(entry => <tr key={entry.id}><td>{new Date(entry.createdAt).toLocaleString('zh-CN')}</td><td>¥{entry.amount}</td><td>{entry.status}</td></tr>)}</tbody></table></div> : <p>暂无付款记录。当前没有自动续费。</p>}
  </div>;
}
