import {describe,it,expect,vi} from 'vitest';
vi.hoisted(()=>{process.env.DATABASE_URL??='postgres://test:test@localhost:5432/test';process.env.ACCESS_SECRET??='a'.repeat(64);process.env.REFRESH_TOKEN_PEPPER??='b'.repeat(64);process.env.PROVIDER_MASTER_KEY??='c'.repeat(64);process.env.PUBLIC_BASE_URL??='http://localhost:3001';});
import {sanitizeDiagnostic,diagnosticModelNames} from './diagnostics.js';
import {FailureDiagnosticSchema} from '@bridge/contract';
import {randomUUID} from 'node:crypto';
describe('failure diagnostic privacy boundaries',()=>{
  it('separates routed Cloud models from desktop aliases and never labels rejected requests as routed',()=>{
    expect(diagnosticModelNames({request:{desktop:{model:'gpt-5.5'},forwarded:{model:'openai/gpt-6-sol'}}})).toEqual({model:'openai/gpt-6-sol',clientModel:'gpt-5.5'});
    expect(diagnosticModelNames({request:{desktop:{model:'gpt-6-luna'}}})).toEqual({model:null,clientModel:'gpt-6-luna'});
  });
  it('removes nested credential headers, embedded keys and file binaries while retaining failure context',()=>{
    const result=sanitizeDiagnostic({headers:{authorization:'Bearer private'},cookie:'private',nested:{password:'private',file_data:'base64private'},message:'failed sk-123456789abc password=private Bearer abc',content:'请检查合成文档',data:'data:image/png;base64,YWJjZA=='});
    expect(JSON.stringify(result)).not.toContain('private');expect(JSON.stringify(result)).not.toContain('YWJjZA');
    expect(result).toMatchObject({content:'请检查合成文档',headers:'[REDACTED]'});
  });
  it('bounds recursive arrays and strings and never traverses inherited properties',()=>{
    expect(sanitizeDiagnostic('a'.repeat(20000))).toBe('[BINARY_REMOVED]');
    expect(sanitizeDiagnostic(Array(100).fill('内容'))).toHaveLength(64);
    let deep:unknown='hidden';for(let i=0;i<12;i++)deep={next:deep};expect(JSON.stringify(sanitizeDiagnostic(deep))).toContain('DEPTH_LIMIT');
    expect(sanitizeDiagnostic(Object.create({password:'inherited'}))).toEqual({});
  });
  it('requires explicit account owner and a failure stage, rejecting forged email/success envelopes',()=>{
    const value={id:randomUUID(),ownerUserId:randomUUID(),occurredAt:new Date().toISOString(),appVersion:'0.3.5',traceId:randomUUID(),stage:'stream_failed',error:{code:'GATEWAY_TIMEOUT',message:'deadline'},request:{},reply:{}};
    expect(FailureDiagnosticSchema.safeParse(value).success).toBe(true);
    expect(FailureDiagnosticSchema.safeParse({...value,email:'forged@test'}).success).toBe(false);
    expect(FailureDiagnosticSchema.safeParse({...value,ownerUserId:undefined}).success).toBe(false);
    expect(FailureDiagnosticSchema.safeParse({...value,stage:'completed'}).success).toBe(false);
    expect(FailureDiagnosticSchema.safeParse({...value,reply:{events:Array(65).fill({})}}).success).toBe(false);
  });
  it('redacts tool JSON strings and quoted embedded credentials, preserving safe tool content and marking clipping',()=>{
    const value={arguments:JSON.stringify({password:'PRIVATE_PASS',apiKey:'PRIVATE_KEY',code:'const marker = "SAFE_MARKER";',nested:{output:JSON.stringify({token:'PRIVATE_TOKEN',text:'SAFE_TEXT'})}}),output:'OPENAI_API_KEY="PRIVATE_ENV" Cookie: "PRIVATE_COOKIE" debug "password":"PRIVATE_QUOTED"',text:'中文'.repeat(10000)};
    const flags={truncated:false};const result=JSON.stringify(sanitizeDiagnostic(value,0,flags));
    expect(result).not.toContain('PRIVATE_');expect(result).toContain('SAFE_MARKER');expect(result).toContain('SAFE_TEXT');expect(flags.truncated).toBe(true);
    expect(JSON.parse((sanitizeDiagnostic(value) as {arguments:string}).arguments).password).toBe('[REDACTED]');
  });
});
