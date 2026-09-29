import { describe, expect, it } from 'vitest';

process.env.DATABASE_URL ??= 'postgres://localhost/bridge_metering_test';
process.env.ACCESS_SECRET ??= 'a'.repeat(64);
process.env.REFRESH_TOKEN_PEPPER ??= 'b'.repeat(64);
process.env.PROVIDER_MASTER_KEY ??= 'c'.repeat(64);
process.env.PUBLIC_BASE_URL ??= 'http://localhost:3001';

const { evaluateMeteredUsage, hasObservedUpstreamTextDelta, interruptedStreamUsageUnavailable } = await import('./metering.js');
const rate = { inputRate: '10', outputRate: '20', cachedInputRate: '2', reasoningRate: '30',
  imageInputRate: '3', imageOutputRate: '4', toolRate: '1', minimumCharge: 1 };

describe('interrupted response metering', () => {
  it('flags an upstream delta after client disconnect even when it cannot be written', () => {
    let observed = hasObservedUpstreamTextDelta(false, '');
    expect(observed).toBe(false);
    const clientWritable = false;
    observed = hasObservedUpstreamTextDelta(observed, 'partial response');
    const written = clientWritable ? ['partial response'] : [];
    expect(written).toEqual([]);
    expect(interruptedStreamUsageUnavailable(observed, false)).toBe(true);
    expect(hasObservedUpstreamTextDelta(observed, '')).toBe(true);
    expect(interruptedStreamUsageUnavailable(false, false)).toBe(false);
    expect(interruptedStreamUsageUnavailable(true, true)).toBe(false);
  });
  it('does not rate missing usage as zero or debit-eligible even if partial counters were supplied', () => {
    const unknown = evaluateMeteredUsage({ usageUnavailable: true }, 'MANAGED_USAGE', rate, 'SHADOW');
    expect(unknown).toMatchObject({ billingStatus: 'METERING_ERROR', rated: 0, meteringError: true });
    const partial = evaluateMeteredUsage({ usageUnavailable: true, usage: { inputTokens: 1000 } }, 'MANAGED_USAGE', rate, 'SHADOW');
    expect(partial).toMatchObject({ billingStatus: 'METERING_ERROR', rated: 0, meteringError: true });
  });
  it('preserves empty failed and measured SHADOW request semantics', () => {
    expect(evaluateMeteredUsage({}, 'MANAGED_USAGE', rate, 'SHADOW')).toMatchObject({ billingStatus: 'NO_USAGE', rated: 0 });
    expect(evaluateMeteredUsage({ usage: { inputTokens: 1000 } }, 'MANAGED_USAGE', rate, 'SHADOW'))
      .toMatchObject({ billingStatus: 'SHADOW', rated: 10 });
  });
});
