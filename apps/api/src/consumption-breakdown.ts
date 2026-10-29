import type {NormalizedUsage,PointRates} from './rating.js';

// Only show two monetary portions when the saved standard card explains the
// actual debit exactly. Fractional rounding, minimums, partial payment and
// special provider adjustments cannot be silently assigned to either portion.
export function exactConsumptionBreakdown(u:NormalizedUsage,r:PointRates,charged:number,status:string){
  if(status!=='SETTLED'||u.imageInput||u.imageOutput||u.toolCalls)return null;
  const micros=(v:string)=>{const [a,b='']=v.split('.');return BigInt(a)*1000000n+BigInt(b.padEnd(6,'0'));};
  const input=BigInt(u.inputTokens-u.cachedInputTokens)*micros(r.inputRate)+BigInt(u.cachedInputTokens)*micros(r.cachedInputRate);
  const output=BigInt(u.outputTokens-u.reasoningTokens)*micros(r.outputRate)+BigInt(u.reasoningTokens)*micros(r.reasoningRate);
  const unit=1000000000n;
  if(input%unit||output%unit||(input+output)/unit!==BigInt(charged))return null;
  return {inputPoints:Number(input/unit),outputPoints:Number(output/unit)};
}
