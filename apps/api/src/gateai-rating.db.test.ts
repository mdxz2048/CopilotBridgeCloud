import {afterAll,beforeAll,describe,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {eq} from 'drizzle-orm';

describe.skipIf(!process.env.V2_TEST_DATABASE_URL)('GateAI tier settlement on isolated PostgreSQL',()=>{
  let data:typeof import('@bridge/db'),meter:typeof import('./metering.js'),wallet:typeof import('./wallet.js');
  let uid:string,device:string,provider:string,model:string,version:string;
  beforeAll(async()=>{
    if(!new URL(process.env.V2_TEST_DATABASE_URL!).pathname.startsWith('/bridge_v2_test_'))throw new Error('REFUSE_NON_TEST_DATABASE');
    process.env.DATABASE_URL=process.env.V2_TEST_DATABASE_URL;
    data=await import('@bridge/db');meter=await import('./metering.js');wallet=await import('./wallet.js');
    const [u]=await data.db.insert(data.users).values({email:`gateai-db-${randomUUID()}@example.test`,passwordHash:'fixture'}).returning();uid=u.id;
    const [d]=await data.db.insert(data.devices).values({userId:uid,deviceId:randomUUID(),deviceName:'fixture',platform:'test'}).returning();device=d.id;
    const [p]=await data.db.insert(data.providers).values({code:'OPENAI_'+randomUUID().replaceAll('-','').slice(0,12).toUpperCase(),name:'GateAI isolated fixture'}).returning();provider=p.id;
    const [m]=await data.db.insert(data.models).values({providerId:provider,providerModelId:'gpt-6.1-sol',publicId:'fixture/'+randomUUID(),displayName:'fixture'}).returning();model=m.id;
    const [card]=await data.db.insert(data.rateCards).values({providerId:provider,modelId:model,billingPolicy:'MANAGED_USAGE'}).returning();
    const [v]=await data.db.insert(data.rateCardVersions).values({rateCardId:card.id,version:1,status:'ACTIVE',inputRate:'2.6',cachedInputRate:'0.13',outputRate:'13',reasoningRate:'13'}).returning();version=v.id;
    await data.db.transaction(tx=>wallet.applyWalletChange(tx,{userId:uid,points:20000,type:'TEST_GRANT',referenceType:'DIAGNOSTIC',referenceId:uid,idempotencyKey:'gateai-db:'+uid}));
  });
  afterAll(async()=>{await data?.pool.end();});
  const request=()=>meter.createAiRequest({responseId:'resp_'+randomUUID(),userId:uid,deviceId:device,providerId:provider,modelId:model,billingPolicy:'MANAGED_USAGE',rateCardVersionId:version});
  const audit=(write=0)=>({rateSnapshot:{source:'USER_PROVIDED_GATEAI_PRICE_CARD',model:'gpt-6.1-sol',cacheWriteTokens:write}});
  it('settles a long request once using its immutable old rate after a later rate edit',async()=>{
    const r=await request();
    const [old]=await data.db.select().from(data.rateCardVersions).where(eq(data.rateCardVersions.id,version));
    await data.db.update(data.rateCardVersions).set({status:'RETIRED',effectiveTo:new Date()}).where(eq(data.rateCardVersions.id,version));
    await data.db.insert(data.rateCardVersions).values({rateCardId:old.rateCardId,version:2,status:'ACTIVE',inputRate:'28',cachedInputRate:'1.4',outputRate:'140',reasoningRate:'140'});
    const result={usage:{inputTokens:272001,outputTokens:1},costAudit:audit()};
    const first=await meter.settleAiRequest(r.id,'COMPLETED',result);
    const repeat=await meter.settleAiRequest(r.id,'COMPLETED',result);
    expect(first.pointsCharged).toBe(1415);expect(repeat.id).toBe(first.id);
    expect((await wallet.walletSummary(uid)).balance).toBe(18585);
    expect(await data.db.select().from(data.walletTransactions).where(eq(data.walletTransactions.referenceId,r.id))).toHaveLength(1);
  });
  it('keeps legacy non-GateAI settlement on the existing flat formula',async()=>{
    const r=await request();const event=await meter.settleAiRequest(r.id,'COMPLETED',{usage:{inputTokens:272001,outputTokens:1}});
    expect(event.pointsCharged).toBe(708);expect((await wallet.walletSummary(uid)).balance).toBe(17877);
  });
  it('settles disjoint cache writes and leaves invalid write counters uncharged',async()=>{
    const r=await request();const event=await meter.settleAiRequest(r.id,'COMPLETED',{usage:{inputTokens:100000,cachedInputTokens:40000,outputTokens:10000,reasoningTokens:5000},costAudit:audit(10000)});
    expect(event.pointsCharged).toBe(298);expect((await wallet.walletSummary(uid)).balance).toBe(17579);
    const bad=await request();const rejected=await meter.settleAiRequest(bad.id,'COMPLETED',{usage:{inputTokens:1},costAudit:audit(2)});
    expect(rejected.billingStatus).toBe('UNRATED');expect(rejected.pointsCharged).toBe(0);expect((await wallet.walletSummary(uid)).balance).toBe(17579);
  });
});
