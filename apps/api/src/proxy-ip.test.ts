import Fastify from 'fastify';
import { expect, it } from 'vitest';
import { trustedProxy } from './trusted-proxy.js';

it('selects the client IP at the configured proxy hop instead of a spoofed leftmost forwarded address', async () => {
  for (const [hops, forwarded, expected] of [
    [1, '203.0.113.66, 192.0.2.10', '192.0.2.10'],
    [2, '203.0.113.66, 192.0.2.10, 172.18.0.1', '192.0.2.10'],
  ] as const) {
    const app = Fastify({ trustProxy: trustedProxy(hops, '127.0.0.0/8,172.16.0.0/12') });
    app.get('/ip', async req => ({ ip: req.ip, protocol: req.protocol, host: req.hostname }));
    const response = await app.inject({ method: 'GET', url: '/ip', headers: {
      host: 'internal-api:3001', 'x-forwarded-for': forwarded,
      'x-forwarded-proto': 'http, https', 'x-forwarded-host': 'forged.invalid, cloud.example.test',
    } });
    expect(response.json().ip).toBe(expected);
    expect(response.json().protocol).toBe('https');
    expect(response.json().host).toBe('cloud.example.test');
    await app.close();
  }
});

it('ignores forwarded headers when the immediate peer is not trusted', async () => {
  const app = Fastify({ trustProxy: trustedProxy(2, '172.16.0.0/12') });
  app.get('/ip', async req => ({ ip: req.ip, protocol: req.protocol }));
  const response = await app.inject({ method: 'GET', url: '/ip',
    headers: { 'x-forwarded-for': '198.51.100.2, 203.0.113.5', 'x-forwarded-proto': 'https' } });
  expect(response.json()).toEqual({ ip: '127.0.0.1', protocol: 'http' });
  await app.close();
});
