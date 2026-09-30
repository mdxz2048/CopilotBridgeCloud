import { createHash } from 'node:crypto';
import { Transform } from 'node:stream';
import { compactVerify, importJWK } from 'jose';
import { db, deviceProofs } from '@bridge/db';
import { lt } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ApiError } from './errors.js';

type DeviceKey = { kty: 'EC'; crv: 'P-256'; x: string; y: string };
type Proof = { htm: string; htu: string; iat: number; jti: string; ath: string; bth: string };
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('base64url');
const invalid = () => new ApiError(401, 'DEVICE_PROOF_INVALID');
const hash = /^[A-Za-z0-9_-]{43}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const bodies = new WeakMap<FastifyRequest, string>();
let nextProofCleanup = 0;

export function captureDeviceBody(app: FastifyInstance) {
  app.addHook('preParsing', (req, _reply, payload, done) => {
    const hasher = createHash('sha256');
    const stream = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        hasher.update(chunk);
        stream.receivedEncodedLength += chunk.length;
        callback(null, chunk);
      },
      flush(callback) {
        bodies.set(req, hasher.digest('base64url'));
        callback();
      },
    }) as Transform & { receivedEncodedLength: number };
    stream.receivedEncodedLength = 0;
    payload.on('error', error => stream.destroy(error));
    payload.pipe(stream);
    done(null, stream);
  });
}

export async function verifyDeviceProof(req: FastifyRequest, jwk: DeviceKey | null, token: string): Promise<string> {
  if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !hash.test(jwk.x) || !hash.test(jwk.y)) throw invalid();
  const compact = req.headers.dpop;
  if (typeof compact !== 'string' || compact.length > 4096 || compact.split('.').length !== 3) throw invalid();
  try {
    const { payload, protectedHeader } = await compactVerify(compact, await importJWK(jwk, 'ES256'), { algorithms: ['ES256'] });
    if (protectedHeader.typ !== 'dpop+jwt' || protectedHeader.alg !== 'ES256'
      || !protectedHeader.jwk || Object.keys(protectedHeader.jwk).sort().join(',') !== 'crv,kty,x,y'
      || protectedHeader.jwk.kty !== jwk.kty || protectedHeader.jwk.crv !== jwk.crv
      || protectedHeader.jwk.x !== jwk.x || protectedHeader.jwk.y !== jwk.y) throw invalid();
    const proof = JSON.parse(Buffer.from(payload).toString('utf8')) as Proof;
    const htu = new URL(req.raw.url ?? req.url, `${req.protocol}://${req.host}`);
    if (!proof || Object.keys(proof).sort().join(',') !== 'ath,bth,htm,htu,iat,jti'
      || typeof proof.iat !== 'number' || !Number.isSafeInteger(proof.iat)
      || Math.abs(Math.floor(Date.now() / 1000) - proof.iat) > 60
      || typeof proof.jti !== 'string' || !uuid.test(proof.jti)
      || proof.htm !== req.method || proof.htu !== `${htu.origin}${htu.pathname}`
      || proof.ath !== digest(token)
      || proof.bth !== (bodies.get(req) ?? (req.body === undefined ? digest('') : undefined))) throw invalid();
    return proof.jti;
  } catch {
    throw invalid();
  }
}

export async function claimDeviceProof(deviceId: string, jti: string) {
  await db.transaction(async tx => {
    if (Date.now() >= nextProofCleanup) {
      await tx.delete(deviceProofs).where(lt(deviceProofs.createdAt, new Date(Date.now() - 10 * 60_000)));
      nextProofCleanup = Date.now() + 60_000;
    }
    const [claimed] = await tx.insert(deviceProofs).values({ deviceId, jti }).onConflictDoNothing().returning({ id: deviceProofs.id });
    if (!claimed) throw new ApiError(401, 'DEVICE_PROOF_REPLAYED');
  });
}
