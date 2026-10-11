import { ApiError } from './errors.js';
import { OpenAIProvider } from './openai-provider.js';

/** Explicit administrator check: two bounded model requests, no tool execution. */
export async function probeOpenAIResponses(adapter: OpenAIProvider, modelId: string, reasoning: boolean) {
  const normal = await adapter.executeNative({model:modelId,input:'Reply OK.',stream:false,reasoning:{mode:'normal'},maxOutputTokens:64},modelId,AbortSignal.timeout(30000));
  if (normal.status !== 'completed' || !normal.output.some(item=>item.type==='message')) throw new ApiError(502,'PROTOCOL_INVALID','原生 Responses 普通文本检查未完成。');
  let eventCount=0;
  const tool = await adapter.executeNative({model:modelId,input:'Call bridge_probe exactly once with value 1. Do not execute anything.',stream:true,reasoning:{mode:reasoning?'thinking':'normal',...(reasoning?{effort:'low'}:{})},tools:[{type:'function',name:'bridge_probe',parameters:{type:'object',properties:{value:{type:'integer'}},required:['value'],additionalProperties:false}}],maxOutputTokens:512},modelId,AbortSignal.timeout(60000),async()=>{eventCount++;});
  if (tool.status!=='completed' || !eventCount || !tool.output.some(item=>item.type==='function_call'&&item.name==='bridge_probe')) throw new ApiError(502,'PROTOCOL_INVALID','原生 Responses 流式工具检查未完成。');
  if (reasoning && !tool.output.some(item=>item.type==='reasoning') && !(tool.reasoningTokens && tool.reasoningTokens>0)) throw new ApiError(422,'UNSUPPORTED_CAPABILITY','该检查未证明模型支持思考模式，请关闭思考检查或选择另一模型。');
  return {capabilities:{tools:true,streaming:true,vision:false,reasoning,reasoningModes:reasoning?['normal','thinking','auto']:['normal'],defaultReasoningMode:reasoning?'auto':'normal',responsesProfile:'openai',evidence:'openai-native-text-tool-probe'},inputTokens:normal.inputTokens+tool.inputTokens,outputTokens:normal.outputTokens+tool.outputTokens};
}
