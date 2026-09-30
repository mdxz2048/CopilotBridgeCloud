import { createHash } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { describe, expect, it } from 'vitest';

process.env.DATABASE_URL ??= 'postgres://localhost/bridge_release_test';
process.env.ACCESS_SECRET ??= 'a'.repeat(64);
process.env.REFRESH_TOKEN_PEPPER ??= 'b'.repeat(64);
process.env.PROVIDER_MASTER_KEY ??= 'c'.repeat(64);
process.env.PUBLIC_BASE_URL ??= 'http://localhost:3001';

const { releaseInspector } = await import('./release-files.js');

const sink = () => new Writable({ write(_chunk, _encoding, done) { done(); } });

describe('installer stream validation', () => {
  it('computes a digest only for a complete Windows executable', async () => {
    const bytes = Buffer.from('MZpayload');
    const inspect = releaseInspector(20);
    await pipeline(Readable.from([bytes.subarray(0, 1), bytes.subarray(1)]), inspect.stream, sink());
    expect(inspect.result(bytes.length)).toEqual({ size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    const chunked = releaseInspector(20);
    await pipeline(Readable.from([bytes]), chunked.stream, sink());
    expect(chunked.result().size).toBe(bytes.length);
  });
  it('rejects truncated, invalid and oversized files', async () => {
    const short = releaseInspector(20);
    await pipeline(Readable.from([Buffer.from('MZ')]), short.stream, sink());
    expect(() => short.result(3)).toThrow('INVALID_RELEASE_FILE');
    const invalid = releaseInspector(20);
    await pipeline(Readable.from([Buffer.from('not executable')]), invalid.stream, sink());
    expect(() => invalid.result(14)).toThrow('INVALID_RELEASE_FILE');
    const oversized = releaseInspector(2);
    await expect(pipeline(Readable.from([Buffer.from('MZpayload')]), oversized.stream, sink())).rejects.toThrow('RELEASE_TOO_LARGE');
  });
});
