import {z} from 'zod';
import {isPeak,POINTS_PER_RMB,defaultMoneyPolicy} from './money-pricing.js';

export const ModelMarkupSchema=z.object({multiplier:z.number().min(.01).max(100),revision:z.number().int().nonnegative()}).strict();
export type ModelMarkup=z.infer<typeof ModelMarkupSchema>;
type Prices={input:number;cached:number;output:number};
export type PriceReference={source:'OFFICIAL_DEEPSEEK'|'CONFIGURED_REFERENCE'|'USER_PROVIDED_REFERENCE';label:string;costMultiplier?:number;periods:Array<{id:'offPeak'|'peak'|'standard';label:string;prices:Prices}>};
export function modelPriceReference(family:string,model:string,prices:Record<string,{offPeak:Prices;peak:Prices}>):PriceReference|null {
 if(family==='deepseek'&&prices[model]){
  const base=defaultMoneyPolicy.prices[model as keyof typeof defaultMoneyPolicy.prices];
  const official=base&&(['offPeak','peak'] as const).every(period=>(['input','cached','output'] as const).every(part=>base[period][part]===prices[model][period][part]));
  return {costMultiplier:1,source:official?'OFFICIAL_DEEPSEEK':'CONFIGURED_REFERENCE',label:official?'DeepSeek 人民币峰谷基准':'已配置价格基准（不是已核对的供应商账单）',periods:[{id:'offPeak',label:'空闲时段',prices:prices[model].offPeak},{id:'peak',label:'高峰时段',prices:prices[model].peak}]};
 }
 // Explicit prices supplied by the operator; never treated as measured supplier cost.
 if(family==='openai'&&model==='gpt-6.1-sol')return {costMultiplier:.1,source:'USER_PROVIDED_REFERENCE',label:'GateAI GPT-6.1 Sol 人民币价目 · CNY 2 / 0.1 / 10，不换汇；实际成本未验证',periods:[{id:'standard',label:'标准（人民币／百万 Token）',prices:{input:2,cached:.1,output:10}}]};
 if(family==='openai'&&model==='gpt-6-sol')return {source:'USER_PROVIDED_REFERENCE',label:'已提供 gpt-6-sol 中转价目 · USD 2 / 0.1 / 10，汇率 7；实际成本未验证',periods:[{id:'standard',label:'标准',prices:{input:14,cached:.7,output:70}}]};
 return null;
}
export function referenceRates(reference:PriceReference,multiplier:number,holidays:string[],at=new Date()) {
 ModelMarkupSchema.shape.multiplier.parse(multiplier);
 const chosen=reference.periods.find(p=>p.id===(isPeak(at,holidays)?'peak':'offPeak'))??reference.periods[0];
 const convert=(n:number)=>(n*multiplier*POINTS_PER_RMB/1000).toFixed(6);
 return {inputRate:convert(chosen.prices.input),outputRate:convert(chosen.prices.output),cachedInputRate:convert(chosen.prices.cached),reasoningRate:convert(chosen.prices.output),imageInputRate:'0.000000',imageOutputRate:'0.000000',toolRate:'0.000000',minimumCharge:0};
}
