import { db, modelInstances, providers, models } from '@bridge/db';
import { and, eq } from 'drizzle-orm';
import { randomInt } from 'node:crypto';
import { ApiError } from './errors.js';
import type { CanonicalRequest } from './provider.js';

export const currentDeepSeekModel = (id: string) => ['deepseek-flash', 'deepseek-v4-pro'].includes(id);
export type Candidate = { instance: typeof modelInstances.$inferSelect; provider: typeof providers.$inferSelect };
export type ResponsesProfile='deepseek'|'openai';
export function responsesProfile(code:string):ResponsesProfile|null {
  if(code==='DEEPSEEK'||/^DEEPSEEK_[A-F0-9]{12}$/.test(code))return 'deepseek';
  if(code==='OPENAI'||/^OPENAI_[A-F0-9]{12}$/.test(code))return 'openai';
  return null;
}
export function eligible(candidate: Candidate, request?: CanonicalRequest, now = Date.now()) {
  const { instance: i, provider: p } = candidate;
  const testMock=p.code==='MOCK'&&process.env.INTEGRATION_MOCK_ENABLED==='true';
  if(!testMock && (process.env.NATIVE_RESPONSES_ENABLED==='false'||!responsesProfile(p.code)||!i.nativeProtocols.includes('responses')))return false;
  if(!request && i.weight===0)return false;
  if (!i.enabled || !p.enabled || !['READY', 'UNKNOWN','DEGRADED'].includes(i.healthStatus) || (i.cooldownUntil && i.cooldownUntil.getTime() > now)) return false;
  // UNKNOWN is exclusively the migration legacy binding; new resources cannot be published without a check.
  if (i.healthStatus === 'UNKNOWN' && i.capabilities.legacy !== true) return false;
  if (!request) return true;
  if (request.tools?.length && i.capabilities.tools !== true) return false;
  if (request.stream && i.capabilities.streaming !== true) return false;
  if (Array.isArray(request.input) && JSON.stringify(request.input).includes('"input_image"') && i.capabilities.vision !== true) return false;
  if ((request.reasoning?.mode === 'thinking' || (request.reasoning?.mode!=='normal' && request.reasoning?.effort && request.reasoning.effort !== 'none')) && i.capabilities.reasoning !== true) return false;
  return true;
}
export function chooseInstance(candidates: Candidate[], request: CanonicalRequest, pinnedId?: string | null, draw = (max: number) => randomInt(max)) {
  const usable = candidates.filter(c => eligible(c, request));
  if(new Set(candidates.filter(c=>eligible(c)).map(c=>responsesProfile(c.provider.code)).filter(Boolean)).size>1)throw new ApiError(422,'UNSUPPORTED_PROTOCOL','同一逻辑模型的资源必须使用相同 Responses 协议配置。');
  if (pinnedId) {
    const pinned = usable.find(c => c.instance.id === pinnedId);
    if (!pinned) throw new ApiError(409, 'MODEL_UNAVAILABLE', '会话绑定的资源已停用或不支持该请求，请新建会话。');
    return pinned;
  }
  const available = usable.filter(c=>c.instance.weight > 0);
  if (!available.length) throw new ApiError(503, 'MODEL_UNAVAILABLE', '该模型没有满足请求能力的可用资源。');
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
    reasoningModes:reasoning?['normal','thinking','auto']:['normal'], defaultReasoningMode:reasoning?'auto':'normal' };
}
