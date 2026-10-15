import {db,systemSettings,rateCards,rateCardVersions,models,providers,modelInstances,auditLogs} from '@bridge/db';
import {and,desc,eq,sql} from 'drizzle-orm';
import {ApiError} from './errors.js';
import {moneyPolicy} from './money-policy.js';
import {isDeepSeekProvider,isOpenAIProvider} from './provider.js';
import {ModelMarkupSchema,modelPriceReference,referenceRates} from './model-price-reference.js';

type Tx=Parameters<Parameters<typeof db.transaction>[0]>[0];
export const markupKey=(id:string)=>`model_markup:${id}`;
export const providerFamily=(code:string)=>isDeepSeekProvider(code)?'deepseek':isOpenAIProvider(code)?'openai':'';
async function publish(tx:Tx,providerId:string,modelId:string,values:ReturnType<typeof referenceRates>,actorId?:string) {
 await tx.insert(rateCards).values({providerId,modelId,billingPolicy:'MANAGED_USAGE'}).onConflictDoNothing();
 const [card]=await tx.select().from(rateCards).where(and(eq(rateCards.providerId,providerId),eq(rateCards.modelId,modelId),eq(rateCards.billingPolicy,'MANAGED_USAGE'))).for('update').limit(1);
 const [latest]=await tx.select().from(rateCardVersions).where(eq(rateCardVersions.rateCardId,card.id)).orderBy(desc(rateCardVersions.version)).limit(1);
 if(latest?.status==='ACTIVE'&&Object.entries(values).every(([key,v])=>String(latest[key as keyof typeof latest])===String(v)))return latest;
 const now=new Date();
 await tx.update(rateCardVersions).set({status:'RETIRED',effectiveTo:now}).where(and(eq(rateCardVersions.rateCardId,card.id),eq(rateCardVersions.status,'ACTIVE')));
 const [version]=await tx.insert(rateCardVersions).values({...values,rateCardId:card.id,version:(latest?.version??0)+1,status:'ACTIVE',effectiveFrom:now,createdBy:actorId}).returning();
 return version;
}

/** Shared per-model lock prevents a stale in-flight price refresh from undoing an admin save. */
export async function ensureManagedModelRate(providerId:string,modelId:string,providerModelId:string,code:string) {
 const family=providerFamily(code);if(!family)return;
 return db.transaction(async tx=>{
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${markupKey(modelId)},0))`);
  const [row]=await tx.select().from(systemSettings).where(eq(systemSettings.key,markupKey(modelId))).limit(1);
  // Preserve existing non-DeepSeek prices until the administrator explicitly adopts multiplier pricing.
  if(family!=='deepseek'&&!row)return;
  const policy=await moneyPolicy(tx),reference=modelPriceReference(family,providerModelId,policy.prices);if(!reference)return;
  const multiplier=row?ModelMarkupSchema.parse(row.value).multiplier:policy.markup;
  return publish(tx,providerId,modelId,referenceRates(reference,multiplier,policy.holidayDates));
 });
}

export async function saveModelMarkup(modelId:string,multiplier:number,expectedRevision:number,actorId:string) {
 ModelMarkupSchema.shape.multiplier.parse(multiplier);
 return db.transaction(async tx=>{
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${markupKey(modelId)},0))`);
  const [model]=await tx.select().from(models).where(eq(models.id,modelId)).limit(1);if(!model)throw new ApiError(404,'NOT_FOUND');
  const [provider]=await tx.select().from(providers).where(eq(providers.id,model.providerId)).limit(1);
  const policy=await moneyPolicy(tx),family=providerFamily(provider.code),reference=modelPriceReference(family,model.providerModelId,policy.prices);
  if(!reference)throw new ApiError(409,'PRICE_REFERENCE_UNAVAILABLE','该模型尚无已确认的上游价格基准。');
  const [previous]=await tx.select().from(systemSettings).where(eq(systemSettings.key,markupKey(modelId))).limit(1);
  const old=previous?ModelMarkupSchema.parse(previous.value):{multiplier:family==='deepseek'?policy.markup:1,revision:0};
  if(old.revision!==expectedRevision)throw new ApiError(409,'PRICE_CHANGED','价格已被其他管理员修改，请刷新后重试。');
  const value={multiplier,revision:old.revision+1};
  await tx.insert(systemSettings).values({key:markupKey(modelId),value}).onConflictDoUpdate({target:systemSettings.key,set:{value,updatedAt:new Date()}});
  const bindings=await tx.select({providerId:modelInstances.providerId,code:providers.code}).from(modelInstances).innerJoin(providers,eq(providers.id,modelInstances.providerId)).where(and(eq(modelInstances.modelId,model.id),eq(modelInstances.providerModelId,model.providerModelId)));
  const ids=[...new Set([provider.id,...bindings.filter(b=>providerFamily(b.code)===family).map(b=>b.providerId)])];
  const values=referenceRates(reference,multiplier,policy.holidayDates);
  for(const id of ids)await publish(tx,id,modelId,values,actorId);
  await tx.insert(auditLogs).values({actorId,action:'MODEL_MARKUP_UPDATED',targetType:'MODEL',targetId:modelId,metadata:{previousMultiplier:old.multiplier,multiplier,revision:value.revision,referenceSource:reference.source,providerCount:ids.length}});
  return value;
 });
}
