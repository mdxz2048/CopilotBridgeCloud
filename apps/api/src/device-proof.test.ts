import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import Fastify from 'fastify';import {createHash,generateKeyPairSync,randomUUID} from 'node:crypto';import {SignJWT} from 'jose';
process.env.DATABASE_URL??='postgres://localhost/bridge_device_proof_test';
const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),jwk=pair.publicKey.export({format:'jwk'}) as {kty:'EC';crv:'P-256';x:string;y:string};
const token='synthetic-access-token',hash=(s:string)=>createHash('sha256').update(s).digest('base64url');
const app=Fastify(),warn=vi.fn();
beforeAll(async()=>{const {captureDeviceBody,verifyDeviceProof}=await import('./device-proof.js');captureDeviceBody(app);app.post('/proof',async req=>{req.log.warn=warn;return {jti:await verifyDeviceProof(req,jwk,token)};});await app.ready();});
afterAll(()=>app.close());
async function post(body:string,patch:Record<string,unknown>={}){warn.mockClear();const dpop=await new SignJWT({htm:'POST',htu:'http://localhost/proof',iat:Math.floor(Date.now()/1000),jti:randomUUID(),ath:hash(token),bth:hash(body),...patch}).setProtectedHeader({typ:'dpop+jwt',alg:'ES256',jwk}).sign(pair.privateKey);return app.inject({method:'POST',url:'/proof',headers:{'content-type':'application/json',dpop},payload:body});}
it('accepts exact UTF-8 request bodies at the observed size without logging proof contents',async()=>{const body=JSON.stringify({synthetic:'中😀'.repeat(30000),padding:'x'.repeat(400000)});const r=await post(body);expect(r.statusCode,r.body).toBe(200);expect(warn).not.toHaveBeenCalled();});
it.each([
  [{bth:hash('changed')},'BODY_HASH_MISMATCH'],
  [{ath:hash('changed')},'TOKEN_HASH_MISMATCH'],
  [{htu:'https://other.example/proof'},'TARGET_MISMATCH'],
  [{iat:Math.floor(Date.now()/1000)-90},'PROOF_TIME_INVALID'],
])('keeps rejecting invalid proofs and logs a bounded reason: %s',async(patch,reason)=>{const r=await post('{}',patch as Record<string,unknown>);expect(r.statusCode).toBe(401);expect(warn.mock.calls[0][0]).toMatchObject({event:'device_proof_rejected',reason});expect(JSON.stringify(warn.mock.calls)).not.toContain(token);expect(JSON.stringify(warn.mock.calls)).not.toContain('bth');expect(r.body).toContain('zhipeng2048@gmail.com');});

