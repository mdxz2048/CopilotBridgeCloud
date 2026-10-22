import {randomUUID} from 'node:crypto';
import {FailureDiagnosticSchema} from '@bridge/contract';
import {db,failureDiagnostics} from '@bridge/db';
import {sql} from 'drizzle-orm';
import {encryptSecret} from './security.js';
import {pruneFailureDiagnostics} from './diagnostics.js';
import {getFlightRecorder} from './flight-recorder-service.js';

/** Successful recovery uses the same encrypted bounded store and timed cleanup. */
export async function recordProtocolRecovery(input:{userId:string;deviceId:string;email:string;appVersion:string;requestId:string;model:string;attempts:number;modes:string[];durationMs:number}){
  const id=randomUUID();
  const event={type:'bridge.protocol_recovered',attempts:input.attempts,modes:[...new Set(input.modes)].slice(0,16),durationMs:input.durationMs};
  const report=FailureDiagnosticSchema.parse({id,ownerUserId:input.userId,occurredAt:new Date().toISOString(),appVersion:input.appVersion,traceId:input.requestId,requestId:input.requestId,stage:'cloud_http',error:{code:'PROTOCOL_RECOVERED',message:'工具协议异常已在服务端恢复，用户请求继续完成。'},request:{forwarded:{model:input.model}},reply:{events:[event]}});
  const payload=encryptSecret(JSON.stringify(report));
  await db.transaction(async tx=>{await tx.execute(sql`select pg_advisory_xact_lock(81903317)`);await pruneFailureDiagnostics(tx);await tx.insert(failureDiagnostics).values({id,userId:input.userId,deviceId:input.deviceId,userEmail:input.email,appVersion:input.appVersion,traceId:input.requestId,stage:'cloud_http',errorCode:'PROTOCOL_RECOVERED',occurredAt:new Date(report.occurredAt),payload,payloadBytes:Buffer.byteLength(JSON.stringify(payload))});await pruneFailureDiagnostics(tx);});
  await getFlightRecorder()?.freeze(input.userId,{source:'protocol_recovery',code:'PROTOCOL_RECOVERED',requestId:input.requestId,failureId:id});
}
