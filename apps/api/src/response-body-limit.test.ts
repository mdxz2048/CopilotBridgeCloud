import {expect,it} from 'vitest';
process.env.DATABASE_URL??='postgresql://fixture:fixture@127.0.0.1:5432/fixture';
process.env.ACCESS_SECRET??='a'.repeat(64);
process.env.REFRESH_TOKEN_PEPPER??='b'.repeat(64);
process.env.PROVIDER_MASTER_KEY??='c'.repeat(64);
process.env.PUBLIC_BASE_URL??='http://localhost:3001';

it('accepts Responses context above 1MiB before authentication and returns accurate 413 beyond 10MiB',async()=>{
  const app=await(await import('./server.js')).createServer();
  try {
    const medium=await app.inject({method:'POST',url:'/v1/responses',payload:{model:'fixture',input:'x'.repeat(2*1024*1024)}});
    expect(medium.statusCode).toBe(401);
    const large=await app.inject({method:'POST',url:'/v1/responses',payload:{model:'fixture',input:'x'.repeat(10*1024*1024)}});
    expect(large.statusCode).toBe(413);expect(large.json().error.code).toBe('PAYLOAD_TOO_LARGE');
  } finally {await app.close();}
},20000);
