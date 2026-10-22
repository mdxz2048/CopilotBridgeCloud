import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { eq } from 'drizzle-orm';

describe.skipIf(!process.env.V2_TEST_DATABASE_URL)('Nested tool repair signed gateway PostgreSQL',()=>{
  let data:typeof import('@bridge/db'), app:Awaited<ReturnType<typeof import('./server.js').createServer>>;
  let userId:string,deviceId:string,token:string,modelId:string,gatewayRequestId:string;
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
    app.addHook('onRequest',async req=>{gatewayRequestId=req.id;});
  });
  afterAll(async()=>{vi.unstubAllGlobals();await app?.close();await data?.pool.end();});
  async function post(input:unknown,stream:boolean,previous_response_id?:string){
    const payload={model:modelId,input,stream,previous_response_id,tools:[wrapper],reasoning:{mode:'normal'},max_output_tokens:128};
    const hash=(s:string)=>createHash('sha256').update(s).digest('base64url');
    const dpop=await new SignJWT({htm:'POST',htu:origin+'/v1/responses',iat:Math.floor(Date.now()/1000),jti:randomUUID(),ath:hash(token),bth:hash(JSON.stringify(payload))}).setProtectedHeader({typ:'dpop+jwt',alg:'ES256',jwk}).sign(key.privateKey);
    return app.inject({method:'POST',url:'/v1/responses',payload,headers:{host:'localhost:3001',authorization:`Bearer ${token}`,'x-device-id':deviceId,'x-client-thread-id':thread,dpop}});
  }
  it.each(['nested_command','wrapper_name'])('repairs %s SSE and JSON, settles usage once and continues with the same call ID',async mode=>{
    let posts=0;
    const input='text(await tools.exec_command({cmd:"echo synthetic",yield_time_ms:10000}));';
    const call={id:'fc_fixture',type:'function_call',call_id:'call_fixture',name:'exec_command',arguments:JSON.stringify(mode==='wrapper_name'?{input}:{cmd:'echo synthetic',yield_time_ms:10000}),status:'completed'};
    vi.stubGlobal('fetch',vi.fn(async(url,init)=>{
      if(String(url).endsWith('/user/balance'))return Response.json({is_available:true,balance_infos:[{currency:'CNY',total_balance:'100',granted_balance:'0',topped_up_balance:'100'}]});
      expect(String(url)).toBe('https://repair.example/responses');posts++;const body=JSON.parse(init.body);
      expect(body.tools[0].strict).toBe(true);
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
    if(mode==='wrapper_name'){expect(fixed.arguments).toBe(call.arguments);expect(third.json().output[0].arguments).toBe(call.arguments);}
    expect(posts).toBe(3);const allUsage=await data.db.select().from(data.usageEvents).where(eq(data.usageEvents.userId,userId));
    const ids=new Set([first.headers['x-bridge-ai-request-id'],second.headers['x-bridge-ai-request-id'],third.headers['x-bridge-ai-request-id']]);
    const usage=allUsage.filter(u=>ids.has(u.requestId));expect(usage).toHaveLength(3);expect(usage.every(u=>u.billingStatus==='SETTLED'&&u.inputTokens===20&&u.outputTokens===8)).toBe(true);
    expect(before-(await wallet.walletSummary(userId)).balance).toBe(usage.reduce((n,u)=>n+u.pointsCharged,0));
    const requests=await data.db.select().from(data.aiRequests).where(eq(data.aiRequests.userId,userId));expect(requests.every(r=>r.status==='COMPLETED')).toBe(true);
  });
  it.each([true,false])('recovers one missing input internally (stream=%s) without replaying a completed sibling',async stream=>{
    let posts=0;
    vi.stubGlobal('fetch',vi.fn(async(url,init)=>{
      if(String(url).endsWith('/user/balance'))return Response.json({is_available:true,balance_infos:[{currency:'CNY',total_balance:'100',granted_balance:'0',topped_up_balance:'100'}]});
      posts++;const body=JSON.parse(init.body);expect(body.tools[0].strict).toBe(true);
      if(posts===2){expect(body.stream).toBe(false);expect(body.tools).toHaveLength(1);expect(body.reasoning.effort).toBe('none');expect(body.tool_choice).toEqual({type:'function',name:'functions__exec'});return Response.json({id:'correction',status:'completed',output:[{id:'correction_item',call_id:'correction_call',type:'function_call',name:'functions__exec',arguments:'{"input":"text(42);"}'}],usage:{input_tokens:10,output_tokens:4}});}
      expect(posts).toBe(1);
      const item={id:'fc_empty',call_id:'call_empty',type:'function_call',name:'exec',arguments:'{}'};
      const good={id:'fc_good',call_id:'call_good',type:'function_call',name:'functions__exec',arguments:'{"input":"text(1);"}',status:'completed'};
      const response={id:'upstream_empty',status:'completed',output:[good,item],usage:{input_tokens:20,output_tokens:8}};
      if(!stream)return Response.json(response);
      return new Response([
        {type:'response.output_item.added',output_index:0,item:{...good,arguments:''}},
        {type:'response.output_item.done',output_index:0,item:good},
        {type:'response.output_item.added',output_index:1,item:{...item,arguments:''}},
        {type:'response.function_call_arguments.delta',item_id:item.id,output_index:1,delta:'{}'},
        {type:'response.function_call_arguments.done',item_id:item.id,output_index:1,arguments:'{}'},
        {type:'response.output_item.done',output_index:1,item},
        {type:'response.completed',response},
      ].map(e=>`data: ${JSON.stringify(e)}\n\n`).join(''));
    }));
    const response=await post('synthetic empty wrapper',stream);expect(response.statusCode,response.body).toBe(200);expect(posts).toBe(2);
    let completed;
    if(stream){const events=response.body.split(/\n\n/).filter(b=>b.includes('data: {')).map(b=>JSON.parse(b.split('\n').find(l=>l.startsWith('data: '))!.slice(6)));
      expect(events.some(e=>e.type==='response.failed')).toBe(false);expect(events.filter(e=>e.type==='response.output_item.added'&&e.item.call_id==='call_good')).toHaveLength(1);expect(events.filter(e=>e.type==='response.output_item.added'&&e.item.call_id==='call_empty')).toHaveLength(1);expect(events.map(e=>e.sequence_number)).toEqual(events.map((_,i)=>i));completed=events.at(-1).response;
    }else completed=response.json();
    expect(completed.status).toBe('completed');expect(completed.output.map((i:Record<string,unknown>)=>i.call_id)).toEqual(['call_good','call_empty']);expect(completed.output[1]).toMatchObject({id:'fc_empty',arguments:'{"input":"text(42);"}'});
    const [request]=await data.db.select().from(data.aiRequests).where(eq(data.aiRequests.id,String(response.headers['x-bridge-ai-request-id'])));
    expect(request.status).toBe('COMPLETED');
    const usage=await data.db.select().from(data.usageEvents).where(eq(data.usageEvents.requestId,request.id));
    expect(usage).toHaveLength(1);expect(usage[0]).toMatchObject({inputTokens:30,outputTokens:12,billingStatus:'SETTLED'});
    await vi.waitFor(async()=>{const records=await data.db.select().from(data.failureDiagnostics).where(eq(data.failureDiagnostics.traceId,gatewayRequestId));expect(records).toHaveLength(1);expect(records[0].errorCode).toBe('PROTOCOL_RECOVERED');},{timeout:5000,interval:50});
  });
  it('stops after one failed correction and keeps both actual usage records in one settlement',async()=>{
    let posts=0;
    vi.stubGlobal('fetch',vi.fn(async url=>{if(String(url).endsWith('/user/balance'))return Response.json({is_available:true,balance_infos:[{currency:'CNY',total_balance:'100',granted_balance:'0',topped_up_balance:'100'}]});posts++;return Response.json({id:'invalid_'+posts,status:'completed',output:[{id:'bad_'+posts,call_id:'bad_call_'+posts,type:'function_call',name:'functions__exec',arguments:'{}'}],usage:{input_tokens:10,output_tokens:4}});}));
    const response=await post('synthetic bounded correction',false);expect(response.statusCode).toBe(502);expect(posts).toBe(2);
    const usage=await data.db.select().from(data.usageEvents).where(eq(data.usageEvents.requestId,String(response.headers['x-bridge-ai-request-id'])));expect(usage).toHaveLength(1);expect(usage[0]).toMatchObject({inputTokens:20,outputTokens:8,billingStatus:'SETTLED'});
  });
});
