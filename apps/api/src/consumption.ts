import type {FastifyInstance} from 'fastify';
import {db} from '@bridge/db';
import {sql} from 'drizzle-orm';
import {z} from 'zod';
import {actor,ApiError} from './core.js';
import {ConsumptionQuerySchema,ConsumptionSchema,ConsumptionDetailSchema} from '../../../packages/contract/src/consumption.js';
import {exactConsumptionBreakdown} from './consumption-breakdown.js';
import type {NormalizedUsage,PointRates} from './rating.js';

export function consumptionWindow(range:'today'|'week',now=new Date()){
  const day=86400000,offset=8*3600000;
  const midnight=Math.floor((now.getTime()+offset)/day)*day-offset;
  return {from:new Date(midnight-(range==='week'?6*day:0)),to:now};
}

// Usage events are authoritative even while a device interval is still open.
// Interval totals are a second view of the SAME debits, never another debit.
// If old events are missing, expose only the device's unmatched lifetime total
// as one historical summary. Do not guess interval membership using timestamps:
// settlement and heartbeat transactions may straddle each other's timestamps.
function records(userId:string){return sql`with event_totals as (
  select device_id,sum(points_charged)::bigint as charged from usage_events where user_id=${userId} group by device_id
), period_totals as (
  select device_id,sum(charged_points)::bigint as charged,max(ended_at) as ended_at
  from device_billing_periods where user_id=${userId} group by device_id
), history as (
  select d.id,d.device_name,d.platform,p.ended_at,
    greatest(0,p.charged+coalesce(s.charged_points-s.settled_points,0)-coalesce(e.charged,0))::bigint as charged
  from period_totals p join devices d on d.id=p.device_id and d.user_id=${userId}
  left join event_totals e on e.device_id=d.id
  left join device_billing_states s on s.device_id=d.id and s.user_id=${userId}
), records as (
  select u.id::text as id,'CALL'::text as kind,d.id as "deviceId",d.device_name as "deviceName",d.platform,
    u.created_at as "occurredAt",m.display_name as model,
    case when u.billing_status in ('METERING_ERROR','UNRATED') then null else u.points_charged end::bigint as "chargedPoints",
    u.billing_status as status,u.billing_status in ('METERING_ERROR','UNRATED','UNPAID') as "needsReview"
  from usage_events u join devices d on d.id=u.device_id and d.user_id=${userId} join models m on m.id=u.model_id where u.user_id=${userId}
  union all
  select 'history:'||id::text,'HISTORICAL',id,device_name,platform,ended_at,null,charged,'HISTORICAL',false from history where charged>0
) `;}
const numberRow=(row:Record<string,unknown>)=>({...row,...(row.occurredAt instanceof Date?{occurredAt:row.occurredAt.toISOString()}:{}),chargedPoints:row.chargedPoints===null?null:Number(row.chargedPoints)});

export function registerConsumption(app:FastifyInstance){
  app.get('/api/v1/me/consumption',async(req,reply)=>{
    const a=await actor(req);reply.header('Cache-Control','no-store');
    const {range,deviceId,page}=ConsumptionQuerySchema.parse(req.query),pageSize=20;
    const {from,to}=consumptionWindow(range);
    if(deviceId){const owned=await db.execute(sql`select id from devices where id=${deviceId} and user_id=${a.user.id}`);if(!owned.rows.length)throw new ApiError(404,'NOT_FOUND');}
    // One SQL snapshot keeps summary, pagination and legacy reconciliation consistent.
    const result=await db.execute(sql`${records(a.user.id)}, filtered as (
      select * from records where "occurredAt">=${from} and "occurredAt"<=${to}
    ), selected as (select * from filtered ${deviceId?sql`where "deviceId"=${deviceId}`:sql``})
    select (select coalesce(json_agg(r),'[]') from (select * from selected order by "occurredAt" desc,id desc limit ${pageSize} offset ${(page-1)*pageSize}) r) as data,
      (select count(*)::integer from selected) as total,
      (select coalesce(sum("chargedPoints"),0)::bigint from selected) as charged,
      (select count(*)::integer from selected where "needsReview") as reviews,
      (select coalesce(json_agg(d order by "lastUsedAt" desc,id),'[]') from (
        select "deviceId" as id,max("deviceName") as name,max(platform) as platform,max("occurredAt") as "lastUsedAt",
        coalesce(sum("chargedPoints"),0)::bigint as "chargedPoints",count(*) filter(where "needsReview")::integer as "reviewCount",count(*)::integer as count
        from filtered group by "deviceId") d) as devices`);
    const r=result.rows[0];
    return ConsumptionSchema.parse({range,from:from.toISOString(),to:to.toISOString(),chargedPoints:Number(r.charged),reviewCount:r.reviews,devices:(r.devices as Record<string,unknown>[]).map(numberRow),data:(r.data as Record<string,unknown>[]).map(numberRow),total:r.total,page,pageSize});
  });
  app.get('/api/v1/me/consumption/:id',async(req,reply)=>{
    const a=await actor(req);reply.header('Cache-Control','no-store');
    const {id}=z.object({id:z.string().regex(/^(history:)?[0-9a-f-]{36}$/i)}).parse(req.params);
    const found=await db.execute(sql`${records(a.user.id)} select * from records where id=${id}`);
    if(!found.rows.length)throw new ApiError(404,'NOT_FOUND');
    const row=numberRow(found.rows[0]);
    if(id.startsWith('history:'))return ConsumptionDetailSchema.parse({...row,usage:null,rates:null,ratedPoints:null,breakdown:null});
    // Explicit allowlist: never expose provider costs, private usage payloads or audits.
    const detail=await db.execute(sql`select u.input_tokens as "inputTokens",u.cached_input_tokens as "cachedInputTokens",u.output_tokens as "outputTokens",u.reasoning_tokens as "reasoningTokens",u.image_input as "imageInput",u.image_output as "imageOutput",u.tool_calls as "toolCalls",u.points_rated as "ratedPoints",
      v.input_rate as "inputRate",v.cached_input_rate as "cachedInputRate",v.output_rate as "outputRate",v.reasoning_rate as "reasoningRate",v.image_input_rate as "imageInputRate",v.image_output_rate as "imageOutputRate",v.tool_rate as "toolRate",v.minimum_charge as "minimumCharge",
      u.provider_reported_usage->'bridge_cost_audit'->'rateSnapshot'->>'source' as "specialRate"
      from usage_events u left join rate_card_versions v on v.id=u.rate_card_version_id where u.id=${id} and u.user_id=${a.user.id}`);
    const d=detail.rows[0],usage=Object.fromEntries(['inputTokens','cachedInputTokens','outputTokens','reasoningTokens','imageInput','imageOutput','toolCalls'].map(k=>[k,d[k]]));
    // A base card alone cannot explain provider-specific cache-write/long-context adjustments.
    const rates=d.inputRate!==null&&!d.specialRate?Object.fromEntries(['inputRate','cachedInputRate','outputRate','reasoningRate','imageInputRate','imageOutputRate','toolRate','minimumCharge'].map(k=>[k,d[k]])):null;
    const status=String(found.rows[0].status),validUsage=!['METERING_ERROR','UNRATED'].includes(status);
    const breakdown=validUsage&&rates?exactConsumptionBreakdown(usage as NormalizedUsage,rates as PointRates,Number(found.rows[0].chargedPoints),status):null;
    return ConsumptionDetailSchema.parse({...row,usage:validUsage?usage:null,rates:validUsage?rates:null,ratedPoints:d.ratedPoints,breakdown});
  });
}
