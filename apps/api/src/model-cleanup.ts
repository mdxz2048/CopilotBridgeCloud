import {db,models,modelInstances,modelSessions,aiRequests,usageEvents,usageRecords,rateCards,rateCardVersions,planModelAccess,userModelAccess,systemSettings,auditLogs} from '@bridge/db';
import {and,eq,inArray,or,sql} from 'drizzle-orm';
const obsolete=['deepseek/deepseek-chat','deepseek/deepseek-reasoner','deepseek/deepseek-v4-pro'];
// Only the explicitly retired DeepSeek records may be permanently removed.
export async function removeUnusedDeepSeekModels(actorId:string) {
 return db.transaction(async tx=>{
  const targets=await tx.select().from(models).where(inArray(models.publicId,obsolete)).for('update');
  if(!targets.length)return {removed:[] as string[]};
  const ids=targets.map(m=>m.id);
  if(targets.some(m=>m.enabled))throw Error('REFUSE_ENABLED_MODEL_REMOVAL');
  for(const table of [modelSessions,aiRequests,usageEvents,usageRecords]){
   const [row]=await tx.select({total:sql<number>`count(*)`}).from(table).where(inArray(table.modelId,ids));
   if(Number(row.total))throw Error('REFUSE_MODEL_WITH_HISTORY');
  }
  const cards=await tx.select({id:rateCards.id}).from(rateCards).where(inArray(rateCards.modelId,ids));
  const versions=cards.length?await tx.select({id:rateCardVersions.id}).from(rateCardVersions).where(inArray(rateCardVersions.rateCardId,cards.map(c=>c.id))):[];
  if(versions.length){
   for(const table of [aiRequests,usageEvents]){
    const [row]=await tx.select({total:sql<number>`count(*)`}).from(table).where(inArray(table.rateCardVersionId,versions.map(v=>v.id)));
    if(Number(row.total))throw Error('REFUSE_RATE_WITH_HISTORY');
   }
   await tx.delete(rateCardVersions).where(inArray(rateCardVersions.id,versions.map(v=>v.id)));
  }
  if(cards.length)await tx.delete(rateCards).where(inArray(rateCards.id,cards.map(c=>c.id)));
  await tx.delete(planModelAccess).where(inArray(planModelAccess.modelId,ids));
  await tx.delete(userModelAccess).where(inArray(userModelAccess.modelId,ids));
  await tx.delete(modelInstances).where(inArray(modelInstances.modelId,ids));
  await tx.delete(systemSettings).where(inArray(systemSettings.key,ids.map(id=>'model_markup:'+id)));
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('archived_models',0))`);
  const [setting]=await tx.select().from(systemSettings).where(eq(systemSettings.key,'archived_models')).limit(1);
  if(setting){const value=setting.value as {ids?:string[]};await tx.update(systemSettings).set({value:{...value,ids:(value.ids??[]).filter(id=>!ids.includes(id))},updatedAt:new Date()}).where(eq(systemSettings.key,'archived_models'));}
  await tx.delete(models).where(and(inArray(models.id,ids),inArray(models.publicId,obsolete)));
  await tx.insert(auditLogs).values({actorId,action:'MODEL_RECORDS_REMOVED',targetType:'MODEL',targetId:ids.join(','),metadata:{publicIds:targets.map(m=>m.publicId),historicalRowsDeleted:0}});
  return {removed:targets.map(m=>m.publicId)};
 });
}
