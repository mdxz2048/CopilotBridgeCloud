import type { FastifyInstance, FastifyRequest } from 'fastify';

type Context = { userId?: string; deviceId?: string; model?: string; providerId?: string };
const contexts = new WeakMap<FastifyRequest, Context>();
export function requestContext(req: FastifyRequest, context: Context) {
  contexts.set(req, { ...contexts.get(req), ...context });
}

// Deliberately exclude URL query strings, headers, bodies and error messages.
export function registerRequestLog(app: FastifyInstance) {
  const errors = new WeakMap<FastifyRequest, string>();
  const starts = new WeakMap<FastifyRequest, number>();
  app.addHook('onRequest', async (req, reply) => {
    starts.set(req, Date.now());
    reply.header('X-Request-Id', req.id);
  });
  app.addHook('onSend', async (req, _reply, payload) => {
    if (typeof payload === 'string' && payload.length < 8192) {
      try {
        const code = JSON.parse(payload)?.error?.code;
        if (typeof code === 'string' && /^[A-Z0-9_]{1,80}$/.test(code)) errors.set(req, code);
      } catch { /* SSE and non-JSON responses carry no JSON error code. */ }
    }
    return payload;
  });
  app.addHook('onResponse', async (req, reply) => {
    const entry = { event: 'request_completed', requestId: req.id, method: req.method,
      route: req.routeOptions.url ?? 'unmatched', statusCode: reply.statusCode,
      durationMs: Date.now() - (starts.get(req) ?? Date.now()), errorCode: errors.get(req), ...contexts.get(req) };
    if (reply.statusCode >= 500) req.log.error(entry, 'request completed');
    else if (reply.statusCode >= 400) req.log.warn(entry, 'request completed');
    else if (req.routeOptions.url !== '/health') req.log.info(entry, 'request completed');
  });
}
