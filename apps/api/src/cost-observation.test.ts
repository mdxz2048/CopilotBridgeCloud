import {describe,it,expect} from 'vitest';
import {balanceWindow,beginCostObservation,estimatedDeepSeekCost} from './cost-observation.js';
import type {ProviderAdapter} from './provider.js';

describe('supplier cost observations',()=>{
 it('counts cached input and reasoning output once and preserves sub-cent cost',()=>{
  expect(estimatedDeepSeekCost({inputTokens:1000,cachedInputTokens:400,outputTokens:100},{input:1,cached:.02,output:4})).toBe(.001008);
  expect(estimatedDeepSeekCost({inputTokens:1,cachedInputTokens:2,outputTokens:1},{input:1,cached:.02,output:4})).toBeNull();
 });
 it('retains signed account changes rather than calling top-ups negative request cost',()=>{
  const b=(total:string)=>({checkedAt:'2026-10-14T00:00:00Z',balances:[{currency:'CNY',total}]});
  expect(balanceWindow(b('1'),b('.9'))).toEqual([{currency:'CNY',netDecrease:.1}]);
  expect(balanceWindow(b('1'),b('2'))).toEqual([{currency:'CNY',netDecrease:-1}]);
  expect(balanceWindow(b('1'),null)).toEqual([]);
 });
 it('unsupported balance endpoints and missing vendor prices stay unknown',async()=>{
  const observation=await beginCostObservation({} as ProviderAdapter,'gpt-6-sol',false);
  expect(await observation.finish()).toMatchObject({costSource:'UNKNOWN',estimatedCostRmb:null,reportedCostRmb:null,balanceStatus:'UNAVAILABLE',balanceScope:'UPSTREAM_ACCOUNT_WINDOW_NOT_REQUEST'});
 });
});
