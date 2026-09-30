import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildOpenApiV2 } from './generate-v2.js';
import { ErrorCodeV2Schema, UsageRecordV2Schema } from './v2-schemas.js';

const root = new URL('../../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
const specText = read('docs/protocol/openapi.v2.json');
const spec = JSON.parse(specText) as {
  info: { version: string };
  paths: Record<string, Record<string, unknown>>;
  components: { schemas: Record<string, { properties?: Record<string, unknown>; enum?: string[] }> };
};
const freeze = JSON.parse(read('docs/protocol/CONTRACT_VERSION.json')) as {
  version: string; openapiSha256: string; gatewayV1: { version: string; openapiSha256: string };
};

describe('V2 contract drift gate', () => {
  it('pins the generated OpenAPI and keeps the Gateway V1 hash intact', () => {
    expect(buildOpenApiV2()).toEqual(spec);
    expect(spec.info.version).toBe(freeze.version);
    expect(createHash('sha256').update(specText).digest('hex')).toBe(freeze.openapiSha256);
    const v1 = read('docs/protocol/openapi.v1.json');
    expect(JSON.parse(v1).info.version).toBe(freeze.gatewayV1.version);
    expect(createHash('sha256').update(v1).digest('hex')).toBe(freeze.gatewayV1.openapiSha256);
    const manifest = read('docs/protocol/PRODUCTION_INTEGRATION_MANIFEST.md');
    expect(manifest).toContain(`PENDING_CONTRACT_VERSION: ${freeze.version}`);
    expect(manifest).toContain(`PENDING_OPENAPI_HASH: sha256:${freeze.openapiSha256}`);
    expect(manifest).toContain(`PENDING_GATEWAY_V1_OPENAPI_HASH: sha256:${freeze.gatewayV1.openapiSha256}`);
    expect(manifest).toContain('PRODUCTION_STATUS: PARTIAL');
    expect(read('docs/api-v2.md')).toContain(`Contract version: \`${freeze.version}\``);
  });

  it('documents every V2 runtime route and the inherited response route', () => {
    for (const file of ['apps/api/src/v2-routes.ts', 'apps/api/src/v2-admin.ts']) {
      const source = read(file);
      const routes = [...source.matchAll(/app\.(get|post|put|patch|delete)\('([^']+)'/g)];
      expect(routes.length).toBeGreaterThan(10);
      for (const [, method, rawPath] of routes) {
        const path = rawPath.replace(/:([a-zA-Z]+)/g, '{$1}');
        expect(spec.paths[path]?.[method], `${method.toUpperCase()} ${path}`).toBeDefined();
      }
    }
    expect(spec.paths['/api/v1/auth/register']?.post).toBeDefined();
    expect(spec.paths['/v1/responses']?.post).toBeDefined();
  });

  it('pins stable shapes, SHADOW status, referral onboarding and response metadata', () => {
    const stable = ['AccountSummary', 'SubscriptionSummary', 'WalletSummary', 'Device', 'DeviceCredential',
      'Provider', 'ProviderConnection', 'Model', 'UsageSummary', 'UsageRecord', 'ReferralSummary',
      'ReferralRecord', 'ErrorResponse'];
    const docs = read('docs/api-v2.md');
    for (const name of stable) {
      expect(spec.components.schemas[name], name).toBeDefined();
      expect(docs).toContain(`type ${name} =`);
    }
    expect(UsageRecordV2Schema.shape.billingStatus.options).toContain('SHADOW');
    expect(JSON.stringify(spec.components.schemas.UsageRecord)).toContain('SHADOW');
    expect(JSON.stringify(spec.components.schemas.RegisterRequest)).toContain('referralCode');
    const response = JSON.stringify(spec.components.schemas.Response);
    for (const field of ['points_rated', 'points_charged', 'remaining_points', 'request_id', 'billing_mode'])
      expect(response).toContain(field);
    expect(docs).toContain('SHADOW');
    expect(docs).toContain('referralCode');
  });

  it('keeps emitted API error codes in the shared enum', () => {
    const sourceFiles = readdirSync(new URL('apps/api/src/', root))
      .filter(file => file.endsWith('.ts') && !file.endsWith('.test.ts'))
      .map(file => `apps/api/src/${file}`);
    const source = sourceFiles.map(read).join('\n');
    const codes = [...source.matchAll(/new ApiError\(\s*\d+\s*,\s*'([A-Z_]+)'/g)].map(match => match[1]);
    expect(codes.length).toBeGreaterThan(30);
    for (const code of codes) expect(ErrorCodeV2Schema.options, code).toContain(code);
    const enumText = JSON.stringify(spec.components.schemas.ErrorResponse);
    for (const code of new Set(codes)) expect(enumText).toContain(code);
  });
});
