import { ApiError } from './errors.js';
import { OpenAIProvider } from './openai-provider.js';
import { deflateSync } from 'node:zlib';

// Synthetic fixture only: never replay a customer's image during health checks.
function redSquare() {
  const crc=(bytes:Buffer)=>{let n=0xffffffff;for(const v of bytes){n^=v;for(let k=0;k<8;k++)n=(n>>>1)^((n&1)?0xedb88320:0);}return(n^0xffffffff)>>>0;};
  const chunk=(type:string,data:Buffer)=>{const tag=Buffer.from(type),size=Buffer.alloc(4),checksum=Buffer.alloc(4);size.writeUInt32BE(data.length);checksum.writeUInt32BE(crc(Buffer.concat([tag,data])));return Buffer.concat([size,tag,data,checksum]);};
  const header=Buffer.alloc(13);header.writeUInt32BE(128);header.writeUInt32BE(128,4);header[8]=8;header[9]=2;
  const pixels=Buffer.alloc(128*(1+128*3));for(let y=0;y<128;y++)for(let x=0;x<128;x++)pixels[y*(1+128*3)+1+x*3]=255;
  return 'data:image/png;base64,'+Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]).toString('base64');
}

/** Explicit administrator check: bounded text, tool and synthetic vision requests. */
export async function probeOpenAIResponses(adapter: OpenAIProvider, modelId: string, reasoning: boolean) {
  const normal = await adapter.executeNative({model:modelId,input:'Reply OK.',stream:false,reasoning:{mode:reasoning?'auto':'normal',...(reasoning?{effort:'low'}:{})},maxOutputTokens:reasoning?512:64},modelId,AbortSignal.timeout(30000));
  if (normal.status !== 'completed' || !normal.output.some(item=>item.type==='message')) throw new ApiError(502,'PROTOCOL_INVALID','原生 Responses 普通文本检查未完成。');
  let eventCount=0;
  const tool = await adapter.executeNative({model:modelId,input:'Call bridge_probe exactly once with value 1. Do not execute anything.',stream:true,reasoning:{mode:reasoning?'thinking':'normal',...(reasoning?{effort:'low'}:{})},tools:[{type:'function',name:'bridge_probe',parameters:{type:'object',properties:{value:{type:'integer'}},required:['value'],additionalProperties:false}}],maxOutputTokens:512},modelId,AbortSignal.timeout(60000),async()=>{eventCount++;});
  if (tool.status!=='completed' || !eventCount || !tool.output.some(item=>item.type==='function_call'&&item.name==='bridge_probe')) throw new ApiError(502,'PROTOCOL_INVALID','原生 Responses 流式工具检查未完成。');
  if (reasoning && !tool.output.some(item=>item.type==='reasoning') && !(tool.reasoningTokens && tool.reasoningTokens>0)) throw new ApiError(422,'UNSUPPORTED_CAPABILITY','该检查未证明模型支持思考模式，请关闭思考检查或选择另一模型。');
  let vision=false,visionInput=0,visionOutput=0,visionProbe='unverified';
  try{
    const image=await adapter.executeNative({model:modelId,input:[{role:'user',content:[{type:'input_text',text:'What is the color of this square? Reply with only the English color name.'},{type:'input_image',image_url:redSquare(),detail:'high'}]}],stream:false,reasoning:{mode:'normal'},maxOutputTokens:64},modelId,AbortSignal.timeout(30000));
    visionInput=image.inputTokens;visionOutput=image.outputTokens;
    const text=image.output.flatMap(item=>Array.isArray(item.content)?item.content:[]).map(part=>typeof part.text==='string'?part.text:'').join('');
    vision=image.status==='completed'&&/\bred\b/i.test(text);visionProbe=vision?'passed':'unverified';
  }catch{visionProbe='unverified';} // A failed optional image check cannot disable text-only models.
  return {capabilities:{tools:true,streaming:true,vision,visionProbe,reasoning,reasoningModes:reasoning?['normal','thinking','auto']:['normal'],defaultReasoningMode:reasoning?'auto':'normal',responsesProfile:'openai',evidence:'openai-native-capability-probe'},inputTokens:normal.inputTokens+tool.inputTokens+visionInput,outputTokens:normal.outputTokens+tool.outputTokens+visionOutput};
}
