import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { randomUUID, generateKeyPairSync } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';

describe.skipIf(!process.env.V2_TEST_DATABASE_URL)('Device interval billing and account controls PostgreSQL', () => {
  let data: typeof import('@bridge/db');
  let app: Awaited<ReturnType<typeof import('./server.js').createServer>>;
  const origin = 'http://localhost:3000';
  beforeAll(async () => {
    if (!new URL(process.env.V2_TEST_DATABASE_URL!).pathname.startsWith('/bridge_v2_test_')) throw Error('REFUSE_NON_TEST_DATABASE');
    Object.assign(process.env, { DATABASE_URL: process.env.V2_TEST_DATABASE_URL, NODE_ENV: 'test', PUBLIC_BASE_URL: origin,
      ACCESS_SECRET: 'a'.repeat(64), REFRESH_TOKEN_PEPPER: 'b'.repeat(64), PROVIDER_MASTER_KEY: 'c'.repeat(64), LOG_LEVEL: 'silent' });
    data = await import('@bridge/db'); app = await (await import('./server.js')).createServer();
  });
  afterAll(async () => { await app?.close(); await data?.pool.end(); });
  async function fixture() {
    const key = randomUUID().replaceAll('-', '');
    const [user] = await data.db.insert(data.users).values({ email: `interval-${key}@example.test`, passwordHash: 'fixture' }).returning();
    const devices = await data.db.insert(data.devices).values(['工作电脑', '家里电脑'].map(deviceName => ({ userId: user.id, deviceId: randomUUID(), deviceName, platform: 'Windows', publicKeyJwk: generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({format:'jwk'}) as { kty:'EC'; crv:'P-256'; x:string; y:string } }))).returning();
    const [provider] = await data.db.insert(data.providers).values({ code: key, name: 'Fixture' }).returning();
    const [model] = await data.db.insert(data.models).values({ providerId: provider.id, providerModelId: key, publicId: key, displayName: 'Fixture' }).returning();
    const [card] = await data.db.insert(data.rateCards).values({ providerId: provider.id, modelId: model.id, billingPolicy: 'MANAGED_USAGE' }).returning();
    const [rate] = await data.db.insert(data.rateCardVersions).values({ rateCardId: card.id, version: 1, status: 'ACTIVE', inputRate: '1000' }).returning();
    const { applyWalletChange } = await import('./wallet.js');
    await data.db.transaction(tx => applyWalletChange(tx, { userId: user.id, points: 100000, type: 'PURCHASE', referenceType: 'TEST', referenceId: key, idempotencyKey: key }));
    return { user, devices, provider, model, rate };
  }
  async function cookie(id: string) {
    const { newRefresh, hashRefresh } = await import('./security.js'); const token = newRefresh();
    await data.db.insert(data.webSessions).values({ userId: id, tokenHash: hashRefresh(token), expiresAt: new Date(Date.now() + 3600000) });
    return { cookie: `bridge_session=${token}`, origin };
  }
  async function charge(f: Awaited<ReturnType<typeof fixture>>, device: typeof f.devices[number], points: number) {
    const { createAiRequest, settleAiRequest } = await import('./metering.js');
    const request = await createAiRequest({ responseId: `resp_${randomUUID()}`, userId: f.user.id, deviceId: device.id, providerId: f.provider.id, modelId: f.model.id, billingPolicy: 'MANAGED_USAGE', rateCardVersionId: f.rate.id });
    const event = await settleAiRequest(request.id, 'COMPLETED', { usage: { inputTokens: points } });
    return { request, event };
  }
  async function online(f: Awaited<ReturnType<typeof fixture>>, device: typeof f.devices[number]) {
    await data.db.transaction(async tx => {
      // Real login/heartbeat holds the device lock before advancing billing.
      await tx.select().from(data.devices).where(eq(data.devices.id, device.id)).for('update').limit(1);
      await (await import('./online-events.js')).recordOnlineEvent({ userId: f.user.id, device, ip: '192.0.2.1', source: 'APP_START', loginSessionId: randomUUID() }, tx);
    });
  }
  it('uses Beijing midnight and seven calendar days for consumption filters',async()=>{
    const {consumptionWindow}=await import('./consumption.js');
    expect(consumptionWindow('today',new Date('2026-10-28T16:00:00Z')).from.toISOString()).toBe('2026-10-28T16:00:00.000Z');
    expect(consumptionWindow('today',new Date('2026-10-28T15:59:59Z')).from.toISOString()).toBe('2026-10-27T16:00:00.000Z');
    expect(consumptionWindow('week',new Date('2026-10-28T16:00:00Z')).from.toISOString()).toBe('2026-10-22T16:00:00.000Z');
  });
  it('shows request debits before interval closure and never counts the interval twice', async()=>{
    const f=await fixture(),[a,b]=f.devices,headers=await cookie(f.user.id);
    await online(f,a);const first=await charge(f,a,19);await charge(f,b,7);
    let response=await app.inject({url:'/api/v1/me/consumption',headers});
    expect(response.statusCode,response.body).toBe(200);expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json().chargedPoints).toBe(26);expect(response.json().devices).toHaveLength(2);expect(response.json().total).toBe(2);
    await online(f,a);
    response=await app.inject({url:`/api/v1/me/consumption?deviceId=${a.id}`,headers});
    expect(response.json().chargedPoints).toBe(19);expect(response.json().data.map((r:{kind:string})=>r.kind)).toEqual(['CALL']);
    const detail=await app.inject({url:`/api/v1/me/consumption/${first.event.id}`,headers});
    expect(detail.statusCode,detail.body).toBe(200);expect(detail.json().usage.inputTokens).toBe(19);expect(detail.json().rates.inputRate).toBe('1000.000000');
    expect(detail.body).not.toMatch(/providerCost|providerReportedUsage|responseId|walletBefore/);
    const stranger=await fixture(),other=await cookie(stranger.user.id);
    expect((await app.inject({url:`/api/v1/me/consumption/${first.event.id}`,headers:other})).statusCode).toBe(404);
    expect((await app.inject({url:`/api/v1/me/consumption?deviceId=${a.id}`,headers:other})).statusCode).toBe(404);
    expect((await app.inject({url:'/api/v1/me/consumption?range=invalid',headers})).statusCode).toBe(400);
    expect((await app.inject({url:'/api/v1/me/consumption?page=0',headers})).statusCode).toBe(400);
  });
  it('paginates stable call rows and exposes only unmatched historical charges',async()=>{
    const f=await fixture(),[a]=f.devices,headers=await cookie(f.user.id);
    await online(f,a);for(let i=0;i<21;i++)await charge(f,a,1);await online(f,a);
    await data.db.insert(data.deviceBillingPeriods).values({userId:f.user.id,deviceId:a.id,deviceName:a.deviceName,bindingId:a.deviceId,kind:'HISTORICAL',endedAt:new Date(),chargedPoints:13});
    const response=await app.inject({url:`/api/v1/me/consumption?deviceId=${a.id}`,headers});
    expect(response.statusCode,response.body).toBe(200);expect(response.json().total).toBe(22);expect(response.json().data).toHaveLength(20);expect(response.json().chargedPoints).toBe(34);
    const second=await app.inject({url:`/api/v1/me/consumption?deviceId=${a.id}&page=2`,headers});
    expect(second.json().data).toHaveLength(2);expect(new Set([...response.json().data,...second.json().data].map(r=>r.id)).size).toBe(22);
    const detail=await app.inject({url:`/api/v1/me/consumption/history:${a.id}`,headers});
    expect(detail.statusCode,detail.body).toBe(200);expect(detail.json()).toMatchObject({kind:'HISTORICAL',chargedPoints:13,usage:null,model:null,rates:null});
  });
  it('keeps metering unknowns distinct from zero and preserves partially debited amounts',async()=>{
    const f=await fixture(),[a]=f.devices,headers=await cookie(f.user.id);
    const {createAiRequest,settleAiRequest}=await import('./metering.js');
    const request=await createAiRequest({responseId:`resp_${randomUUID()}`,userId:f.user.id,deviceId:a.id,providerId:f.provider.id,modelId:f.model.id,billingPolicy:'MANAGED_USAGE',rateCardVersionId:f.rate.id});
    const unknown=await settleAiRequest(request.id,'CLIENT_DISCONNECTED',{usageUnavailable:true});
    await charge(f,a,100001);
    const response=await app.inject({url:'/api/v1/me/consumption',headers});
    expect(response.statusCode,response.body).toBe(200);expect(response.json().chargedPoints).toBe(100000);expect(response.json().reviewCount).toBe(2);
    expect(response.json().data.find((r:{id:string})=>r.id===unknown.id).chargedPoints).toBeNull();
    const detail=await app.inject({url:`/api/v1/me/consumption/${unknown.id}`,headers});expect(detail.json().usage).toBeNull();
    expect(response.json().data.find((r:{status:string})=>r.status==='UNPAID').chargedPoints).toBe(100000);
  });
  it('separates devices, ignores topups/expiry, closes only on device online and never debits twice', async () => {
    const f = await fixture(), [a, b] = f.devices;
    await online(f, a); await online(f, b);
    const first = await charge(f, a, 31); await charge(f, b, 17);
    const metering = await import('./metering.js');
    await metering.settleAiRequest(first.request.id, 'COMPLETED', { usage: { inputTokens: 31 } });
    const { applyWalletChange, walletSummary } = await import('./wallet.js');
    await data.db.transaction(tx => applyWalletChange(tx, { userId: f.user.id, points: 100, type: 'ADMIN_ADJUSTMENT', referenceType: 'TEST', referenceId: f.user.id, idempotencyKey: randomUUID() }));
    await (await import('./online-events.js')).recordOnlineEvent({ userId: f.user.id, ip: '192.0.2.2', source: 'WEB_LOGIN' });
    expect(await data.db.select().from(data.deviceBillingPeriods).where(eq(data.deviceBillingPeriods.userId, f.user.id))).toHaveLength(0);
    await online(f, a);
    const periods = await data.db.select().from(data.deviceBillingPeriods).where(eq(data.deviceBillingPeriods.userId, f.user.id));
    expect(periods).toHaveLength(1); expect(periods[0]).toMatchObject({ deviceId: a.id, chargedPoints: 31, kind: 'SESSION' });
    expect((await walletSummary(f.user.id)).balance).toBe(100100 - 48);
    await online(f, a);
    const state = await data.db.select().from(data.deviceBillingStates).where(eq(data.deviceBillingStates.deviceId, a.id));
    expect(state[0]).toMatchObject({ chargedPoints: 31, settledPoints: 31 });
    const events = await data.db.select().from(data.auditLogs).where(and(eq(data.auditLogs.actorId, f.user.id), eq(data.auditLogs.action, 'USER_ONLINE')));
    expect(events.some(event => (event.metadata.previousBilling as {points?:number})?.points === 31)).toBe(true);
  });
  it('assigns late stream settlement to the next interval and preserves uninitialised historical charges', async () => {
    const f = await fixture(), [a] = f.devices;
    await charge(f, a, 11); await online(f, a);
    await online(f, a); await charge(f, a, 23); await online(f, a);
    const periods = await data.db.select().from(data.deviceBillingPeriods).where(eq(data.deviceBillingPeriods.userId, f.user.id));
    expect(periods.map(p => p.chargedPoints).sort((a,b) => a-b)).toEqual([0, 11, 23]);
    expect(periods.find(p => p.kind === 'HISTORICAL')?.startedAt).toBeNull();
  });
  it('concurrent settlements and online boundaries conserve every deducted point', async () => {
    const f = await fixture(), [a] = f.devices; await online(f, a);
    await Promise.all([charge(f, a, 7), online(f, a), charge(f, a, 13), online(f, a), charge(f, a, 19)]);
    await online(f, a);
    const periods = await data.db.select().from(data.deviceBillingPeriods).where(eq(data.deviceBillingPeriods.userId, f.user.id));
    const [state] = await data.db.select().from(data.deviceBillingStates).where(eq(data.deviceBillingStates.deviceId, a.id));
    expect(periods.reduce((sum, period) => sum + period.chargedPoints, 0)).toBe(39);
    expect(state.chargedPoints).toBe(39); expect(state.settledPoints).toBe(39);
    expect((await (await import('./wallet.js')).walletSummary(f.user.id)).balance).toBe(100000 - 39);
  });
  it('rolls back wallet debit and usage event if the counter write fails', async () => {
    const f = await fixture(), [a] = f.devices;
    const {createAiRequest,settleAiRequest} = await import('./metering.js');
    const request = await createAiRequest({responseId:randomUUID(),userId:f.user.id,deviceId:a.id,providerId:f.provider.id,modelId:f.model.id,billingPolicy:'MANAGED_USAGE',rateCardVersionId:f.rate.id});
    await data.db.execute(sql.raw(`create function fail_interval_counter() returns trigger language plpgsql as $$ begin if new.device_id='${a.id}' then raise exception 'TEST_COUNTER_FAILED'; end if; return new; end $$`));
    await data.db.execute(sql.raw('create trigger fail_interval_counter before insert or update on device_billing_states for each row execute function fail_interval_counter()'));
    try { await expect(settleAiRequest(request.id,'COMPLETED',{usage:{inputTokens:9}})).rejects.toThrow(); }
    finally { await data.db.execute(sql.raw('drop trigger fail_interval_counter on device_billing_states'));await data.db.execute(sql.raw('drop function fail_interval_counter()')); }
    expect((await (await import('./wallet.js')).walletSummary(f.user.id)).balance).toBe(100000);
    expect(await data.db.select().from(data.usageEvents).where(eq(data.usageEvents.requestId,request.id))).toHaveLength(0);
  });
  it('paginates bill views, retains other adjustments, hides open amounts and isolates users', async () => {
    const f = await fixture(), [a] = f.devices; await online(f,a); await charge(f,a,19); await online(f,a); await charge(f,a,7);
    const headers = await cookie(f.user.id);
    const all = await app.inject({ url:'/api/v1/me/bills?pageSize=1', headers });
    expect(all.statusCode, all.body).toBe(200); const body=all.json(); expect(body.data).toHaveLength(1);expect(body.total).toBe(2);
    expect(body.pending[0].points).toBeUndefined();expect(body.pending[0].chargedPoints).toBeUndefined();
    expect(body.summary).toEqual({balance:100000-26,totalAdded:100000,totalConsumed:19});
    const recharge=await app.inject({url:'/api/v1/me/bills?kind=recharge',headers});expect(recharge.json().data.map((r:{type:string})=>r.type)).toEqual(['PURCHASE']);
    const usage=await app.inject({url:'/api/v1/me/bills?kind=consumption',headers});expect(usage.json().data).toHaveLength(1);expect(usage.json().data[0].points).toBe(-19);
    expect((await app.inject({url:'/api/v1/me/bills?kind=invalid',headers})).statusCode).toBe(400);
    const other=await fixture(),oh=await cookie(other.user.id);expect((await app.inject({url:'/api/v1/me/bills?kind=consumption',headers:oh})).json().data).toEqual([]);
    expect((await app.inject({url:'/api/v1/me/bills'})).statusCode).toBe(401);
  });
  it('atomically revokes all own App and web sessions while retaining blocked devices, balances and history', async () => {
    const f=await fixture(),[a,b]=f.devices,other=await fixture();await online(f,a);await charge(f,a,3);await online(f,a);
    const first=await cookie(f.user.id),second=await cookie(f.user.id),foreign=await cookie(other.user.id);
    await data.db.update(data.devices).set({status:'BLOCKED'}).where(eq(data.devices.id,b.id));
    await data.db.insert(data.refreshTokens).values({userId:f.user.id,deviceId:a.id,tokenHash:randomUUID(),expiresAt:new Date(Date.now()+3600000)});
    expect((await app.inject({method:'POST',url:'/api/v1/me/devices/revoke-all',headers:first,payload:{}})).statusCode).toBe(400);
    expect((await app.inject({method:'POST',url:'/api/v1/me/devices/revoke-all',headers:{...first,origin:'https://evil.test'},payload:{confirm:true}})).statusCode).toBe(403);
    const result=await app.inject({method:'POST',url:'/api/v1/me/devices/revoke-all',headers:first,payload:{confirm:true}});expect(result.statusCode,result.body).toBe(200);
    expect(result.json().revokedDevices).toBe(1);expect(result.headers['set-cookie']).toBeDefined();
    for(const headers of [first,second])expect((await app.inject({url:'/api/v1/auth/me',headers})).statusCode).toBe(401);
    expect((await app.inject({url:'/api/v1/auth/me',headers:foreign})).statusCode).toBe(200);
    const own=await data.db.select().from(data.devices).where(eq(data.devices.userId,f.user.id));expect(own.find(d=>d.id===a.id)).toMatchObject({status:'REVOKED',authVersion:1});expect(own.find(d=>d.id===b.id)).toMatchObject({status:'BLOCKED',authVersion:1});
    expect((await data.db.select().from(data.refreshTokens).where(eq(data.refreshTokens.userId,f.user.id)))[0].revokedAt).not.toBeNull();
    expect(await data.db.select().from(data.deviceBillingPeriods).where(eq(data.deviceBillingPeriods.userId,f.user.id))).toHaveLength(1);
    expect((await (await import('./wallet.js')).walletSummary(f.user.id)).balance).toBe(99997);
  });
});
