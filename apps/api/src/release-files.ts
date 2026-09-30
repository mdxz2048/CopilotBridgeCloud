import type { FastifyInstance } from 'fastify';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, stat, unlink, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { db, auditLogs, releases } from '@bridge/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { admin, ApiError } from './core.js';
import { config } from './config.js';

const storage = resolve(process.env.RELEASE_STORAGE_DIR ?? join(homedir(), '.bridge-cloud', 'releases'));
const maxBytes = 512 * 1024 * 1024;
const metadata = z.object({
  version: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/),
  channel: z.enum(['stable', 'beta']),
  notes: z.string().max(4000),
});

export function releaseInspector(limit = maxBytes) {
  const hash = createHash('sha256');
  let size = 0;
  let signature = Buffer.alloc(0);
  const stream = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      size += chunk.length;
      if (size > limit) { done(new ApiError(413, 'RELEASE_TOO_LARGE')); return; }
      if (signature.length < 2) signature = Buffer.concat([signature, chunk.subarray(0, 2 - signature.length)]);
      hash.update(chunk);
      done(null, chunk);
    },
  });
  return { stream, result(declaredSize?: number) {
    if (size < 2 || (declaredSize !== undefined && size !== declaredSize) || signature.toString('ascii') !== 'MZ') throw new ApiError(400, 'INVALID_RELEASE_FILE');
    return { size, sha256: hash.digest('hex') };
  } };
}

export function registerReleaseFiles(app: FastifyInstance) {
  app.addContentTypeParser('application/octet-stream', (req, payload, done) => done(null, payload));

  app.post('/api/v1/admin/releases/upload', { bodyLimit: maxBytes, onRequest: async req => { await admin(req); } }, async (req, reply) => {
    const operator = await admin(req);
    const data = metadata.parse({
      version: req.headers['x-release-version'],
      channel: req.headers['x-release-channel'],
      notes: req.headers['x-release-notes'] ?? '',
    });
    if (req.headers['content-type'] !== 'application/octet-stream') throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE');
    const declaredSize = req.headers['content-length'] === undefined ? undefined : Number(req.headers['content-length']);
    if (declaredSize !== undefined && (!Number.isSafeInteger(declaredSize) || declaredSize < 2 || declaredSize > maxBytes)) throw new ApiError(413, 'INVALID_RELEASE_SIZE');
    await mkdir(storage, { recursive: true, mode: 0o700 });
    const id = randomUUID();
    const temporary = join(storage, `${id}.part`);
    const destination = join(storage, `${id}.exe`);
    const inspector = releaseInspector();
    let release: typeof releases.$inferSelect;
    try {
      await pipeline(req.body as Readable, inspector.stream, createWriteStream(temporary, { flags: 'wx', mode: 0o600 }));
      const { size, sha256 } = inspector.result(declaredSize);
      await rename(temporary, destination);
      release = await db.transaction(async tx => {
        const [entry] = await tx.insert(releases).values({
          id, version: data.version, channel: data.channel, platform: 'windows', arch: 'x64',
          downloadUrl: `${config.PUBLIC_BASE_URL}/api/v1/releases/files/${id}`,
          sha256, releaseNotes: data.notes, published: false,
        }).returning();
        await tx.insert(auditLogs).values({ actorId: operator.user.id, action: 'RELEASE_UPLOADED', targetType: 'RELEASE', targetId: id, metadata: { version: data.version, size } });
        return entry;
      });
    } catch (error) {
      await Promise.all([unlink(temporary).catch((reason: NodeJS.ErrnoException) => {
        if (reason.code !== 'ENOENT') throw reason;
      }), unlink(destination).catch((reason: NodeJS.ErrnoException) => {
        if (reason.code !== 'ENOENT') throw reason;
      })]);
      throw error;
    }
    return reply.code(201).send(release);
  });

  app.get('/api/v1/releases/files/:id', async (req, reply) => {
    const id = z.uuid().parse((req.params as { id: string }).id);
    const [release] = await db.select().from(releases).where(eq(releases.id, id)).limit(1);
    if (!release?.published || release.platform !== 'windows') throw new ApiError(404, 'NOT_FOUND');
    const file = join(storage, `${id}.exe`);
    let info;
    try { info = await stat(file); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new ApiError(503, 'RELEASE_FILE_MISSING');
      throw error;
    }
    reply.header('Content-Type', 'application/octet-stream');
    reply.header('Content-Length', info.size);
    reply.header('Content-Disposition', `attachment; filename="CopilotBridge-${release.version.replace(/[^A-Za-z0-9._-]/g, '_')}.exe"`);
    return reply.send(createReadStream(file));
  });
}
