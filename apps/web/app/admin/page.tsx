'use client';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell, type NavItem } from '../../components/app-shell';
import { api, patch, post, put, type Plan } from '../../lib/api';
import { V2AdminPanel } from '../../components/v2-admin-panels';
import { CopilotAuthCard } from '../../components/copilot-auth-card';
import { WebsiteSettings } from '../../components/website-settings';
import { DeepSeekConnectionCard } from '../../components/deepseek-connection-card';
import { ModelInstanceManager } from '../../components/model-instance-manager';
import { MoneyPlanManager } from '../../components/money-plan-manager';
import { AdminUserDialog, CreateUserDialog } from '../../components/admin-user-dialog';
import { ReleaseUpload } from '../../components/release-upload';
import { AdminInsights } from '../../components/admin-insights';
import { FailureFeedback } from '../../components/failure-feedback';

const items: NavItem[] = [
  {id:'models',label:'模型与连接',icon:'Boxes'},
  {id:'users',label:'用户与权限',icon:'Users'},
  {id:'money-plans',label:'套餐与计费',icon:'Boxes'},
  {id:'v2-rates',label:'模型售价',icon:'Boxes'},

  {id:'failures',label:'失败反馈',icon:'Activity'},
  {id:'audit',label:'操作记录',icon:'ScrollText'},
];
type Row = Record<string, unknown> & { id?: string };
type RatePolicy = { accountRpm: number; deviceRpm: number; publicIpRpm: number; authIpRpm: number };
type ModelAccess = {
  planAccess: Array<{ planId: string; modelId: string }>;
  overrides: Array<{ modelId: string; access: string }>;
  subscription: { planId: string; planCode: string; status: string } | null;
  effectiveModelIds: string[];
};
const resourcePaths: Record<string, string> = { users: 'users', devices: 'devices', plans: 'plans', subscriptions: 'subscriptions', usage: 'usage', orders: 'orders', providers: 'providers', models: 'models', releases: 'releases', audit: 'audit' };
const columns: Record<string, string[]> = {
  users: ['email', 'role', 'status', 'createdAt'], devices: ['deviceName', 'platform', 'status', 'lastSeenAt'], plans: ['code', 'name', 'monthlyPrice', 'monthlyPoints', 'rolloverPolicy', 'maxDevices', 'enabled'],
  subscriptions: ['userId', 'planId', 'status', 'currentPeriodEnd'], usage: ['userId', 'status', 'totalTokens', 'usageCredit', 'costKind', 'createdAt'],
  orders: ['orderNo', 'userId', 'amount', 'provider', 'status'], providers: ['name', 'code', 'enabled', 'baseUrl'], models: ['displayName', 'publicId', 'enabled', 'usageWeight'],
  releases: ['version', 'channel', 'platform', 'published', 'createdAt'], audit: ['action', 'targetType', 'targetId', 'createdAt'],
};
function display(value: unknown) { if (value === null || value === undefined) return '—'; if (typeof value === 'boolean') return value ? '是' : '否'; if (typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value)) return new Date(value).toLocaleString('zh-CN'); return String(value); }
function Field({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; type?: string }) { const id = useId(); return <div className="field"><label htmlFor={id}>{label}</label><input id={id} type={type} value={value} onChange={e => onChange(e.target.value)}/></div>; }
function modelAvailability(model: Row, provider: Row | undefined, access: ModelAccess) {
  if (access.effectiveModelIds.includes(String(model.id))) return '当前账号可用';
  if (!access.subscription) return '无有效订阅';
  if (!provider?.enabled) return 'Provider 未启用';
  if (!model.enabled) return '模型未启用';
  const override = access.overrides.find(row => row.modelId === model.id)?.access;
  if (override === 'DENY') return '用户特例拒绝';
  if (override !== 'ALLOW' && !access.planAccess.some(row => row.planId === access.subscription?.planId && row.modelId === model.id))
    return '套餐未开放';
  return '其他服务端限制（如测试 Mock 范围）';
}

export default function AdminPage() {
  const [creatingUser, setCreatingUser] = useState(false);
  const router = useRouter(); const [active, setActive] = useState('models'); const [email, setEmail] = useState(''); const [rows, setRows] = useState<Row[]>([]); const [dashboard, setDashboard] = useState<Record<string, number>>({}); const [system, setSystem] = useState<Record<string, unknown>>({}); const [rateDraft, setRateDraft] = useState<Record<keyof RatePolicy, string> | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [search, setSearch] = useState(''); const [selected, setSelected] = useState<Row | null>(null); const [form, setForm] = useState<Record<string, string>>({}); const [plans, setPlans] = useState<Plan[]>([]); const [providers, setProviders] = useState<Row[]>([]); const [models, setModels] = useState<Row[]>([]);
  const [planAccess, setPlanAccess] = useState<ModelAccess | null>(null); const [userAccess, setUserAccess] = useState<ModelAccess | null>(null);
  const [userAccessId, setUserAccessId] = useState('');
  const [accessError, setAccessError] = useState(''); const [accessLoading, setAccessLoading] = useState(false); const [accessRevision, setAccessRevision] = useState(0);
  const [running, setRunning] = useState(false);
  const [setupProvider, setSetupProvider] = useState<Row | null>(null);
  const [modelProviderReady, setModelProviderReady] = useState('');
  const loadVersion = useRef(0);
  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    setLoading(true); setError('');
    if (active === 'models' || active === 'plans') setPlanAccess(null);
    try {
      const me = await api<{ user: { email: string; role: string } }>('/api/v1/auth/me');
      if (version !== loadVersion.current) return false;
      if (me.user.role !== 'ADMIN') { router.replace('/dashboard'); return false; }
      setEmail(me.user.email);
      if (active.startsWith('v2-') || active === 'website-settings' || active === 'money-plans' || active === 'failures') return true;
      if (active === 'dashboard') {
        const result = await api<Record<string, number>>('/api/v1/admin/dashboard');
        if (version !== loadVersion.current) return false;
        setDashboard(result);
      }
      else if (active === 'system') {
        const [diagnostics, rates] = await Promise.all([api<Record<string, unknown>>('/api/v1/admin/system'),
          api<{ policy: RatePolicy }>('/api/v1/admin/rate-policy')]);
        if (version !== loadVersion.current) return false;
        setSystem(diagnostics);
        setRateDraft(Object.fromEntries(Object.entries(rates.policy).map(([name, value]) => [name, String(value)])) as Record<keyof RatePolicy, string>);
      }
      else { const result = await api<{ data: Row[] }>(`/api/v1/admin/${resourcePaths[active]}${active === 'users' && search ? `?search=${encodeURIComponent(search)}` : ''}`); if (version !== loadVersion.current) return false; setRows(active === 'models' ? result.data.filter(row => !String(row.publicId).startsWith('mock/') && (row.enabled || !['deepseek/deepseek-chat','deepseek/deepseek-reasoner'].includes(String(row.publicId)))) : result.data); }
      if (active === 'models' || active === 'plans') {
        const [p, providersResult, modelsResult, access] = await Promise.all([
          api<{ data: Plan[] }>('/api/v1/admin/plans'),
          api<{ data: Row[] }>('/api/v1/admin/providers'),
          api<{ data: Row[] }>('/api/v1/admin/models'),
          api<ModelAccess>('/api/v1/admin/model-access'),
        ]);
        if (version !== loadVersion.current) return false;
        setPlans(p.data); setProviders(providersResult.data); setModels(modelsResult.data); setPlanAccess(access);
      }
      if (active === 'users') {
        const [m, p] = await Promise.all([api<{ data: Row[] }>('/api/v1/admin/models'), api<{ data: Row[] }>('/api/v1/admin/providers')]);
        if (version !== loadVersion.current) return false;
        setModels(m.data); setProviders(p.data);
      }
      if (active === 'subscriptions') { const p = await api<{ data: Plan[] }>('/api/v1/admin/plans'); if (version !== loadVersion.current) return false; setPlans(p.data); }
      if (active === 'providers') { const m = await api<{ data: Row[] }>('/api/v1/admin/models'); if (version !== loadVersion.current) return false; setModels(m.data); }
      return true;
    } catch (e) { if (version === loadVersion.current) setError((e as { message?: string }).message ?? '暂时无法加载'); return false; }
    finally { if (version === loadVersion.current) setLoading(false); }
  }, [active, router, search]);
  useEffect(() => { void load(); return () => { loadVersion.current++; }; }, [load]);
  useEffect(() => {
    if (active !== 'users' || !selected?.id) return;
    let cancelled = false;
    setUserAccess(null); setUserAccessId(''); setAccessError(''); setAccessLoading(true);
    void api<ModelAccess>(`/api/v1/admin/model-access?userId=${selected.id}`)
      .then(value => { if (!cancelled) { setUserAccess(value); setUserAccessId(selected.id!); } })
      .catch(() => { if (!cancelled) setAccessError('模型权限加载失败，请重试。'); })
      .finally(() => { if (!cancelled) setAccessLoading(false); });
    return () => { cancelled = true; };
  }, [active, selected?.id, accessRevision]);
  function update(key: string, value: string) { setForm(prev => ({ ...prev, [key]: value })); }
  async function run(action: () => Promise<unknown>, success = '已保存', keepSelection = false) {
    if (running) return;
    setRunning(true);
    setMessage('');
    try {
      await action();
      if (keepSelection && active === 'users') setUserAccess(null);
      const refreshed = await load();
      if (keepSelection) setAccessRevision(value => value + 1);
      else setSelected(null);
      setMessage(refreshed ? success : '操作已提交，但状态刷新失败，请重试读取。');
    } catch (e) { setMessage((e as { message?: string }).message ?? '操作失败'); }
    finally { setRunning(false); }
  }
  const title = items.find(i => i.id === active)?.label ?? 'Admin';
  if (!email) return <div className="auth-wrap"><div className="auth-card">
    {error ? <><h1>暂时无法验证管理员身份</h1><p role="alert">{error}</p><button className="button" onClick={() => void load()}>重试</button></>
      : <p role="status">正在验证管理员身份…</p>}
  </div></div>;
  return <AppShell title={title} description="管理账号、权限、模型与服务状态。" items={items} active={active} onChange={id => {setLoading(true);setRows([]);setEmail('');setActive(id);setSelected(null);setForm({});setSearch('');setMessage('');setSetupProvider(null);setModelProviderReady('');}} email={email} admin>
    {message && <div className="notice" role="status">{message}</div>}{error && <div className="error-text" role="alert">{error} <button className="mini-button" onClick={load}>重试</button></div>}
    {loading && <div className="loading-skeleton"/>}
    {active === 'money-plans' && <MoneyPlanManager/>}
    {!loading && active === 'failures' && <FailureFeedback/>}
    {active === 'models' && <><DeepSeekConnectionCard onReady={() => void load()}/><ModelInstanceManager refreshKey={providers.map(p=>`${p.id}:${p.enabled}`).join(',')+models.map(m=>m.id).join(',')}/></> }
    {!loading && active === 'website-settings' && <WebsiteSettings/>}
    {!loading && active.startsWith('v2-') && <V2AdminPanel section={active as 'v2-wallets' | 'v2-rates' | 'v2-referrals' | 'v2-costs'}/>}
    {!loading && active === 'dashboard' && <AdminInsights totals={dashboard}/>}
    {!loading && active === 'system' && <>
      <section className="panel"><h2>系统诊断</h2><p>Database: {display(system.database)}</p><p>Gateway: {display(system.gateway)}</p><p>配置项：{Array.isArray(system.settings) ? system.settings.length : 0}</p></section>
      {rateDraft && <section className="panel"><h2>请求限额</h2><p>初始 AI 限额：每账号 2 次新提问/分钟、每设备 1 次新提问/分钟；同一轮中服务端待处理的工具续接最多 8 次、5 分钟内完成，仍计入套餐用量。JSON 与流式新提问均限流。公开接口按可信代理解析的 IP 限流；认证接口另有更严格的 IP 限额。</p>
        <div className="form-grid">{([
          ['accountRpm', '每账号 AI 新提问 / 分钟', 120], ['deviceRpm', '每设备 AI 新提问 / 分钟', 60],
          ['publicIpRpm', '公开接口每 IP 请求 / 分钟', 120], ['authIpRpm', '认证接口每 IP 请求 / 分钟', 120],
        ] as const).map(([key, label, max]) => <div className="field" key={key}><label htmlFor={key}>{label}</label>
          <input id={key} type="number" min={1} max={max} step={1} value={rateDraft[key]}
            onChange={event => setRateDraft(previous => previous ? { ...previous, [key]: event.target.value } : previous)}/></div>)}</div>
        <button disabled={running} className="button button-small" onClick={() => run(() => put('/api/v1/admin/rate-policy', {
          accountRpm: Number(rateDraft.accountRpm), deviceRpm: Number(rateDraft.deviceRpm),
          publicIpRpm: Number(rateDraft.publicIpRpm), authIpRpm: Number(rateDraft.authIpRpm),
        }), '请求限额已保存并审计')}>保存限额</button>
      </section>}
    </>}
    {!loading && active === 'providers' && rows.some(row => row.code === 'COPILOT') && <CopilotAuthCard/>}
    {active === 'users' && <button className="button button-small" onClick={() => setCreatingUser(true)}>创建用户</button>}
    {!loading && resourcePaths[active] && <><div className="toolbar"><h2>{title} <span style={{fontSize:12,color:'#9aa69b'}}>({rows.length})</span></h2>{active === 'users' && <input className="search-input" value={search} onChange={e => {setRows([]);setSelected(null);setSearch(e.target.value);}} placeholder="搜索邮箱" aria-label="搜索用户"/>}</div><section className="panel" style={{marginTop:0,padding:0}}>{rows.length ? <div className="table-wrap"><table className="data-table"><thead><tr>{columns[active]?.map(c => <th key={c}>{c}</th>)}<th>操作</th></tr></thead><tbody>{rows.map((row, idx) => <tr key={row.id ?? idx}>{columns[active]?.map(c => <td key={c}>{c === 'status' || c === 'enabled' || c === 'published' ? <span className={`badge ${row[c] === 'ACTIVE' || row[c] === true || row[c] === 'COMPLETED' ? '' : 'muted'}`}>{display(row[c])}</span> : display(row[c])}</td>)}<td><div className="inline-actions">
      {active === 'providers' && row.code === 'COPILOT' ? <span>见上方认证卡</span> : ['users','plans','providers','models','releases'].includes(active) && <button className="mini-button" onClick={() => {setSelected(row);setForm({});setUserAccess(null);setUserAccessId('');}}>管理</button>}
      {active === 'devices' && <button className="mini-button" onClick={() => run(() => patch(`/api/v1/admin/devices/${row.id}`, { status: row.status === 'ACTIVE' ? 'REVOKED' : 'ACTIVE' }))}>{row.status === 'ACTIVE' ? '停用' : '恢复'}</button>}
      {active === 'orders' && row.status === 'PENDING' && row.provider === 'MANUAL' && <button className="mini-button" onClick={() => run(() => post(`/api/v1/admin/orders/${row.id}/mark-paid`, {}), '手工订单已入账')}>确认收款</button>}
      {active === 'subscriptions' && <button className="mini-button" onClick={() => {setSelected(row);setForm({});}}>调整</button>}
    </div></td></tr>)}</tbody></table></div> : <div className="empty"><strong>暂无记录</strong>新数据出现后会显示在这里。</div>}</section></>}

    {active === 'users' && selected?.id && <AdminUserDialog userId={selected.id} onClose={() => setSelected(null)} onChanged={() => void load()}/>}
    {creatingUser && <CreateUserDialog onClose={() => setCreatingUser(false)} onCreated={() => void load()}/>}
    {active === 'plans' && selected && <section className="panel"><h2>编辑 {display(selected.code)}</h2><p>正式产品方向只按模型实际用量扣点，不收月费。以下周期字段仅保留旧版测试开通兼容，不能当作正式收费设置；模型按量单价在「按量费率」发布。</p><div className="form-grid">{[['name','名称'],['description','描述'],['monthlyPrice','旧版测试月费（不对外展示）'],['monthlyPoints','旧版测试周期点数'],['currency','货币'],['maxDevices','设备上限'],['monthlyTokenLimit','月 Token 上限（旧版）'],['monthlyUsageCreditLimit','月 Credit 上限（旧版）'],['maxConcurrentRequests','最大并发'],['requestsPerMinute','每分钟请求']].map(([key,label]) => <Field key={key} label={label} value={form[key] ?? display(selected[key])} onChange={v => update(key,v)}/>)}</div><div className="field"><label>旧版测试点数结转</label><select value={form.rolloverPolicy ?? String(selected.rolloverPolicy ?? 'NONE')} onChange={e => update('rolloverPolicy',e.target.value)}><option value="NONE">周期结束后到期</option><option value="UNLIMITED">保留</option></select></div><label style={{fontSize:12}}><input type="checkbox" checked={(form.enabled ?? String(selected.enabled)) === 'true'} onChange={e => update('enabled', String(e.target.checked))}/> 启用套餐</label><div className="form-actions"><button className="button button-small" onClick={() => run(() => patch(`/api/v1/admin/plans/${selected.id}`, { name: form.name ?? selected.name, description: form.description ?? selected.description, monthlyPrice: Number(form.monthlyPrice ?? selected.monthlyPrice), monthlyPoints: Number(form.monthlyPoints ?? selected.monthlyPoints ?? 0), rolloverPolicy: form.rolloverPolicy ?? selected.rolloverPolicy ?? 'NONE', currency: form.currency ?? selected.currency, maxDevices: Number(form.maxDevices ?? selected.maxDevices), monthlyTokenLimit: Number(form.monthlyTokenLimit ?? selected.monthlyTokenLimit), monthlyUsageCreditLimit: Number(form.monthlyUsageCreditLimit ?? selected.monthlyUsageCreditLimit), maxConcurrentRequests: Number(form.maxConcurrentRequests ?? selected.maxConcurrentRequests), requestsPerMinute: Number(form.requestsPerMinute ?? selected.requestsPerMinute), enabled: (form.enabled ?? String(selected.enabled)) === 'true' }))}>保存套餐</button></div>
      <h3>绑定模型</h3>{!planAccess ? <p role="status">正在加载套餐模型权限…</p> : models.map(model => {
        const allowed = planAccess.planAccess.some(access => access.modelId === model.id && access.planId === selected.id);
        return <div key={model.id} className="inline-actions" style={{marginBottom:9}}><span style={{minWidth:220}}>{display(model.displayName)} · {model.enabled ? '已启用' : '停用'}</span><button className="mini-button" disabled={running || allowed} onClick={() => run(() => put(`/api/v1/admin/models/${model.id}/plans/${selected.id}`, { allowed: true }), '套餐模型已开放', true)}>绑定</button><button className="mini-button danger" disabled={running || !allowed} onClick={() => run(() => put(`/api/v1/admin/models/${model.id}/plans/${selected.id}`, { allowed: false }), '套餐模型已移除', true)}>移除</button></div>;
      })}</section>}

    {active === 'subscriptions' && <section className="panel"><h2>手工开通</h2><div className="form-grid"><Field label="用户 UUID" value={form.userId ?? ''} onChange={v => update('userId',v)}/><div className="field"><label>套餐</label><select value={form.planCode ?? 'STANDARD'} onChange={e => update('planCode',e.target.value)}>{plans.map(p => <option key={p.id}>{p.code}</option>)}</select></div><Field label="天数" type="number" value={form.days ?? '30'} onChange={v => update('days',v)}/></div><button className="button button-small" onClick={() => run(() => post('/api/v1/admin/subscriptions/grant', { userId: form.userId, planCode: form.planCode ?? 'STANDARD', days: Number(form.days ?? 30) }), '订阅已开通')}>开通订阅</button></section>}
    {active === 'subscriptions' && selected && <section className="panel"><h2>调整订阅</h2><p>{selected.id}</p><div className="form-grid"><div className="field"><label>操作</label><select value={form.action ?? 'EXTEND'} onChange={e => update('action',e.target.value)}>{['EXTEND','SUSPEND','CANCEL','UPGRADE','DOWNGRADE'].map(v => <option key={v}>{v}</option>)}</select></div><Field label="延长天数" type="number" value={form.days ?? '30'} onChange={v => update('days',v)}/><div className="field"><label>目标套餐</label><select value={form.planCode ?? 'PRO'} onChange={e => update('planCode',e.target.value)}>{plans.map(p => <option key={p.id}>{p.code}</option>)}</select></div></div><button className="button button-small" onClick={() => run(() => patch(`/api/v1/admin/subscriptions/${selected.id}`, { action: form.action ?? 'EXTEND', days: Number(form.days ?? 30), planCode: form.planCode ?? 'PRO' }))}>应用调整</button></section>}

    {active === 'providers' && selected && selected.code !== 'COPILOT' && <section className="panel"><h2>{display(selected.name)}</h2><p>API Key 保存后只显示掩码。Copilot Provider 在授权评审前保持禁用。</p><div className="form-grid"><Field label="Base URL" value={form.baseUrl ?? String(selected.baseUrl ?? '')} onChange={v => update('baseUrl',v)}/><Field label="超时（毫秒）" type="number" value={form.timeoutMs ?? String(selected.timeoutMs ?? 60000)} onChange={v => update('timeoutMs',v)}/><Field label="新 API Key（留空则不修改）" type="password" value={form.apiKey ?? ''} onChange={v => update('apiKey',v)}/></div><label style={{fontSize:12}}><input type="checkbox" checked={(form.enabled ?? String(selected.enabled)) === 'true'} onChange={e => update('enabled',String(e.target.checked))}/> 启用 Provider</label><div className="form-actions"><button className="button button-small" onClick={() => run(() => patch(`/api/v1/admin/providers/${selected.id}`, {enabled:(form.enabled ?? String(selected.enabled)) === 'true',baseUrl:form.baseUrl || selected.baseUrl || undefined,timeoutMs:Number(form.timeoutMs ?? selected.timeoutMs),apiKey:form.apiKey || undefined}))}>保存 Provider</button><button className="mini-button" onClick={() => run(async () => { const result = await api<{ready:boolean;reason?:string}>(`/api/v1/admin/providers/${selected.id}/health`); setMessage(result.ready ? 'Provider 正常' : `Provider 不可用：${result.reason}`); })}>健康检查</button></div><p>已配置模型：{models.filter(m => m.providerId === selected.id).length}</p></section>}


    {active === 'models' && selected && <section className="panel"><h2>{display(selected.displayName)}</h2><p>{display(selected.publicId)} · {selected.enabled ? '模型已启用' : '模型停用'} · Provider {providers.find(row => row.id === selected.providerId)?.enabled ? '已启用' : '停用'}</p><div className="inline-actions"><button className="mini-button" onClick={() => run(() => patch(`/api/v1/admin/models/${selected.id}`, { enabled: !selected.enabled }))}>{selected.enabled ? '停用模型' : '启用模型'}</button></div><div className="form-grid"><Field label="Usage Weight" type="number" value={form.usageWeight ?? String(selected.usageWeight)} onChange={v => update('usageWeight',v)}/></div><button className="mini-button" onClick={() => run(() => patch(`/api/v1/admin/models/${selected.id}`, { usageWeight: Number(form.usageWeight ?? selected.usageWeight) }))}>保存权重</button>
      <h3 style={{fontSize:14,marginTop:30}}>套餐 ACL（配置值，非最终可用性）</h3>
      {!planAccess && <p className="error-text">套餐权限尚未加载；请使用上方重试按钮刷新后操作。</p>}
      {plans.map(p => {
        const allowed = planAccess?.planAccess.some(row => row.modelId === selected.id && row.planId === p.id);
        return <div className="inline-actions" style={{marginBottom:9}} key={p.id}><span style={{minWidth:160,fontSize:12}}>{p.name}（{p.enabled ? '启用' : '停用'}）：{planAccess ? allowed ? '已开放' : '未开放' : '读取中'}</span><button className="mini-button" disabled={running || !planAccess || Boolean(allowed)} onClick={() => run(() => put(`/api/v1/admin/models/${selected.id}/plans/${p.id}`, { allowed:true }), `${p.name} 套餐 ACL 已开放`, true)}>开放</button><button className="mini-button danger" disabled={running || !planAccess || !allowed} onClick={() => run(() => put(`/api/v1/admin/models/${selected.id}/plans/${p.id}`, { allowed:false }), `${p.name} 套餐 ACL 已关闭`, true)}>关闭</button></div>;
      })}
      <p>先在“模型售价”发布售价，再启用逻辑模型与已验证实例，并在“用户与权限”分配逻辑模型。实际可用性仍由服务端按订阅、额度、用户权限和实例状态判断。</p>
      <button className="mini-button" onClick={()=>{setActive('v2-rates');setSelected(null);setForm({});}}>配置模型售价</button>
    </section>}

    {active === 'releases' && <ReleaseUpload onUploaded={() => { setMessage('安装包已上传并计算 SHA-256；仍是未发布草稿，请核对后发布。'); void load(); }}/>}
    {active === 'releases' && selected && <section className="panel"><h2>{display(selected.version)}</h2><p>{display(selected.downloadUrl)}</p><p>SHA-256：<code>{display(selected.sha256)}</code></p><button className="button button-small" onClick={() => run(() => patch(`/api/v1/admin/releases/${selected.id}`, {published:!selected.published}), selected.published ? '已取消发布' : '已发布')}>{selected.published ? '取消发布' : '发布'}</button></section>}
  </AppShell>;
}
