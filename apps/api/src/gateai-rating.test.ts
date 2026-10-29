import {describe,it,expect} from 'vitest';
import {rateGateAI61Points} from './gateai-rating.js';
import {ratePoints,type PointRates} from './rating.js';
const rates:PointRates={inputRate:'2.6',cachedInputRate:'0.13',outputRate:'13',reasoningRate:'13',toolRate:'0',imageInputRate:'0',imageOutputRate:'0',minimumCharge:0};
describe('GateAI 0.13 user pricing from frozen standard rates',()=>{
  it('separates reads and writes, preserving the 30 percent cost markup before final point rounding',()=>{
    const usage={inputTokens:100000,cachedInputTokens:40000,outputTokens:10000,reasoningTokens:5000};
    expect(rateGateAI61Points(usage,rates,10000)).toBe(298);
    expect(rateGateAI61Points(usage,rates,0)).toBe(ratePoints('MANAGED_USAGE',usage,rates));
  });
  it('uses the strict 272K boundary and both tier multipliers',()=>{
    expect(rateGateAI61Points({inputTokens:272000,outputTokens:1},rates)).toBe(708);
    expect(rateGateAI61Points({inputTokens:272001,outputTokens:1},rates)).toBe(1415);
    const oldSnapshot={...rates,inputRate:'28',cachedInputRate:'1.4',outputRate:'140',reasoningRate:'140'};
    expect(rateGateAI61Points({inputTokens:272001,outputTokens:1},oldSnapshot)).toBe(15233);
  });
  it('rejects invalid write counters and retains final rounding and minimum semantics',()=>{
    for(const write of [-1,1.5,11,'1'])expect(()=>rateGateAI61Points({inputTokens:10},rates,write)).toThrow('INVALID_PROVIDER_USAGE');
    expect(rateGateAI61Points({inputTokens:1},rates)).toBe(1);
    expect(rateGateAI61Points({inputTokens:1},{...rates,minimumCharge:5})).toBe(5);
  });
});
