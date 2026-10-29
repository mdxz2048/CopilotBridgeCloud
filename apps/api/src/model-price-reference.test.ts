import {describe,it,expect} from 'vitest';
import {defaultMoneyPolicy} from './money-pricing.js';
import {modelPriceReference,referenceRates,ModelMarkupSchema} from './model-price-reference.js';
import {ratePoints} from './rating.js';
describe('per-model multiplier pricing',()=>{
 it('applies a multiplier to all DeepSeek price components with peak and holiday boundaries',()=>{
  const ref=modelPriceReference('deepseek','deepseek-flash',defaultMoneyPolicy.prices)!;
  const peak=referenceRates(ref,1.1,[],new Date('2026-10-15T02:00:00Z'));
  expect(peak).toMatchObject({inputRate:'22.000000',cachedInputRate:'0.440000',outputRate:'88.000000'});
  const holiday=referenceRates(ref,1.1,['2026-10-15'],new Date('2026-10-15T02:00:00Z'));
  expect(holiday.inputRate).toBe('11.000000');
  expect(ratePoints('MANAGED_USAGE',{inputTokens:1000000,cachedInputTokens:500000,outputTokens:1000000},holiday)).toBe(49610);
 });
 it('keeps operator-provided GPT prices distinct from verified supplier costs',()=>{
  const ref=modelPriceReference('openai','gpt-6-sol',defaultMoneyPolicy.prices)!;
  expect(ref.source).toBe('USER_PROVIDED_REFERENCE');expect(ref.periods[0].prices).toEqual({input:14,cached:.7,output:70});
  expect(referenceRates(ref,1.1,[])).toMatchObject({inputRate:'154.000000',cachedInputRate:'7.700000',outputRate:'770.000000'});
  expect(modelPriceReference('openai','unknown',defaultMoneyPolicy.prices)).toBeNull();
 });
 it('supports deliberate subsidies but rejects zero, nonfinite and excessive multipliers',()=>{
  expect(ModelMarkupSchema.safeParse({multiplier:.8,revision:0}).success).toBe(true);
  for(const multiplier of [0,-1,NaN,Infinity,101])expect(ModelMarkupSchema.safeParse({multiplier,revision:0}).success).toBe(false);
 });
 it('supports the confirmed 0.13 user markup for GPT-6.1 standard prices',()=>{
  const ref=modelPriceReference('openai','gpt-6.1-sol',defaultMoneyPolicy.prices)!;
  expect(ref.source).toBe('USER_PROVIDED_REFERENCE');
  expect(referenceRates(ref,.13,[])).toMatchObject({inputRate:'2.600000',cachedInputRate:'0.130000',outputRate:'13.000000'});
 });
 it('labels custom references and never mutates source prices across models',()=>{
  const prices=structuredClone(defaultMoneyPolicy.prices);prices['deepseek-flash'].peak.input=3;
  expect(modelPriceReference('deepseek','deepseek-flash',prices)?.source).toBe('CONFIGURED_REFERENCE');
  expect(defaultMoneyPolicy.prices['deepseek-flash'].peak.input).toBe(2);
 });
});
