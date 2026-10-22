import { describe, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { DeepSeekToolRepair } from './deepseek-tool-repair.js';
import { nativeResult } from './native-responses.js';

const declaration = `declare const tools: { exec_command(args: {
  // Shell command to execute.
  cmd: string; justification?: string; login?: boolean; max_output_tokens?: number;
  prefix_rule?: Array<string>; sandbox_permissions?: "use_default" | "require_escalated";
  shell?: string; tty?: boolean; workdir?: string; yield_time_ms?: number;
}): Promise<unknown>; };`;
const wrapper = { type:'function', name:'functions__exec', description:'Run JavaScript code with the global `tools` object.\n'+declaration,
  parameters:{type:'object',properties:{input:{type:'string'}},required:['input'],additionalProperties:false} };
const request = { model:'fixture', input:'synthetic', tools:[wrapper] };
const call = (n=1,args:unknown={cmd:'echo synthetic'}) => ({id:`fc_${n}`,call_id:`call_${n}`,type:'function_call',name:'exec_command',arguments:JSON.stringify(args),status:'completed'});
const result = (output:Record<string,unknown>[]) => nativeResult({id:'resp_fixture',status:'completed',output,usage:{input_tokens:20,output_tokens:8}});
const added = (item=call(),index=0) => ({type:'response.output_item.added',response_id:'resp_fixture',output_index:index,item:{...item,status:'in_progress',arguments:''}});
const done = (item=call(),index=0) => ({type:'response.output_item.done',response_id:'resp_fixture',output_index:index,item});

describe('DeepSeek nested command repair',()=>{
  it('restores a mislabeled wrapper without changing or executing its JavaScript',()=>{
    const input='// 中文 😀\nconst args = {cmd: "echo `literal` ${literal}"};\ntext(await tools.exec_command(args));';
    const item={...call(1,{input}),arguments:JSON.stringify({input},null,2)};
    const audit=vi.fn(),repair=new DeepSeekToolRepair(request,'deepseek',audit);
    repair.events('response.output_item.added',added(item));
    for(const delta of item.arguments)repair.events('response.function_call_arguments.delta',{item_id:item.id,delta});
    const events=repair.events('response.function_call_arguments.done',{item_id:item.id,arguments:item.arguments});
    const final=repair.events('response.output_item.done',done(item))[0];
    const fixed=repair.result(result([item])).output[0];
    expect(fixed).toEqual({...item,name:'functions__exec'});
    expect(final.event.item).toEqual(fixed);expect(events[1].event.delta).toBe(item.arguments);
    expect(JSON.parse(String(fixed.arguments)).input).toBe(input);
    expect(audit).toHaveBeenCalledTimes(1);expect(audit.mock.calls[0][0].mode).toBe('wrapper_name');
    expect(JSON.stringify(audit.mock.calls)).not.toContain(input);
  });
  it('keeps arguments literal, IDs and usage unchanged and invokes only the existing wrapper method',async()=>{
    const args={cmd:'echo `backtick` $(test) ${injected} "quote" \\path\nnext',workdir:'C:\\synthetic',shell:'powershell',login:false,tty:true,max_output_tokens:500,yield_time_ms:10000,justification:'fixture',sandbox_permissions:'use_default',prefix_rule:['echo']};
    const audit=vi.fn(),repair=new DeepSeekToolRepair(request,'deepseek',audit),original=result([call(1,args)]),before=JSON.stringify(original);
    const output=repair.result(original);expect(output.inputTokens).toBe(20);expect(output.outputTokens).toBe(8);expect(output.output[0]).toMatchObject({id:'fc_1',call_id:'call_1',name:'functions__exec',status:'completed'});
    expect(output.nativeResponse?.output).toEqual(output.output);expect(JSON.stringify(original)).toBe(before);
    const exec_command=vi.fn(async(_args:unknown)=>({output:'synthetic fixture'})),text=vi.fn();
    await runInNewContext(`(async()=>{${JSON.parse(String(output.output[0].arguments)).input}})()`,{tools:{exec_command},text},{timeout:1000});
    expect(exec_command).toHaveBeenCalledTimes(1);expect(exec_command.mock.calls[0][0]).toEqual(args);expect(text).toHaveBeenCalledWith({output:'synthetic fixture'});
    expect(audit).toHaveBeenCalledTimes(1);expect(JSON.stringify(audit.mock.calls)).not.toContain(args.cmd);
  });
  it('buffers split JSON and emits a consistent complete wrapper before tool completion',()=>{
    const repair=new DeepSeekToolRepair(request,'deepseek');const item=call(1,{cmd:'echo 中文 😀 "fixture"'}),start=added(item);
    expect(repair.events(start.type,start)).toEqual([]);
    for(const delta of String(item.arguments))expect(repair.events('response.function_call_arguments.delta',{item_id:item.id,delta})).toEqual([]);
    const events=repair.events('response.function_call_arguments.done',{item_id:item.id,arguments:item.arguments});
    expect(events.map(e=>e.type)).toEqual(['response.output_item.added','response.function_call_arguments.delta','response.function_call_arguments.done']);
    expect(events[0].event.item).toMatchObject({id:item.id,call_id:item.call_id,name:'functions__exec',arguments:''});
    const final=repair.events('response.output_item.done',done(item))[0];expect(final.event.item).toEqual(repair.result(result([item])).output[0]);
    expect(events[1].event.delta).toBe((final.event.item as Record<string,unknown>).arguments);expect(events[2].event.arguments).toBe(events[1].event.delta);
  });
  it('handles parallel calls, index association and output-item-only completion independently',()=>{
    const repair=new DeepSeekToolRepair(request,'deepseek');const a=call(),b=call(2,{cmd:'echo second'});
    repair.events('response.output_item.added',added(a,0));repair.events('response.output_item.added',added(b,1));
    expect(repair.events('response.function_call_arguments.delta',{output_index:1,delta:b.arguments})).toEqual([]);
    const second=repair.events('response.output_item.done',done(b,1));const first=repair.events('response.output_item.done',done(a,0));
    expect(second).toHaveLength(4);expect(first).toHaveLength(4);expect(repair.result(result([a,b])).output.map(i=>i.call_id)).toEqual(['call_1','call_2']);
  });
  it('does not transform OpenAI, undeclared wrappers, unknown signatures, ambiguous or directly declared tools',()=>{
    const direct={type:'function',name:'exec_command',parameters:{type:'object'}};
    for(const [tools,profile] of [
      [[wrapper],'openai'],[[],'deepseek'],[[{...wrapper,description:'ordinary function'}],'deepseek'],
      [[{...wrapper,description:wrapper.description.replace('cmd: string','command: string')}],'deepseek'],
      [[{...wrapper,parameters:{type:'object'}}],'deepseek'],[[wrapper,wrapper],'deepseek'],[[wrapper,direct],'deepseek'],
      [[wrapper,{...direct,name:'another__exec_command'}],'deepseek'],
    ] as const){const repair=new DeepSeekToolRepair({...request,tools:[...tools]},profile);const r=result([call()]);expect(repair.result(r)).toEqual(r);const e=added();expect(repair.events(e.type,e)).toEqual([{type:e.type,event:e}]);}
    const unknown={...call(),name:'delete_everything'};expect(new DeepSeekToolRepair(request,'deepseek').result(result([unknown])).output[0]).toEqual(unknown);
  });
  it('rejects malformed JSON, extra fields, invalid field types and oversized input without executing anything',()=>{
    for(const args of [{},{cmd:4},{cmd:''},{cmd:'fixture',unknown:true},{cmd:'fixture',tty:'true'},{cmd:'fixture',prefix_rule:[1]},{cmd:'fixture',sandbox_permissions:'always'},{input:4},{input:''},{input:'text(1)',cmd:'echo mixed'},{input:'text(1)',unknown:true},[],null,JSON.parse('{"cmd":"fixture","__proto__":{}}'),JSON.parse('{"input":"text(1)","__proto__":{}}')]){
      expect(()=>new DeepSeekToolRepair(request,'deepseek').result(result([call(1,args)]))).toThrow('无法安全转换');
    }
    for(const arguments_ of ['not json','{"cmd":','x'.repeat(1024*1024+1)])expect(()=>new DeepSeekToolRepair(request,'deepseek').result(result([{...call(),arguments:arguments_}]))).toThrow();
  });
  it('rejects mismatched IDs, changed final arguments, premature terminal and buffers beyond the limit',()=>{
    const repair=new DeepSeekToolRepair(request,'deepseek');repair.events('response.output_item.added',added());
    expect(()=>repair.result(result([call()]))).toThrow(); // terminal alone cannot complete an unfinished streamed call.
    repair.events('response.function_call_arguments.done',{item_id:'fc_1',arguments:call().arguments});
    expect(()=>repair.events('response.output_item.done',done(call(1,{cmd:'changed'})))).toThrow();
    expect(()=>repair.events('response.output_item.done',done({...call(),call_id:'different'}))).toThrow();
    expect(()=>repair.events('response.function_call_arguments.delta',{item_id:'fc_1',delta:'later'})).toThrow();
    const large=new DeepSeekToolRepair(request,'deepseek');large.events('response.output_item.added',added());expect(()=>large.events('response.function_call_arguments.delta',{item_id:'fc_1',delta:'x'.repeat(1024*1024+1)})).toThrow();
  });
  it('preserves ordinary text, declared tools, failures and continuation call IDs',()=>{
    const repair=new DeepSeekToolRepair(request,'deepseek');const text={type:'response.output_text.delta',delta:'fixture'};expect(repair.events(text.type,text)).toEqual([{type:text.type,event:text}]);
    const normal={...call(),name:'functions__exec',arguments:'{"input":"text(1)"}'};expect(repair.result(result([normal])).output[0]).toBe(normal);
    const failed={...result([]),status:'failed' as const,nativeTerminalEvent:'response.failed'};expect(repair.result(failed)).toEqual(failed);
    const fixed=repair.result(result([call()]));const input=[...fixed.output,{type:'function_call_output',call_id:'call_1',output:'synthetic'}];expect(input[0].call_id).toBe(input[1].call_id);
  });
  it('numbers relayed interleaved events and the terminal monotonically while leaving OpenAI untouched',()=>{
    const repair=new DeepSeekToolRepair(request,'deepseek');const messages:Record<string,unknown>[]=[];
    const send=(type:string,event:Record<string,unknown>)=>{for(const translated of repair.events(type,event))messages.push(repair.relay(translated.event));};
    send('response.output_item.added',{...added(),sequence_number:5});
    send('response.output_text.delta',{type:'response.output_text.delta',delta:'interleaved',sequence_number:8});
    send('response.output_item.done',{...done(),sequence_number:12});
    messages.push(repair.relay({type:'response.completed',sequence_number:13}));
    expect(messages.map(m=>m.sequence_number)).toEqual([0,1,2,3,4,5]);
    const openai=new DeepSeekToolRepair(request,'openai'),e={sequence_number:50};expect(openai.relay(e)).toBe(e);
  });
});
