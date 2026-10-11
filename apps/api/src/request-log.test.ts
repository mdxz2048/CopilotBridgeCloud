import Fastify from 'fastify';
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { registerRequestLog, requestContext, requestCounts, requestMilestone,requestNativeMetrics } from './request-log.js';

describe('request diagnostics', () => {
  it('records quota rejection with account context without request secrets', async () => {
    let logs = '';
    const stream = new Writable({ write(chunk, _encoding, callback) { logs += chunk.toString(); callback(); } });
    const app = Fastify({ disableRequestLogging: true, logger: { stream } });
    registerRequestLog(app);
    app.post('/v1/responses', async (req, reply) => {
      requestContext(req, { userId: 'test-user', model: 'deepseek/test' });
      requestMilestone(req,'authDone');requestCounts(req,{requestBytes:100,upstreamAttemptCount:1});
      requestNativeMetrics(req,{eventCount:4,upstreamFirstTextMs:25,privateDocument:999,responseBytes:-1});
      return reply.code(429).send({ error: { code: 'MONTHLY_QUOTA_EXCEEDED' } });
    });
    const res = await app.inject({ method: 'POST', url: '/v1/responses?key=QUERY_SECRET',
      headers: { authorization: 'Bearer AUTH_SECRET', cookie: 'SESSION_SECRET' },
      payload: { input: 'WORD_DOCUMENT_SECRET', apiKey: 'KEY_SECRET' } });
    await app.close();
    const entry = JSON.parse(logs.trim());
    expect(entry).toMatchObject({ event: 'request_completed', statusCode: 429, errorCode: 'MONTHLY_QUOTA_EXCEEDED', userId: 'test-user', model: 'deepseek/test', route: '/v1/responses' });
    expect(entry.durationMs).toBeGreaterThanOrEqual(0);
    expect(entry.stageTimingsMs.authDone).toBeGreaterThanOrEqual(0);expect(entry.counts).toEqual({requestBytes:100,upstreamAttemptCount:1});expect(entry.nativeMetrics).toEqual({eventCount:4,upstreamFirstTextMs:25});
    expect(res.headers['x-request-id']).toBe(entry.requestId);
    expect(logs).not.toMatch(/QUERY_SECRET|AUTH_SECRET|SESSION_SECRET|WORD_DOCUMENT_SECRET|KEY_SECRET/);
  });

  it('does not use untrusted error text as a log field', async () => {
    let logs = '';
    const stream = new Writable({ write(chunk, _encoding, callback) { logs += chunk.toString(); callback(); } });
    const app = Fastify({ disableRequestLogging: true, logger: { stream } });
    registerRequestLog(app);
    app.get('/failure', async (_req, reply) => reply.code(503).send({ error: { code: 'sensitive document text', message: 'PASSWORD_SECRET' } }));
    await app.inject('/failure');
    await app.close();
    expect(JSON.parse(logs.trim()).statusCode).toBe(503);
    expect(logs).not.toMatch(/sensitive document text|PASSWORD_SECRET/);
  });
});
