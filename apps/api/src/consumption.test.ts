import {describe,it,expect} from 'vitest';
import {exactConsumptionBreakdown} from './consumption-breakdown.js';
const usage={inputTokens:1000,cachedInputTokens:200,outputTokens:500,reasoningTokens:100,imageInput:0,imageOutput:0,toolCalls:0};
const rates={inputRate:'10',cachedInputRate:'5',outputRate:'30',reasoningRate:'40',imageInputRate:'0',imageOutputRate:'0',toolRate:'0',minimumCharge:0};
describe('Consumption monetary explanation',()=>{
  it('does not double-count cache or reasoning',()=>{expect(exactConsumptionBreakdown(usage,rates,25,'SETTLED')).toEqual({inputPoints:9,outputPoints:16});});
  it('withholds portions for rounding, minimums, partial debits and image/tool pricing',()=>{
    expect(exactConsumptionBreakdown({...usage,inputTokens:1001},rates,26,'SETTLED')).toBeNull();
    expect(exactConsumptionBreakdown(usage,{...rates,minimumCharge:30},30,'SETTLED')).toBeNull();
    expect(exactConsumptionBreakdown(usage,rates,3,'UNPAID')).toBeNull();
    expect(exactConsumptionBreakdown({...usage,toolCalls:1},rates,25,'SETTLED')).toBeNull();
    expect(exactConsumptionBreakdown(usage,rates,0,'SHADOW')).toBeNull();
  });
});
