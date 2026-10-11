'use client';
import { useCallback, useEffect, useId, useState } from 'react';
import { api, post, put } from '../lib/api';
import {rateDraftPayload,ratePointsToRmb} from './rate-money';
import {providerCanPriceModel} from './provider-kind';

type Row = Record<string, unknown> & { id?: string };
type V2Section = 'v2-wallets' | 'v2-rates' | 'v2-referrals' | 'v2-costs';
const show = (value: unknown) => value === null || value === undefined ? '—' : String(value);
function CellInput({ label, value, set, type = 'text' }: { label: string; value: string; set: (value: string) => void; type?: string }) {
  const id=useId();
  return <div className="field"><label htmlFor={id}>{label}</label><input id={id} type={type} step={type==='number'?'any':undefined} value={value} onChange={event => set(event.target.value)}/></div>;
}

export function V2AdminPanel({ section }: { section: V2Section }) {
  const [rows, setRows] = useState<Row[]>([]); const [versions, setVersions] = useState<Row[]>([]); const [providers, setProviders] = useState<Row[]>([]); const [models, setModels] = useState<Row[]>([]);
  const [instances,setInstances]=useState<Array<{modelId:string;providerId:string;providerModelId:string}>>([]);
  const [selected, setSelected] = useState<Row | null>(null); const [groupBy, setGroupBy] = useState('day'); const [form, setForm] = useState<Record<string,string>>({});
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const update = (key: string, value: string) => setForm(previous => ({ ...previous, [key]: value }));
  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (section === 'v2-wallets') setRows((await api<{data:Row[]}>('/api/v1/admin/wallets')).data);
      if (section === 'v2-rates') {
        const [rates, p, m,bindings] = await Promise.all([api<{data:Row[];versions:Row[]}>('/api/v1/admin/rate-cards'), api<{data:Row[]}>('/api/v1/admin/providers'), api<{data:Row[]}>('/api/v1/admin/models'),api<{data:Array<{modelId:string;providerId:string;providerModelId:string}>}>('/api/v1/admin/model-instances')]);
        setRows(rates.data); setVersions(rates.versions); setProviders(p.data); setModels(m.data);setInstances(bindings.data);
      }
      if (section === 'v2-referrals') {
        const [list, settings] = await Promise.all([api<{data:Row[]}>('/api/v1/admin/referrals'), api<{policy:{enabled:boolean;minPaidAmount:number;referrerPoints:number;referredPoints:number}}>('/api/v1/admin/referral-policy')]);
        setRows(list.data); setForm(previous => ({ ...previous, policyEnabled: String(settings.policy.enabled), minPaidAmount: String(settings.policy.minPaidAmount),
          referrerPoints: String(settings.policy.referrerPoints), referredPoints: String(settings.policy.referredPoints) }));
      }
      if (section === 'v2-costs') setRows((await api<{data:Row[]}>(`/api/v1/admin/cost-analytics?groupBy=${groupBy}`)).data);
    } catch (error) { setMessage((error as {message?:string}).message ?? '加载失败'); }
    finally { setLoading(false); }
  }, [section, groupBy]);
  useEffect(() => { void load(); }, [load]);
  async function run(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true); setMessage('');
    try { await action(); setMessage('已保存'); await load(); }
    catch (error) { setMessage((error as {message?:string}).message ?? '操作失败'); }
    finally { setBusy(false); }
  }
  let draft:ReturnType<typeof rateDraftPayload>|null=null,draftError='';
  if(section==='v2-rates'&&selected)try{draft=rateDraftPayload(form);}catch(error){draftError=(error as Error).message;}
  const selectedProvider=providers.find(provider=>provider.id===form.providerId);
  const priceableModels=models.filter(model=>selectedProvider&&providerCanPriceModel({id:String(model.id),providerId:String(model.providerId),providerModelId:String(model.providerModelId),publicId:String(model.publicId)},{id:String(selectedProvider.id),code:String(selectedProvider.code)},instances));
  return <>
    {message && <div className="notice" role="status">{message}</div>}
    {loading && <div className="loading-skeleton"/>}
    {!loading && section === 'v2-wallets' && <>
      <section className="panel"><h2>AI 点数钱包</h2><p>余额来自账本；调整点数需要填写原因并生成审计记录。</p><div className="table-wrap"><table className="data-table"><thead><tr><th>用户</th><th>余额</th><th>更新时间</th><th>操作</th></tr></thead><tbody>{rows.map(row => <tr key={row.userId as string}><td>{show(row.email)}</td><td>{show(row.balance)} 点</td><td>{show(row.updatedAt)}</td><td><button className="mini-button" onClick={() => { setSelected(row); setForm({}); }}>调整</button></td></tr>)}</tbody></table></div></section>
      {selected && <section className="panel"><h2>调整 {show(selected.email)} 的点数</h2><div className="form-grid"><CellInput label="点数（负数为扣减）" value={form.points ?? ''} set={value => update('points', value)} type="number"/><CellInput label="原因（至少 10 字）" value={form.reason ?? ''} set={value => update('reason', value)}/></div><button disabled={busy} className="button button-small" onClick={() => run(() => post(`/api/v1/admin/users/${selected.userId}/wallet/adjust`, { points: Number(form.points), reason: form.reason, idempotencyKey: crypto.randomUUID() }))}>记录调整</button></section>}
    </>}
    {!loading && section === 'v2-rates' && <>
      <section className="panel"><h2>模型售价与费率卡</h2><p>10000 AI_POINT = ¥1。Token 售价使用人民币 / 百万 Token；¥1 / 百万 Token 对应 API 的 10 点 / 千 Token。这里设置向用户收取的售价，不代表上游成本。已发布的价格保留历史版本，不能直接修改。</p><p>接入新模型后：创建费率卡 → 填写并保存售价草稿 → 发布 → 在“模型与连接”启用逻辑模型与已验证实例 → 在“用户与权限”授权。</p><div className="table-wrap"><table className="data-table" style={{minWidth:760}}><thead><tr><th>连接</th><th>逻辑模型</th><th>计费策略</th><th>版本</th><th>操作</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td>{show(providers.find(item => item.id === row.providerId)?.name ?? row.providerId)}</td><td>{show(models.find(item => item.id === row.modelId)?.publicId ?? row.modelId)}</td><td>{show(row.billingPolicy)}</td><td>{versions.filter(item => item.rateCardId === row.id).length}</td><td><button className="mini-button" onClick={() => { setSelected(row); setForm({}); }}>管理</button></td></tr>)}</tbody></table></div></section>
      <section className="panel"><h2>新建费率卡</h2><p>选择实际连接及绑定的逻辑模型；同一模型的不同连接分别配置费率。创建空卡后，在列表中点“管理”填写并发布版本。</p><div className="form-grid"><div className="field"><label>费率归属连接</label><select value={form.providerId ?? ''} onChange={event => {update('providerId', event.target.value);update('modelId','');}}><option value="">选择连接资源</option>{providers.map(p => <option key={p.id} value={p.id}>{show(p.name)}</option>)}</select></div><div className="field"><label>模型</label><select value={form.modelId ?? ''} onChange={event => update('modelId', event.target.value)}><option value="">选择模型</option>{priceableModels.map(m => <option key={m.id} value={m.id}>{show(m.publicId)}</option>)}</select></div><div className="field"><label>计费策略</label><select value={form.policy ?? 'MANAGED_USAGE'} onChange={event => update('policy', event.target.value)}><option value="MANAGED_USAGE">Managed</option><option value="BYOS_USAGE">BYOS</option><option value="LOCAL_USAGE">Local</option></select></div></div><button disabled={busy || !form.providerId || !form.modelId || !priceableModels.some(model=>model.id===form.modelId)} className="button button-small" onClick={() => run(() => post('/api/v1/admin/rate-cards', { providerId: form.providerId, modelId: form.modelId, billingPolicy: form.policy ?? 'MANAGED_USAGE' }))}>创建</button></section>
      {selected && <section className="panel"><h2>费率版本 · {show(models.find(item => item.id === selected.modelId)?.publicId)}</h2><div className="table-wrap"><table className="data-table" style={{minWidth:860}}><thead><tr><th>版本</th><th>状态</th><th>输入 ¥/百万 Token</th><th>输出 ¥/百万 Token</th><th>其他价格</th><th>生效时间</th><th>操作</th></tr></thead><tbody>{versions.filter(item => item.rateCardId === selected.id).map(item => <tr key={item.id}><td>{show(item.version)}</td><td>{show(item.status)}</td><td>{ratePointsToRmb(item.inputRate)}</td><td>{ratePointsToRmb(item.outputRate)}</td><td><details><summary>查看</summary><p>缓存 ¥{ratePointsToRmb(item.cachedInputRate)} / 百万 Token<br/>思考 ¥{ratePointsToRmb(item.reasoningRate)} / 百万 Token<br/>图片输入 ¥{ratePointsToRmb(item.imageInputRate,'item')} / 张<br/>图片输出 ¥{ratePointsToRmb(item.imageOutputRate,'item')} / 张<br/>工具 ¥{ratePointsToRmb(item.toolRate,'item')} / 次<br/>最低消费 ¥{ratePointsToRmb(item.minimumCharge,'item')} / 请求</p></details></td><td>{show(item.effectiveFrom)}</td><td>{item.status === 'DRAFT' ? <button disabled={busy||Number(item.inputRate)<=0||Number(item.outputRate)<=0} title={Number(item.inputRate)<=0||Number(item.outputRate)<=0?'输入和输出售价需大于 0，请新建正确草稿。':'发布后对新请求生效'} className="mini-button" onClick={() => run(() => post(`/api/v1/admin/rate-card-versions/${item.id}/publish`, {}))}>发布</button> : '只读'}</td></tr>)}</tbody></table></div><h3>创建售价草稿</h3><p>输入和输出售价必填且大于 0。其他项目留空表示该项目不单独收费（0），请按实际计费策略填写。最低消费单位为人民币，支持 ¥0.0001 的整数倍。保存草稿不会发布，也不会改变现有 DeepSeek 费率。</p><div className="form-grid">{[['inputRate','输入售价 ¥ / 百万 Token（必填）'],['outputRate','输出售价 ¥ / 百万 Token（必填）'],['cachedInputRate','缓存输入 ¥ / 百万 Token'],['reasoningRate','思考 ¥ / 百万 Token'],['imageInputRate','图片输入 ¥ / 张'],['imageOutputRate','图片输出 ¥ / 张'],['toolRate','工具调用 ¥ / 次'],['minimumCharge','最低消费 ¥ / 请求']].map(([key,label]) => <CellInput key={key} label={label} value={form[key] ?? ''} set={value => update(key,value)} type="number"/>)}</div>{draftError&&<p role="status">{draftError}</p>}<button disabled={busy||!draft} className="button button-small" onClick={() => {if(draft)void run(() => post(`/api/v1/admin/rate-cards/${selected.id}/versions`,draft));}}>保存草稿（不发布）</button></section>}
    </>}
    {!loading && section === 'v2-referrals' && <>
      <section className="panel"><h2>邀请资格与风控</h2><div className="table-wrap"><table className="data-table"><thead><tr><th>邀请人</th><th>受邀人</th><th>状态</th><th>风险标记</th><th>操作</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td>{show(row.referrerUserId)}</td><td>{show(row.referredUserId)}</td><td>{show(row.status)}</td><td>{Array.isArray(row.riskFlags) ? row.riskFlags.join(', ') || '—' : '—'}</td><td>{['PENDING','REGISTERED'].includes(String(row.status)) && <button className="mini-button" onClick={() => { setSelected(row); setForm({}); }}>审核</button>}</td></tr>)}</tbody></table></div></section>
      {selected && <section className="panel"><h2>审核邀请</h2><p>{show(selected.id)}</p><CellInput label="审核原因" value={form.reviewReason ?? ''} set={value => update('reviewReason', value)}/><div className="inline-actions"><button disabled={busy} className="mini-button" onClick={() => run(() => post(`/api/v1/admin/referrals/${selected.id}/review`, {decision:'APPROVE',reason:form.reviewReason}))}>批准</button><button disabled={busy} className="mini-button danger" onClick={() => run(() => post(`/api/v1/admin/referrals/${selected.id}/review`, {decision:'REJECT',reason:form.reviewReason}))}>拒绝</button></div></section>}
      <section className="panel"><h2>邀请奖励规则</h2><p>默认关闭；仅符合已付款订单门槛的邀请可发奖。</p><div className="form-grid"><div className="field"><label>状态</label><select value={form.policyEnabled ?? 'false'} onChange={event => update('policyEnabled',event.target.value)}><option value="false">关闭</option><option value="true">开启</option></select></div><CellInput label="最低付款金额" value={form.minPaidAmount ?? '0'} set={value => update('minPaidAmount',value)} type="number"/><CellInput label="邀请人点数" value={form.referrerPoints ?? '0'} set={value => update('referrerPoints',value)} type="number"/><CellInput label="受邀人点数" value={form.referredPoints ?? '0'} set={value => update('referredPoints',value)} type="number"/></div><button disabled={busy} className="button button-small" onClick={() => run(() => put('/api/v1/admin/referral-policy', {enabled: form.policyEnabled === 'true',minPaidAmount:Number(form.minPaidAmount ?? 0),referrerPoints:Number(form.referrerPoints ?? 0),referredPoints:Number(form.referredPoints ?? 0)}))}>保存规则</button></section>
    </>}
    {!loading && section === 'v2-costs' && <section className="panel"><h2>Provider 成本</h2><p>只有 Provider 报告或已核算的成本才纳入金额。收入与毛利将在支付和点数估值接入后显示。</p><div className="field"><label>分组</label><select value={groupBy} onChange={event => setGroupBy(event.target.value)}><option value="day">日期</option><option value="provider">Provider</option><option value="model">模型</option><option value="user">用户</option></select></div><div className="table-wrap"><table className="data-table"><thead><tr><th>分组</th><th>请求</th><th>消耗点数</th><th>已知成本</th><th>货币</th><th>未计价记录</th></tr></thead><tbody>{rows.map((row,index) => <tr key={index}><td>{show(row.group)}</td><td>{show(row.requests)}</td><td>{show(row.pointsCharged)}</td><td>{show(row.providerCost)}</td><td>{show(row.currency)}</td><td>{show(row.unpricedCostRows)}</td></tr>)}</tbody></table></div></section>}
  </>;
}
