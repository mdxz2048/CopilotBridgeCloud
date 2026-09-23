import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DeviceInfoSchema, LatestReleaseResponseSchema, ResponseRequestSchema } from './schemas.js';

describe('Desktop V1 contract', () => {
  it('requires an explicit version update for OpenAPI wire changes', () => {
    const spec = readFileSync(new URL('../../../docs/protocol/openapi.v1.json', import.meta.url));
    const freeze = JSON.parse(readFileSync(new URL('../../../docs/protocol/CONTRACT_VERSION.json', import.meta.url), 'utf8')) as { version: string; openapiSha256: string };
    expect(JSON.parse(spec.toString()).info.version).toBe(freeze.version);
    expect(createHash('sha256').update(spec).digest('hex')).toBe(freeze.openapiSha256);
  });
  it('rejects hardware fingerprints and malformed device IDs', () => {
    expect(DeviceInfoSchema.safeParse({ deviceId: 'MAC:00:11', deviceName: 'PC', platform: 'windows' }).success).toBe(false);
  });
  it('accepts tool continuation', () => {
    expect(ResponseRequestSchema.safeParse({ model: 'mock/mock-chat', input: [{ type: 'function_call_output', call_id: 'call_1', output: 'done' }] }).success).toBe(true);
  });
  it('freezes nullable latest release responses', () => {
    expect(LatestReleaseResponseSchema.safeParse({ release: null }).success).toBe(true);
    expect(LatestReleaseResponseSchema.safeParse({ release: {
      id: '66666666-6666-4666-8666-666666666666', version: '0.1.0', channel: 'stable', platform: 'windows',
      arch: 'x64', downloadUrl: 'https://example.test/desktop.exe', sha256: 'a'.repeat(64), releaseNotes: 'Initial release',
      published: true, createdAt: '2026-09-23T00:00:00.000Z',
    } }).success).toBe(true);
    expect(LatestReleaseResponseSchema.safeParse({ release: { version: '0.1.0' } }).success).toBe(false);
  });
});
