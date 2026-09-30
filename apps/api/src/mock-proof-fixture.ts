import { createHash, generateKeyPairSync, randomUUID, type KeyObject } from 'node:crypto';
import { SignJWT } from 'jose';
import type { FastifyInstance } from 'fastify';
import { createMockServer } from './mock.js';

const originals = new WeakMap<FastifyInstance, FastifyInstance['inject']>();
const lastHeaders = new WeakMap<object, Record<string, string>>();
export function rawMockInject(app: Awaited<ReturnType<typeof createMockServer>>, options: { method: 'GET' | 'POST' | 'DELETE'; url: string; headers?: Record<string, string>; payload?: unknown }) {
  return originals.get(app)!(options as never);
}
export function previousProofHeaders(app: Awaited<ReturnType<typeof createMockServer>>) {
  return { ...lastHeaders.get(app) };
}
export async function createSignedMockServer(limits: { accountRpm?: number; deviceRpm?: number; publicIpRpm?: number; authIpRpm?: number } = { accountRpm: 100, deviceRpm: 100 }) {
  const app = await createMockServer(limits);
  const inject = app.inject.bind(app);
  originals.set(app, inject);
  const keys = new Map<string, { publicKeyJwk: object; privateKey: KeyObject }>();
  const tokens = new Map<string, string>();
  const hash = (value: string) => createHash('sha256').update(value).digest('base64url');
  app.inject = (async (options: unknown) => {
    if (typeof options === 'string') return inject(options);
    const parsed = options as { method?: string; url: string; headers?: Record<string, string>; payload?: unknown };
    const input = { ...parsed, headers: { ...parsed.headers } };
    const body = input.payload as Record<string, unknown> | undefined;
    const path = new URL(input.url, 'http://localhost:3001').pathname;
    if (path === '/api/v1/auth/login' && body?.device && typeof body.device === 'object') {
      const device = body.device as { deviceId: string; publicKeyJwk?: object };
      if (!keys.has(device.deviceId)) {
        const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
        keys.set(device.deviceId, { privateKey, publicKeyJwk: publicKey.export({ format: 'jwk' }) });
      }
      input.payload = { ...body, device: { ...device, publicKeyJwk: keys.get(device.deviceId)!.publicKeyJwk } };
    }
    const authorization = String((input.headers as Record<string, string>).authorization ?? '');
    const accessToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    const refreshToken = path === '/api/v1/auth/refresh' ? String((input.payload as { refreshToken?: string }).refreshToken ?? '') : '';
    const id = tokens.get(accessToken || refreshToken);
    if (id) {
      const proof = {
        htm: input.method ?? 'GET', htu: new URL(input.url, 'http://localhost:3001').origin + new URL(input.url, 'http://localhost:3001').pathname,
        iat: Math.floor(Date.now() / 1000), jti: randomUUID(), ath: hash(accessToken || refreshToken),
        bth: hash(input.payload === undefined ? '' : JSON.stringify(input.payload)),
      };
      Object.assign(input.headers!, {
        host: 'localhost:3001',
        dpop: await new SignJWT(proof).setProtectedHeader({ typ: 'dpop+jwt', alg: 'ES256', jwk: keys.get(id)!.publicKeyJwk }).sign(keys.get(id)!.privateKey),
      });
      lastHeaders.set(app, input.headers);
    }
    const result = await inject(input as never);
    if (result.statusCode === 200 && (path === '/api/v1/auth/login' || path === '/api/v1/auth/refresh')) {
      const response = result.json<{ accessToken: string; refreshToken: string; device?: { deviceId: string } }>();
      const deviceId = response.device?.deviceId ?? id;
      if (deviceId) {
        tokens.set(response.accessToken, deviceId);
        tokens.set(response.refreshToken, deviceId);
      }
    }
    return result;
  }) as typeof app.inject;
  return app;
}
