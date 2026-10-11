import {afterEach,expect,it,vi} from 'vitest';
import Fastify from 'fastify';
process.env.DATABASE_URL??='postgres://localhost/bridge_official_test';
process.env.ACCESS_SECRET??='a'.repeat(64);process.env.REFRESH_TOKEN_PEPPER??='b'.repeat(64);process.env.PROVIDER_MASTER_KEY??='c'.repeat(64);process.env.PUBLIC_BASE_URL??='http://localhost:3001';
vi.mock('node:fs/promises',async()=>({...await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises'),readFile:vi.fn(),stat:vi.fn()}));
const {readFile,stat}=await import('node:fs/promises');
const {officialClientManifest,registerOfficialClient}=await import('./official-client.js');
afterEach(()=>vi.resetAllMocks());
it('serves only the fixed official installer manifest and rejects mismatched local asset size',async()=>{
  vi.mocked(readFile).mockResolvedValue(JSON.stringify({version:'26.1000',arch:'x64',sha256:'a'.repeat(64),size:10}));
  vi.mocked(stat).mockResolvedValue({size:10,isFile:()=>true} as any);
  expect(await officialClientManifest()).toMatchObject({filename:'ChatGPT-Windows-x64.zip',downloadUrl:'http://localhost:3001/api/v1/official-client/files/ChatGPT-Windows-x64.zip'});
  vi.mocked(stat).mockResolvedValue({size:11,isFile:()=>true} as any);
  await expect(officialClientManifest()).rejects.toMatchObject({code:'RELEASE_FILE_MISSING'});
  const app=Fastify();registerOfficialClient(app);app.setErrorHandler((e,req,reply)=>reply.code((e as any).status??500).send({error:true}));
  try{expect((await app.inject({url:'/api/v1/official-client/files/other.zip'})).statusCode).toBe(404);expect((await app.inject({url:'/api/v1/official-client/files/..%2Fmanifest.json'})).statusCode).toBe(404);}finally{await app.close();}
});
