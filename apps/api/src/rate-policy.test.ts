import { expect, it } from 'vitest';

process.env.DATABASE_URL ??= 'postgres://localhost/bridge_rate_policy_test';
process.env.ACCESS_SECRET ??= 'a'.repeat(64);
process.env.REFRESH_TOKEN_PEPPER ??= 'b'.repeat(64);
process.env.PROVIDER_MASTER_KEY ??= 'c'.repeat(64);
process.env.PUBLIC_BASE_URL ??= 'http://localhost:3001';

it('starts at account 2/min and device 1/min with bounded, strict admin policy inputs', async () => {
  const { defaultRatePolicy, RatePolicySchema, isPublicPath } = await import('./rate-policy.js');
  expect(defaultRatePolicy).toMatchObject({ accountRpm: 2, deviceRpm: 1 });
  expect(RatePolicySchema.parse(defaultRatePolicy)).toEqual(defaultRatePolicy);
  for (const bad of [{ ...defaultRatePolicy, deviceRpm: 0 }, { ...defaultRatePolicy, accountRpm: 121 },
    { ...defaultRatePolicy, publicIpRpm: 121 }, { ...defaultRatePolicy, authIpRpm: 61 },
    { ...defaultRatePolicy, unexpected: 1 }]) expect(RatePolicySchema.safeParse(bad).success).toBe(false);
  expect(isPublicPath({ method: 'POST', url: '/api/v1/auth/login' })).toBe(true);
  expect(isPublicPath({ method: 'GET', url: '/api/v1/client/config' })).toBe(true);
  expect(isPublicPath({ method: 'GET', url: '/api/v1/admin/rate-policy' })).toBe(false);
});
