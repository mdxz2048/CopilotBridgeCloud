import {defaultMoneyPolicy,isPeak} from './money-pricing.js';
import type {CanonicalResult,ProviderAdapter} from './provider.js';

type Balance = {checkedAt:string;balances:Array<{currency:string;total:string;granted?:string;toppedUp?:string}>};
type CostRates = {input:number;cached:number;output:number};
const round=(value:number)=>Number(value.toFixed(8));

export function estimatedDeepSeekCost(usage: Pick<CanonicalResult,'inputTokens'|'cachedInputTokens'|'outputTokens'>,rates:CostRates) {
  const input=usage.inputTokens,cached=usage.cachedInputTokens??0,output=usage.outputTokens;
  if(![input,cached,output].every(n=>Number.isSafeInteger(n)&&n>=0)||cached>input)return null;
  return round(((input-cached)*rates.input+cached*rates.cached+output*rates.output)/1_000_000);
}
export function balanceWindow(before:Balance|null,after:Balance|null) {
  if(!before||!after)return [];
  return before.balances.flatMap(b=>{
    const next=after.balances.find(a=>a.currency===b.currency);
    if(!next||![Number(b.total),Number(next.total)].every(Number.isFinite))return [];
    // A negative delta is a top-up or adjustment, never a negative model cost.
    return [{currency:b.currency,netDecrease:round(Number(b.total)-Number(next.total))}];
  });
}
async function snapshot(adapter:ProviderAdapter):Promise<Balance|null> {
  const balance=(adapter as ProviderAdapter & {balance?:(signal?:AbortSignal)=>Promise<Balance>}).balance;
  if(!balance)return null;
  try {
    const raw=await balance.call(adapter,AbortSignal.timeout(1500));
    if(!raw||!Array.isArray(raw.balances)||!raw.balances.every(b=>/^[A-Z]{3}$/.test(b.currency)&&Number.isFinite(Number(b.total))))return null;
    return {checkedAt:raw.checkedAt??new Date().toISOString(),balances:raw.balances.map(b=>({currency:b.currency,total:b.total,granted:b.granted,toppedUp:b.toppedUp}))};
  }catch{return null;}
}
export async function beginCostObservation(adapter:ProviderAdapter,modelId:string,deepseek:boolean) {
  const startedAt=new Date();
  let rateSnapshot:({currency:'CNY';perMillion:CostRates;period:string;source:string;verifiedDate:string})|null=null;
  if(deepseek){
    const base=defaultMoneyPolicy.prices[modelId as keyof typeof defaultMoneyPolicy.prices];
    if(base){
      let holidays:string[]=[];try{holidays=(await (await import('./money-policy.js')).moneyPolicy()).holidayDates;}catch{/* Observation must not prevent a request. */}
      const period=isPeak(startedAt,holidays)?'peak':'offPeak';
      rateSnapshot={currency:'CNY',perMillion:base[period],period,source:'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/',verifiedDate:'2026-10-14'};
    }
  }
  const before=await snapshot(adapter);let final:Promise<Balance|null>|undefined;
  return {async finish(result?:CanonicalResult){
    const after=await(final??=snapshot(adapter));
    const estimatedCostRmb=result&&!result.usageUnavailable&&rateSnapshot?estimatedDeepSeekCost(result,rateSnapshot.perMillion):null;
    const reportedCostRmb=result?.providerCost!==undefined&&Number.isFinite(result.providerCost)&&result.providerCost>=0
      ?result.providerCurrency==='CNY'?round(result.providerCost):result.providerCurrency==='USD'?round(result.providerCost*7):null:null;
    return {version:1,startedAt:startedAt.toISOString(),finishedAt:new Date().toISOString(),rateSnapshot,
      estimatedCostRmb,reportedCostRmb,reportedUsdExchangeRate:result?.providerCurrency==='USD'?7:null,
      beforeBalance:before,afterBalance:after,observedBalanceWindow:balanceWindow(before,after),
      balanceScope:'UPSTREAM_ACCOUNT_WINDOW_NOT_REQUEST',balanceStatus:before&&after?'OBSERVED':'UNAVAILABLE',
      costSource:reportedCostRmb!==null?'UPSTREAM_REPORTED':estimatedCostRmb!==null?'OFFICIAL_RATE_ESTIMATE':'UNKNOWN'};
  }};
}
