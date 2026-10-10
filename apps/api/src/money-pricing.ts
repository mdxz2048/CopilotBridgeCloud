import { z } from 'zod';
import { ApiError } from './errors.js';
export const POINTS_PER_RMB = 10_000;
const price = z.object({ input: z.number().nonnegative().max(10000), cached: z.number().nonnegative().max(10000), output: z.number().nonnegative().max(10000) });
export const MoneyPolicySchema = z.object({ enforceManaged: z.boolean().default(true), markup: z.number().min(1).max(100), holidayDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(400),
  prices: z.record(z.string(), z.object({ offPeak: price, peak: price })) }).strict().superRefine((policy,ctx)=>{
    for(const [model,entry] of Object.entries(policy.prices)) for(const period of ['offPeak','peak'] as const) {
      const baseline=defaultMoneyPolicy.prices[model as keyof typeof defaultMoneyPolicy.prices]?.[period];
      for(const part of ['input','cached','output'] as const) if(entry[period][part]<=0 || (baseline && entry[period][part]<baseline[part]))
        ctx.addIssue({code:'custom',path:['prices',model,period,part],message:'单价必须大于零，且不得低于已配置的官方成本基准。'});
    }
  });
export const defaultMoneyPolicy = { enforceManaged: true, markup: 1, holidayDates: [], prices: {
  'deepseek-flash': { offPeak: { input: 1, cached: .02, output: 4 }, peak: { input: 2, cached: .04, output: 8 } },
  'deepseek-v4-pro': { offPeak: { input: 4.5, cached: .15, output: 13.5 }, peak: { input: 9, cached: .3, output: 27 } },
} };
export function isPeak(at: Date, holidayDates: string[]) {
  const local = new Date(at.getTime() + 8 * 3600000);
  const day = local.getUTCDay(), hour = local.getUTCHours(), date = local.toISOString().slice(0, 10);
  return day > 0 && day < 6 && !holidayDates.includes(date) && ((hour >= 9 && hour < 12) || (hour >= 14 && hour < 18));
}
export function ratesFor(model: string, policy: z.infer<typeof MoneyPolicySchema>, at = new Date()) {
  const entry = policy.prices[model];
  if (!entry) throw new ApiError(503, 'RATE_CARD_UNAVAILABLE');
  const chosen = entry[isPeak(at, policy.holidayDates) ? 'peak' : 'offPeak'];
  const convert = (n: number) => (n * policy.markup * POINTS_PER_RMB / 1000).toFixed(6);
  return { inputRate: convert(chosen.input), outputRate: convert(chosen.output), cachedInputRate: convert(chosen.cached), reasoningRate: convert(chosen.output), imageInputRate: '0.000000', imageOutputRate: '0.000000', toolRate: '0.000000', minimumCharge: 0 };
}
