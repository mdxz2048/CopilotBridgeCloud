import { describe, expect, it } from 'vitest';

process.env.DATABASE_URL ??= 'postgres://localhost/bridge_admin_provider_test';
process.env.ACCESS_SECRET ??= 'a'.repeat(64);
process.env.REFRESH_TOKEN_PEPPER ??= 'b'.repeat(64);
process.env.PROVIDER_MASTER_KEY ??= 'c'.repeat(64);
process.env.PUBLIC_BASE_URL ??= 'http://localhost:3001';

const { assertProviderPatchAllowed } = await import('./admin.js');

describe('provider admin credential policy', () => {
  it('rejects generic Copilot credential writes before storage and preserves the release gate', () => {
    expect(() => assertProviderPatchAllowed('COPILOT', { apiKey: 'unverified-token' }))
      .toThrowError(expect.objectContaining({ code: 'PROVIDER_CONNECTION_UNAVAILABLE', status: 409 }));
    expect(() => assertProviderPatchAllowed('COPILOT', { enabled: false, apiKey: 'unverified-token' }))
      .toThrowError(expect.objectContaining({ code: 'PROVIDER_CONNECTION_UNAVAILABLE', status: 409 }));
    expect(() => assertProviderPatchAllowed('COPILOT', { enabled: true }))
      .toThrowError(expect.objectContaining({ code: 'PROVIDER_UNAVAILABLE', status: 503 }));
    expect(() => assertProviderPatchAllowed('COPILOT', { enabled: false })).not.toThrow();
  });
  it('keeps ordinary provider API key updates available', () => {
    expect(() => assertProviderPatchAllowed('DEEPSEEK', { enabled: true, apiKey: 'existing-key' })).not.toThrow();
  });
});
