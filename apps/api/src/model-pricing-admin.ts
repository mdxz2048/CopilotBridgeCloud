import type {FastifyInstance} from 'fastify';
import {db,models,providers,providerCredentials,systemSettings,usageEvents,users} from '@bridge/db';
import {eq,or,sql} from 'drizzle-orm';
import {z} from 'zod';
import {admin,ApiError} from './core.js';
import {config} from './config.js';
import {providerFor} from './provider.js';
import {moneyPolicy} from './money-policy.js';
import {markupKey,providerFamily,saveModelMarkup} from './managed-pricing.js';
import {ModelMarkupSchema,modelPriceReference} from './model-price-reference.js';

export async function registerModelPricingAdmin(app:FastifyInstance) {
 app.get('/api/v1/admin/model-pricing',async req=>{
  await admin(req);
  const policy=await moneyPolicy();
  const [catalog,connections,markups,credentials,stats]=await Promise.all([
   db.select().from(models),
   db.select({id:providers.id,name:providers.name,code:providers.code,enabled:providers.enabled}).from(providers),
   db.select().from(systemSettings).where(or(sql`${systemSettings.key} like 'model_markup:%'`,eq(systemSettings.key,'archived_models'))),
   db.select({providerId:providerCredentials.providerId}).from(providerCredentials),
   db.select({modelId:usageEvents.modelId,providerId:usageEvents.providerId,requests:sql<number>`count(*)`,userDebitedRmb:sql<number>`coalesce(sum(${usageEvents.pointsCharged}),0)/10000.0`,
    knownCostRmb:sql<number>`coalesce(sum(coalesce((${usageEvents.providerReportedUsage}->'bridge_cost_audit'->>'reportedCostRmb')::numeric,(${usageEvents.providerReportedUsage}->'bridge_cost_audit'->>'estimatedCostRmb')::numeric)),0)`,
    pairedUserDebitedRmb:sql<number>`coalesce(sum(${usageEvents.pointsCharged}/10000.0) filter(where coalesce(${usageEvents.providerReportedUsage}->'bridge_cost_audit'->>'reportedCostRmb',${usageEvents.providerReportedUsage}->'bridge_cost_audit'->>'estimatedCostRmb') is not null),0)`,
    knownCostRequests:sql<number>`count(*) filter(where coalesce(${usageEvents.providerReportedUsage}->'bridge_cost_audit'->>'reportedCostRmb',${usageEvents.providerReportedUsage}->'bridge_cost_audit'->>'estimatedCostRmb') is not null)`})
    .from(usageEvents).innerJoin(users,eq(users.id,usageEvents.userId)).where(sql`lower(${users.email}) not like '%@example.test'`).groupBy(usageEvents.modelId,usageEvents.providerId),
  ]);
  const summary=(selected:typeof stats)=>{
   const total={requests:0,userDebitedRmb:0,knownCostRmb:0,pairedUserDebitedRmb:0,knownCostRequests:0};
   for(const row of selected)for(const key of Object.keys(total) as Array<keyof typeof total>)total[key]+=Number(row[key]);
   const round=(n:number)=>Number(n.toFixed(8));
   return {...total,userDebitedRmb:round(total.userDebitedRmb),knownCostRmb:round(total.knownCostRmb),pairedUserDebitedRmb:round(total.pairedUserDebitedRmb),unknownCostRequests:total.requests-total.knownCostRequests,estimatedMarginRmb:total.knownCostRequests?round(total.pairedUserDebitedRmb-total.knownCostRmb):null};
  };
  const upstreams=await Promise.all(connections.filter(p=>providerFamily(p.code)&&credentials.some(c=>c.providerId===p.id)).map(async p=>{
   let balance:unknown=null,balanceStatus='UNSUPPORTED',checkedAt:string|null=null;
   if(!p.enabled)balanceStatus='DISABLED';else try{
    const adapter=await providerFor(p.id,p.code) as Awaited<ReturnType<typeof providerFor>>&{balance?:(signal?:AbortSignal)=>Promise<{balances:Array<{currency:string;total:string}>;checkedAt:string}>};
    if(adapter.balance){const result=await adapter.balance(AbortSignal.timeout(2000));balance=result.balances;checkedAt=result.checkedAt;balanceStatus='AVAILABLE';}
   }catch{balanceStatus='ERROR';}
   return {id:p.id,name:p.name,enabled:p.enabled,balance,balanceStatus,checkedAt,...summary(stats.filter(s=>s.providerId===p.id))};
  }));
  const archived=(markups.find(r=>r.key==='archived_models')?.value as {ids?:string[]}|undefined)?.ids??[];
  const items=catalog.filter(m=>!archived.includes(m.id)&&/^(deepseek|openai)\//.test(m.publicId)).map(m=>{
   const connection=connections.find(p=>p.id===m.providerId),family=providerFamily(connection?.code??'');
   const row=markups.find(r=>r.key===markupKey(m.id));
   return {id:m.id,name:m.displayName,publicId:m.publicId,enabled:m.enabled,providerId:m.providerId,
    ...(row?ModelMarkupSchema.parse(row.value):{multiplier:family==='deepseek'?policy.markup:1,revision:0}),
    reference:modelPriceReference(family,m.providerModelId,policy.prices),...summary(stats.filter(s=>s.modelId===m.id))};
  }).filter(m=>m.enabled||m.reference||m.requests>0);
  return {models:items,providers:upstreams,summary:summary(stats),checkedAt:new Date().toISOString(),currency:'CNY',excludeInternalTests:true,holidays:policy.holidayDates};
 });
 app.put('/api/v1/admin/model-pricing/:id',async req=>{
  const auth=await admin(req);if(req.headers.origin!==config.PUBLIC_BASE_URL)throw new ApiError(403,'CSRF_REJECTED');
  const id=z.uuid().parse((req.params as {id:string}).id);
  const body=z.object({multiplier:ModelMarkupSchema.shape.multiplier,expectedRevision:z.number().int().nonnegative()}).strict().parse(req.body);
  return saveModelMarkup(id,body.multiplier,body.expectedRevision,auth.user.id);
 });
}
