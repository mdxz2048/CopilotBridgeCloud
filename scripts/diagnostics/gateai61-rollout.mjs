// Authorized model-catalog configuration change, with a rollback rehearsal.
// Run only in the API container beside a bundled native-provider-probe.js.
import {createRequire} from 'node:module';
import {createDecipheriv,createHash} from 'node:crypto';
import {OpenAIProvider} from './openai-provider.js';
import {probeOpenAIResponses} from './native-provider-probe.js';
if(process.env.GATEAI61_APPLY!=='1')throw new Error('EXPLICIT_ROLLOUT_REQUIRED');
const require=createRequire('/workspace/packages/db/package.json');
const {Client}=require('pg'),db=new Client({connectionString:process.env.DATABASE_URL});await db.connect();
const assert=(condition,code)=>{if(!condition)throw Object.assign(new Error(code),{code});};
const oldId='16298e41-3f93-4dd1-9cab-8f5534e3a1d7',newId='fc28e1db-9073-4ae7-9b1c-7cca12a96143';
const report={date:new Date().toISOString(),scope:'AUTHORIZED_GPT_CATALOG_AND_RATE_CONFIGURATION',oldPublicId:'openai/gpt-6-sol',newPublicId:'openai/gpt-6.1-sol'};
const fingerprint=async()=>createHash('sha256').update(JSON.stringify((await db.query("select m.id,m.public_id,m.display_name,m.enabled,m.provider_model_id,p.base_url,p.config,i.id instance_id,i.enabled instance_enabled,i.provider_model_id upstream,i.capabilities from models m join providers p on p.id=m.provider_id join model_instances i on i.model_id=m.id where m.public_id like 'deepseek/%' order by m.id,i.id")).rows)).digest('hex');
async function mutate(provider,checked,actor){
  await db.query('begin');
  await db.query('select pg_advisory_xact_lock(hashtextextended($1,0))',['model_markup:'+oldId]);
  await db.query('select pg_advisory_xact_lock(hashtextextended($1,0))',['model_markup:'+newId]);
  const {rows:models}=await db.query('select id,provider_id,public_id from models where id=any($1::uuid[]) order by id for update',[[oldId,newId]]);
  assert(models.length===2&&models.every(m=>m.provider_id===provider.id)&&models.some(m=>m.id===newId&&m.public_id==='openai/gpt-6.1-sol'),'MODEL_IDENTITY_CHANGED');
  const {rows:[source]}=await db.query('select value from system_settings where key=$1',['model_markup:'+oldId]);assert(source?.value.multiplier===.2,'USER_MARKUP_CHANGED');
  const {rows:[previous]}=await db.query('select value from system_settings where key=$1',['model_markup:'+newId]);
  await db.query("insert into system_settings(key,value) values($1,$2::jsonb) on conflict(key) do update set value=excluded.value,updated_at=now()",['model_markup:'+newId,JSON.stringify({multiplier:.13,revision:(previous?.value.revision??0)+1})]);
  await db.query('insert into plan_model_access(model_id,plan_id) select $1,plan_id from plan_model_access where model_id=$2 on conflict do nothing',[newId,oldId]);
  await db.query("insert into user_model_access(user_id,model_id,access) select user_id,$1,access from user_model_access where model_id=$2 on conflict(user_id,model_id) do update set access=case when user_model_access.access='DENY' or excluded.access='DENY' then 'DENY' else user_model_access.access end",[newId,oldId]);
  await db.query("insert into rate_cards(provider_id,model_id,billing_policy) values($1,$2,'MANAGED_USAGE') on conflict do nothing",[provider.id,newId]);
  const {rows:[card]}=await db.query("select id from rate_cards where provider_id=$1 and model_id=$2 and billing_policy='MANAGED_USAGE' for update",[provider.id,newId]);
  const {rows:[latest]}=await db.query('select coalesce(max(version),0)::int version from rate_card_versions where rate_card_id=$1',[card.id]);
  await db.query("update rate_card_versions set status='RETIRED',effective_to=now() where rate_card_id=$1 and status='ACTIVE'",[card.id]);
  await db.query("insert into rate_card_versions(rate_card_id,version,status,input_rate,cached_input_rate,output_rate,reasoning_rate,effective_from,created_by) values($1,$2,'ACTIVE','2.600000','0.130000','13.000000','13.000000',now(),$3)",[card.id,latest.version+1,actor]);
  await db.query("update model_instances set enabled=false where model_id in(select id from models where public_id like 'openai/%') and model_id<>$1",[newId]);
  await db.query("update models set enabled=false where public_id like 'openai/%' and id<>$1",[newId]);
  await db.query("update model_instances set enabled=true,health_status='READY',health_checked_at=now(),cooldown_until=null,native_protocols='[\"responses\"]',capabilities=$3::jsonb where model_id=$1 and provider_id=$2 and provider_model_id='gpt-6.1-sol'",[newId,provider.id,JSON.stringify({...checked.capabilities,generationVerified:true})]);
  await db.query("update models set enabled=true,display_name='GateAI · GPT-6.1 Sol',supports_tools=true,supports_streaming=true,supports_vision=$2,supports_reasoning=false where id=$1",[newId,checked.capabilities.vision]);
  const meta={oldModelId:oldId,newModelId:newId,model:'gpt-6.1-sol',supplier:'GateAI',multiplier:.13,supplierDiscount:.1,userPricesRmbPerMillion:{input:.26,cached:.013,output:1.3,cacheWrite:.325,extendedInput:.52,extendedOutput:1.95},costReference:'USER_PROVIDED_GATEAI_PRICE_CARD_20261029',permissionPolicy:'COPY_OLD_PRESERVE_EITHER_EXPLICIT_DENY',capabilityEvidence:checked.capabilities.evidence};
  await db.query("insert into audit_logs(actor_id,action,target_type,target_id,metadata) values($1,'GATEAI61_MODEL_SWITCHED','MODEL',$2,$3::jsonb)",[actor,newId,JSON.stringify(meta)]);
  const {rows:active}=await db.query("select public_id from models where enabled and public_id like 'openai/%'");assert(active.length===1&&active[0].public_id==='openai/gpt-6.1-sol','GPT_CATALOG_NOT_EXCLUSIVE');
  const {rows:missing}=await db.query("select a.user_id from user_model_access a left join user_model_access b on b.user_id=a.user_id and b.model_id=$1 where a.model_id=$2 and (b.user_id is null or (a.access='DENY' and b.access<>'DENY'))",[newId,oldId]);assert(missing.length===0,'ACL_COPY_FAILED');
  return meta;
}
try{
  const {rows:[provider]}=await db.query("select p.id,p.base_url,p.config,c.ciphertext,c.iv,c.tag from providers p join provider_credentials c on c.provider_id=p.id where p.base_url='https://gateai.cc/v1' and p.enabled");assert(provider,'GATEAI_UNAVAILABLE');
  const {rows:[admin]}=await db.query("select id from users where role='ADMIN' and status='ACTIVE' order by created_at limit 1");assert(admin,'ADMIN_UNAVAILABLE');
  const de=createDecipheriv('aes-256-gcm',Buffer.from(process.env.PROVIDER_MASTER_KEY,'hex'),Buffer.from(provider.iv,'base64'));de.setAuthTag(Buffer.from(provider.tag,'base64'));
  const key=Buffer.concat([de.update(Buffer.from(provider.ciphertext,'base64')),de.final()]).toString();
  const adapter=new OpenAIProvider(provider.base_url,key,60000,[],provider.config.emptyToolsWorkaround===true);
  const checked=await probeOpenAIResponses(adapter,'gpt-6.1-sol',false);report.capabilities=checked.capabilities;report.probeTokens={input:checked.inputTokens,output:checked.outputTokens};
  const before=await fingerprint();report.deepseekBefore=before;
  await mutate(provider,checked,admin.id);assert(await fingerprint()===before,'DEEPSEEK_CHANGED_DURING_REHEARSAL');await db.query('rollback');report.rollbackRehearsal='PASS';
  // This transaction changes GPT catalog rows only. Ongoing DeepSeek requests
  // can continue; wait only for GPT requests whose model is being retired.
  const {rows:[busy]}=await db.query("select count(*)::int n from ai_requests a join models m on m.id=a.model_id where a.completed_at is null and a.status in ('STARTED','RUNNING','STREAMING') and m.public_id like 'openai/%'");assert(busy.n===0,'ACTIVE_GPT_GENERATIONS_DEFER_MODEL_SWITCH');
  report.configuration=await mutate(provider,checked,admin.id);assert(await fingerprint()===before,'DEEPSEEK_CHANGED');await db.query('commit');report.committed=true;report.deepseekAfter=await fingerprint();report.status='PASS';
}catch(error){await db.query('rollback').catch(()=>{});report.status='FAIL';report.errorCode=error.code??error.message;}
finally{await db.end();console.log(JSON.stringify(report));}
if(report.status!=='PASS')process.exitCode=1;
