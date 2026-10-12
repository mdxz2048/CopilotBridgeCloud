import type { FastifyInstance, FastifyRequest } from 'fastify';

type Stage='authDone'|'entitlementDone'|'historyRecovered'|'routingDone'|'preflightDone'|'reservationDone'|'upstreamStarted'|'relayFirstEvent'|'relayFirstText'|'relayToolArgumentsDone'|'settlementDone'|'historySaved';
type Count='declaredRequestBytes'|'requestBytes'|'toolResultBytes'|'inputItemCount'|'toolCount'|'upstreamAttemptCount';
type Context = { transportRateScope?: 'model'|'client_metadata'|'general'; userId?: string; deviceId?: string; model?: string; providerId?: string; instanceId?: string; inputProtocol?: string; outboundProtocol?: string; protocolMode?: string; reasoningMode?: string; stream?: boolean; ignoredFields?: string[]; ignoredToolTypes?: string[]; traceId?:string; responseId?:string; terminalStatus?:string; errorCode?:string;timeoutPhase?:'connect'|'idle'|'total'; responsesProfile?:string; stageTimingsMs?:Partial<Record<Stage,number>>; counts?:Partial<Record<Count,number>>; nativeMetrics?:Record<string,number> };
const contexts = new WeakMap<FastifyRequest, Context>();
const starts = new WeakMap<FastifyRequest, number>();
export function requestContext(req: FastifyRequest, context: Context) {
  contexts.set(req, { ...contexts.get(req), ...context });
}
export function requestMilestone(req:FastifyRequest,stage:Stage) {
  const context=contexts.get(req)??{};const stageTimingsMs={...context.stageTimingsMs};
  stageTimingsMs[stage]??=Math.max(0,Date.now()-(starts.get(req)??Date.now()));requestContext(req,{stageTimingsMs});
}
export function requestCounts(req:FastifyRequest,counts:Partial<Record<Count,number>>) {
  const safe=Object.fromEntries(Object.entries(counts).filter(([,v])=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0));
  requestContext(req,{counts:{...contexts.get(req)?.counts,...safe}});
}
export function requestNativeMetrics(req:FastifyRequest,metrics:Record<string,number>|undefined) {
  const allowed=['requestBytes','responseBytes','eventCount','upstreamAttemptCount','upstreamHeadersMs','upstreamFirstEventMs','upstreamFirstTextMs','upstreamFirstToolMs','upstreamToolArgumentsDoneMs','upstreamTerminalMs','serialHeldEventCount','serialHeldBytes'];
  requestContext(req,{nativeMetrics:Object.fromEntries(Object.entries(metrics??{}).filter(([k,v])=>allowed.includes(k)&&Number.isSafeInteger(v)&&v>=0))});
}

// Deliberately exclude URL query strings, headers, bodies and error messages.
export function registerRequestLog(app: FastifyInstance) {
  const errors = new WeakMap<FastifyRequest, string>();
  app.addHook('onRequest', async (req, reply) => {
    starts.set(req, Date.now());
    const declared=req.headers['content-length'];
    if(typeof declared==='string'&&/^\d{1,12}$/.test(declared)&&Number.isSafeInteger(Number(declared)))requestCounts(req,{declaredRequestBytes:Number(declared)});
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
