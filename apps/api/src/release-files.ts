import type { FastifyInstance, FastifyRequest } from 'fastify';
import {recordClientDownload} from './site-visits.js';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, stat, unlink, rename, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { db, auditLogs, releases } from '@bridge/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { admin, ApiError } from './core.js';
import { config } from './config.js';
import { registerOfficialClient } from './official-client.js';
import { blockmapLimit, installerRange, validateBlockmap } from './release-differential.js';

const storage = resolve(process.env.RELEASE_STORAGE_DIR ?? join(homedir(), '.bridge-cloud', 'releases'));
const maxBytes = 512 * 1024 * 1024;
const metadata = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/).max(64),
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
  registerOfficialClient(app);
  app.addContentTypeParser('application/octet-stream', (req, payload, done) => done(null, payload));

  app.get('/api/v1/releases/by-version/:version', async req => {
    const version = z.string().regex(/^\d+\.\d+\.\d+$/).parse((req.params as {version:string}).version);
    const [release] = await db.select().from(releases).where(and(eq(releases.version, version), eq(releases.channel, 'stable'), eq(releases.platform, 'windows'), eq(releases.arch, 'x64'), eq(releases.published, true))).limit(1);
    if (!release) throw new ApiError(404, 'NOT_FOUND');
    return { release };
  });

  app.put('/api/v1/admin/releases/:id/blockmap', { bodyLimit: blockmapLimit, onRequest: async req => { await admin(req); } }, async req => {
    const operator = await admin(req);
    const id = z.uuid().parse((req.params as {id:string}).id);
    if (req.headers['content-type'] !== 'application/octet-stream') throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE');
    // Serialize against publishing and other uploads: published sidecars are immutable.
    return db.transaction(async tx => {
      const [release] = await tx.select().from(releases).where(eq(releases.id, id)).for('update').limit(1);
      if (!release || release.platform !== 'windows' || release.arch !== 'x64') throw new ApiError(404, 'NOT_FOUND');
      if (release.published) {
        // Older released installers predate sidecars. Permit a single audited backfill,
        // while keeping an already published map immutable (including concurrent PUTs).
        let exists = false;
        try { await stat(join(storage, `${id}.exe.blockmap`)); exists = true; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        if (exists) throw new ApiError(409, 'RELEASE_ALREADY_PUBLISHED');
      }
      const installer = await stat(join(storage, `${id}.exe`));
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of req.body as Readable) {
        const bytes = Buffer.from(chunk); size += bytes.length;
        if (size > blockmapLimit) throw new ApiError(413, 'RELEASE_BLOCKMAP_TOO_LARGE');
        chunks.push(bytes);
      }
      const bytes = Buffer.concat(chunks);
      const summary = validateBlockmap(bytes, installer.size);
      const temporary = join(storage, `${id}.${randomUUID()}.blockmap.part`);
      try { await writeFile(temporary, bytes, {flag:'wx', mode:0o600}); await rename(temporary, join(storage, `${id}.exe.blockmap`)); }
      finally { await unlink(temporary).catch((error:NodeJS.ErrnoException) => {if(error.code !== 'ENOENT') throw error;}); }
      await tx.insert(auditLogs).values({actorId:operator.user.id,action:'RELEASE_BLOCKMAP_UPLOADED',targetType:'RELEASE',targetId:id,metadata:{size, publishedBackfill:release.published, ...summary}});
      return { size, sha256:createHash('sha256').update(bytes).digest('hex'), ...summary };
    });
  });

  app.get('/api/v1/releases/files/:id/blockmap', async (req, reply) => {
    const id = z.uuid().parse((req.params as {id:string}).id);
    const [release] = await db.select().from(releases).where(eq(releases.id, id)).limit(1);
    if (!release?.published || release.platform !== 'windows' || release.arch !== 'x64') throw new ApiError(404, 'NOT_FOUND');
    let bytes: Buffer;
    try {
      const path = join(storage, `${id}.exe.blockmap`);
      if ((await stat(path)).size > blockmapLimit) throw new ApiError(503, 'INVALID_RELEASE_BLOCKMAP');
      bytes = await readFile(path);
      validateBlockmap(bytes, (await stat(join(storage, `${id}.exe`))).size);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new ApiError(404, 'NOT_FOUND');
      throw error;
    }
    reply.header('Content-Type','application/octet-stream');
    reply.header('Content-Length',bytes.length);
    reply.header('Cache-Control','public, max-age=31536000, immutable');
    return reply.send(bytes);
  });

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

  const downloads=new WeakMap<FastifyRequest,{version:string;platform:string;arch:string}>();
  app.get('/api/v1/releases/files/:id', {onResponse:async(req,reply)=>{
    const release=downloads.get(req);
    if(req.method!=='GET'||reply.statusCode!==200||!release)return;
    try{await recordClientDownload(release);}catch{req.log.warn({event:'download_count_failed'},'下载计数暂时未保存');}
  }},async (req, reply) => {
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
    const etag = `"${release.sha256}"`;
    reply.header('ETag', etag);
    reply.header('Accept-Ranges', 'bytes');
    const ifRange = req.headers['if-range'];
    const range = installerRange(req.headers.range, Array.isArray(ifRange) ? '' : ifRange, etag, info.size);
    if (range === false) return reply.code(416).header('Content-Range', `bytes */${info.size}`).send();
    if (range) {
      reply.code(206).header('Content-Range', `bytes ${range.start}-${range.end}/${info.size}`).header('Content-Length', range.end-range.start+1);
      return reply.send(createReadStream(file, range));
    }
    reply.header('Content-Length', info.size);
    reply.header('Content-Disposition', `attachment; filename="CopilotBridge-${release.version.replace(/[^A-Za-z0-9._-]/g, '_')}.exe"`);
    downloads.set(req,{version:release.version,platform:release.platform,arch:release.arch});
    return reply.send(createReadStream(file));
  });
}
