import { describe, expect, it } from 'vitest';
import { normalizeUsage, ratePoints, type PointRates } from './rating.js';

const rates: PointRates = { inputRate: '10.000000', outputRate: '20.000000', cachedInputRate: '2.000000', reasoningRate: '30.000000', imageInputRate: '3.000000', imageOutputRate: '4.000000', toolRate: '1.000000', minimumCharge: 0 };
describe('versioned rating arithmetic', () => {
  it('uses cached and reasoning subsets once, rounding up at the end', () => {
    expect(ratePoints('MANAGED_USAGE', { inputTokens: 1000, cachedInputTokens: 500, outputTokens: 1000, reasoningTokens: 500 }, rates)).toBe(31);
    expect(ratePoints('MANAGED_USAGE', { inputTokens: 1 }, rates)).toBe(1);
    expect(ratePoints('BYOS_USAGE', { toolCalls: 2 }, rates)).toBe(2);
  });
  it('keeps local usage free and enforces a configured minimum', () => {
    expect(ratePoints('LOCAL_USAGE', { inputTokens: 100000 })).toBe(0);
    expect(ratePoints('MANAGED_USAGE', { inputTokens: 1 }, { ...rates, minimumCharge: 5 })).toBe(5);
  });
  it('rejects malformed provider counters and prices', () => {
    expect(() => normalizeUsage({ inputTokens: 1, cachedInputTokens: 2 })).toThrow('INVALID_PROVIDER_USAGE');
    expect(() => ratePoints('MANAGED_USAGE', { inputTokens: 1 }, { ...rates, inputRate: '-1' })).toThrow('INVALID_RATE');
  });
});
