import {describe,it,expect} from 'vitest';
import {defaultMoneyPolicy,isPeak,ratesFor,MoneyPolicySchema} from './money-pricing.js';
import {ratePoints} from './rating.js';
describe('RMB pricing snapshots',()=>{
  it('rejects free or below-cost price cards and enforces funded use by default',()=>{
    expect(MoneyPolicySchema.parse(defaultMoneyPolicy).enforceManaged).toBe(true);
    const low=structuredClone(defaultMoneyPolicy);low.prices['deepseek-flash'].offPeak.output=3;
    expect(MoneyPolicySchema.safeParse(low).success).toBe(false);
  });
  it('uses Beijing workday boundaries and explicit holidays',()=>{
    expect(isPeak(new Date('2026-10-09T01:00:00Z'),[])).toBe(true);
    expect(isPeak(new Date('2026-10-09T04:00:00Z'),[])).toBe(false);
    expect(isPeak(new Date('2026-10-10T02:00:00Z'),[])).toBe(false);
    expect(isPeak(new Date('2026-10-09T02:00:00Z'),['2026-10-09'])).toBe(false);
  });
  it('rates input, cache and output independently at 10000 points per RMB',()=>{
    const rates=ratesFor('deepseek-flash',defaultMoneyPolicy,new Date('2026-10-10T02:00:00Z'));
    expect(ratePoints('MANAGED_USAGE',{inputTokens:1000000,outputTokens:1000000,cachedInputTokens:500000},rates)).toBe(45100);
    expect(ratePoints('MANAGED_USAGE',{inputTokens:1},rates)).toBe(1);
  });
  it('applies configured markup and refuses unpriced models',()=>{
    expect(ratesFor('deepseek-v4-pro',{...defaultMoneyPolicy,markup:1.2},new Date('2026-10-09T02:00:00Z')).outputRate).toBe('324.000000');
    expect(()=>ratesFor('unknown',defaultMoneyPolicy)).toThrow('RATE_CARD_UNAVAILABLE');
  });
});
