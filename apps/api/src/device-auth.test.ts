import { expect, it } from 'vitest';

process.env.DATABASE_URL ??= 'postgres://localhost/bridge_device_auth_test';
process.env.ACCESS_SECRET ??= 'a'.repeat(64);
process.env.REFRESH_TOKEN_PEPPER ??= 'b'.repeat(64);
process.env.PROVIDER_MASTER_KEY ??= 'c'.repeat(64);
process.env.PUBLIC_BASE_URL ??= 'http://localhost:3001';

it('binds new device access tokens to an authorization version while reading legacy tokens as version zero', async () => {
  const { issueAccess, readAccess } = await import('./security.js');
  const { SignJWT } = await import('jose');
  const userId = '11111111-1111-4111-8111-111111111111';
  const deviceId = '22222222-2222-4222-8222-222222222222';
  expect((await readAccess(await issueAccess(userId, deviceId))).deviceVersion).toBe(0);
  expect((await readAccess(await issueAccess(userId, deviceId, 'USER', 3))).deviceVersion).toBe(3);
  expect((await readAccess(await issueAccess(userId))).deviceVersion).toBeUndefined();
  const legacy = await new SignJWT({ deviceId, role: 'USER' }).setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId).setIssuedAt().setExpirationTime('30m').sign(new TextEncoder().encode(process.env.ACCESS_SECRET));
  expect((await readAccess(legacy)).deviceVersion).toBeUndefined();
});
