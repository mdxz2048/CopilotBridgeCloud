// Explicit, bounded public-HTTPS release acceptance. Run only in the API container.
// Creates one audited @example.test fixture; retains its ledger and soft-deletes it.
import {createRequire} from 'node:module';
import {randomUUID,randomBytes,generateKeyPairSync,createHash,sign} from 'node:crypto';
if(process.env.GATEAI_SMOKE_RUN!=='1')throw new Error('EXPLICIT_PAID_SMOKE_REQUIRED');
const require=createRequire('/workspace/apps/api/package.json');
const {Client}=createRequire('/workspace/packages/db/package.json')('pg');
const argon2=require('argon2');
const db=new Client({connectionString:process.env.DATABASE_URL});await db.connect();
const origin='https://ai.mddxz.top',uid=randomUUID(),email=`gateai61-release-${randomUUID()}@example.test`,password=randomBytes(24).toString('hex');
const report={scope:'PUBLIC_HTTPS_REAL_SUPPLIERS_SYNTHETIC_TOOLS_NOT_OFFICIAL_GUI',checks:[],requests:[],fixtureUser:uid};
let seeded=false;
const assert=(condition,code)=>{if(!condition)throw Object.assign(new Error(code),{code});};
const hash=s=>createHash('sha256').update(s).digest('base64url');
function jwt(header,payload,key){const head=Buffer.from(JSON.stringify(header)).toString('base64url'),body=Buffer.from(JSON.stringify(payload)).toString('base64url');const value=head+'.'+body;return value+'.'+sign('sha256',Buffer.from(value),{key,dsaEncoding:'ieee-p1363'}).toString('base64url');}
async function send(path,body,session,authToken){
  const method=body===undefined?'GET':'POST',text=body===undefined?'':JSON.stringify(body),headers={'content-type':'application/json'};
  if(session){const token=authToken??session.accessToken;headers.authorization='Bearer '+token;headers['x-device-id']=session.deviceId;
    headers['x-client-thread-id']=session.thread;headers.dpop=jwt({typ:'dpop+jwt',alg:'ES256',jwk:session.jwk},{htm:method,htu:origin+path,iat:Math.floor(Date.now()/1000),jti:randomUUID(),ath:hash(token),bth:hash(text)},session.privateKey);}
  const response=await fetch(origin+path,{method,headers,body:body===undefined?undefined:text,signal:AbortSignal.timeout(90000)});
  const raw=await response.text();let data;
  if(response.headers.get('content-type')?.includes('text/event-stream')){
    const events=raw.split(/\r?\n\r?\n/).flatMap(block=>{const s=block.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');return s&&s!=='[DONE]'?[JSON.parse(s)]:[];});
    data=events.find(e=>['response.completed','response.failed','response.incomplete'].includes(e.type))?.response;
  }else{try{data=JSON.parse(raw);}catch{throw new Error('NON_JSON_HTTP_RESPONSE');}}
  return {status:response.status,data,requestId:response.headers.get('x-bridge-ai-request-id')};
}
async function login(version){
  const {publicKey,privateKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),jwk=publicKey.export({format:'jwk'}),deviceId=randomUUID();
  const response=await send('/api/v1/auth/login',{email,password,device:{deviceId,deviceName:'Temporary GateAI release acceptance',platform:'windows',osVersion:'synthetic',appVersion:version,publicKeyJwk:jwk}});
  if(response.status!==200)return {response};
  const session={deviceId,jwk,privateKey,accessToken:response.data.accessToken,refreshToken:response.data.refreshToken,thread:randomUUID()};
  const refresh=await send('/api/v1/auth/refresh',{refreshToken:session.refreshToken},session,session.refreshToken);
  assert(refresh.status===200,'REFRESH_'+version+'_'+refresh.data?.error?.code);session.accessToken=refresh.data.accessToken;
  report.checks.push({version,login:'PASS',refresh:'PASS'});return {response,session};
}
try{
  await db.query('begin');
  const {rows:[plan]}=await db.query("select id from plans where code='PAYG' and enabled=true");assert(plan,'PAYG_UNAVAILABLE');
  await db.query('insert into users(id,email,password_hash) values($1,$2,$3)',[uid,email,await argon2.hash(password,{type:argon2.argon2id})]);
  await db.query("insert into subscriptions(user_id,plan_id,status,started_at,current_period_start,current_period_end) values($1,$2,'ACTIVE',now(),now(),now()+interval '1 month')",[uid,plan.id]);
  await db.query("insert into user_model_access(user_id,model_id,access) select $1,id,'ALLOW' from models where public_id=any($2::text[])",[uid,['openai/gpt-6.1-sol','deepseek/deepseek-flash']]);
  const {rows:[wallet]}=await db.query('insert into wallets(user_id,balance) values($1,20000) returning id',[uid]);
  const {rows:[grant]}=await db.query("insert into wallet_transactions(wallet_id,type,points,balance_after,reference_type,reference_id,idempotency_key,metadata) values($1,'TEST_GRANT',20000,20000,'DIAGNOSTIC',$2,$2,'{\"purpose\":\"GateAI API release acceptance\"}') returning id",[wallet.id,uid]);
  await db.query("insert into wallet_lots(wallet_id,source_transaction_id,granted_points,remaining_points,expires_at) values($1,$2,20000,20000,now()+interval '1 hour')",[wallet.id,grant.id]);
  await db.query("insert into audit_logs(actor_id,action,target_type,target_id,metadata) values($1::uuid,'INTERNAL_DIAGNOSTIC_CREATED','USER',$1::text,'{\"purpose\":\"GateAI release acceptance\"}')",[uid]);
  await db.query('commit');seeded=true;
  const config=await send('/api/v1/client/config');assert(config.data.minimumVersion==='0.3.28'&&config.data.latestVersion==='0.3.30','RELEASE_POLICY_CHANGED');
  report.release={minimum:config.data.minimumVersion,latest:config.data.latestVersion};
  for(const version of ['0.3.28','0.3.30']){
    const {response,session}=await login(version);assert(session,'LOGIN_'+version+'_'+response.data?.error?.code);
    const catalog=await send('/v1/models',undefined,session);assert(catalog.status===200,'CATALOG_'+version);
    assert(['openai/gpt-6.1-sol','deepseek/deepseek-flash'].every(id=>catalog.data.data.some(m=>m.id===id)),'MODELS_MISSING');
    assert(catalog.data.data.filter(m=>m.id.startsWith('openai/')).length===1,'GPT_NOT_EXCLUSIVE');
    for(const profile of ['gateai','deepseek']){
      session.thread=randomUUID();const model=profile==='gateai'?'openai/gpt-6.1-sol':'deepseek/deepseek-flash';
      const native={type:'namespace',name:'fixture',description:'Synthetic release acceptance tools',tools:[{type:'custom',name:'probe',description:'Return a synthetic marker. Supply raw input ping.',format:{type:'text'}}]};
      const tools=profile==='gateai'?[]:[{type:'function',name:'probe',description:'Return a synthetic marker.',parameters:{type:'object',properties:{},required:[],additionalProperties:false}}];
      const input=[...(profile==='gateai'?[{type:'additional_tools',id:'at_'+randomBytes(24).toString('hex'),role:'system',tools:[native]}]:[]),{role:'user',content:'Call probe once to obtain a marker. Use ping if it takes raw input. After its result reply only with the returned marker.'}];
      const base={model,tools,stream:version==='0.3.30',store:false,max_output_tokens:256,reasoning:{mode:'normal'},tool_choice:'auto',parallel_tool_calls:false};
      const first=await send('/v1/responses',{...base,input},session);assert(first.status===200&&first.data?.status==='completed','FIRST_'+profile+'_'+first.data?.error?.code);
      report.requests.push({version,profile,requestId:first.requestId,status:first.data.status});
      const calls=first.data.output.filter(x=>['custom_tool_call','function_call'].includes(x.type));assert(calls.length===1&&calls[0].name==='probe','CALL_MISSING_'+profile);
      const call=calls[0],marker='DEPLOY_'+randomBytes(6).toString('hex');
      const second=await send('/v1/responses',{...base,previous_response_id:first.data.id,input:[{type:call.type==='custom_tool_call'?'custom_tool_call_output':'function_call_output',call_id:call.call_id,output:marker}]},session);
      assert(second.status===200&&second.data?.status==='completed','CONTINUATION_'+profile+'_'+second.data?.error?.code);
      report.requests.push({version,profile,requestId:second.requestId,status:second.data.status});
      assert(second.data.output.filter(x=>x.type==='message').flatMap(x=>x.content??[]).some(x=>x.text?.includes(marker)),'MARKER_MISSING_'+profile);
      report.checks.push({version,profile,transport:base.stream?'SSE':'JSON',toolRoundTrip:'PASS'});
    }
  }
  const old=await login('0.3.27');const rejected=old.session?await send('/v1/models',undefined,old.session):old.response;
  assert(rejected.status===426&&rejected.data?.error?.code==='CLIENT_UPGRADE_REQUIRED','BELOW_MINIMUM_NOT_REJECTED');report.checks.push({version:'0.3.27',belowMinimum:'PASS'});
  const {rows:usage}=await db.query('select request_id,billing_status,points_charged from usage_events where user_id=$1',[uid]);
  assert(usage.length===8&&usage.every(x=>x.billing_status==='SETTLED'),'SETTLEMENT_MISMATCH');
  const {rows:gptAudits}=await db.query("select u.provider_reported_usage->'bridge_cost_audit' audit from usage_events u join models m on m.id=u.model_id where u.user_id=$1 and m.public_id='openai/gpt-6.1-sol'",[uid]);
  assert(gptAudits.length===4&&gptAudits.every(x=>x.audit?.costSource==='USER_PROVIDED_RATE_ESTIMATE'&&x.audit?.rateSnapshot?.supplierDiscount===.1&&x.audit.estimatedCostRmb>0),'GATEAI_COST_AUDIT_MISSING');report.costReference={supplierDiscount:.1,source:'USER_PROVIDED_RATE_ESTIMATE',pricedRequests:gptAudits.length};
  const charged=usage.reduce((n,x)=>n+x.points_charged,0),{rows:[after]}=await db.query('select balance from wallets where user_id=$1',[uid]);
  assert(after.balance===20000-charged,'WALLET_RECONCILIATION');report.billing={requests:usage.length,status:'SETTLED',pointsCharged:charged,walletReconciled:true};report.status='PASS';
}catch(error){await db.query('rollback').catch(()=>{});report.status='FAIL';report.errorCode=error.code??error.message;}
finally{
  if(seeded){
    await db.query('begin');
    await db.query("update users set status='DELETED' where id=$1",[uid]);
    await db.query("update devices set status='REVOKED',auth_version=auth_version+1 where user_id=$1",[uid]);
    await db.query('update refresh_tokens set revoked_at=now() where user_id=$1 and revoked_at is null',[uid]);
    await db.query('delete from model_sessions where user_id=$1',[uid]);
    await db.query("insert into audit_logs(actor_id,action,target_type,target_id,metadata) values($1::uuid,'INTERNAL_DIAGNOSTIC_COMPLETED','USER',$1::text,'{\"cleanup\":\"soft-delete, revoke devices, retain ledger\"}')",[uid]);
    await db.query('commit');report.fixtureSoftDeleted=true;
  }
  await db.end();console.log(JSON.stringify(report));
}
if(report.status!=='PASS')process.exitCode=1;
