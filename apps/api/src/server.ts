import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { ApiError } from './core.js';
import { config } from './config.js';
import { registerRoutes } from './routes.js';
import { registerAdmin } from './admin.js';
import { registerGateway } from './gateway.js';
import { registerV2Routes } from './v2-routes.js';
import { registerV2Admin } from './v2-admin.js';
import { registerCopilotAuthRoutes } from './copilot-auth.js';
import { currentBillingMode } from './billing-mode.js';
import { captureDeviceBody } from './device-proof.js';
import { trustedProxy } from './trusted-proxy.js';
import { registerRatePolicy } from './rate-policy.js';
import { registerReleaseFiles } from './release-files.js';
import { registerSiteVisits } from './site-visits.js';

export async function createServer() {
  currentBillingMode();
  const app = Fastify({
    trustProxy: trustedProxy(config.TRUSTED_PROXY_HOPS, config.TRUSTED_PROXY_CIDRS), bodyLimit: 1024 * 1024,
    logger: { level: process.env.LOG_LEVEL ?? 'info', redact: { paths: ['req.headers.authorization', 'req.headers.cookie', 'req.headers.dpop', 'req.body', 'res.body'], censor: '[REDACTED]' } },
  });
  captureDeviceBody(app);
  await app.register(cookie);
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
  registerRatePolicy(app);
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof ApiError) return reply.code(error.status).send({ error: { code: error.code, message: error.message, requestId: req.id, request_id: req.id } });
    if (error instanceof ZodError) return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request', requestId: req.id, request_id: req.id } });
    if (error && typeof error === 'object' && 'statusCode' in error && error.statusCode === 429) return reply.code(429).send({ error: { code: 'RATE_LIMITED', message: 'Too many requests', requestId: req.id, request_id: req.id } });
    req.log.error({ errorType: error instanceof Error ? error.name : 'UnknownError', requestId: req.id }, 'request failed');
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Internal error', requestId: req.id, request_id: req.id } });
  });
  await registerRoutes(app);
  await registerAdmin(app);
  registerReleaseFiles(app);
  registerSiteVisits(app);
  await registerCopilotAuthRoutes(app);
  await registerGateway(app);
  await registerV2Routes(app);
  await registerV2Admin(app);
  return app;
}

if (process.env.NODE_ENV !== 'test') {
  const app = await createServer();
  await app.listen({ host: '0.0.0.0', port: config.API_PORT });
}
