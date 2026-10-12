import { db, modelInstances, providers, models } from '@bridge/db';
import { and, eq } from 'drizzle-orm';
import { randomInt } from 'node:crypto';
import { ApiError } from './errors.js';
import type { CanonicalRequest,CanonicalResult } from './provider.js';

export const currentDeepSeekModel = (id: string) => ['deepseek-flash', 'deepseek-v4-pro'].includes(id);
export type Candidate = { instance: typeof modelInstances.$inferSelect; provider: typeof providers.$inferSelect };
export type ResponsesProfile='deepseek'|'openai';
export function responsesProfile(code:string):ResponsesProfile|null {
  if(code==='DEEPSEEK'||/^DEEPSEEK_[A-F0-9]{12}$/.test(code))return 'deepseek';
  if(code==='OPENAI'||/^OPENAI_[A-F0-9]{12}$/.test(code))return 'openai';
  return null;
}
function resourceAvailable(candidate: Candidate, now = Date.now(),ignoreCooldown=false) {
  const { instance: i, provider: p } = candidate;
  const testMock=p.code==='MOCK'&&process.env.INTEGRATION_MOCK_ENABLED==='true';
  if(!testMock && (process.env.NATIVE_RESPONSES_ENABLED==='false'||!responsesProfile(p.code)||!i.nativeProtocols.includes('responses')))return false;
  if (!i.enabled || !p.enabled || !['READY', 'UNKNOWN','DEGRADED'].includes(i.healthStatus) || (!ignoreCooldown&&i.cooldownUntil && i.cooldownUntil.getTime() > now)) return false;
  // UNKNOWN is exclusively the migration legacy binding; new resources cannot be published without a check.
  if (i.healthStatus === 'UNKNOWN' && i.capabilities.legacy !== true) return false;
  return true;
}
function missingCapabilities(candidate:Candidate,request:CanonicalRequest){
  const caps=candidate.instance.capabilities,missing:string[]=[];
  if(request.tools?.length&&caps.tools!==true)missing.push('tools');
  if(request.stream&&caps.streaming!==true)missing.push('streaming');
  if(Array.isArray(request.input)&&request.input.some(item=>Array.isArray(item.content)&&item.content.some(part=>part&&typeof part==='object'&&part.type==='input_image'))&&caps.vision!==true)missing.push('vision');
  if((request.reasoning?.mode==='thinking'||(request.reasoning?.mode!=='normal'&&request.reasoning?.effort&&request.reasoning.effort!=='none'))&&caps.reasoning!==true)missing.push('thinking');
  return missing;
}
export function eligible(candidate:Candidate,request?:CanonicalRequest,now=Date.now()){
  return resourceAvailable(candidate,now)&&(request?missingCapabilities(candidate,request).length===0:candidate.instance.weight>0);
}
export function instanceHealthAfterFailure(code:string,now=Date.now()){
  code=code.toUpperCase();
  const auth=['PROVIDER_AUTH_REQUIRED','AUTHENTICATION_ERROR','INVALID_API_KEY','PROVIDER_BALANCE_EXHAUSTED','INSUFFICIENT_QUOTA'];
  const transient=['PROVIDER_UNAVAILABLE','PROVIDER_RATE_LIMITED','GATEWAY_TIMEOUT','SERVER_ERROR','INTERNAL_ERROR','RATE_LIMIT_EXCEEDED','SERVICE_UNAVAILABLE','OVERLOADED'];
  if(!auth.includes(code)&&!transient.includes(code))return null;
  return {healthStatus:auth.includes(code)?'UNAVAILABLE' as const:'DEGRADED' as const,healthCheckedAt:new Date(now),cooldownUntil:new Date(now+60000)};
}
export function instanceHealthAfterResult(result:CanonicalResult,now=Date.now()){
  if(result.status==='failed'){const error=result.nativeResponse?.error as {code?:unknown}|undefined;return typeof error?.code==='string'?instanceHealthAfterFailure(error.code,now):null;}
  return {healthStatus:'READY' as const,healthCheckedAt:new Date(now),cooldownUntil:null};
}
export function chooseInstance(candidates: Candidate[], request: CanonicalRequest, pinnedId?: string | null, draw = (max: number) => randomInt(max)) {
  const usable = candidates.filter(c => eligible(c, request));
  if(new Set(candidates.filter(c=>eligible(c)).map(c=>responsesProfile(c.provider.code)).filter(Boolean)).size>1)throw new ApiError(422,'UNSUPPORTED_PROTOCOL','同一逻辑模型的资源必须使用相同 Responses 协议配置。');
  if (pinnedId) {
    const pinned = candidates.find(c => c.instance.id === pinnedId);
    if(!pinned||!resourceAvailable(pinned,Date.now(),true))throw new ApiError(409,'MODEL_UNAVAILABLE','会话绑定的资源已停用或不可用，请新建会话。');
    if(pinned?.instance.cooldownUntil&&pinned.instance.cooldownUntil.getTime()>Date.now())throw new ApiError(503,'MODEL_UNAVAILABLE','会话绑定的模型资源暂时冷却，请稍后重试当前会话。');
    const missing=missingCapabilities(pinned,request);if(missing.length)throw new ApiError(422,'UNSUPPORTED_CAPABILITY',`会话绑定的资源不支持请求能力：${missing.join(', ')}。`);
    return pinned;
  }
  const available = usable.filter(c=>c.instance.weight > 0);
  if (!available.length) {
    const ready=candidates.filter(c=>eligible(c));
    if(ready.length)throw new ApiError(422,'UNSUPPORTED_CAPABILITY',`可用模型资源不支持请求能力：${[...new Set(ready.flatMap(c=>missingCapabilities(c,request)))].join(', ')}。`);
    throw new ApiError(503, 'MODEL_UNAVAILABLE', '该模型资源暂时不可用或正在冷却，请稍后重试。');
  }
  const native = available.filter(c => c.instance.nativeProtocols.includes('responses'));
  const pool = native.length ? native : available;
  const priority = Math.max(...pool.map(c => c.instance.priority));
  const group = pool.filter(c => c.instance.priority === priority);
  const total = group.reduce((sum, c) => sum + Math.max(1, c.instance.weight), 0);
  let point = draw(total);
  return group.find(c => (point -= Math.max(1, c.instance.weight)) < 0)!;
}
export async function modelCandidates(modelId: string) {
  return db.select({ instance: modelInstances, provider: providers }).from(modelInstances).innerJoin(providers, eq(modelInstances.providerId, providers.id)).where(eq(modelInstances.modelId, modelId));
}
export async function ensureLegacyInstance(model: typeof models.$inferSelect) {
  await db.insert(modelInstances).values({ modelId: model.id, providerId: model.providerId, providerModelId: model.providerModelId,
    enabled: true, capabilities: { legacy: true, tools: model.supportsTools, vision: model.supportsVision, reasoning: model.supportsReasoning, streaming: model.supportsStreaming },
    nativeProtocols: ['chat_completions'], healthStatus: 'UNKNOWN' }).onConflictDoNothing();
}
export function logicalCapabilities(candidates: Candidate[]) {
  candidates=candidates.filter(c=>eligible(c));
  const profiles=[...new Set(candidates.map(c=>responsesProfile(c.provider.code)).filter((p):p is ResponsesProfile=>p!==null))];
  const reasoning = candidates.some(c=>c.instance.capabilities.reasoning===true);
  return { tools:candidates.some(c=>c.instance.capabilities.tools===true), vision:candidates.some(c=>c.instance.capabilities.vision===true), reasoning,
    streaming:candidates.some(c=>c.instance.capabilities.streaming===true), nativeResponses:profiles.length===1,
    ...(profiles.length===1?{responsesProfile:profiles[0]}:{}),
    reasoningModes:reasoning?[...new Set(candidates.flatMap(c=>Array.isArray(c.instance.capabilities.reasoningModes)?c.instance.capabilities.reasoningModes as string[]:['normal','thinking','auto']))]:['normal'], defaultReasoningMode:reasoning?'auto':'normal' };
}

/** Selection is separate from readiness: a configured GPT can be selected before payment. */
export function catalogPresentation(candidates:Candidate[]) {
  const ready=candidates.filter(c=>eligible(c));
  if(ready.length)return {availability:'READY' as const,statusMessage:'可用',capabilities:logicalCapabilities(ready)};
  const configured=candidates.filter(c=>responsesProfile(c.provider.code)==='openai'&&c.provider.config.catalogConfigured===true);
  const declared=configured[0]?.instance.capabilities;
  const pending=configured.some(c=>c.instance.capabilities.generationVerified!==true);
  return {availability:pending?'SETUP_REQUIRED' as const:'UNAVAILABLE' as const,
    statusMessage:pending?'已配置；需管理员完成 API 充值、连接验证和启用后使用。':'模型暂不可用，请联系管理员。',
    capabilities:declared?{tools:declared.tools===true,vision:declared.vision===true,reasoning:declared.reasoning===true,streaming:declared.streaming===true,nativeResponses:true,responsesProfile:'openai' as const,reasoningModes:declared.reasoningModes as string[]??['normal'],defaultReasoningMode:declared.defaultReasoningMode as string??'normal'}:logicalCapabilities([])};
}
