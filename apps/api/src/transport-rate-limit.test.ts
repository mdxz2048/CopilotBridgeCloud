import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { expect, it } from 'vitest';
import { transportRateOptions, transportRateScope } from './transport-rate-limit.js';

it('separates metadata reads, model transport and general requests on one IP with bounded quotas', async () => {
  const app = Fastify();
  await app.register(rateLimit, transportRateOptions);
  app.get('/v1/models', async () => ({ models: [] }));
  app.get('/api/v1/me', async () => ({ account: true }));
  app.get('/api/v1/auth/me', async () => ({ user: true }));
  app.post('/v1/responses', async () => ({ reachedGateway: true }));
  app.post('/api/v1/other', async () => ({ ok: true }));
  try {
    for (let i = 0; i < 600; i++) {
      const r = await app.inject({ method: 'GET', url: ['/v1/models?refresh=1','/api/v1/me','/api/v1/auth/me'][i % 3] });
      expect(r.statusCode).toBe(200);
    }
    expect((await app.inject({ method: 'GET', url: '/v1/models' })).statusCode).toBe(429);
    expect((await app.inject({ method: 'POST', url: '/v1/responses', payload: {} })).json()).toEqual({ reachedGateway: true });
    for (let i = 0; i < 120; i++) expect((await app.inject({ method: 'POST', url: '/api/v1/other' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/v1/other' })).statusCode).toBe(429);
    for (let i = 1; i < 600; i++) expect((await app.inject({ method: 'POST', url: '/v1/responses', payload: {} })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/v1/responses', payload: {} })).statusCode).toBe(429);
  } finally { await app.close(); }
});

it('does not exempt admin writes, login, diagnostics or arbitrary methods as metadata', () => {
  for (const url of ['/api/v1/auth/login', '/api/v1/admin/users', '/api/v1/diagnostics/failures', '/v1/models'])
    expect(transportRateScope({ method: 'POST', url })).toBe('general');
  expect(transportRateScope({ method: 'GET', url: '/api/v1/me/usage?period=current' })).toBe('client_metadata');
  for (const url of ['/api/v1/auth/me','/api/v1/account','/api/v1/devices','/api/v1/subscription',
    '/api/v1/usage/current','/api/v1/referral/stats','/api/v1/referral/history','/api/v1/providers/test/models'])
    expect(transportRateScope({ method: 'GET', url })).toBe('client_metadata');
});
