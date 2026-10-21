import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { eq } from 'drizzle-orm';

describe.skipIf(!process.env.V2_TEST_DATABASE_URL)('Nested tool repair signed gateway PostgreSQL',()=>{
  let data:typeof import('@bridge/db'), app:Awaited<ReturnType<typeof import('./server.js').createServer>>;
  let userId:string,deviceId:string,token:string,modelId:string;
  const origin='http://localhost:3001',key=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),thread=randomUUID();
  const jwk=key.publicKey.export({format:'jwk'}) as {kty:'EC';crv:'P-256';x:string;y:string};
  const wrapper={type:'function',name:'functions__exec',description:`Run JavaScript code with the global \`tools\` object.
declare const tools: { exec_command(args: {
cmd: string; justification?: string; login?: boolean; max_output_tokens?: number;
prefix_rule?: Array<string>; sandbox_permissions?: "use_default" | "require_escalated";
shell?: string; tty?: boolean; workdir?: string; yield_time_ms?: number;
}): Promise<unknown>; };`,parameters:{type:'object',properties:{input:{type:'string'}},required:['input'],additionalProperties:false}};
  beforeAll(async()=>{
    const url=process.env.V2_TEST_DATABASE_URL!;if(!new URL(url).pathname.startsWith('/bridge_v2_test_'))throw Error('REFUSE_NON_TEST_DATABASE');
    Object.assign(process.env,{DATABASE_URL:url,NODE_ENV:'test',PUBLIC_BASE_URL:origin,LOG_LEVEL:'silent',FLIGHT_RECORDER_ENABLED:'false',STAGED_EMAIL_REGISTRATION_ENABLED:'false',V2_BILLING_MODE:'ENFORCED'});
    process.env.ACCESS_SECRET??='a'.repeat(64);process.env.REFRESH_TOKEN_PEPPER??='b'.repeat(64);process.env.PROVIDER_MASTER_KEY??='c'.repeat(64);
    data=await import('@bridge/db');const security=await import('./security.js');
    const [user]=await data.db.insert(data.users).values({email:`repair-${randomUUID()}@example.test`,passwordHash:'synthetic'}).returning();userId=user.id;
    const [device]=await data.db.insert(data.devices).values({userId,deviceId:randomUUID(),deviceName:'Synthetic repair test',platform:'Windows',appVersion:'999.0.0',publicKeyJwk:jwk}).returning();deviceId=device.deviceId;token=await security.issueAccess(userId,device.id);
    const [provider]=await data.db.insert(data.providers).values({code:`DEEPSEEK_${randomUUID().replaceAll('-','').slice(0,12).toUpperCase()}`,name:'Synthetic repair',baseUrl:'https://repair.example',enabled:true}).returning();
    await data.db.insert(data.providerCredentials).values({providerId:provider.id,...security.encryptSecret('fixture-key')});
    const [model]=await data.db.insert(data.models).values({providerId:provider.id,providerModelId:'deepseek-flash',publicId:`deepseek/repair-${randomUUID()}`,displayName:'Synthetic repair',enabled:true,supportsTools:true,maxOutputTokens:512}).returning();modelId=model.publicId;
    await data.db.insert(data.modelInstances).values({modelId:model.id,providerId:provider.id,providerModelId:'deepseek-flash',enabled:true,healthStatus:'READY',nativeProtocols:['responses'],capabilities:{tools:true,streaming:true}});
    const [plan]=await data.db.insert(data.plans).values({code:`REPAIR_${randomUUID().slice(0,8)}`,name:'Synthetic repair',monthlyPrice:'1',maxDevices:2,monthlyTokenLimit:1000000,monthlyUsageCreditLimit:'1000000',maxConcurrentRequests:3,requestsPerMinute:60,enabled:true}).returning();
    await data.db.insert(data.planModelAccess).values({planId:plan.id,modelId:model.id});
    const now=new Date();await data.db.insert(data.subscriptions).values({userId,planId:plan.id,status:'ACTIVE',startedAt:now,currentPeriodStart:now,currentPeriodEnd:new Date(Date.now()+86400000)});
    const wallet=await import('./wallet.js');await data.db.transaction(tx=>wallet.applyWalletChange(tx,{userId,points:200000,type:'PURCHASE',referenceType:'TEST',referenceId:userId,idempotencyKey:`repair-${userId}`}));
    app=await(await import('./server.js')).createServer();
  });
  afterAll(async()=>{vi.unstubAllGlobals();await app?.close();await data?.pool.end();});
  async function post(input:unknown,stream:boolean,previous_response_id?:string){
    const payload={model:modelId,input,stream,previous_response_id,tools:[wrapper],reasoning:{mode:'normal'},max_output_tokens:128};
    const hash=(s:string)=>createHash('sha256').update(s).digest('base64url');
    const dpop=await new SignJWT({htm:'POST',htu:origin+'/v1/responses',iat:Math.floor(Date.now()/1000),jti:randomUUID(),ath:hash(token),bth:hash(JSON.stringify(payload))}).setProtectedHeader({typ:'dpop+jwt',alg:'ES256',jwk}).sign(key.privateKey);
    return app.inject({method:'POST',url:'/v1/responses',payload,headers:{host:'localhost:3001',authorization:`Bearer ${token}`,'x-device-id':deviceId,'x-client-thread-id':thread,dpop}});
  }
  it('repairs SSE and JSON, settles real usage once, saves repaired history and continues with the same call ID',async()=>{
    let posts=0;
    const call={id:'fc_fixture',type:'function_call',call_id:'call_fixture',name:'exec_command',arguments:JSON.stringify({cmd:'echo synthetic',yield_time_ms:10000}),status:'completed'};
    vi.stubGlobal('fetch',vi.fn(async(url,init)=>{
      if(String(url).endsWith('/user/balance'))return Response.json({is_available:true,balance_infos:[{currency:'CNY',total_balance:'100',granted_balance:'0',topped_up_balance:'100'}]});
      expect(String(url)).toBe('https://repair.example/responses');posts++;const body=JSON.parse(init.body);
      const output:Record<string,unknown>[]=posts===2?[{type:'message',role:'assistant',content:[{type:'output_text',text:'synthetic complete'}]}]:[{...call,id:`fc_${posts}`,call_id:`call_${posts}`}];
      if(posts===2){const old=body.input.find((i:Record<string,unknown>)=>i.call_id==='call_1'&&i.type==='function_call');expect(old.name).toBe('functions__exec');expect(JSON.parse(old.arguments).input).toContain('tools.exec_command');expect(body.input.some((i:Record<string,unknown>)=>i.type==='function_call_output'&&i.call_id==='call_1')).toBe(true);}
      const response={id:`upstream_${posts}`,status:'completed',output,usage:{input_tokens:20,output_tokens:8}};
      if(!body.stream)return Response.json(response);
      const item=output[0];return new Response([
        {type:'response.output_item.added',response_id:response.id,output_index:0,item:{...item,arguments:''}},
        {type:'response.function_call_arguments.delta',item_id:item.id,output_index:0,delta:item.arguments},
        {type:'response.function_call_arguments.done',item_id:item.id,output_index:0,arguments:item.arguments},
        {type:'response.output_item.done',response_id:response.id,output_index:0,item},
        {type:'response.completed',response},
      ].map(e=>`data: ${JSON.stringify(e)}\n\n`).join(''));
    }));
    const wallet=await import('./wallet.js'),before=(await wallet.walletSummary(userId)).balance;
    const first=await post('synthetic repair fixture',true);expect(first.statusCode,first.body).toBe(200);
    const events=first.body.split(/\n\n/).filter(b=>b.includes('data: ')).map(b=>JSON.parse(b.split('\n').find(l=>l.startsWith('data: '))!.slice(6)));
    const terminal=events.find(e=>e.type==='response.completed');expect(terminal,first.body).toBeTruthy();
    expect(events.map(e=>e.sequence_number)).toEqual(events.map((_,i)=>i));
    const fixed=terminal.response.output[0];expect(fixed).toMatchObject({name:'functions__exec',call_id:'call_1',id:'fc_1'});
    expect(events.find(e=>e.type==='response.output_item.added').item.name).toBe(fixed.name);
    expect(events.find(e=>e.type==='response.function_call_arguments.done').arguments).toBe(fixed.arguments);
    const second=await post([{type:'function_call_output',call_id:'call_1',output:'synthetic result'}],false,terminal.response.id);expect(second.statusCode,second.body).toBe(200);
    expect(second.json().status).toBe('completed');
    const third=await post([{type:'message',role:'user',content:'new synthetic command'}],false,second.json().id);expect(third.statusCode,third.body).toBe(200);expect(third.json().output[0].name).toBe('functions__exec');
    expect(posts).toBe(3);const usage=await data.db.select().from(data.usageEvents).where(eq(data.usageEvents.userId,userId));expect(usage).toHaveLength(3);expect(usage.every(u=>u.billingStatus==='SETTLED'&&u.inputTokens===20&&u.outputTokens===8)).toBe(true);
    expect(before-(await wallet.walletSummary(userId)).balance).toBe(usage.reduce((n,u)=>n+u.pointsCharged,0));
    const requests=await data.db.select().from(data.aiRequests).where(eq(data.aiRequests.userId,userId));expect(requests.every(r=>r.status==='COMPLETED')).toBe(true);
  });
});
