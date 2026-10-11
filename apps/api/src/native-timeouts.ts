import { ApiError } from './errors.js';
export class NativeTimeoutError extends ApiError {
  constructor(readonly phase:'connect'|'idle'|'total'){
    super(504,'GATEWAY_TIMEOUT',phase==='connect'?'连接上游模型超时，请稍后重试。':phase==='idle'?'上游模型长时间没有内容或工具进展，本次请求已超时。':'本次模型生成超过十分钟总时限，请缩小任务后重试。');
  }
}

/** Bound generation without treating a long, active document stream as stalled. */
export function nativeDeadline(parent:AbortSignal,providerTimeoutMs=60000){
  const controller=new AbortController();
  const connectMs=Math.min(120000,Math.max(10000,providerTimeoutMs));
  const idleMs=Math.min(180000,Math.max(120000,providerTimeoutMs));
  const totalMs=600000;
  let connection:ReturnType<typeof setTimeout>|undefined,idle:ReturnType<typeof setTimeout>|undefined,total:ReturnType<typeof setTimeout>|undefined;
  const abort=(phase:'connect'|'idle'|'total')=>controller.abort(new NativeTimeoutError(phase));
  const inherited=()=>controller.abort(parent.reason);
  if(parent.aborted)inherited();else parent.addEventListener('abort',inherited,{once:true});
  connection=setTimeout(()=>abort('connect'),connectMs);total=setTimeout(()=>abort('total'),totalMs);
  const progress=()=>{if(controller.signal.aborted)return;clearTimeout(idle);idle=setTimeout(()=>abort('idle'),idleMs);};
  return {signal:controller.signal,connectMs,idleMs,totalMs,headersReceived(){clearTimeout(connection);progress();},progress,
    dispose(){clearTimeout(connection);clearTimeout(idle);clearTimeout(total);parent.removeEventListener('abort',inherited);}};
}
export function nativeEventProgress(type:string,event:Record<string,unknown>){
  if(['response.completed','response.incomplete','response.failed'].includes(type))return true;
  if(type.endsWith('.delta'))return typeof event.delta==='string'&&event.delta.length>0;
  return /^response\.(?:output_item|content_part|output_text|reasoning_text|function_call_arguments|custom_tool_call_input)\.(?:added|done)$/.test(type);
}
