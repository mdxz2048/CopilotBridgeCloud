import {describe,it,expect} from 'vitest';
import {estimatedGateAI61Cost} from './gateai-cost-reference.js';
import {beginCostObservation} from './cost-observation.js';
import {OpenAIProvider} from './openai-provider.js';

describe('GateAI operator-supplied GPT-6.1 cost reference',()=>{
  it('prices cache reads/writes and uncached input as disjoint subsets',()=>{
    const result=estimatedGateAI61Cost({inputTokens:1000,cachedInputTokens:400,outputTokens:100,providerReportedUsage:{input_tokens_details:{cache_write_tokens:100}}})!;
    expect(result.estimatedCostRmb).toBe(.000229);
    expect(result.rateSnapshot).toMatchObject({supplierDiscount:.1,perMillion:{input:.2,cached:.01,cacheWrite:.25,output:1},cacheWriteTokens:100,cacheWriteUsageReported:true,source:'USER_PROVIDED_GATEAI_PRICE_CARD'});
  });
  it('applies the strictly greater than 272K tier to input and output only',()=>{
    expect(estimatedGateAI61Cost({inputTokens:272000,outputTokens:1})?.estimatedCostRmb).toBe(.054401);
    const extended=estimatedGateAI61Cost({inputTokens:272001,outputTokens:1})!;
    expect(extended.estimatedCostRmb).toBe(.1088019);
    expect(extended.rateSnapshot).toMatchObject({period:'over272K',perMillion:{input:.4,cached:.01,cacheWrite:.25,output:1.5},extendedCacheRatesAssumedUnchanged:true});
  });
  it('records missing cache-write usage as an estimate assumption, rather than a measured zero',()=>{
    const result=estimatedGateAI61Cost({inputTokens:1000,cachedInputTokens:400,outputTokens:100})!;
    expect(result.estimatedCostRmb).toBe(.000224);
    expect(result.rateSnapshot.cacheWriteUsageReported).toBe(false);
    expect(result.rateSnapshot.referenceCurrency).toBe('CNY');
    expect(result.rateSnapshot).not.toHaveProperty('usdCny');
    expect(result.rateSnapshot.cacheWriteAssumption).toBe('UNREPORTED_WRITES_INCLUDED_AT_ORDINARY_INPUT_RATE');
  });
  it('keeps invalid or unavailable usage unknown',()=>{
    for(const result of [{inputTokens:-1,outputTokens:1},{inputTokens:1,cachedInputTokens:2,outputTokens:1},{inputTokens:2,cachedInputTokens:1,outputTokens:0,providerReportedUsage:{input_tokens_details:{cache_write_tokens:2}}},{inputTokens:1,outputTokens:1,usageUnavailable:true}])expect(estimatedGateAI61Cost(result)).toBeNull();
  });
  it('isolates estimates to GateAI GPT-6.1 and keeps reported supplier costs preferred',async()=>{
    const gateai=new OpenAIProvider('https://gateai.cc/v1','fixture',1000),official=new OpenAIProvider('https://api.openai.com/v1','fixture',1000);
    const usage={inputTokens:1000,outputTokens:100,costKind:'UNKNOWN' as const,output:[]};
    const observation=await beginCostObservation(gateai,'gpt-6.1-sol',false);
    expect(await observation.finish(usage)).toMatchObject({costSource:'USER_PROVIDED_RATE_ESTIMATE',estimatedCostRmb:.0003});
    expect(await (await beginCostObservation(official,'gpt-6.1-sol',false)).finish(usage)).toMatchObject({costSource:'UNKNOWN',estimatedCostRmb:null});
    expect(await (await beginCostObservation(gateai,'gpt-6-sol',false)).finish(usage)).toMatchObject({costSource:'UNKNOWN',estimatedCostRmb:null});
    expect(await observation.finish({...usage,providerCost:.1,providerCurrency:'USD'})).toMatchObject({costSource:'UPSTREAM_REPORTED',reportedCostRmb:.7});
  });
});
