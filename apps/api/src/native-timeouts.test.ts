import {afterEach,describe,expect,it,vi} from 'vitest';
import {nativeDeadline,nativeEventProgress,NativeTimeoutError,nativeTimeoutPolicy} from './native-timeouts.js';
import {executeNativeResponses,nativeFailedEvent} from './native-responses.js';
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
describe('native document generation deadlines',()=>{
  it('allows active generation beyond one hour but retains a sixty-five-minute cap',async()=>{
    vi.useFakeTimers();const deadline=nativeDeadline(new AbortController().signal,60000);deadline.headersReceived();
    for(let i=0;i<64;i++){await vi.advanceTimersByTimeAsync(60000);deadline.progress();expect(deadline.signal.aborted).toBe(false);}
    await vi.advanceTimersByTimeAsync(60000);expect(deadline.signal.reason).toMatchObject({code:'GATEWAY_TIMEOUT',phase:'total',message:expect.stringContaining('平台总时限')});deadline.dispose();
  });
  it('separates connection timeout from idle timeout and ignores heartbeat-only activity',async()=>{
    vi.useFakeTimers();const connect=nativeDeadline(new AbortController().signal,60000);await vi.advanceTimersByTimeAsync(60000);expect(connect.signal.reason.message).toContain('连接');connect.dispose();
    const idle=nativeDeadline(new AbortController().signal);idle.headersReceived();
    for(let i=0;i<9;i++){await vi.advanceTimersByTimeAsync(30000);for(const type of ['response.created','response.in_progress','ping'])if(nativeEventProgress(type,{}))idle.progress();}
    await vi.advanceTimersByTimeAsync(30000);expect(idle.signal.reason.message).toContain('没有内容或工具进展');idle.dispose();
    expect(nativeEventProgress('response.function_call_arguments.delta',{delta:'document text'})).toBe(true);expect(nativeEventProgress('response.function_call_arguments.delta',{delta:''})).toBe(false);
  });
  it('relays a real fake-clock active SSE past 60 seconds without retrying generation',async()=>{
    vi.useFakeTimers();let controller!:ReadableStreamDefaultController;
    const fetch=vi.fn(async(_url,init)=>new Response(new ReadableStream({start(c){controller=c;init.signal.addEventListener('abort',()=>c.error(init.signal.reason),{once:true});}})));vi.stubGlobal('fetch',fetch);
    const events:string[]=[];const pending=executeNativeResponses('https://fixture.invalid','fixture',{model:'logical',input:'fixture',stream:true},'fixture',new AbortController().signal,async type=>{events.push(type);});
    await vi.advanceTimersByTimeAsync(0);for(let i=0;i<2;i++){await vi.advanceTimersByTimeAsync(65000);controller.enqueue(new TextEncoder().encode('data: {"type":"response.function_call_arguments.delta","delta":"synthetic document fragment"}\n\n'));await vi.advanceTimersByTimeAsync(0);}
    controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({type:'response.completed',response:{id:'fixture',object:'response',model:'fixture',status:'completed',output:[],usage:{input_tokens:1,output_tokens:1}}})}\n\n`));controller.close();
    expect((await pending).status).toBe('completed');expect(events).toHaveLength(2);expect(fetch).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
  });
  it('exposes a bounded idle failure inside the native response error',()=>{
    const event=nativeFailedEvent('resp_fixture','logical',new NativeTimeoutError('idle'),'request_fixture');
    expect(event.response).toMatchObject({object:'response',status:'failed',error:{code:'GATEWAY_TIMEOUT',request_id:'request_fixture',timeout_phase:'idle'}});expect(event.error).toEqual(event.response.error);expect('usage' in event.response).toBe(false);
  });
  it('validates deployment timeouts and propagates cancellation without leaking timers',()=>{
    expect(nativeTimeoutPolicy({NATIVE_IDLE_TIMEOUT_MS:'300000',NATIVE_TOTAL_TIMEOUT_MS:'3900000'})).toEqual({idleMs:300000,totalMs:3900000});
    expect(()=>nativeTimeoutPolicy({NATIVE_TOTAL_TIMEOUT_MS:'0'})).toThrow();expect(()=>nativeTimeoutPolicy({NATIVE_TOTAL_TIMEOUT_MS:'999999999'})).toThrow();
    vi.useFakeTimers();const parent=new AbortController();const deadline=nativeDeadline(parent.signal);parent.abort(new Error('cancelled'));expect(deadline.signal.reason.message).toBe('cancelled');deadline.dispose();expect(vi.getTimerCount()).toBe(0);
  });
});
