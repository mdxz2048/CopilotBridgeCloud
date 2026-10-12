import type { FastifyRequest } from 'fastify';

// Background policy/model reads must not spend the model request's transport quota.
export function transportRateScope(req: Pick<FastifyRequest, 'method' | 'url'>): 'model' | 'client_metadata' | 'general' {
  const path = req.url.split('?')[0];
  if (req.method === 'POST' && path === '/v1/responses') return 'model';
  if (req.method === 'GET' && (metadataPaths.has(path) || path === '/api/v1/me'
    || path.startsWith('/api/v1/me/') || /^\/api\/v1\/providers\/[^/]+(?:\/models)?$/.test(path))) return 'client_metadata';
  return 'general';
}

const metadataPaths = new Set(['/v1/models', '/api/v1/auth/me', '/api/v1/account', '/api/v1/devices',
  '/api/v1/subscription', '/api/v1/usage/current', '/api/v1/usage/history', '/api/v1/providers',
  '/api/v1/referral/code', '/api/v1/referral/stats', '/api/v1/referral/history']);

export const transportRateOptions = {
  timeWindow: '1 minute',
  max: 120,
  allowList: (req: FastifyRequest) => transportRateScope(req) !== 'general',
  keyGenerator: (req: FastifyRequest) => `${transportRateScope(req)}:${req.ip}`,
};
