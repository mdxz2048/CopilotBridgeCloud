import { describe, expect, it } from 'vitest';
import { CopilotFailure, mapCopilotFailure, summarizeCopilotUsage } from './copilot-provider.js';

describe('Copilot provider metering', () => {
  it('sums only reported counters across model calls', () => {
    expect(summarizeCopilotUsage([
      { model: 'gpt-5.4-mini', inputTokens: 3000, outputTokens: 40, cacheReadTokens: 1000, reasoningTokens: 10 },
      { model: 'gpt-5.4-mini', inputTokens: 100, outputTokens: 20 },
    ])).toEqual({ inputTokens: 3100, outputTokens: 60, cachedInputTokens: 1000, reasoningTokens: 10 });
  });
  it('rejects absent or inconsistent token usage without estimating from text', () => {
    expect(() => summarizeCopilotUsage([])).toThrowError(new CopilotFailure(503, 'COPILOT_USAGE_UNAVAILABLE'));
    expect(() => summarizeCopilotUsage([{ model: 'x', inputTokens: 10 }])).toThrowError('COPILOT_USAGE_UNAVAILABLE');
    expect(() => summarizeCopilotUsage([{ model: 'x', inputTokens: 1, outputTokens: 1, cacheReadTokens: 2 }])).toThrowError('COPILOT_USAGE_UNAVAILABLE');
  });
});

describe('Copilot stable error mapping', () => {
  it.each([
    ['401 unauthorized secret=do-not-leak', 'COPILOT_AUTH_EXPIRED', 401],
    ['403 Copilot subscription required', 'COPILOT_NOT_ENTITLED', 403],
    ['429 too many requests', 'RATE_LIMITED', 429],
    ['upstream HTTP 502 private-detail', 'PROVIDER_UNAVAILABLE', 503],
    ['deadline exceeded private-detail', 'GATEWAY_TIMEOUT', 504],
  ] as const)('maps %s', (raw, code, status) => {
    const mapped = mapCopilotFailure(new Error(raw));
    expect(mapped.code).toBe(code);
    expect(mapped.status).toBe(status);
    expect(mapped.message).toBe(code);
    expect(mapped.message).not.toContain('private-detail');
  });
  it('maps abortion and preserves typed missing credential', () => {
    expect(mapCopilotFailure(new Error('anything'), true).code).toBe('GATEWAY_TIMEOUT');
    expect(mapCopilotFailure(new CopilotFailure(503, 'PROVIDER_AUTH_REQUIRED')).code).toBe('PROVIDER_AUTH_REQUIRED');
  });
});
