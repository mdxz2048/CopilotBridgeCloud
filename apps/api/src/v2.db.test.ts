import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { createHash, createPublicKey, generateKeyPairSync, randomUUID, type KeyObject } from 'node:crypto';
import { SignJWT } from 'jose';

const proofKey = () => generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const hashProof = (value: string) => createHash('sha256').update(value).digest('base64url');
async function signedHeaders(key: KeyObject, method: string, path: string, payload: unknown, token = '') {
  const url = new URL(path, 'http://localhost:3001');
  const proof = { htm: method, htu: url.origin + url.pathname,
    iat: Math.floor(Date.now() / 1000), jti: randomUUID(), ath: hashProof(token),
    bth: hashProof(payload === undefined ? '' : JSON.stringify(payload)) };
  const jwk = createPublicKey(key).export({ format: 'jwk' });
  return { host: 'localhost:3001', dpop: await new SignJWT(proof).setProtectedHeader({ typ: 'dpop+jwt', alg: 'ES256', jwk }).sign(key) };
}
async function testCookieHeaders(dbModule: typeof import('@bridge/db'), userId: string) {
  const { newRefresh, hashRefresh } = await import('./security.js');
  const token = newRefresh();
  await dbModule.db.insert(dbModule.webSessions).values({ userId, tokenHash: hashRefresh(token),
    expiresAt: new Date(Date.now() + 300000) });
  return { cookie: `bridge_session=${token}`, origin: process.env.PUBLIC_BASE_URL! };
}

const enabled = Boolean(process.env.V2_TEST_DATABASE_URL);
describe.skipIf(!enabled)('V2 PostgreSQL invariants', () => {
  let dbModule: typeof import('@bridge/db');
  let walletModule: typeof import('./wallet.js');
  let meterModule: typeof import('./metering.js');
  let referralModule: typeof import('./referral.js');
  let sql: typeof import('drizzle-orm').sql;
  let ids: { user: string; secondUser: string; admin: string; device: string; secondDevice: string; provider: string; model: string; plan: string; rateCard: string; rateVersion: string };

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.V2_TEST_DATABASE_URL;
    process.env.ACCESS_SECRET ??= 'a'.repeat(64);
    process.env.REFRESH_TOKEN_PEPPER ??= 'b'.repeat(64);
    process.env.PROVIDER_MASTER_KEY ??= 'c'.repeat(64);
    process.env.PUBLIC_BASE_URL ??= 'http://localhost:3001';
    dbModule = await import('@bridge/db');
    walletModule = await import('./wallet.js');
    meterModule = await import('./metering.js');
    referralModule = await import('./referral.js');
    sql = (await import('drizzle-orm')).sql;
    const { db, users, devices, providers, models, plans, rateCards, rateCardVersions, systemSettings } = dbModule;
    // This test is permitted only against a dedicated disposable database.
    if (!new URL(process.env.DATABASE_URL!).pathname.startsWith('/bridge_v2_test_')) throw new Error('REFUSE_NON_TEST_DATABASE');
    await db.execute(sql`truncate table users, plans, providers, system_settings restart identity cascade`);
    await db.insert(systemSettings).values({ key: 'rate_policy',
      value: { accountRpm: 120, deviceRpm: 60, publicIpRpm: 120, authIpRpm: 120 } });
    const [user] = await db.insert(users).values({ email: `v2-${randomUUID()}@example.test`, passwordHash: 'test' }).returning();
    const [secondUser] = await db.insert(users).values({ email: `v2-${randomUUID()}@example.test`, passwordHash: await (await import('./security.js')).hashPassword('testpassword123') }).returning();
    const [admin] = await db.insert(users).values({ email: `v2-admin-${randomUUID()}@example.test`, passwordHash: 'test', role: 'ADMIN' }).returning();
    const [device] = await db.insert(devices).values({ userId: user.id, deviceId: randomUUID(), deviceName: 'test', platform: 'test' }).returning();
    const [secondDevice] = await db.insert(devices).values({ userId: secondUser.id, deviceId: randomUUID(), deviceName: 'test', platform: 'test' }).returning();
    const [provider] = await db.insert(providers).values({ code: 'DEEPSEEK_AA0011223344', name: 'V2 Test', enabled: true }).returning();
    const [model] = await db.insert(models).values({ providerId: provider.id, providerModelId: 'test', publicId: 'v2/test', displayName: 'Test', enabled: true }).returning();
    await db.insert(dbModule.modelInstances).values({modelId:model.id,providerId:provider.id,providerModelId:'test',enabled:true,healthStatus:'READY',nativeProtocols:['responses'],capabilities:{}});
    const [plan] = await db.insert(plans).values({ code: 'V2_TEST', name: 'V2 Test', monthlyPrice: '1', maxDevices: 3,
      monthlyTokenLimit: 1000000, monthlyUsageCreditLimit: '1000000', maxConcurrentRequests: 10, requestsPerMinute: 100, monthlyPoints: 100, rolloverPolicy: 'UNLIMITED' }).returning();
    const [card] = await db.insert(rateCards).values({ providerId: provider.id, modelId: model.id, billingPolicy: 'MANAGED_USAGE' }).returning();
    const [rateVersion] = await db.insert(rateCardVersions).values({ rateCardId: card.id, version: 1, status: 'ACTIVE', inputRate: '10', outputRate: '20',
      cachedInputRate: '2', reasoningRate: '30', imageInputRate: '3', imageOutputRate: '4', toolRate: '1' }).returning();
    ids = { user: user.id, secondUser: secondUser.id, admin: admin.id, device: device.id, secondDevice: secondDevice.id, provider: provider.id, model: model.id, plan: plan.id, rateCard: card.id, rateVersion: rateVersion.id };
  });
  afterAll(async () => { await dbModule?.pool.end(); });

  it('configures unpaid GPT without network calls, preserves secrets, and enforces catalog ACL',async()=>{
    const {db,providers,providerCredentials,modelInstances,planModelAccess,userModelAccess,users,subscriptions}=dbModule;
    const [provider]=await db.insert(providers).values({code:'OPENAI_CC0011223344',name:'Unpaid fixture'}).returning();
    const [user]=await db.insert(users).values({email:`gpt-${randomUUID()}@example.test`,passwordHash:'test'}).returning();
    const now=new Date();await db.insert(subscriptions).values({userId:user.id,planId:ids.plan,status:'ACTIVE',startedAt:now,currentPeriodStart:now,currentPeriodEnd:new Date(now.getTime()+86400000)});
    const app=await(await import('./server.js')).createServer();
    const fetcher=vi.fn(()=>{throw Error('UNEXPECTED_PAID_OR_METADATA_REQUEST');});vi.stubGlobal('fetch',fetcher);
    try{
      const headers=await testCookieHeaders(dbModule,ids.admin),userHeaders=await testCookieHeaders(dbModule,user.id);
      const endpoint=`/api/v1/admin/providers/${provider.id}/connect-openai`,payload={modelId:'gpt-6.1-sol',apiKey:'synthetic-api-key-only'};
      expect((await app.inject({method:'POST',url:endpoint,headers:userHeaders,payload})).statusCode).toBe(403);
      const configured=await app.inject({method:'POST',url:endpoint,headers,payload});expect(configured.statusCode).toBe(200);
      expect(configured.json()).toMatchObject({ready:false,configured:true,generationVerified:false});expect(configured.body).not.toContain(payload.apiKey);
      const model=configured.json().model;const [credential]=await db.select().from(providerCredentials).where((await import('drizzle-orm')).eq(providerCredentials.providerId,provider.id));
      expect((await import('./security.js')).decryptSecret(credential)).toBe(payload.apiKey);
      expect((await app.inject({method:'POST',url:endpoint,headers,payload:{modelId:payload.modelId}})).statusCode).toBe(200);
      const [instance]=await db.select().from(modelInstances).where((await import('drizzle-orm')).eq(modelInstances.modelId,model.id));expect(instance).toMatchObject({enabled:false,healthStatus:'UNKNOWN',capabilities:{generationVerified:false}});
      const read=async()=>{const r=await app.inject({url:'/api/v1/models',headers:userHeaders});expect(r.statusCode).toBe(200);return r.json().data;};
      expect(await read()).not.toContainEqual(expect.objectContaining({publicId:model.publicId}));
      await db.insert(planModelAccess).values({planId:ids.plan,modelId:model.id});
      expect(await read()).not.toContainEqual(expect.objectContaining({publicId:model.publicId}));
      await db.insert(userModelAccess).values({userId:user.id,modelId:model.id,access:'DENY'});
      expect(await read()).not.toContainEqual(expect.objectContaining({publicId:model.publicId}));
      expect(fetcher).not.toHaveBeenCalled();
    }finally{vi.unstubAllGlobals();await app.close();}
  });

  it('imports the authenticated relay catalog without expanding access, preserves URLs, and archives old management rows',async()=>{
    const {db,providers,models,modelInstances}=dbModule;
    const [provider]=await db.insert(providers).values({code:'OPENAI_DD0011223344',name:'Relay fixture',baseUrl:'https://relay.example/v1'}).returning();
    const app=await(await import('./server.js')).createServer(),headers=await testCookieHeaders(dbModule,ids.admin),userHeaders=await testCookieHeaders(dbModule,ids.user);
    const terminal={id:'u',object:'response',status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'OK'}]}],usage:{input_tokens:2,output_tokens:1}};
    const fetcher=vi.fn(async(url:string,options?:{body?:string})=>{
      expect(url.startsWith('https://relay.example/v1/')).toBe(true);
      if(url.endsWith('/models'))return Response.json({data:[{id:'gpt-relay-fixture'}]});
      const body=JSON.parse(options!.body!);if(!body.stream){expect(body.tool_choice).toBe('none');return Response.json(terminal);}
      return new Response(`data: ${JSON.stringify({type:'response.created',response:{id:'u',status:'in_progress'}})}\n\ndata: ${JSON.stringify({type:'response.completed',response:{...terminal,output:[{type:'function_call',name:'bridge_probe',call_id:'c',arguments:'{"value":1}'}]}})}\n\n`);
    });vi.stubGlobal('fetch',fetcher);
    try{
      const url=`/api/v1/admin/providers/${provider.id}/sync-openai`,payload={baseUrl:'https://relay.example/v1',apiKey:'synthetic-relay-key',emptyToolsWorkaround:true};
      expect((await app.inject({method:'POST',url,headers:userHeaders,payload})).statusCode).toBe(403);
      const imported=await app.inject({method:'POST',url,headers,payload});expect(imported.statusCode).toBe(200);expect(imported.body).not.toContain(payload.apiKey);
      const model=imported.json().models[0];expect(model.enabled).toBe(false);
      const check=await app.inject({method:'POST',url:`/api/v1/admin/providers/${provider.id}/connect-openai`,headers,payload:{modelId:'gpt-relay-fixture',verifyGeneration:true}});expect(check.statusCode).toBe(200);expect(check.json().ready).toBe(true);
      const [saved]=await db.select().from(providers).where((await import('drizzle-orm')).eq(providers.id,provider.id));expect(saved.baseUrl).toBe(payload.baseUrl);
      const removed=await app.inject({method:'DELETE',url:`/api/v1/admin/models/${model.id}`,headers});expect(removed.statusCode).toBe(200);
      const listed=await app.inject({url:'/api/v1/admin/models',headers});expect(listed.json().data.some((m:{id:string})=>m.id===model.id)).toBe(false);
      const [retained]=await db.select().from(models).where((await import('drizzle-orm')).eq(models.id,model.id));expect(retained.enabled).toBe(false);
      const [instance]=await db.select().from(modelInstances).where((await import('drizzle-orm')).eq(modelInstances.modelId,model.id));expect(instance.enabled).toBe(false);
    }finally{vi.unstubAllGlobals();await app.close();}
  });

  it('serializes concurrent debit, prevents overdraft, and deduplicates retries', async () => {
    const { db, walletTransactions, wallets } = dbModule;
    await db.transaction(tx => walletModule.applyWalletChange(tx, { userId: ids.user, points: 10, type: 'PURCHASE', referenceType: 'TEST', referenceId: 'seed', idempotencyKey: 'seed-wallet' }));
    const debit = (key: string) => db.transaction(tx => walletModule.applyWalletChange(tx, { userId: ids.user, points: -8, type: 'USAGE', referenceType: 'TEST', referenceId: key, idempotencyKey: key }));
    const results = await Promise.allSettled([debit('debit-a'), debit('debit-b')]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected').map(r => (r as PromiseRejectedResult).reason.code)).toEqual(['INSUFFICIENT_POINTS']);
    const winner = results.find(r => r.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof debit>>>;
    const duplicate = await debit(winner.value.transaction.idempotencyKey);
    expect(duplicate.duplicate).toBe(true);
    const [wallet] = await db.select().from(wallets).where((await import('drizzle-orm')).eq(wallets.userId, ids.user));
    expect(wallet.balance).toBe(2);
    const entries = await db.select().from(walletTransactions);
    expect(entries.filter(entry => entry.type === 'USAGE')).toHaveLength(1);
  });

  it('grants a subscription period only once', async () => {
    const { db, subscriptions, wallets } = dbModule;
    const now = new Date();
    const [subscription] = await db.insert(subscriptions).values({ userId: ids.secondUser, planId: ids.plan, status: 'ACTIVE', startedAt: now, currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + 30 * 86400000) }).returning();
    const first = await db.transaction(tx => walletModule.grantSubscriptionPoints(tx, subscription.id));
    const second = await db.transaction(tx => walletModule.grantSubscriptionPoints(tx, subscription.id));
    expect(first?.duplicate).toBe(false);
    expect(second?.duplicate).toBe(true);
    const [wallet] = await db.select().from(wallets).where((await import('drizzle-orm')).eq(wallets.userId, ids.secondUser));
    expect(wallet.balance).toBe(100);
  });

  it('expires only unspent non-rollover grants and preserves purchased points', async () => {
    const { db, plans, subscriptions, users, walletLots, walletTransactions } = dbModule;
    const [account] = await db.insert(users).values({ email: `v2-expiry-${randomUUID()}@example.test`, passwordHash: 'test' }).returning();
    const [plan] = await db.insert(plans).values({ code: 'NO_ROLLOVER', name: 'No rollover', monthlyPrice: '1', maxDevices: 1,
      monthlyTokenLimit: 10000, monthlyUsageCreditLimit: '10000', maxConcurrentRequests: 1, requestsPerMinute: 10, monthlyPoints: 50,
      rolloverPolicy: 'NONE' }).returning();
    const start = new Date(); const end = new Date(start.getTime() + 86400000);
    const [subscription] = await db.insert(subscriptions).values({ userId: account.id, planId: plan.id, status: 'ACTIVE', startedAt: start,
      currentPeriodStart: start, currentPeriodEnd: end }).returning();
    await db.transaction(tx => walletModule.grantSubscriptionPoints(tx, subscription.id));
    await db.transaction(tx => walletModule.applyWalletChange(tx, { userId: account.id, points: 20, type: 'PURCHASE', referenceType: 'TEST', referenceId: 'purchase', idempotencyKey: 'purchase-expiry' }));
    await db.transaction(tx => walletModule.applyWalletChange(tx, { userId: account.id, points: -30, type: 'USAGE', referenceType: 'TEST', referenceId: 'usage', idempotencyKey: 'usage-expiry' }));
    expect(await walletModule.expireDueWalletLots(account.id, new Date(end.getTime() + 1000))).toBe(20);
    expect(await walletModule.expireDueWalletLots(account.id, new Date(end.getTime() + 2000))).toBe(20);
    const lots = await db.select().from(walletLots);
    expect(lots.some(lot => lot.expiresAt && lot.remainingPoints === 0)).toBe(true);
    expect(lots.some(lot => !lot.expiresAt && lot.remainingPoints === 20)).toBe(true);
    expect((await db.select().from(walletTransactions)).filter(entry => entry.type === 'EXPIRATION' && entry.points === -20)).toHaveLength(1);
  });

  it('registers, limits, revokes and replaces a user-owned device', async () => {
    const { db, users } = dbModule;
    const [user] = await db.select().from(users).where((await import('drizzle-orm')).eq(users.id, ids.secondUser));
    const app = await (await import('./server.js')).createServer();
    try {
      const deviceInfo = () => {
        const { privateKey, publicKey } = proofKey();
        return { privateKey, device: { deviceId: randomUUID(), deviceName: 'test desktop', platform: 'Windows',
          osVersion: '11', appVersion: '2.0', publicKeyJwk: publicKey.export({ format: 'jwk' }) } };
      };
      const login = async ({ device, privateKey }: ReturnType<typeof deviceInfo>) => {
        const payload = { email: user.email, password: 'testpassword123', device };
        return app.inject({ method: 'POST', url: '/api/v1/auth/login', payload });
      };
      const firstKey = deviceInfo();
      const first = await login(firstKey);
      const second = await login(deviceInfo());
      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      const limited = await login(deviceInfo());
      expect(limited.statusCode).toBe(409);
      expect(limited.json().error.code).toBe('DEVICE_LIMIT_REACHED');
      const revokedId = first.json().device.id as string;
      const revokePath = `/api/v1/devices/${revokedId}/revoke`;
      const firstToken = first.json().accessToken as string;
      const revoke = await app.inject({ method: 'POST', url: revokePath,
        headers: { authorization: `Bearer ${firstToken}`, ...(await signedHeaders(firstKey.privateKey, 'POST', revokePath, undefined, firstToken)) } });
      expect(revoke.statusCode).toBe(200);
      expect((await login(deviceInfo())).statusCode).toBe(200);
    } finally { await app.close(); }
  }, 15_000);

  it('enrolls a legacy device key once at password login and invalidates its old tokens', async () => {
    const { db, devices, refreshTokens, subscriptions, users } = dbModule;
    const { eq } = await import('drizzle-orm');
    const security = await import('./security.js');
    const [user] = await db.insert(users).values({ email: `v2-upgrade-${randomUUID()}@example.test`,
      passwordHash: await security.hashPassword('testpassword123') }).returning();
    const [legacy] = await db.insert(devices).values({ userId: user.id, deviceId: randomUUID(),
      deviceName: 'Legacy Desktop', platform: 'Windows' }).returning();
    const startedAt = new Date();
    await db.insert(subscriptions).values({ userId: user.id, planId: ids.plan, status: 'ACTIVE',
      startedAt, currentPeriodStart: startedAt, currentPeriodEnd: new Date(startedAt.getTime() + 86400000) });
    const oldAccess = await security.issueAccess(user.id, legacy.id);
    const oldRefresh = security.newRefresh();
    await db.insert(refreshTokens).values({ userId: user.id, deviceId: legacy.id,
      tokenHash: security.hashRefresh(oldRefresh), expiresAt: new Date(Date.now() + 86400000) });
    const { publicKey } = proofKey();
    const jwk = publicKey.export({ format: 'jwk' });
    const payload = { email: user.email, password: 'testpassword123', device: { deviceId: legacy.deviceId,
      deviceName: 'Upgraded Desktop', platform: 'Windows',
      publicKeyJwk: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y } } };
    const app = await (await import('./server.js')).createServer();
    try {
      const first = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload });
      expect(first.statusCode).toBe(200);
      const [enrolled] = await db.select().from(devices).where(eq(devices.id, legacy.id));
      expect(enrolled.publicKeyJwk).toMatchObject(payload.device.publicKeyJwk);
      expect(enrolled.authVersion).toBe(1);
      const [revoked] = await db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, security.hashRefresh(oldRefresh)));
      expect(revoked.revokedAt).not.toBeNull();
      expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${oldAccess}` } })).statusCode).toBe(403);
      expect((await app.inject({ method: 'POST', url: '/api/v1/auth/refresh',
        payload: { refreshToken: oldRefresh } })).statusCode).toBe(401);
      expect((await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload })).statusCode).toBe(200);
      const replacement = proofKey().publicKey.export({ format: 'jwk' });
      const changed = await app.inject({ method: 'POST', url: '/api/v1/auth/login',
        payload: { ...payload, device: { ...payload.device,
          publicKeyJwk: { kty: 'EC', crv: 'P-256', x: replacement.x, y: replacement.y } } } });
      expect(changed.statusCode).toBe(403);
      expect(changed.json().error.code).toBe('DEVICE_PROOF_INVALID');
    } finally { await app.close(); }
  });

  it('keeps old access and refresh tokens revoked after Admin and user device restoration', async () => {
    const { db, plans, subscriptions, users, webSessions } = dbModule;
    const [user] = await db.insert(users).values({ email: `v2-device-auth-${randomUUID()}@example.test`,
      passwordHash: await (await import('./security.js')).hashPassword('testpassword123') }).returning();
    const [plan] = await db.insert(plans).values({ code: `DEVICE_${randomUUID().slice(0, 8)}`, name: 'Device Test', monthlyPrice: '1',
      maxDevices: 2, monthlyTokenLimit: 1000, monthlyUsageCreditLimit: '1000', maxConcurrentRequests: 1, requestsPerMinute: 10 }).returning();
    const now = new Date();
    await db.insert(subscriptions).values({ userId: user.id, planId: plan.id, status: 'ACTIVE', startedAt: now,
      currentPeriodStart: now, currentPeriodEnd: new Date(now.getTime() + 86400000) });
    const app = await (await import('./server.js')).createServer();
    try {
      const { newRefresh, hashRefresh } = await import('./security.js');
      const adminSession = newRefresh();
      await db.insert(webSessions).values({ userId: ids.admin, tokenHash: hashRefresh(adminSession),
        expiresAt: new Date(Date.now() + 86400000) });
      const { privateKey, publicKey } = proofKey();
      const device = { deviceId: randomUUID(), deviceName: 'Restored Desktop', platform: 'Windows',
        osVersion: '11', appVersion: '2.0', publicKeyJwk: publicKey.export({ format: 'jwk' }) };
      const login = async () => {
        const payload = { email: user.email, password: 'testpassword123', device };
        const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload });
        expect(response.statusCode).toBe(200);
        return response.json() as { accessToken: string; refreshToken: string; device: { id: string } };
      };
      const first = await login();
      const deviceId = first.device.id;
      const adminStatus = async (status: 'ACTIVE' | 'REVOKED' | 'BLOCKED') => {
        const response = await app.inject({ method: 'PATCH', url: `/api/v1/admin/devices/${deviceId}`,
          headers: { cookie: `bridge_session=${adminSession}`, origin: process.env.PUBLIC_BASE_URL! }, payload: { status } });
        expect(response.statusCode).toBe(200);
      };
      const assertStale = async (credentials: { accessToken: string; refreshToken: string }) => {
        const access = await app.inject({ method: 'GET', url: '/api/v1/auth/me',
          headers: { authorization: `Bearer ${credentials.accessToken}` } });
        expect(access.statusCode).toBe(403);
        expect(access.json().error.code).toBe('DEVICE_REVOKED');
        const refresh = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh',
          payload: { refreshToken: credentials.refreshToken } });
        expect(refresh.statusCode).toBe(401);
      };
      await adminStatus('REVOKED');
      await adminStatus('ACTIVE');
      await assertStale(first);
      const second = await login();
      expect(second.device.id).toBe(deviceId);
      await adminStatus('BLOCKED');
      await adminStatus('ACTIVE');
      await assertStale(second);
      const third = await login();
      for (const [method, path] of [['DELETE', `/api/v1/devices/${deviceId}`], ['POST', `/api/v1/devices/${deviceId}/revoke`]] as const) {
        const current = method === 'DELETE' ? third : await login();
        const token = current.accessToken;
        const revoke = await app.inject({ method, url: path,
          headers: { authorization: `Bearer ${token}`, ...(await signedHeaders(privateKey, method, path, undefined, token)) } });
        expect(revoke.statusCode).toBe(200);
        await adminStatus('ACTIVE');
        await assertStale(current);
      }
      expect((await login()).device.id).toBe(deviceId);
    } finally { await app.close(); }
  }, 15_000);

  it('persists audited rate-policy changes and rejects non-admin and cross-origin updates', async () => {
    const { db, auditLogs } = dbModule;
    const app = await (await import('./server.js')).createServer();
    try {
      const adminHeaders = await testCookieHeaders(dbModule, ids.admin);
      const userHeaders = await testCookieHeaders(dbModule, ids.secondUser);
      const path = '/api/v1/admin/rate-policy';
      const policy = { accountRpm: 4, deviceRpm: 2, publicIpRpm: 80, authIpRpm: 12 };
      expect((await app.inject({ method: 'GET', url: path, headers: userHeaders })).statusCode).toBe(403);
      expect((await app.inject({ method: 'PUT', url: path, headers: userHeaders, payload: policy })).statusCode).toBe(403);
      expect((await app.inject({ method: 'PUT', url: path,
        headers: { ...adminHeaders, origin: 'https://forged.example' }, payload: policy })).statusCode).toBe(403);
      expect((await app.inject({ method: 'PUT', url: path,
        headers: adminHeaders, payload: { ...policy, accountRpm: 999 } })).statusCode).toBe(400);
      expect((await app.inject({ method: 'PUT', url: path, headers: adminHeaders, payload: policy })).statusCode).toBe(200);
      expect((await app.inject({ method: 'GET', url: path, headers: adminHeaders })).json().policy).toEqual(policy);
      expect((await db.select().from(auditLogs)).some(log => log.action === 'RATE_POLICY_UPDATED' && log.actorId === ids.admin)).toBe(true);
      expect((await app.inject({ method: 'PUT', url: path, headers: adminHeaders,
        payload: { accountRpm: 120, deviceRpm: 60, publicIpRpm: 120, authIpRpm: 120 } })).statusCode).toBe(200);
    } finally { await app.close(); }
  });

  it('pins a rate version, bills observed disconnect usage once, and preserves failed requests', async () => {
    const { db, aiRequests, rateCardVersions, usageEvents, walletTransactions } = dbModule;
    const [request] = await db.insert(aiRequests).values({ responseId: `resp_${randomUUID().replaceAll('-', '')}`, userId: ids.secondUser,
      deviceId: ids.secondDevice, providerId: ids.provider, modelId: ids.model, billingPolicy: 'MANAGED_USAGE', rateCardVersionId: ids.rateVersion, status: 'STARTED' }).returning();
    const [pinned] = await db.select().from(rateCardVersions).where((await import('drizzle-orm')).eq(rateCardVersions.id, ids.rateVersion));
    await db.update(rateCardVersions).set({ status: 'RETIRED', effectiveTo: new Date() }).where((await import('drizzle-orm')).eq(rateCardVersions.id, ids.rateVersion));
    await db.insert(rateCardVersions).values({ rateCardId: pinned.rateCardId, version: 2, status: 'ACTIVE', inputRate: '100', outputRate: '100' });
    expect((await meterModule.activeRateVersion(ids.provider, ids.model, 'MANAGED_USAGE'))?.version).toBe(2);
    const event = await meterModule.settleAiRequest(request.id, 'CLIENT_DISCONNECTED', { usage: { inputTokens: 1000, outputTokens: 1000 }, providerReportedUsage: { input_tokens: 1000, output_tokens: 1000 } });
    expect(event.pointsRated).toBe(30);
    expect(event.pointsCharged).toBe(30);
    expect(event.rateCardVersionId).toBe(ids.rateVersion);
    const repeat = await meterModule.settleAiRequest(request.id, 'CLIENT_DISCONNECTED', { usage: { inputTokens: 1000 } });
    expect(repeat.id).toBe(event.id);
    expect((await db.select().from(walletTransactions)).filter(t => t.referenceId === request.id)).toHaveLength(1);
    await expect(db.update(usageEvents).set({ pointsCharged: 0 }).where((await import('drizzle-orm')).eq(usageEvents.id, event.id))).rejects.toThrow();
    const [failed] = await db.insert(aiRequests).values({ responseId: `resp_${randomUUID().replaceAll('-', '')}`, userId: ids.secondUser,
      deviceId: ids.secondDevice, providerId: ids.provider, modelId: ids.model, billingPolicy: 'MANAGED_USAGE', rateCardVersionId: ids.rateVersion, status: 'STARTED' }).returning();
    const failedEvent = await meterModule.settleAiRequest(failed.id, 'PROVIDER_ERROR', {});
    expect(failedEvent.billingStatus).toBe('NO_USAGE');
    expect(failedEvent.pointsCharged).toBe(0);
    const [partial] = await db.insert(aiRequests).values({ responseId: `resp_${randomUUID().replaceAll('-', '')}`, userId: ids.secondUser,
      deviceId: ids.secondDevice, providerId: ids.provider, modelId: ids.model, billingPolicy: 'MANAGED_USAGE', rateCardVersionId: ids.rateVersion, status: 'STARTED' }).returning();
    const partialEvent = await meterModule.settleAiRequest(partial.id, 'PROVIDER_ERROR', { usage: { inputTokens: 1000 } });
    expect(partialEvent.pointsCharged).toBe(10);
    const [overrun] = await db.insert(aiRequests).values({ responseId: `resp_${randomUUID().replaceAll('-', '')}`, userId: ids.secondUser,
      deviceId: ids.secondDevice, providerId: ids.provider, modelId: ids.model, billingPolicy: 'MANAGED_USAGE', rateCardVersionId: ids.rateVersion, status: 'STARTED' }).returning();
    const availableBeforeOverrun = (await walletModule.walletSummary(ids.secondUser)).balance;
    const unpaid = await meterModule.settleAiRequest(overrun.id, 'COMPLETED', { usage: { inputTokens: 100000 } });
    expect(unpaid.billingStatus).toBe('UNPAID');
    expect(availableBeforeOverrun).toBeGreaterThan(0);
    expect(unpaid.pointsCharged).toBe(availableBeforeOverrun);
    expect((await walletModule.walletSummary(ids.secondUser)).balance).toBe(0);
    const duplicate = await meterModule.settleAiRequest(overrun.id, 'COMPLETED', { usage: { inputTokens: 100000 } });
    expect(duplicate.id).toBe(unpaid.id);
    expect(await db.select().from(walletTransactions).where((await import('drizzle-orm')).eq(walletTransactions.referenceId,overrun.id))).toHaveLength(1);
    await expect(meterModule.preflightPoints(ids.secondUser, ids.provider, ids.model, 'MANAGED_USAGE')).rejects.toMatchObject({status:402,code:'INSUFFICIENT_POINTS'});
    const [invalid] = await db.insert(aiRequests).values({ responseId: `resp_${randomUUID().replaceAll('-', '')}`, userId: ids.user,
      deviceId: ids.device, providerId: ids.provider, modelId: ids.model, billingPolicy: 'MANAGED_USAGE', rateCardVersionId: ids.rateVersion, status: 'STARTED' }).returning();
    const invalidEvent = await meterModule.settleAiRequest(invalid.id, 'COMPLETED', { usage: { inputTokens: -1 }, providerReportedUsage: { input_tokens: -1 } });
    expect(invalidEvent.billingStatus).toBe('METERING_ERROR');
    expect(invalidEvent.pointsCharged).toBe(0);
    await expect(meterModule.preflightPoints(ids.user, ids.provider, ids.model, 'MANAGED_USAGE')).resolves.toMatchObject({ rate: expect.anything() });
  });

  it('flags observed upstream text after disconnect without final usage for review without debiting points', async () => {
    const { db, aiRequests, devices, usageEvents, users, walletTransactions } = dbModule;
    const { eq } = await import('drizzle-orm');
    const [user] = await db.insert(users).values({ email: `v2-interrupted-${randomUUID()}@example.test`, passwordHash: 'test' }).returning();
    const [device] = await db.insert(devices).values({ userId: user.id, deviceId: randomUUID(), deviceName: 'test', platform: 'test' }).returning();
    await db.transaction(tx => walletModule.applyWalletChange(tx, { userId: user.id, points: 100, type: 'TEST_GRANT',
      referenceType: 'TEST', referenceId: user.id, idempotencyKey: `interrupted:${user.id}` }));
    const [request] = await db.insert(aiRequests).values({ responseId: `resp_${randomUUID().replaceAll('-', '')}`, userId: user.id,
      deviceId: device.id, providerId: ids.provider, modelId: ids.model, billingPolicy: 'MANAGED_USAGE',
      rateCardVersionId: ids.rateVersion, status: 'STARTED' }).returning();
    const event = await meterModule.settleAiRequest(request.id, 'CLIENT_DISCONNECTED', { usageUnavailable: true }, 'SHADOW');
    expect(event).toMatchObject({ billingStatus: 'METERING_ERROR', pointsRated: 0, pointsCharged: 0 });
    expect(await walletModule.walletSummary(user.id)).toMatchObject({ balance: 100 });
    expect(await db.select().from(walletTransactions).where(eq(walletTransactions.referenceId, request.id))).toHaveLength(0);
    const [updated] = await db.select().from(aiRequests).where(eq(aiRequests.id, request.id));
    expect(updated).toMatchObject({ status: 'CLIENT_DISCONNECTED', errorCode: 'COPILOT_USAGE_UNAVAILABLE' });
    const retry = await meterModule.settleAiRequest(request.id, 'PROVIDER_ERROR', {}, 'SHADOW');
    expect(retry.id).toBe(event.id);
    expect(await db.select().from(usageEvents).where(eq(usageEvents.requestId, request.id))).toHaveLength(1);
    await expect(meterModule.preflightPoints(user.id, ids.provider, ids.model, 'MANAGED_USAGE'))
      .resolves.toMatchObject({ rate: expect.anything() });
    const app=await(await import('./server.js')).createServer();
    try {
      const adminHeaders=await testCookieHeaders(dbModule,ids.admin);const userHeaders=await testCookieHeaders(dbModule,user.id);
      const path=`/api/v1/admin/usage-events/${event.id}/review`;const payload={resolution:'platform_waived',reason:'Internal cancellation test; platform assumes unknown supplier cost.'};
      expect((await app.inject({method:'POST',url:path,headers:userHeaders,payload})).statusCode).toBe(403);
      expect((await app.inject({method:'POST',url:path,headers:{...adminHeaders,origin:'https://forged.example'},payload})).statusCode).toBe(403);
      expect((await app.inject({method:'POST',url:path,headers:adminHeaders,payload:{...payload,reason:' '}})).statusCode).toBe(400);
      expect((await app.inject({method:'POST',url:`/api/v1/admin/usage-events/${randomUUID()}/review`,headers:adminHeaders,payload})).statusCode).toBe(404);
      expect((await app.inject({method:'GET',url:'/api/v1/admin/usage-events/review',headers:adminHeaders})).json().data.some((item:{id:string})=>item.id===event.id)).toBe(true);
      const reviewed=await app.inject({method:'POST',url:path,headers:adminHeaders,payload});expect(reviewed.statusCode).toBe(200);expect(reviewed.json()).toMatchObject({alreadyReviewed:false,review:{resolution:'platform_waived',supplierCostKnown:false,actorId:ids.admin}});
      expect((await app.inject({method:'POST',url:path,headers:adminHeaders,payload})).json().alreadyReviewed).toBe(true);
      await expect(meterModule.preflightPoints(user.id,ids.provider,ids.model,'MANAGED_USAGE')).resolves.toBeTruthy();
      const after=await db.select().from(usageEvents).where(eq(usageEvents.id,event.id));expect(after[0]).toEqual(event);
      expect(await db.select().from(walletTransactions).where(eq(walletTransactions.referenceId,request.id))).toHaveLength(0);expect((await walletModule.walletSummary(user.id)).balance).toBe(100);
      expect((await db.select().from(dbModule.auditLogs).where(eq(dbModule.auditLogs.targetId,event.id))).filter(log=>log.action==='USAGE_BILLING_REVIEWED')).toHaveLength(1);
      const [next]=await db.insert(aiRequests).values({responseId:`resp_${randomUUID()}`,userId:user.id,deviceId:device.id,providerId:ids.provider,modelId:ids.model,billingPolicy:'MANAGED_USAGE',rateCardVersionId:ids.rateVersion,status:'STARTED'}).returning();
      await meterModule.settleAiRequest(next.id,'CLIENT_DISCONNECTED',{usageUnavailable:true},'SHADOW');
      await expect(meterModule.preflightPoints(user.id,ids.provider,ids.model,'MANAGED_USAGE')).resolves.toMatchObject({rate:expect.anything()});
    }finally{await app.close();}
  });

  it('persists only verified Copilot credentials and audit without enabling the provider', async () => {
    const { auditLogs, db, providerCredentials, providers, webSessions } = dbModule;
    const { eq } = await import('drizzle-orm');
    const [provider] = await db.insert(providers).values({ code: 'COPILOT', name: 'Copilot', enabled: false }).returning();
    const token = 'gho_local-test-user-token';
    const fetcher = vi.fn(async (url: string | URL | Request) => Response.json(String(url).endsWith('/device/code')
      ? { device_code: 'hidden-device-code', user_code: 'TEST-CODE', verification_uri: 'https://github.com/login/device',
        expires_in: 120, interval: 5 }
      : { access_token: token, token_type: 'bearer' })) as unknown as typeof fetch;
    const { createCopilotAuthService } = await import('./copilot-auth.js');
    const service = createCopilotAuthService({ clientId: 'Iv1.testclientid', fetcher, wait: async () => {},
      discover: async () => ({ authenticated: true, login: 'test-copilot-user', models: [{ id: 'gpt-5.4-mini' }] }) });
    expect((await service.start(ids.admin)).status).toBe('PENDING');
    await vi.waitFor(async () => expect(await service.status()).toEqual({ status: 'AUTHENTICATED', login: 'test-copilot-user' }));
    const [credential] = await db.select().from(providerCredentials).where(eq(providerCredentials.providerId, provider.id));
    expect(credential.ciphertext).not.toContain(token);
    expect((await import('./security.js')).decryptSecret(credential)).toBe(token);
    const [unchanged] = await db.select().from(providers).where(eq(providers.id, provider.id));
    expect(unchanged.enabled).toBe(false);
    const audit = (await db.select().from(auditLogs)).find(row => row.action === 'COPILOT_DEVICE_AUTHENTICATED');
    expect(audit?.actorId).toBe(ids.admin);
    expect(JSON.stringify(audit?.metadata)).not.toMatch(/gho_|hidden-device-code/);
    const restored = createCopilotAuthService({ clientId: undefined,
      discover: async () => ({ authenticated: true, login: 'test-copilot-user', models: [{ id: 'gpt-5.4-mini' }] }) });
    expect(await restored.status()).toEqual({ status: 'AUTHENTICATED', login: 'test-copilot-user' });
    const app = await (await import('./server.js')).createServer();
    try {
      const { decryptSecret, hashRefresh, newRefresh } = await import('./security.js');
      const nonAdminHeaders = await testCookieHeaders(dbModule, ids.secondUser);
      for (const method of ['GET', 'POST'] as const) {
        const denied = await app.inject({ method, url: '/api/v1/admin/copilot/auth',
          headers: nonAdminHeaders });
        expect(denied.statusCode).toBe(403);
        expect(denied.json().error.code).toBe('FORBIDDEN');
      }
      const patchUrl = `/api/v1/admin/providers/${provider.id}`;
      const forbidden = await app.inject({ method: 'PATCH', url: patchUrl,
        headers: nonAdminHeaders, payload: { apiKey: 'replacement-key' } });
      expect(forbidden.statusCode).toBe(403);
      expect(forbidden.json().error.code).toBe('FORBIDDEN');
      const session = newRefresh();
      await db.insert(webSessions).values({ userId: ids.admin, tokenHash: hashRefresh(session),
        expiresAt: new Date(Date.now() + 60000) });
      const csrf = await app.inject({ method: 'PATCH', url: patchUrl,
        headers: { cookie: `bridge_session=${session}`, origin: 'https://not-the-admin-origin.example' },
        payload: { apiKey: 'replacement-key' } });
      expect(csrf.statusCode).toBe(403);
      expect(csrf.json().error.code).toBe('CSRF_REJECTED');
      const adminHeaders = await testCookieHeaders(dbModule, ids.admin);
      const headers = adminHeaders;
      for (const payload of [{ apiKey: 'replacement-key' }, { apiKey: 'replacement-key', enabled: false }]) {
        const rejected = await app.inject({ method: 'PATCH', url: patchUrl, headers, payload });
        expect(rejected.statusCode).toBe(409);
        expect(rejected.json().error.code).toBe('PROVIDER_CONNECTION_UNAVAILABLE');
      }
      const enable = await app.inject({ method: 'PATCH', url: patchUrl, headers, payload: { enabled: true } });
      expect(enable.statusCode).toBe(503);
      const [protectedCredential] = await db.select().from(providerCredentials).where(eq(providerCredentials.providerId, provider.id));
      expect(protectedCredential).toMatchObject({ ciphertext: credential.ciphertext, iv: credential.iv, tag: credential.tag });
      const [stillDisabled] = await db.select().from(providers).where(eq(providers.id, provider.id));
      expect(stillDisabled.enabled).toBe(false);
      const other = await app.inject({ method: 'PATCH', url: `/api/v1/admin/providers/${ids.provider}`, headers,
        payload: { apiKey: 'ordinary-provider-key' } });
      expect(other.statusCode).toBe(200);
      const [otherCredential] = await db.select().from(providerCredentials).where(eq(providerCredentials.providerId, ids.provider));
      expect(decryptSecret(otherCredential)).toBe('ordinary-provider-key');
    } finally { await app.close(); }
    service.cancel();
  });

  it('reads configured ACL and effective user models after admin assignment and revocation', async () => {
    const { db, subscriptions, users } = dbModule;
    const [user] = await db.insert(users).values({ email: `v2-access-${randomUUID()}@example.test`, passwordHash: 'test' }).returning();
    const now = new Date();
    await db.insert(subscriptions).values({ userId: user.id, planId: ids.plan, status: 'ACTIVE', startedAt: now,
      currentPeriodStart: now, currentPeriodEnd: new Date(now.getTime() + 86400000) });
    const app = await (await import('./server.js')).createServer();
    try {
      const headers = await testCookieHeaders(dbModule, ids.admin);
      const userHeaders = await testCookieHeaders(dbModule, user.id);
      const endpoint = `/api/v1/admin/model-access?userId=${user.id}`;
      expect((await app.inject({ method: 'GET', url: endpoint, headers: userHeaders })).statusCode).toBe(403);
      const read = async () => {
        const response = await app.inject({ method: 'GET', url: endpoint, headers });
        expect(response.statusCode).toBe(200);
        return response.json() as { planAccess: Array<{planId:string;modelId:string}>;
          overrides: Array<{modelId:string;access:string}>; effectiveModelIds: string[] };
      };
      expect((await read()).effectiveModelIds).not.toContain(ids.model);
      const allow = await app.inject({ method: 'PUT', url: `/api/v1/admin/models/${ids.model}/plans/${ids.plan}`, headers,
        payload: { allowed: true } });
      expect(allow.statusCode).toBe(200);
      expect((await read()).effectiveModelIds).toContain(ids.model);
      const deny = await app.inject({ method: 'PUT', url: `/api/v1/admin/users/${user.id}/models/${ids.model}`, headers,
        payload: { access: 'DENY' } });
      expect(deny.statusCode).toBe(200);
      const denied = await read();
      expect(denied.overrides).toContainEqual({ modelId: ids.model, access: 'DENY' });
      expect(denied.effectiveModelIds).not.toContain(ids.model);
      const reset = await app.inject({ method: 'PUT', url: `/api/v1/admin/users/${user.id}/models/${ids.model}`, headers,
        payload: { access: 'DEFAULT' } });
      expect(reset.statusCode).toBe(200);
      expect((await read()).effectiveModelIds).toContain(ids.model);
    } finally { await app.close(); }
  });

  it('records a referral and awards a qualified paid referral once', async () => {
    const { db, referralCodes, referrals, referralRewards, systemSettings } = dbModule;
    const [code] = await db.insert(referralCodes).values({ userId: ids.secondUser, code: 'V2TESTCODE' }).returning();
    const referral = await referralModule.registerReferral(ids.user, code.code, undefined, '192.0.2.1');
    expect(referral.status).toBe('REGISTERED');
    await db.insert(systemSettings).values({ key: 'referral_policy', value: { enabled: true, minPaidAmount: 1, referrerPoints: 5, referredPoints: 2 } });
    await db.transaction(tx => referralModule.qualifyReferralFromPaidOrder(tx, ids.user, 1));
    await db.transaction(tx => referralModule.qualifyReferralFromPaidOrder(tx, ids.user, 1));
    const [updated] = await db.select().from(referrals).where((await import('drizzle-orm')).eq(referrals.id, referral.id));
    expect(updated.status).toBe('REWARDED');
    expect(await db.select().from(referralRewards)).toHaveLength(2);
  });

  it('flags a shared installation and requires an audited Admin review', async () => {
    const { db, billingOrders, devices, referralRewards, referrals, users } = dbModule;
    const [ownerDevice] = await db.select().from(devices).where((await import('drizzle-orm')).eq(devices.id, ids.secondDevice));
    const [referred] = await db.insert(users).values({ email: `v2-risk-${randomUUID()}@example.test`, passwordHash: 'test' }).returning();
    const [sameInstallation] = await db.insert(devices).values({ userId: referred.id, deviceId: ownerDevice.deviceId, deviceName: 'duplicate', platform: 'test' }).returning();
    const flagged = await referralModule.registerReferral(referred.id, 'V2TESTCODE', sameInstallation.id, '192.0.2.2');
    expect(flagged.riskFlags).toContain('SAME_INSTALLATION');
    expect(flagged.status).toBe('PENDING');
    await db.insert(billingOrders).values({ orderNo: randomUUID(), userId: referred.id, planId: ids.plan, amount: '5', currency: 'CNY', provider: 'MANUAL', status: 'PAID', paidAt: new Date() });
    const app = await (await import('./server.js')).createServer();
    try {
      const headers = await testCookieHeaders(dbModule, ids.admin);
      const review = await app.inject({ method: 'POST', url: `/api/v1/admin/referrals/${flagged.id}/review`, headers,
        payload: { decision: 'APPROVE', reason: 'Verified paid user and device ownership' } });
      expect(review.statusCode).toBe(200);
      const [updated] = await db.select().from(referrals).where((await import('drizzle-orm')).eq(referrals.id, flagged.id));
      expect(updated.status).toBe('REWARDED');
      expect((await db.select().from(referralRewards)).filter(reward => reward.referralId === flagged.id)).toHaveLength(2);
    } finally { await app.close(); }
  });

  it('rates alternate instances of the same logical model and rejects unrelated providers', async () => {
    const { db, providers, models, modelInstances } = dbModule;
    const [logical] = await db.insert(models).values({ providerId: ids.provider, providerModelId: 'deepseek-flash', publicId: 'deepseek/rate-binding-test', displayName: 'Rate binding test' }).returning();
    const [alternate] = await db.insert(providers).values({ code: 'DEEPSEEK_BB0011223344', name: 'Alternate key' }).returning();
    const [unrelated] = await db.insert(providers).values({ code: 'OPENAI_BB0011223344', name: 'Wrong family' }).returning();
    await db.insert(modelInstances).values([{ modelId: logical.id, providerId: alternate.id, providerModelId: 'deepseek-flash' }, { modelId: logical.id, providerId: unrelated.id, providerModelId: 'deepseek-flash' }]);
    const app = await (await import('./server.js')).createServer();
    try {
      const headers = await testCookieHeaders(dbModule, ids.admin);
      const create = (providerId: string) => app.inject({ method: 'POST', url: '/api/v1/admin/rate-cards', headers, payload: { providerId, modelId: logical.id, billingPolicy: 'MANAGED_USAGE' } });
      expect((await create(alternate.id)).statusCode).toBe(201);
      expect((await create(unrelated.id)).statusCode).toBe(400);
      expect((await create(ids.provider)).statusCode).toBe(201);
    } finally { await app.close(); }
  });

  it('audits Admin point adjustments and publishes new rate versions without rewriting history', async () => {
    const { db, auditLogs, rateCardVersions, usageEvents } = dbModule;
    const app = await (await import('./server.js')).createServer();
    try {
      const headers = await testCookieHeaders(dbModule, ids.admin);

      const idempotencyKey = randomUUID();
      const payload = { points: 5, reason: 'Correct verified billing dispute', idempotencyKey };
      const first = await app.inject({ method: 'POST', url: `/api/v1/admin/users/${ids.user}/wallet/adjust`, headers, payload });
      const repeat = await app.inject({ method: 'POST', url: `/api/v1/admin/users/${ids.user}/wallet/adjust`, headers, payload });
      expect(first.statusCode).toBe(200);
      expect(repeat.json().duplicate).toBe(true);
      const create = await app.inject({ method: 'POST', url: `/api/v1/admin/rate-cards/${ids.rateCard}/versions`, headers,
        payload: { inputRate:'5', outputRate:'6', cachedInputRate:'1', reasoningRate:'8', imageInputRate:'0', imageOutputRate:'0', toolRate:'0', minimumCharge:0, effectiveFrom:null } });
      expect(create.statusCode).toBe(201);
      const publish = await app.inject({ method: 'POST', url: `/api/v1/admin/rate-card-versions/${create.json().id}/publish`, headers, payload: {} });
      expect(publish.statusCode).toBe(200);
      expect((await meterModule.activeRateVersion(ids.provider, ids.model, 'MANAGED_USAGE'))?.version).toBe(3);
      expect((await db.select().from(usageEvents)).some(event => event.rateCardVersionId === ids.rateVersion)).toBe(true);
      expect((await db.select().from(auditLogs)).some(log => log.action === 'WALLET_ADJUSTED')).toBe(true);
      expect((await db.select().from(rateCardVersions)).filter(version => version.status === 'ACTIVE')).toHaveLength(1);
    } finally { await app.close(); }
  });

  it('registers a referred account atomically and rejects invalid, duplicate and self referrals', async () => {
    const { db, users, referrals, referralRewards } = dbModule;
    const { eq } = await import('drizzle-orm');
    const codeText = 'V2TESTCODE';
    const app = await (await import('./server.js')).createServer();
    const email = `v2-onboard-${randomUUID()}@example.test`;
    const invalidEmail = `v2-invalid-${randomUUID()}@example.test`;
    const rollbackEmail = `v2-rollback-${randomUUID()}@example.test`;
    try {
      const register = (candidate: string, referralCode: string) => app.inject({ method: 'POST', url: '/api/v1/auth/register',
        payload: { email: candidate, password: 'testpassword123', referralCode } });
      const invalid = await register(invalidEmail, 'INVALIDCODE');
      expect(invalid.statusCode).toBe(404);
      expect(invalid.json().error.code).toBe('INVALID_REFERRAL_CODE');
      expect(await db.select().from(users).where(eq(users.email, invalidEmail))).toHaveLength(0);

      await db.execute(sql.raw("create function reject_v2_test_referral() returns trigger language plpgsql as $$ begin raise exception 'TEST_REFERRAL_INSERT_FAILED'; end $$"));
      await db.execute(sql.raw('create trigger reject_v2_test_referral before insert on referrals for each row execute function reject_v2_test_referral()'));
      try {
        const failed = await register(rollbackEmail, codeText);
        expect(failed.statusCode).toBe(500);
        expect(await db.select().from(users).where(eq(users.email, rollbackEmail))).toHaveLength(0);
      } finally {
        await db.execute(sql.raw('drop trigger reject_v2_test_referral on referrals'));
        await db.execute(sql.raw('drop function reject_v2_test_referral()'));
      }

      const created = await register(email, codeText);
      expect(created.statusCode).toBe(201);
      const [account] = await db.select().from(users).where(eq(users.email, email));
      const [referral] = await db.select().from(referrals).where(eq(referrals.referredUserId, account.id));
      expect(referral.referrerUserId).toBe(ids.secondUser);
      expect(referral.status).toBe('REGISTERED');
      expect(await db.select().from(referralRewards).where(eq(referralRewards.referralId, referral.id))).toHaveLength(0);
      const duplicate = await register(email, codeText);
      expect(duplicate.statusCode).toBe(409);
      expect(duplicate.json().error.code).toBe('EMAIL_IN_USE');
      await expect(referralModule.registerReferral(account.id, codeText)).rejects.toMatchObject({ code: 'REFERRAL_NOT_ELIGIBLE' });
      await expect(referralModule.registerReferral(ids.secondUser, codeText)).rejects.toMatchObject({ code: 'REFERRAL_NOT_ELIGIBLE' });
    } finally { await app.close(); }
  });

  it('rates SHADOW usage without changing the wallet or creating a usage debit', async () => {
    const { db, aiRequests, walletTransactions } = dbModule;
    const { eq } = await import('drizzle-orm');
    const before = await walletModule.walletSummary(ids.secondUser);
    const [request] = await db.insert(aiRequests).values({ responseId: `resp_${randomUUID().replaceAll('-', '')}`, userId: ids.secondUser,
      deviceId: ids.secondDevice, providerId: ids.provider, modelId: ids.model, billingPolicy: 'MANAGED_USAGE',
      rateCardVersionId: ids.rateVersion, status: 'STARTED' }).returning();
    const event = await meterModule.settleAiRequest(request.id, 'COMPLETED', {
      usage: { inputTokens: 1000, outputTokens: 1000 }, providerReportedUsage: { input_tokens: 1000, output_tokens: 1000 },
    }, 'SHADOW');
    expect(event.billingStatus).toBe('SHADOW');
    expect(event.pointsRated).toBe(30);
    expect(event.pointsCharged).toBe(0);
    expect(event.rateCardVersionId).toBe(ids.rateVersion);
    expect((await walletModule.walletSummary(ids.secondUser)).balance).toBe(before.balance);
    expect(await db.select().from(walletTransactions).where(eq(walletTransactions.referenceId, request.id))).toHaveLength(0);
    expect((await meterModule.settleAiRequest(request.id, 'COMPLETED', {}, 'SHADOW')).id).toBe(event.id);
  });

  it('stores only signed owned failure reports, bounds retention, and protects admin detail without altering billing',async()=>{
    const {db,users,devices,failureDiagnostics,walletTransactions}=dbModule;const {eq,sql}=await import('drizzle-orm');const security=await import('./security.js');
    const [user]=await db.insert(users).values({email:`diagnostic-${randomUUID()}@example.test`,passwordHash:'test'}).returning();
    const {privateKey,publicKey}=proofKey();const jwk=publicKey.export({format:'jwk'});
    const [device]=await db.insert(devices).values({userId:user.id,deviceId:randomUUID(),deviceName:'Diagnostic',platform:'Windows',appVersion:'0.0.1',publicKeyJwk:{kty:'EC',crv:'P-256',x:jwk.x!,y:jwk.y!}}).returning();
    const token=await security.issueAccess(user.id,device.id);const app=await(await import('./server.js')).createServer();
    const before=await db.select().from(walletTransactions);const path='/api/v1/diagnostics/failures';
    const body={id:randomUUID(),ownerUserId:user.id,occurredAt:new Date().toISOString(),appVersion:'forged',traceId:randomUUID(),stage:'cloud_http',error:{code:'GATEWAY_TIMEOUT',message:'secret=hidden'},request:{forwarded:{model:'fixture',headers:{authorization:'Bearer hidden'},input:'合成私人文本'}},reply:{events:[{type:'response.failed'}]}};
    const send=async(payload:Record<string,unknown>)=>app.inject({method:'POST',url:path,payload,headers:{...await signedHeaders(privateKey,'POST',path,payload,token),authorization:`Bearer ${token}`,'x-device-id':device.deviceId}});
    try{
      expect((await app.inject({method:'POST',url:path,payload:body})).statusCode).toBe(401);
      expect((await app.inject({method:'POST',url:path,payload:body,headers:{authorization:`Bearer ${token}`,'x-device-id':device.deviceId}})).statusCode).toBe(401);
      expect((await send({...body,ownerUserId:ids.user})).statusCode).toBe(403);
      expect((await send({...body,email:'spoof@test'})).statusCode).toBe(400);
      expect((await send({...body,request:{desktop:'字'.repeat(50000)}})).statusCode).toBe(413);
      expect((await send(body)).json()).toMatchObject({id:body.id,received:true,duplicate:false});
      expect((await send(body)).json()).toMatchObject({duplicate:true});
      const [stored]=await db.select().from(failureDiagnostics).where(eq(failureDiagnostics.id,body.id));
      expect(stored.userEmail).toBe(user.email);expect(stored.appVersion).toBe('0.0.1');expect(JSON.stringify(stored.payload)).not.toContain('合成私人文本');
      const payload=JSON.parse(security.decryptSecret(stored.payload));expect(JSON.stringify(payload)).not.toContain('hidden');expect(payload.request.forwarded.input).toBe('合成私人文本');
      const ordinary=await testCookieHeaders(dbModule,user.id),adminHeaders=await testCookieHeaders(dbModule,ids.admin);const detail=`/api/v1/admin/diagnostics/failures/${body.id}`;
      expect((await app.inject({url:detail,headers:ordinary})).statusCode).toBe(403);
      expect((await app.inject({url:detail,headers:adminHeaders})).json().report.userEmail).toBe(user.email);
      expect((await app.inject({url:'/api/v1/admin/diagnostics/failures?email='+encodeURIComponent(user.email),headers:adminHeaders})).json().total).toBe(1);
      for(let i=0;i<29;i++)expect((await send({...body,id:randomUUID()})).statusCode).toBe(200);
      await db.insert(failureDiagnostics).values(Array.from({length:1001},()=>({...stored,id:randomUUID()})));
      await db.update(failureDiagnostics).set({createdAt:new Date(Date.now()-15*86400000)}).where(eq(failureDiagnostics.id,body.id));
      await(await import('./diagnostics.js')).cleanFailureDiagnostics();
      expect(await db.select().from(failureDiagnostics).where(eq(failureDiagnostics.id,body.id))).toHaveLength(0);
      expect(Number((await db.execute(sql`select count(*) as count from failure_diagnostics`)).rows[0].count)).toBe(1000);
      expect((await send({...body,id:randomUUID()})).statusCode).toBe(429);
      const [latest]=await db.select().from(failureDiagnostics).limit(1);const deletion=`/api/v1/admin/diagnostics/failures/${latest.id}`;
      expect((await app.inject({method:'DELETE',url:deletion,headers:{cookie:adminHeaders.cookie}})).statusCode).toBe(403);
      expect((await app.inject({method:'DELETE',url:deletion,headers:adminHeaders})).statusCode).toBe(200);
      expect(await db.select().from(walletTransactions)).toEqual(before);
    }finally{await db.delete(failureDiagnostics);await db.delete(dbModule.systemSettings).where(eq(dbModule.systemSettings.key,'diagnostic_rate:'+user.id));await app.close();}
  });

  it('enforces the current desktop release and prunes obsolete installer records without touching money data',async()=>{
    const {db,releases,devices,walletTransactions}=dbModule;const {eq}=await import('drizzle-orm');const security=await import('./security.js');
    const {privateKey,publicKey}=proofKey();const jwk=publicKey.export({format:'jwk'});
    const [device]=await db.insert(devices).values({userId:ids.secondUser,deviceId:randomUUID(),deviceName:'Version Gate',platform:'Windows',appVersion:'0.3.0',publicKeyJwk:{kty:'EC',crv:'P-256',x:jwk.x!,y:jwk.y!}}).returning();
    const before=await db.select().from(walletTransactions);const app=await(await import('./server.js')).createServer();
    try{
      const headers=await testCookieHeaders(dbModule,ids.admin);
      const publish=async(version:string)=>app.inject({method:'POST',url:'/api/v1/admin/releases',headers,payload:{version,channel:'stable',platform:'windows',arch:'x64',downloadUrl:'https://example.test/fixture.exe',sha256:'a'.repeat(64),published:true}});
      expect((await publish('100.0.0')).statusCode).toBe(201);expect((await publish('100.0.1')).statusCode).toBe(201);
      const rows=await db.select().from(releases);expect(rows.filter(r=>r.published)).toHaveLength(1);expect(rows[0].version).toBe('100.0.1');
      expect((await app.inject({url:'/api/v1/client/config'})).json()).toMatchObject({minimumVersion:'100.0.1',latestVersion:'100.0.1'});
      const token=await security.issueAccess(ids.secondUser,device.id);
      const desktop=async()=>app.inject({url:'/v1/models',headers:{...await signedHeaders(privateKey,'GET','/v1/models',undefined,token),authorization:`Bearer ${token}`,'x-device-id':device.deviceId}});
      expect((await desktop()).statusCode).toBe(426);
      await db.update(devices).set({appVersion:'100.0.1'}).where(eq(devices.id,device.id));expect((await desktop()).statusCode).not.toBe(426);
      expect((await app.inject({url:'/api/v1/admin/releases',headers})).statusCode).toBe(200);
      expect(await db.select().from(walletTransactions)).toEqual(before);
    }finally{await db.delete(releases);await app.close();}
  });

  it('pins native instances, bills actual cached/reasoning usage once, and scopes encrypted previous responses', async () => {
    const {db,users,devices,providers,providerCredentials,models,modelInstances,plans,planModelAccess,subscriptions,systemSettings,aiRequests,usageEvents,modelSessions,usageRecords}=dbModule;
    const {eq}=await import('drizzle-orm');const security=await import('./security.js');
    const [user]=await db.insert(users).values({email:`native-${randomUUID()}@example.test`,passwordHash:await security.hashPassword('FixturePassword123!')}).returning();
    const {privateKey,publicKey}=proofKey();const jwk=publicKey.export({format:'jwk'});
    const deviceData={userId:user.id,deviceName:'Native Fixture',platform:'Windows',appVersion:'0.3.0',publicKeyJwk:{kty:'EC' as const,crv:'P-256' as const,x:jwk.x!,y:jwk.y!}};
    const [device]=await db.insert(devices).values({...deviceData,deviceId:randomUUID()}).returning();
    const [otherDevice]=await db.insert(devices).values({...deviceData,deviceId:randomUUID()}).returning();
    const [provider]=await db.insert(providers).values({code:`DEEPSEEK_${randomUUID().replaceAll('-','').slice(0,12).toUpperCase()}`,name:'Native Fixture',enabled:true,baseUrl:'https://api.deepseek.com'}).returning();
    const [alternate]=await db.insert(providers).values({code:`DEEPSEEK_${randomUUID().replaceAll('-','').slice(0,12).toUpperCase()}`,name:'Native Alternate',enabled:true,baseUrl:'https://api.deepseek.com'}).returning();
    await db.insert(providerCredentials).values([{providerId:provider.id,...security.encryptSecret('fixture-key')},{providerId:alternate.id,...security.encryptSecret('fixture-key')}]);
    const [model]=await db.insert(models).values({providerId:provider.id,providerModelId:'deepseek-flash',publicId:`deepseek/native-${randomUUID()}`,displayName:'Native Fixture',enabled:true,supportsTools:true,supportsReasoning:true,contextWindow:1000000,maxOutputTokens:512}).returning();
    const instanceData={modelId:model.id,providerModelId:'deepseek-flash',enabled:true,healthStatus:'READY',nativeProtocols:['responses'],capabilities:{tools:true,reasoning:true,streaming:true}};
    const [instance]=await db.insert(modelInstances).values({...instanceData,providerId:provider.id,priority:10}).returning();
    await db.insert(modelInstances).values({...instanceData,providerId:alternate.id,priority:0});
    const [plan]=await db.insert(plans).values({code:`NATIVE_${randomUUID().slice(0,8)}`,name:'Native Fixture',monthlyPrice:'1',maxDevices:2,monthlyTokenLimit:1000000,monthlyUsageCreditLimit:'1000000',maxConcurrentRequests:3,requestsPerMinute:60,enabled:true}).returning();
    const now=new Date();await db.insert(subscriptions).values({userId:user.id,planId:plan.id,status:'ACTIVE',startedAt:now,currentPeriodStart:now,currentPeriodEnd:new Date(Date.now()+86400000)});
    await db.insert(planModelAccess).values({modelId:model.id,planId:plan.id});
    await db.transaction(tx=>walletModule.applyWalletChange(tx,{userId:user.id,points:200000,type:'PURCHASE',referenceType:'TEST',referenceId:'native-quota',idempotencyKey:`native-quota-${user.id}`}));
    await db.insert(systemSettings).values({key:'rate_policy',value:{accountRpm:2,deviceRpm:1,publicIpRpm:120,authIpRpm:120}}).onConflictDoUpdate({target:systemSettings.key,set:{value:{accountRpm:2,deviceRpm:1,publicIpRpm:120,authIpRpm:120}}});
    const discoveryHistory=[{role:'user',content:'private fixture prompt'},
      {type:'tool_search_call',call_id:'search_history',execution:'client',arguments:'{"query":"probe"}'},
      {type:'function_call',call_id:'historical_probe',name:'probe',arguments:'{}'},
      {type:'tool_search_output',call_id:'search_history',execution:'client',tools:[]},
      {type:'function_call_output',call_id:'historical_probe',output:'synthetic historical result'}];
    let executions=0;
    vi.stubGlobal('fetch',vi.fn(async(url,init)=>{
      if(String(url).endsWith('/user/balance'))return Response.json({is_available:true,balance_infos:[{currency:'CNY',total_balance:'100',granted_balance:'0',topped_up_balance:'100'}]});
      expect(String(url)).toBe('https://api.deepseek.com/responses');const request=JSON.parse(init.body);expect(request.max_output_tokens).toBeLessThanOrEqual(64);expect(request.reasoning.effort).toBe('low');
      executions++;if(executions===3)throw new (await import('./native-timeouts.js')).NativeTimeoutError('total');
      if(executions===5)throw new (await import('./native-timeouts.js')).NativeTimeoutError('idle');
      if(executions===7)return new Response('',{status:500});
      if(executions<=2){
        expect(request.input.some((item:{type:string})=>['tool_search_call','tool_search_output'].includes(item.type))).toBe(false);
        const envelope=JSON.parse(request.input[0].content[0].text.split('\n').slice(1).join('\n'));
        expect(envelope.records.map((record:{item:{call_id:string}})=>record.item.call_id)).toEqual(['search_history','search_history']);
        const callIndex=request.input.findIndex((item:{call_id:string;type:string})=>item.type==='function_call'&&item.call_id==='historical_probe');
        expect(request.input[callIndex+1]).toMatchObject({type:'function_call_output',call_id:'historical_probe'});
      }
      if(executions===2)expect(request.input.find((item:{type:string})=>item.type==='reasoning')).toMatchObject({id:'rs_native',content:[{type:'reasoning_text',text:'private fixture reasoning'}],summary:[],encrypted_content:'opaque-fixture',internal_chat_message_metadata_passthrough:{fixture:true}});
      if(executions===2)expect(request.input.filter((item:{type:string})=>item.type==='function_call_output').map((item:{call_id:string})=>item.call_id)).toEqual(['historical_probe','call_native','call_native_2']);
      const output=executions===1?[{id:'rs_native',type:'reasoning',status:'completed',content:[{type:'reasoning_text',text:'private fixture reasoning'}],summary:[],encrypted_content:'opaque-fixture'},{id:'fc_native',type:'function_call',call_id:'call_native',name:'probe',arguments:'{}'},{id:'fc_native_2',type:'function_call',call_id:'call_native_2',name:'probe',arguments:'{}'}]:[{id:'msg_native',type:'message',role:'assistant',content:[{type:'output_text',text:'done'}]}];
      return Response.json({id:`upstream_${executions}`,object:'response',status:'completed',model:'deepseek-flash',output,usage:{input_tokens:20,input_tokens_details:{cached_tokens:4},output_tokens:8,output_tokens_details:{reasoning_tokens:3},total_tokens:28}});
    }));
    const app=await(await import('./server.js')).createServer();
    try {
      const token=await security.issueAccess(user.id,device.id);const otherToken=await security.issueAccess(user.id,otherDevice.id);const thread=randomUUID();
      const send=async(input:unknown,previous_response_id?:string,useOtherDevice=false,stream=false)=>{
        const activeDevice=useOtherDevice?otherDevice:device;const activeToken=useOtherDevice?otherToken:token;
        const payload={model:model.publicId,input,previous_response_id,stream,parallel_tool_calls:false,tools:[{type:'function',name:'probe',parameters:{}}],reasoning:{mode:'thinking',effort:'low'},max_output_tokens:64};
        return app.inject({method:'POST',url:'/v1/responses',headers:{...await signedHeaders(privateKey,'POST','/v1/responses',payload,activeToken),authorization:`Bearer ${activeToken}`,'x-device-id':activeDevice.deviceId,'x-client-thread-id':useOtherDevice?randomUUID():thread},payload});
      };
      const before=(await walletModule.walletSummary(user.id)).balance;
      // Old RUNNING records no longer reserve balance or block unrelated requests.
      const held=await db.insert(usageRecords).values(Array.from({length:3},()=>({userId:user.id,deviceId:device.id,planId:plan.id,providerId:provider.id,modelId:model.id,status:'RUNNING',totalTokens:1,usageCredit:'1',createdAt:new Date(Date.now()-86400000)}))).returning();
      expect((await(await import('./core.js')).currentUsage(user.id,(await db.select().from(subscriptions).where(eq(subscriptions.userId,user.id)))[0],plan)).remainingPoints).toBe(before);
      const previousNative=process.env.NATIVE_RESPONSES_ENABLED;process.env.NATIVE_RESPONSES_ENABLED='false';
      try {const closed=await send('private fixture prompt');expect(closed.statusCode).toBe(503);expect(executions).toBe(0);expect(await db.select().from(aiRequests).where(eq(aiRequests.userId,user.id))).toHaveLength(0);expect((await walletModule.walletSummary(user.id)).balance).toBe(before);}
      finally {if(previousNative===undefined)delete process.env.NATIVE_RESPONSES_ENABLED;else process.env.NATIVE_RESPONSES_ENABLED=previousNative;}
      const first=await send(discoveryHistory);expect(first.statusCode).toBe(200);expect(first.json().output[1].id).toBe('fc_native');
      expect(first.json().output.filter((item:{type:string})=>item.type==='function_call').map((item:{call_id:string})=>item.call_id)).toEqual(['call_native','call_native_2']);
      const [healthy]=await db.select().from(modelInstances).where(eq(modelInstances.id,instance.id));expect(healthy).toMatchObject({healthStatus:'READY',cooldownUntil:null});
      const [session]=await db.select().from(modelSessions).where(eq(modelSessions.userId,user.id));expect(JSON.stringify(session.state)).not.toContain('private fixture');expect(session.state.encryptedHistory).toBeTruthy();expect(session.instanceId).toBe(instance.id);
      const foreign=await send([{type:'function_call_output',call_id:'call_native',output:'done'}],first.json().id,true);expect(foreign.statusCode).toBe(409);expect(foreign.json().error.code).toBe('CONVERSATION_NOT_FOUND');
      const replayOutput=first.json().output.map((item:Record<string,unknown>)=>{if(item.type!=='reasoning')return item;const {status:_status,...rest}=item;return {...rest,internal_chat_message_metadata_passthrough:{fixture:true}};});
      const second=await send([...discoveryHistory,...replayOutput,{type:'function_call_output',call_id:'call_native',output:'done'},{type:'function_call_output',call_id:'call_native_2',output:'done two'}]);expect(second.statusCode).toBe(200);
      const requests=await db.select().from(aiRequests).where(eq(aiRequests.userId,user.id));expect(requests).toHaveLength(2);expect(requests.every(r=>r.instanceId===instance.id&&r.protocolMode==='native')).toBe(true);expect(requests.map(r=>r.responseId)).toContain(first.json().id);
      const events=await db.select().from(usageEvents).where(eq(usageEvents.userId,user.id));expect(events).toHaveLength(2);expect(events.every(e=>e.cachedInputTokens===4&&e.reasoningTokens===3&&e.billingStatus==='SETTLED')).toBe(true);
      expect(before-(await walletModule.walletSummary(user.id)).balance).toBe(events.reduce((sum,e)=>sum+e.pointsCharged,0));
      const records=await db.select().from(usageRecords).where(eq(usageRecords.userId,user.id));expect(records.filter(r=>r.status!=='RUNNING').map(r=>r.rateCounted)).toEqual([true,false]);
      await db.update(systemSettings).set({value:{accountRpm:120,deviceRpm:60,publicIpRpm:120,authIpRpm:120}}).where(eq(systemSettings.key,'rate_policy'));
      const timedOut=await send('fixed slow document-writing fixture',second.json().id,false,true);expect(timedOut.statusCode,timedOut.body).toBe(200);
      const failed=timedOut.body.split(/\n\n/).filter(block=>block.includes('event: response.failed')).map(block=>JSON.parse(block.split('\n').find(line=>line.startsWith('data: '))!.slice(6)))[0];
      expect(failed.response.error).toMatchObject({code:'GATEWAY_TIMEOUT',request_id:expect.any(String),timeout_phase:'total'});expect(failed.error).toEqual(failed.response.error);
      const [timeoutEvent]=await db.select().from(usageEvents).where(eq(usageEvents.requestId,failed.response.error.request_id));expect(timeoutEvent.billingStatus).toBe('METERING_ERROR');expect(timeoutEvent.providerCost).toBeNull();
      const [afterPlatformLimit]=await db.select().from(modelInstances).where(eq(modelInstances.id,instance.id));expect(afterPlatformLimit).toMatchObject({healthStatus:'READY',cooldownUntil:null});
      // An exhausted wallet blocks before calling the supplier. After crediting,
      // the prior metering anomaly and legacy period/concurrency limits do not block.
      const available=(await walletModule.walletSummary(user.id)).balance;
      await db.transaction(tx=>walletModule.applyWalletChange(tx,{userId:user.id,points:-available,type:'TEST',referenceType:'TEST',referenceId:user.id,idempotencyKey:`empty-${user.id}`}));
      await db.insert(systemSettings).values({key:`user_quota:${user.id}`,value:{rmbLimit:0}});
      const fresh=await send('new conversation with an empty wallet',undefined,true);expect(fresh.statusCode,fresh.body).toBe(402);expect(fresh.json().error.code).toBe('INSUFFICIENT_POINTS');expect(executions).toBe(3);
      const adminHeaders=await testCookieHeaders(dbModule,ids.admin);
      const firstEvent=(await db.select().from(usageEvents).where(eq(usageEvents.userId,user.id)))[0];
      const audit=firstEvent.providerReportedUsage?.bridge_cost_audit as Record<string,unknown>;
      expect(audit).toMatchObject({costSource:'OFFICIAL_RATE_ESTIMATE',balanceScope:'UPSTREAM_ACCOUNT_WINDOW_NOT_REQUEST',balanceStatus:'OBSERVED',userChargedRmb:firstEvent.pointsCharged/10000});
      expect(Number(audit.walletBeforeRmb)-Number(audit.walletAfterRmb)).toBeCloseTo(firstEvent.pointsCharged/10000,8);
      const costList=await app.inject({url:'/api/v1/admin/cost-requests?includeTest=true',headers:adminHeaders});expect(costList.statusCode).toBe(200);expect(costList.json().data.some((r:{requestId:string})=>r.requestId===firstEvent.requestId)).toBe(true);
      expect((await app.inject({url:'/api/v1/admin/cost-requests?includeTest=true',headers:await testCookieHeaders(dbModule,user.id)})).statusCode).toBe(403);
      const costs=await app.inject({url:'/api/v1/admin/cost-analytics?groupBy=model&includeTest=true',headers:adminHeaders});expect(costs.statusCode,costs.body).toBe(200);const summary=costs.json().data.find((r:{group:string})=>r.group===model.publicId);expect(summary.pricedRequests).toBe(2);expect(summary.unpricedCostRows).toBe(1);expect(summary.estimatedCostRmb).toBeGreaterThan(0);expect(summary.estimatedGrossMarginRmb).not.toBeNull();
      expect((await app.inject({url:'/api/v1/admin/cost-requests',headers:adminHeaders})).json().data).toHaveLength(0);
      expect((await app.inject({url:'/api/v1/admin/cost-analytics',headers:adminHeaders})).json().data).toHaveLength(0);
      const lockPath=`/api/v1/admin/users/${user.id}`;
      expect((await app.inject({method:'PATCH',url:lockPath,headers:adminHeaders,payload:{status:'DISABLED'}})).statusCode).toBe(200);
      const locked=await send('locked user',undefined,true);expect(locked.statusCode).toBe(403);expect(locked.json().error.code).toBe('ACCOUNT_DISABLED');expect(executions).toBe(3);
      expect((await app.inject({method:'PATCH',url:lockPath,headers:adminHeaders,payload:{status:'ACTIVE'}})).statusCode).toBe(200);
      const topup={points:10000,reason:'Administrator immediate balance adjustment',idempotencyKey:randomUUID()};
      const adjustPath=`${lockPath}/wallet/adjust`;
      const credited=await app.inject({method:'POST',url:adjustPath,headers:adminHeaders,payload:topup});expect(credited.statusCode,credited.body).toBe(200);expect(credited.json().transaction.balanceAfter).toBe(10000);
      expect((await app.inject({method:'POST',url:adjustPath,headers:adminHeaders,payload:topup})).json().duplicate).toBe(true);expect((await walletModule.walletSummary(user.id)).balance).toBe(10000);
      const resumed=await send('unlocked account',undefined,true);expect(resumed.statusCode,resumed.body).toBe(200);expect(resumed.json().usage.billing_status).toBe('SETTLED');expect(executions).toBe(4);
      const reduced=await app.inject({method:'POST',url:adjustPath,headers:adminHeaders,payload:{points:-1000,reason:'Administrator decreases available balance',idempotencyKey:randomUUID()}});expect(reduced.statusCode,reduced.body).toBe(200);
      const beforeReduction=(await walletModule.walletSummary(user.id)).balance;
      const invalidReduction=await app.inject({method:'POST',url:adjustPath,headers:adminHeaders,payload:{points:-(beforeReduction+1),reason:'Administrator tries to exceed available balance',idempotencyKey:randomUUID()}});expect(invalidReduction.statusCode).toBe(402);expect((await walletModule.walletSummary(user.id)).balance).toBe(beforeReduction);
      const limitPath=`${lockPath}/devices-limit`;
      expect((await app.inject({method:'PUT',url:limitPath,headers:await testCookieHeaders(dbModule,user.id),payload:{maxDevices:4}})).statusCode).toBe(403);
      expect((await app.inject({method:'PUT',url:limitPath,headers:adminHeaders,payload:{maxDevices:4}})).statusCode).toBe(200);
      expect((await(await import('./core.js')).currentSubscription(user.id))!.plan.maxDevices).toBe(4);
      const thirdIdentity=randomUUID();const newDevicePayload={deviceId:thirdIdentity,deviceName:'Third Fixture',platform:'Windows',appVersion:'0.3.0',publicKeyJwk:jwk};
      const userHeaders=await testCookieHeaders(dbModule,user.id);
      const registered=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email:user.email,password:'FixturePassword123!',device:newDevicePayload}});expect(registered.statusCode,registered.body).toBe(200);
      expect((await app.inject({method:'PUT',url:limitPath,headers:adminHeaders,payload:{maxDevices:2}})).statusCode).toBe(200);
      const overLimit=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email:user.email,password:'FixturePassword123!',device:{...newDevicePayload,deviceId:randomUUID()}}});expect(overLimit.statusCode).toBe(409);expect(overLimit.json().error.code).toBe('DEVICE_LIMIT_REACHED');
      const thirdId=registered.json().device.id;expect((await app.inject({method:'PATCH',url:`/api/v1/admin/devices/${thirdId}`,headers:adminHeaders,payload:{status:'REVOKED'}})).statusCode).toBe(200);
      const restore=await app.inject({method:'PATCH',url:`/api/v1/admin/devices/${thirdId}`,headers:adminHeaders,payload:{status:'ACTIVE'}});expect(restore.statusCode).toBe(409);
      const detail=(await app.inject({url:lockPath,headers:adminHeaders})).json();expect(Number(detail.billingRisks.pendingReview)).toBe(1);expect(Number(detail.billingRisks.unpaidRequests)).toBe(0);expect(detail.limits.maxDevices).toBe(2);expect(detail.wallet.balance).toBe(beforeReduction);

      // With one usable supplier, a single idle timeout/500 still permits the
      // next fresh conversation immediately; no alternate masks quarantine.
      await db.update(modelInstances).set({enabled:false}).where(eq(modelInstances.providerId,alternate.id));
      for(const failure of ['idle timeout','supplier 500']){
        const failedRequest=await send(failure,undefined,true);expect(failedRequest.statusCode).toBeGreaterThanOrEqual(500);
        const [degraded]=await db.select().from(modelInstances).where(eq(modelInstances.id,instance.id));expect(degraded).toMatchObject({healthStatus:'DEGRADED',cooldownUntil:null});
        const newConversation=await send('fresh conversation after '+failure,undefined,true);expect(newConversation.statusCode,newConversation.body).toBe(200);
      }
      expect(executions).toBe(8);
      for(const row of held)await db.delete(usageRecords).where(eq(usageRecords.id,row.id));
      await db.update(modelInstances).set({enabled:false}).where(eq(modelInstances.id,instance.id));const disabled=await send('new turn',second.json().id);expect(disabled.statusCode).toBe(409);expect(disabled.json().error.code).toBe('MODEL_UNAVAILABLE');expect(executions).toBe(8);
    } finally {await app.close();vi.unstubAllGlobals();}
  });

  it('admits new turns and tool continuations without account, device or plan RPM caps', async () => {
    const { db, devices, models, planModelAccess, plans, providers, subscriptions, systemSettings, usageRecords, users } = dbModule;
    const { eq } = await import('drizzle-orm');
    const [user] = await db.insert(users).values({ email: `v2-tool-${randomUUID()}@example.test`, passwordHash: 'test' }).returning();
    const { privateKey, publicKey } = proofKey();
    const jwk = publicKey.export({ format: 'jwk' });
    const [device] = await db.insert(devices).values({ userId: user.id, deviceId: randomUUID(), deviceName: 'Tool PC',
      platform: 'Windows', publicKeyJwk: { kty: 'EC', crv: 'P-256', x: jwk.x!, y: jwk.y! } }).returning();
    const [provider] = await db.insert(providers).values({ code: 'MOCK', name: 'Tool Mock', enabled: true }).returning();
    const [model] = await db.insert(models).values({ providerId: provider.id, providerModelId: 'mock-chat',
      publicId: 'mock/tool', displayName: 'Tool Mock', enabled: true, supportsTools: true }).returning();
    const [plan] = await db.insert(plans).values({ code: `TOOL_${randomUUID().slice(0, 8)}`, name: 'Tool Test',
      monthlyPrice: '0', maxDevices: 1, monthlyTokenLimit: 100000, monthlyUsageCreditLimit: '100000',
      maxConcurrentRequests: 4, requestsPerMinute: 1, enabled: true }).returning();
    const now = new Date();
    await db.insert(subscriptions).values({ userId: user.id, planId: plan.id, status: 'ACTIVE',
      startedAt: now, currentPeriodStart: now, currentPeriodEnd: new Date(now.getTime() + 86400000) });
    await db.insert(planModelAccess).values({ modelId: model.id, planId: plan.id });
    await db.insert(systemSettings).values({ key: 'rate_policy', value: { accountRpm: 2, deviceRpm: 1, publicIpRpm: 120, authIpRpm: 120 } })
      .onConflictDoUpdate({ target: systemSettings.key, set: { value: { accountRpm: 2, deviceRpm: 1, publicIpRpm: 120, authIpRpm: 120 } } });
    const previousMockEnabled = process.env.INTEGRATION_MOCK_ENABLED;
    const previousMockEmail = process.env.INTEGRATION_MOCK_TEST_EMAIL;
    const previousBillingMode = process.env.V2_BILLING_MODE;
    process.env.INTEGRATION_MOCK_ENABLED = 'true';
    process.env.INTEGRATION_MOCK_TEST_EMAIL = user.email;
    process.env.V2_BILLING_MODE = 'OFF';
    // This is a rate/continuation test, not an empty-wallet rejection test.
    // The production money policy can enforce billing even when the legacy mode is OFF.
    await db.transaction(tx=>walletModule.applyWalletChange(tx,{userId:user.id,points:10000,type:'PURCHASE',referenceType:'TEST',referenceId:'tool-quota',idempotencyKey:`tool-quota-${user.id}`}));
    const app = await (await import('./server.js')).createServer();
    try {
      const token = await (await import('./security.js')).issueAccess(user.id, device.id);
      const thread = randomUUID();
      const tools = [{ name: 'read', parameters: {} }, { name: 'write', parameters: {} }];
      const send = async (input: unknown, threadId = thread) => {
        const payload = { model: model.publicId, input, tools };
        const headers = await signedHeaders(privateKey, 'POST', '/v1/responses', payload, token);
        return app.inject({ method: 'POST', url: '/v1/responses',
          headers: { ...headers, authorization: `Bearer ${token}`, 'x-device-id': device.deviceId, 'x-client-thread-id': threadId },
          payload });
      };
      const prompt = { role: 'user', content: 'Use two local tools' };
      const first = await send([prompt]);
      expect(first.statusCode).toBe(200);
      const firstCall = first.json().output[0];
      const firstOutput = { type: 'function_call_output', call_id: firstCall.call_id, output: 'read result' };
      const second = await send([prompt, firstCall, firstOutput]);
      expect(second.statusCode).toBe(200);
      const secondCall = second.json().output[0];
      const third = await send([prompt, firstCall, firstOutput, secondCall,
        { type: 'function_call_output', call_id: secondCall.call_id, output: 'write result' }]);
      expect(third.statusCode).toBe(200);
      expect(third.json().output[0].type).toBe('message');
      expect((await send('new turn')).statusCode).toBe(200);
      const records = await db.select({ counted: usageRecords.rateCounted }).from(usageRecords).where(eq(usageRecords.userId, user.id));
      expect(records.map(row => row.counted)).toEqual([true, false, false, true]);
    } finally {
      await app.close();
      if (previousMockEnabled === undefined) delete process.env.INTEGRATION_MOCK_ENABLED;
      else process.env.INTEGRATION_MOCK_ENABLED = previousMockEnabled;
      if (previousMockEmail === undefined) delete process.env.INTEGRATION_MOCK_TEST_EMAIL;
      else process.env.INTEGRATION_MOCK_TEST_EMAIL = previousMockEmail;
      if (previousBillingMode === undefined) delete process.env.V2_BILLING_MODE;
      else process.env.V2_BILLING_MODE = previousBillingMode;
    }
  });

  it('registers a new account, requires Admin activation, then admits a signed Cloud request', async () => {
    const { db, models, planModelAccess, plans, providers } = dbModule;
    const { publicKey, privateKey } = proofKey();
    const exported = publicKey.export({ format: 'jwk' });
    const device = { deviceId: randomUUID(), deviceName: 'New Desktop', platform: 'Windows',
      publicKeyJwk: { kty: 'EC', crv: 'P-256', x: exported.x, y: exported.y } };
    const email = `v2-new-${randomUUID()}@example.test`;
    const password = 'new-user-test-password123';
    const [plan] = await db.insert(plans).values({ code: 'STANDARD', name: 'New User Test', monthlyPrice: '1',
      maxDevices: 2, monthlyTokenLimit: 100000, monthlyUsageCreditLimit: '100000',
      maxConcurrentRequests: 2, requestsPerMinute: 30, monthlyPoints: 100, enabled: true }).returning();
    const [provider] = await db.insert(providers).values({ code: 'MOCK', name: 'New User Mock', enabled: true })
      .onConflictDoUpdate({ target: providers.code, set: { enabled: true } }).returning();
    const [model] = await db.insert(models).values({ providerId: provider.id, providerModelId: 'mock-chat',
      publicId: `mock/new-${randomUUID()}`, displayName: 'New User Mock', enabled: true }).returning();
    await db.insert(planModelAccess).values({ planId: plan.id, modelId: model.id });
    const previousMockEnabled = process.env.INTEGRATION_MOCK_ENABLED;
    const previousMockEmail = process.env.INTEGRATION_MOCK_TEST_EMAIL;
    const previousBillingMode = process.env.V2_BILLING_MODE;
    process.env.INTEGRATION_MOCK_ENABLED = 'true';
    process.env.INTEGRATION_MOCK_TEST_EMAIL = email;
    process.env.V2_BILLING_MODE = 'OFF';
    const app = await (await import('./server.js')).createServer();
    try {
      const created = await app.inject({ method: 'POST', url: '/api/v1/auth/register',
        payload: { email, password } });
      expect(created.statusCode).toBe(201);
      const userId = created.json().user.id as string;
      const webLogin = await app.inject({ method: 'POST', url: '/api/v1/auth/login',
        headers: { origin: process.env.PUBLIC_BASE_URL! }, payload: { email, password } });
      expect(webLogin.statusCode).toBe(200);
      expect(webLogin.json().user.email).toBe(email);
      const desktopLogin = () => app.inject({ method: 'POST', url: '/api/v1/auth/login',
        payload: { email, password, device } });
      const unentitled = await desktopLogin();
      expect(unentitled.statusCode).toBe(403);
      expect(unentitled.json().error.code).toBe('SUBSCRIPTION_REQUIRED');
      const adminHeaders = await testCookieHeaders(dbModule, ids.admin);
      const activation = await app.inject({ method: 'POST', url: '/api/v1/admin/subscriptions/grant',
        headers: adminHeaders, payload: { userId, planCode: 'STANDARD', days: 30 } });
      expect(activation.statusCode).toBe(200);
      const login = await desktopLogin();
      expect(login.statusCode).toBe(200);
      const bearer = login.json().accessToken as string;
      const registrationPayload = { ...device, osVersion: '', appVersion: '' };
      const registered = await app.inject({ method: 'POST', url: '/api/v1/devices/register',
        headers: { authorization: `Bearer ${bearer}`,
          ...(await signedHeaders(privateKey, 'POST', '/api/v1/devices/register', registrationPayload, bearer)) },
        payload: registrationPayload });
      expect(registered.statusCode).toBe(200);
      const prompt = { model: model.publicId, input: 'New account signed request' };
      const response = await app.inject({ method: 'POST', url: '/v1/responses',
        headers: { authorization: `Bearer ${bearer}`, 'x-device-id': device.deviceId,
          'x-client-thread-id': randomUUID(), ...(await signedHeaders(privateKey, 'POST', '/v1/responses', prompt, bearer)) },
        payload: prompt });
      expect(response.statusCode).toBe(200);
      expect(response.json().output[0].type).toBe('message');
    } finally {
      await app.close();
      if (previousMockEnabled === undefined) delete process.env.INTEGRATION_MOCK_ENABLED;
      else process.env.INTEGRATION_MOCK_ENABLED = previousMockEnabled;
      if (previousMockEmail === undefined) delete process.env.INTEGRATION_MOCK_TEST_EMAIL;
      else process.env.INTEGRATION_MOCK_TEST_EMAIL = previousMockEmail;
      if (previousBillingMode === undefined) delete process.env.V2_BILLING_MODE;
      else process.env.V2_BILLING_MODE = previousBillingMode;
    }
  }, 15_000);
  it('publishes one multiplier per model, preserves in-flight rate snapshots and rejects stale administrator edits',async()=>{
    const {db,providers,models,rateCards,rateCardVersions,systemSettings,users,devices,usageEvents}=dbModule;
    const {eq}=await import('drizzle-orm');
    const {ensureManagedModelRate,markupKey}=await import('./managed-pricing.js');
    const prefix=randomUUID().replaceAll('-','').slice(0,12).toUpperCase();
    const [ds]=await db.insert(providers).values({code:'DEEPSEEK_'+prefix,name:'Multiplier DS',enabled:true}).returning();
    const [gpt]=await db.insert(providers).values({code:'OPENAI_'+prefix,name:'Multiplier GPT',enabled:true}).returning();
    const [dm]=await db.insert(models).values({providerId:ds.id,providerModelId:'deepseek-flash',publicId:'deepseek/markup-'+prefix,displayName:'Multiplier Flash',enabled:true}).returning();
    const [gm]=await db.insert(models).values({providerId:gpt.id,providerModelId:'gpt-6-sol',publicId:'openai/markup-'+prefix,displayName:'Multiplier Sol',enabled:true}).returning();
    const old=await ensureManagedModelRate(ds.id,dm.id,dm.providerModelId,ds.code);expect(old).toBeDefined();
    const [owner]=await db.insert(users).values({email:`markup-${prefix}@example.test`,passwordHash:'fixture'}).returning();
    const [device]=await db.insert(devices).values({userId:owner.id,deviceId:randomUUID(),deviceName:'Markup fixture',platform:'test'}).returning();
    await db.transaction(tx=>walletModule.applyWalletChange(tx,{userId:owner.id,points:1000000,type:'TEST_GRANT',referenceType:'TEST',referenceId:owner.id,idempotencyKey:'markup:'+prefix}));
    const started=await meterModule.createAiRequest({userId:owner.id,deviceId:device.id,providerId:ds.id,modelId:dm.id,responseId:'resp_markup_'+prefix,billingPolicy:'MANAGED_USAGE',rateCardVersionId:old!.id});
    const app=await(await import('./server.js')).createServer();
    try{
      const headers=await testCookieHeaders(dbModule,ids.admin),userHeaders=await testCookieHeaders(dbModule,ids.user);
      expect((await app.inject({url:'/api/v1/admin/model-pricing',headers:userHeaders})).statusCode).toBe(403);
      const save=(id:string,multiplier:number,expectedRevision:number)=>app.inject({method:'PUT',url:'/api/v1/admin/model-pricing/'+id,headers,payload:{multiplier,expectedRevision}});
      expect((await save(dm.id,1.2,0)).statusCode).toBe(200);
      expect((await save(gm.id,1.1,0)).statusCode).toBe(200);
      const next=await ensureManagedModelRate(ds.id,dm.id,dm.providerModelId,ds.code);
      expect(Number(next!.inputRate)/Number(old!.inputRate)).toBeCloseTo(1.2);
      const currentGpt=await ensureManagedModelRate(gpt.id,gm.id,gm.providerModelId,gpt.code);expect(currentGpt!.inputRate).toBe('154.000000');
      const historical=(await db.select().from(rateCardVersions).where(eq(rateCardVersions.id,old!.id)))[0];expect(historical.inputRate).toBe(old!.inputRate);expect(historical.status).toBe('RETIRED');
      const event=await meterModule.settleAiRequest(started.id,'COMPLETED',{usage:{inputTokens:1000000,outputTokens:0}});
      expect(event.pointsCharged).toBe(Number(old!.inputRate)*1000);
      const newer=await meterModule.createAiRequest({userId:owner.id,deviceId:device.id,providerId:ds.id,modelId:dm.id,responseId:'resp_markup_new_'+prefix,billingPolicy:'MANAGED_USAGE',rateCardVersionId:next!.id});
      const eventNew=await meterModule.settleAiRequest(newer.id,'COMPLETED',{usage:{inputTokens:1000000,outputTokens:0},costAudit:{estimatedCostRmb:1,reportedCostRmb:null}});
      expect(eventNew.pointsCharged).toBe(Number(next!.inputRate)*1000);
      const attempts=await Promise.all([save(dm.id,1.3,1),save(dm.id,1.4,1)]);expect(attempts.map(r=>r.statusCode).sort()).toEqual([200,409]);
      const value=(await db.select().from(systemSettings).where(eq(systemSettings.key,markupKey(gm.id))))[0].value as {multiplier:number};expect(value.multiplier).toBe(1.1);
      const overview=await app.inject({url:'/api/v1/admin/model-pricing',headers});expect(overview.statusCode,overview.body).toBe(200);
      const result=overview.json();expect(result.models.find((m:{id:string})=>m.id===gm.id).reference.source).toBe('USER_PROVIDED_REFERENCE');expect(result.summary.requests).toBe(0);
      await db.update(users).set({email:`markup-${prefix}@pricing.invalid`}).where(eq(users.id,owner.id));
      const customer=(await app.inject({url:'/api/v1/admin/model-pricing',headers})).json();
      expect(customer.summary).toMatchObject({requests:2,knownCostRequests:1,unknownCostRequests:1,knownCostRmb:1,pairedUserDebitedRmb:eventNew.pointsCharged/10000});
      expect(customer.summary.userDebitedRmb).toBe((event.pointsCharged+eventNew.pointsCharged)/10000);
      expect(customer.summary.estimatedMarginRmb).toBeCloseTo(eventNew.pointsCharged/10000-1);
      await db.insert(dbModule.providerCredentials).values({providerId:gpt.id,...(await import('./security.js')).encryptSecret('synthetic-fixture-key')});
      const withCredential=(await app.inject({url:'/api/v1/admin/model-pricing',headers})).json();
      expect(withCredential.providers.find((p:{id:string})=>p.id===gpt.id)).toMatchObject({balance:null,balanceStatus:'UNSUPPORTED'});
      expect((await app.inject({method:'DELETE',url:'/api/v1/admin/models/'+gm.id,headers})).statusCode).toBe(200);
      const archived=(await app.inject({url:'/api/v1/admin/model-pricing',headers})).json();expect(archived.models.some((m:{id:string})=>m.id===gm.id)).toBe(false);
      expect((await save(dm.id,0,2)).statusCode).toBe(400);
      expect((await app.inject({method:'PUT',url:'/api/v1/admin/model-pricing/'+dm.id,headers:{...headers,origin:'https://other.invalid'},payload:{multiplier:1,expectedRevision:2}})).statusCode).toBe(403);
    }finally{await app.close();}
  },30000);


  it('separates remaining regular and reward balances through spending, expiration, retries and account APIs',async()=>{
    const {db,users,devices}=dbModule;
    const [owner]=await db.insert(users).values({email:`wallet-parts-${randomUUID()}@example.test`,passwordHash:'test'}).returning();
    const expiresAt=new Date(Date.now()+60000);
    const credit=(points:number,type:string,key:string,expires?:Date)=>db.transaction(tx=>walletModule.applyWalletChange(tx,{userId:owner.id,points,type,referenceType:'TEST',referenceId:owner.id,idempotencyKey:key,expiresAt:expires}));
    const prefix=randomUUID();await credit(10000,'PURCHASE',prefix+':purchase');await credit(2000,'ADMIN_ADJUSTMENT',prefix+':admin');await credit(5000,'REFERRAL_REWARD',prefix+':reward',expiresAt);
    expect(await walletModule.walletSummary(owner.id)).toMatchObject({balance:17000,regularBalance:12000,rewardBalance:5000});
    await credit(-3000,'USAGE',prefix+':usage');await credit(-3000,'USAGE',prefix+':usage');
    expect(await walletModule.walletSummary(owner.id)).toMatchObject({balance:14000,regularBalance:12000,rewardBalance:2000});
    const app=await(await import('./server.js')).createServer();try{
      const ownerHeaders=await testCookieHeaders(dbModule,owner.id),adminHeaders=await testCookieHeaders(dbModule,ids.admin);
      const own=await app.inject({url:'/api/v1/me/wallet',headers:ownerHeaders});expect(own.statusCode).toBe(200);expect(own.json()).toMatchObject({balance:14000,regularBalance:12000,rewardBalance:2000});
      const adminRead=await app.inject({url:'/api/v1/admin/users/'+owner.id,headers:adminHeaders});expect(adminRead.statusCode).toBe(200);expect(adminRead.json().wallet).toMatchObject(own.json());
    }finally{await app.close();}
    await walletModule.expireDueWalletLots(owner.id,new Date(expiresAt.getTime()+1));
    expect(await walletModule.walletSummary(owner.id)).toMatchObject({balance:12000,regularBalance:12000,rewardBalance:0});
    await credit(-1000,'ADMIN_ADJUSTMENT',prefix+':decrease');expect(await walletModule.walletSummary(owner.id)).toMatchObject({balance:11000,regularBalance:11000,rewardBalance:0});
    expect(await walletModule.walletSummary(randomUUID())).toMatchObject({balance:0,regularBalance:0,rewardBalance:0});
  },30000);

  it('binds invited registrations without gifts and rewards both parties once only after a positive confirmed top-up',async()=>{
    const {db,users,plans,referrals,referralRewards,subscriptions}=dbModule;const {eq}=await import('drizzle-orm');
    const {engagementPolicy}=await import('./engagement-policy.js');const {fulfillSignupReward,qualifyInviteFromCredit}=await import('./signup-rewards.js');
    const [host]=await db.insert(users).values({email:`campaign-host-${randomUUID()}@example.test`,passwordHash:'test'}).returning();const code=await referralModule.referralCodeFor(host.id);
    const app=await(await import('./server.js')).createServer();let ip=40;
    try{
      const headers=await testCookieHeaders(dbModule,ids.admin),userHeaders=await testCookieHeaders(dbModule,ids.user);
      const settings={revision:0,campaign:{enabled:true},notices:[{id:randomUUID(),text:'维护完成，欢迎使用',enabled:false}]};
      const save=(value:unknown,h=headers)=>app.inject({method:'PUT',url:'/api/v1/admin/engagement',headers:h,payload:value as object});
      expect((await app.inject({url:'/api/v1/admin/engagement',headers:userHeaders})).statusCode).toBe(403);expect((await save(settings)).statusCode).toBe(400);
      const [plan]=await db.insert(plans).values({code:'PAYG',name:'Campaign PAYG',monthlyPrice:'0',currency:'CNY',enabled:true,maxDevices:3,monthlyTokenLimit:1000000000,monthlyUsageCreditLimit:'1000000000',maxConcurrentRequests:10,requestsPerMinute:100,monthlyPoints:0,rolloverPolicy:'UNLIMITED'}).onConflictDoUpdate({target:plans.code,set:{enabled:true}}).returning();
      expect((await save(settings,{...headers,origin:'https://other.invalid'})).statusCode).toBe(403);expect((await save(settings)).statusCode).toBe(200);expect((await save(settings)).statusCode).toBe(409);
      expect((await app.inject({url:'/api/v1/client/config'})).json().inviteCampaign.rules).toContain('注册本身不发奖励');
      const create=(email:string,referralCode?:string)=>app.inject({method:'POST',url:'/api/v1/auth/register',remoteAddress:`192.0.2.${ip++}`,payload:{email,password:'FixturePassword123!',...(referralCode?{referralCode}:{})}});
      const adjust=(userId:string,points:number,idempotencyKey=randomUUID())=>app.inject({method:'POST',url:`/api/v1/admin/users/${userId}/wallet/adjust`,headers,payload:{points,idempotencyKey,reason:'Internal invitation top-up test'}});
      const email=`campaign-new-${randomUUID()}@example.test`,created=await create(email,code.code);expect(created.statusCode,created.body).toBe(201);const child=created.json().user;
      expect((await walletModule.walletSummary(child.id)).balance).toBe(0);expect((await walletModule.walletSummary(host.id)).balance).toBe(0);
      const [entry]=await db.select().from(referrals).where(eq(referrals.referredUserId,child.id));expect(entry.status).toBe('REGISTERED');
      expect(await db.transaction(tx=>fulfillSignupReward(tx,entry.id))).toMatchObject({status:'AWAITING_TOPUP'});
      await db.transaction(tx=>referralModule.qualifyReferralFromPaidOrder(tx,child.id,100));expect((await walletModule.walletSummary(host.id)).balance).toBe(0);
      const [sub]=await db.select().from(subscriptions).where(eq(subscriptions.userId,child.id));expect(sub.planId).toBe(plan.id);
      await db.update(subscriptions).set({currentPeriodEnd:new Date(Date.now()-86400000)}).where(eq(subscriptions.id,sub.id));
      const childHeaders=await testCookieHeaders(dbModule,child.id);expect((await app.inject({url:'/api/v1/me',headers:childHeaders})).json().subscription.expiresAt).toBeNull();
      const {publicKey}=proofKey();expect((await app.inject({method:'POST',url:'/api/v1/auth/login',remoteAddress:`192.0.2.${ip++}`,payload:{email,password:'FixturePassword123!',device:{deviceId:randomUUID(),deviceName:'Permanent access test',platform:'Windows',appVersion:'999.0.0',publicKeyJwk:publicKey.export({format:'jwk'})}}})).statusCode).toBe(200);
      const key=randomUUID(),credit=await adjust(child.id,10000,key);expect(credit.statusCode,credit.body).toBe(200);expect((await adjust(child.id,10000,key)).json().duplicate).toBe(true);
      const reward=await walletModule.walletSummary(child.id);expect(reward).toMatchObject({balance:60000,regularBalance:10000,rewardBalance:50000,rewardExpiringBalance:50000});expect(Math.abs(new Date(reward.rewardExpiresAt!).getTime()-Date.now()-7*86400000)).toBeLessThan(2000);
      expect((await walletModule.walletSummary(host.id)).rewardBalance).toBe(50000);expect(await db.select().from(referralRewards).where(eq(referralRewards.referralId,entry.id))).toHaveLength(2);
      expect((await adjust(child.id,10000)).statusCode).toBe(200);expect((await adjust(child.id,-1000)).statusCode).toBe(200);expect((await walletModule.walletSummary(host.id)).rewardBalance).toBe(50000);
      await walletModule.expireDueWalletLots(child.id,new Date(new Date(reward.rewardExpiresAt!).getTime()+1));expect(await walletModule.walletSummary(child.id)).toMatchObject({balance:20000,regularBalance:20000,rewardBalance:0});expect(await(await import('./core.js')).currentSubscription(child.id)).not.toBeNull();
      expect((await create(email,code.code)).statusCode).toBe(409);const invalid=`campaign-invalid-${randomUUID()}@example.test`;expect((await create(invalid,'INVALIDCODE')).statusCode).toBe(404);expect(await db.select().from(users).where(eq(users.email,invalid))).toHaveLength(0);
      const plain=await create(`campaign-plain-${randomUUID()}@example.test`);expect(plain.statusCode).toBe(201);expect((await adjust(plain.json().user.id,10000)).statusCode).toBe(200);expect((await walletModule.walletSummary(host.id)).rewardBalance).toBe(50000);
      const [old]=await db.insert(users).values({email:`campaign-old-${randomUUID()}@example.test`,passwordHash:'test'}).returning();await referralModule.registerReferral(old.id,code.code);await adjust(old.id,10000);expect((await walletModule.walletSummary(old.id)).rewardBalance).toBe(0);
      const rollback=await create(`campaign-rollback-${randomUUID()}@example.test`,code.code);const rollbackId=rollback.json().user.id;
      await db.execute(sql.raw("create function fail_campaign_second_reward() returns trigger language plpgsql as $$ begin if new.type='REFERRAL_REWARD' and exists(select 1 from wallets w join users u on u.id=w.user_id where w.id=new.wallet_id and u.email like 'campaign-rollback-%') then raise exception 'TEST_SECOND_REWARD_FAILED'; end if; return new; end $$"));
      await db.execute(sql.raw('create trigger fail_campaign_second_reward before insert on wallet_transactions for each row execute function fail_campaign_second_reward()'));
      try{expect((await adjust(rollbackId,10000)).statusCode).toBe(500);expect((await walletModule.walletSummary(rollbackId)).balance).toBe(0);expect((await walletModule.walletSummary(host.id)).rewardBalance).toBe(50000);}finally{await db.execute(sql.raw('drop trigger fail_campaign_second_reward on wallet_transactions'));await db.execute(sql.raw('drop function fail_campaign_second_reward()'));}
      const gift=await create(`campaign-gift-${randomUUID()}@example.test`,code.code),giftId=gift.json().user.id;
      const giftTx=await db.transaction(tx=>walletModule.applyWalletChange(tx,{userId:giftId,points:1,type:'REFERRAL_REWARD',referenceType:'TEST',referenceId:giftId,idempotencyKey:randomUUID()}));await db.transaction(tx=>qualifyInviteFromCredit(tx,giftId,{transactionId:giftTx.transaction.id}));expect((await walletModule.walletSummary(giftId)).balance).toBe(1);
      await db.transaction(tx=>qualifyInviteFromCredit(tx,giftId,{transactionId:credit.json().transaction.id}));expect((await walletModule.walletSummary(giftId)).balance).toBe(1);
      await db.update(users).set({status:'DISABLED'}).where(eq(users.id,host.id));const pending=await create(`campaign-pending-${randomUUID()}@example.test`,code.code),pendingId=pending.json().user.id;
      await adjust(pendingId,10000);expect((await walletModule.walletSummary(pendingId)).rewardBalance).toBe(0);const [pendingEntry]=await db.select().from(referrals).where(eq(referrals.referredUserId,pendingId));expect(pendingEntry.status).toBe('PENDING');
      await db.update(users).set({status:'ACTIVE'}).where(eq(users.id,host.id));const review=await app.inject({method:'POST',url:`/api/v1/admin/referrals/${pendingEntry.id}/review`,headers,payload:{decision:'APPROVE',reason:'Verified first top-up invitation'}});expect(review.statusCode,review.body).toBe(200);expect(review.json().status).toBe('REWARDED');expect((await walletModule.walletSummary(pendingId)).rewardBalance).toBe(50000);
      const paid=await create(`campaign-paid-${randomUUID()}@example.test`,code.code),paidId=paid.json().user.id;
      const [order]=await db.insert(dbModule.billingOrders).values({userId:paidId,planId:plan.id,orderNo:randomUUID(),amount:'1.00',currency:'CNY',provider:'MANUAL'}).returning();
      await db.transaction(tx=>qualifyInviteFromCredit(tx,paidId,{orderId:order.id}));expect((await walletModule.walletSummary(paidId)).balance).toBe(0);
      const payment=await app.inject({method:'POST',url:`/api/v1/admin/orders/${order.id}/mark-paid`,headers});expect(payment.statusCode,payment.body).toBe(200);expect((await walletModule.walletSummary(paidId)).rewardBalance).toBe(50000);
      expect((await app.inject({method:'POST',url:`/api/v1/admin/orders/${order.id}/mark-paid`,headers})).statusCode).toBe(409);
      const current=await engagementPolicy();expect((await save({...current,campaign:{enabled:false}})).statusCode).toBe(200);expect((await app.inject({url:'/api/v1/client/config'})).json().announcements).toEqual([]);
      const after=await create(`campaign-off-${randomUUID()}@example.test`,code.code);await adjust(after.json().user.id,10000);expect((await walletModule.walletSummary(after.json().user.id)).rewardBalance).toBe(0);
    }finally{await app.close();}
  },30000);

  it('publishes title and body edits, hides and deletes notices and protects concurrent admin edits',async()=>{
    const {engagementPolicy}=await import('./engagement-policy.js');const app=await(await import('./server.js')).createServer();
    try{
      const headers=await testCookieHeaders(dbModule,ids.admin),userHeaders=await testCookieHeaders(dbModule,ids.user),id=randomUUID(),second=randomUUID();const old=await engagementPolicy();
      const draft={...old,campaign:{enabled:false},notices:[{id,title:'服务通知',content:'第一行\n'+'完整正文'.repeat(300),enabled:true},{id:second,title:'隐藏草稿',content:'不公开的内容',enabled:false}]};
      const save=(value:unknown,h=headers)=>app.inject({method:'PUT',url:'/api/v1/admin/engagement',headers:h,payload:value as object});
      expect((await save(draft,userHeaders)).statusCode).toBe(403);const first=await save(draft);expect(first.statusCode,first.body).toBe(200);
      const publicResult=await app.inject({url:'/api/v1/client/config'});expect(publicResult.headers['cache-control']).toBe('no-store');expect(publicResult.json().announcements).toEqual([{id,title:draft.notices[0].title,text:draft.notices[0].title,content:draft.notices[0].content,action:'NONE'}]);
      expect((await save(draft)).statusCode).toBe(409);
      const edited=await save({...first.json<typeof draft>(),notices:[{...draft.notices[0],title:'更新后的标题',content:'更新后的正文',enabled:true}]});expect(edited.statusCode).toBe(200);expect((await app.inject({url:'/api/v1/client/config'})).json().announcements[0]).toMatchObject({title:'更新后的标题',content:'更新后的正文'});
      const editedValue=edited.json<typeof draft>();const hidden=await save({...editedValue,notices:[{...editedValue.notices[0],enabled:false}]});expect(hidden.statusCode).toBe(200);expect((await app.inject({url:'/api/v1/client/config'})).json().announcements).toEqual([]);
      const deleted=await save({...hidden.json<typeof draft>(),notices:[]});expect(deleted.statusCode).toBe(200);expect((await app.inject({url:'/api/v1/client/config'})).json().announcements).toEqual([]);
    }finally{await app.close();}
  });

  it('filters account funding records before the history limit and keeps other users private',async()=>{
    const {db,users}=dbModule;const [owner]=await db.insert(users).values({email:`account-records-${randomUUID()}@example.test`,passwordHash:'fixture'}).returning();let purchaseId='';
    await db.transaction(async tx=>{const added=await walletModule.applyWalletChange(tx,{userId:owner.id,points:1000,type:'PURCHASE',referenceType:'TEST',referenceId:owner.id,idempotencyKey:randomUUID()});purchaseId=added.transaction.id;});await db.transaction(async tx=>{for(let i=0;i<101;i++)await walletModule.applyWalletChange(tx,{userId:owner.id,points:-1,type:'USAGE',referenceType:'TEST',referenceId:owner.id,idempotencyKey:randomUUID()});});
    const app=await(await import('./server.js')).createServer();try{const headers=await testCookieHeaders(dbModule,owner.id);const all=await app.inject({url:'/api/v1/me/wallet/transactions',headers});expect(all.json().data).toHaveLength(100);expect(all.json().data.every((t:{type:string})=>t.type==='USAGE')).toBe(true);const filtered=await app.inject({url:'/api/v1/me/wallet/transactions?kind=account',headers});expect(filtered.statusCode).toBe(200);expect(filtered.json().data.map((t:{id:string})=>t.id)).toEqual([purchaseId]);expect((await app.inject({url:'/api/v1/me/wallet/transactions?kind=invalid',headers})).statusCode).toBe(400);const otherHeaders=await testCookieHeaders(dbModule,ids.admin);expect((await app.inject({url:'/api/v1/me/wallet/transactions?kind=account',headers:otherHeaders})).json().data.some((t:{id:string})=>t.id===purchaseId)).toBe(false);}finally{await app.close();}
  },30000);

});
