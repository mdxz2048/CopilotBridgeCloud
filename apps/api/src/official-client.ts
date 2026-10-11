import type { FastifyInstance } from 'fastify';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { releaseStorage } from './release-lifecycle.js';
import { ApiError } from './errors.js';
import { config } from './config.js';

const filename='ChatGPT-Windows-x64.zip';
const manifestSchema=z.object({version:z.string().min(1).max(80),arch:z.literal('x64'),sha256:z.string().regex(/^[a-f0-9]{64}$/i),size:z.number().int().positive(),filename:z.literal(filename).optional()});
export async function officialClientManifest() {
  let manifest;
  try{manifest=manifestSchema.parse(JSON.parse(await readFile(join(releaseStorage,'official-client','manifest.json'),'utf8')));}
  catch{throw new ApiError(503,'RELEASE_FILE_MISSING','官方客户端离线安装包尚未就绪。');}
  const file=join(releaseStorage,'official-client',filename);
  const info=await stat(file).catch(()=>null);
  if(!info?.isFile()||info.size!==manifest.size)throw new ApiError(503,'RELEASE_FILE_MISSING');
  return {...manifest,filename,downloadUrl:`${config.PUBLIC_BASE_URL}/api/v1/official-client/files/${filename}`};
}
export function registerOfficialClient(app:FastifyInstance) {
  app.get('/api/v1/official-client/windows',async()=>officialClientManifest());
  app.get('/api/v1/official-client/files/:filename',async(req,reply)=>{
    if((req.params as {filename:string}).filename!==filename)throw new ApiError(404,'NOT_FOUND');
    const manifest=await officialClientManifest();
    reply.header('Content-Type','application/zip');reply.header('Content-Length',manifest.size);reply.header('Content-Disposition',`attachment; filename="${filename}"`);
    return reply.send(createReadStream(join(releaseStorage,'official-client',filename)));
  });
}
