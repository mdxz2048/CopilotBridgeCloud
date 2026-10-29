import type {CanonicalResult} from './provider.js';

// Operator-supplied GateAI price card dated 2026-10-29; estimates, not receipts.
// USD per million tokens, fixed USD/CNY 7 and the operator's GateAI discount 0.1.
export function estimatedGateAI61Cost(result:Pick<CanonicalResult,'inputTokens'|'cachedInputTokens'|'outputTokens'|'providerReportedUsage'|'usageUnavailable'>) {
  if(result.usageUnavailable)return null;
  const input=result.inputTokens,cached=result.cachedInputTokens??0,output=result.outputTokens;
  const details=result.providerReportedUsage?.input_tokens_details as Record<string,unknown>|undefined;
  const reportedWrite=details?.cache_write_tokens;
  const write=reportedWrite===undefined?0:reportedWrite;
  if(![input,cached,output,write].every(n=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0)||cached+(write as number)>input)return null;
  const extended=input>272000;
  const usd={input:extended?4:2,cached:.1,cacheWrite:2.5,output:extended?15:10};
  const cny=(n:number)=>Number((n*7*.1).toFixed(8));
  const perMillion={input:cny(usd.input),cached:cny(usd.cached),cacheWrite:cny(usd.cacheWrite),output:cny(usd.output)};
  const estimatedCostRmb=Number((((input-cached-(write as number))*perMillion.input+cached*perMillion.cached+(write as number)*perMillion.cacheWrite+output*perMillion.output)/1_000_000).toFixed(8));
  return {estimatedCostRmb,rateSnapshot:{currency:'CNY',perMillion,usdPerMillion:usd,usdCny:7,supplierDiscount:.1,period:extended?'over272K':'standard',
    source:'USER_PROVIDED_GATEAI_PRICE_CARD',referenceDate:'2026-10-29',model:'gpt-6.1-sol',thresholdInputTokens:272000,
    cacheWriteTokens:write,cacheWriteUsageReported:reportedWrite!==undefined,
    cacheWriteAssumption:reportedWrite===undefined?'UNREPORTED_WRITES_INCLUDED_AT_ORDINARY_INPUT_RATE':null,
    extendedCacheRatesAssumedUnchanged:extended}};
}
