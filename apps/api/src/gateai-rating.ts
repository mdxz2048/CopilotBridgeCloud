import {normalizeUsage,type PointRates,type NormalizedUsage} from './rating.js';

/** GateAI-only adjustments to an immutable standard rate-card snapshot. */
export function rateGateAI61Points(raw:Partial<NormalizedUsage>,rates:PointRates,write:unknown=0) {
  const u=normalizeUsage(raw);
  if(typeof write!=='number'||!Number.isSafeInteger(write)||write<0||write>u.inputTokens-u.cachedInputTokens)throw new Error('INVALID_PROVIDER_USAGE');
  const micros=(rate:string)=>{
    if(!/^\d+(?:\.\d{1,6})?$/.test(rate))throw new Error('INVALID_RATE');
    const [a,b='']=rate.split('.');return BigInt(a)*1000000n+BigInt(b.padEnd(6,'0'));
  };
  const extended=u.inputTokens>272000;
  // Quarter-token weights preserve exact 1.25x writes, 2x long input and 1.5x
  // long output without rounding components or counting cache/reasoning twice.
  const inputWeight=BigInt(u.inputTokens-u.cachedInputTokens-write)*(extended?8n:4n)+BigInt(write)*5n;
  const outputWeight=extended?6n:4n;
  const tokens=inputWeight*micros(rates.inputRate)+BigInt(u.cachedInputTokens)*4n*micros(rates.cachedInputRate)
    +BigInt(u.outputTokens-u.reasoningTokens)*outputWeight*micros(rates.outputRate)+BigInt(u.reasoningTokens)*outputWeight*micros(rates.reasoningRate);
  const items=BigInt(u.imageInput)*micros(rates.imageInputRate)+BigInt(u.imageOutput)*micros(rates.imageOutputRate)+BigInt(u.toolCalls)*micros(rates.toolRate);
  const rounded=(tokens+items*4000n+3999999999n)/4000000000n;
  const points=rounded>BigInt(rates.minimumCharge)?rounded:BigInt(rates.minimumCharge);
  if(points>2147483647n)throw new Error('RATE_OVERFLOW');return Number(points);
}
