import { describe, expect, it } from 'vitest';
import { integrationMockAllowed, modelAllowed, nextPeriod, subscriptionActive, usageCredit, usageState } from './logic.js';

describe('domain rules', () => {
  it('denial wins and disabled models stay hidden', () => {
    expect(modelAllowed(true, true, 'DENY')).toBe(false);
    expect(modelAllowed(true, false, 'ALLOW')).toBe(true);
    expect(modelAllowed(false, true, 'ALLOW')).toBe(false);
  });
  it('never exposes the production Mock model outside its named integration account', () => {
    expect(integrationMockAllowed('MOCK', 'other@example.test', true, 'production-integration@example.test')).toBe(false);
    expect(integrationMockAllowed('MOCK', 'production-integration@example.test', false, 'production-integration@example.test')).toBe(false);
    expect(integrationMockAllowed('MOCK', 'production-integration@example.test', true, 'production-integration@example.test')).toBe(true);
    expect(integrationMockAllowed('DEEPSEEK', 'other@example.test', false)).toBe(true);
  });
  it('uses subscription anniversary and expiration', () => {
    expect(nextPeriod(new Date('2026-01-31T00:00:00Z')).toISOString()).toBe('2026-02-28T00:00:00.000Z');
    expect(subscriptionActive('ACTIVE', new Date('2026-01-01'), new Date('2026-02-01'))).toBe(false);
  });
  it('tracks usage boundaries', () => {
    expect(usageState(70, 100).threshold).toBe(70);
    expect(usageState(90, 100).threshold).toBe(90);
    expect(usageState(100, 100).threshold).toBe(100);
    expect(usageCredit(100, 1.5)).toBe(150);
  });
});
