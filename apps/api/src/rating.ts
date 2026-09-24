export type BillingPolicy = 'MANAGED_USAGE' | 'BYOS_USAGE' | 'LOCAL_USAGE';
export type NormalizedUsage = {
  inputTokens: number; outputTokens: number; cachedInputTokens: number; reasoningTokens: number;
  imageInput: number; imageOutput: number; toolCalls: number;
};
export type PointRates = {
  inputRate: string; outputRate: string; cachedInputRate: string; reasoningRate: string;
  imageInputRate: string; imageOutputRate: string; toolRate: string; minimumCharge: number;
};

export function normalizeUsage(raw: Partial<NormalizedUsage>): NormalizedUsage {
  const count = (value: number | undefined) => {
    if (value === undefined) return 0;
    if (!Number.isSafeInteger(value) || value < 0 || value > 2_147_483_647) throw new Error('INVALID_PROVIDER_USAGE');
    return value;
  };
  const usage = {
    inputTokens: count(raw.inputTokens), outputTokens: count(raw.outputTokens), cachedInputTokens: count(raw.cachedInputTokens),
    reasoningTokens: count(raw.reasoningTokens), imageInput: count(raw.imageInput), imageOutput: count(raw.imageOutput), toolCalls: count(raw.toolCalls),
  };
  if (usage.cachedInputTokens > usage.inputTokens || usage.reasoningTokens > usage.outputTokens) throw new Error('INVALID_PROVIDER_USAGE');
  return usage;
}

// Decimal rates represent points per 1,000 tokens or per image/tool. Fixed-point math avoids float billing drift.
function micros(rate: string): bigint {
  if (!/^\d+(?:\.\d{1,6})?$/.test(rate)) throw new Error('INVALID_RATE');
  const [whole, fraction = ''] = rate.split('.');
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
}
export function ratePoints(policy: BillingPolicy, raw: Partial<NormalizedUsage>, rates?: PointRates): number {
  if (policy === 'LOCAL_USAGE') return 0;
  if (!rates) throw new Error('RATE_CARD_REQUIRED');
  const u = normalizeUsage(raw);
  const tokenMicros = BigInt(u.inputTokens - u.cachedInputTokens) * micros(rates.inputRate)
    + BigInt(u.cachedInputTokens) * micros(rates.cachedInputRate)
    + BigInt(u.outputTokens - u.reasoningTokens) * micros(rates.outputRate)
    + BigInt(u.reasoningTokens) * micros(rates.reasoningRate);
  const itemMicros = BigInt(u.imageInput) * micros(rates.imageInputRate)
    + BigInt(u.imageOutput) * micros(rates.imageOutputRate)
    + BigInt(u.toolCalls) * micros(rates.toolRate);
  const points = (tokenMicros + itemMicros * 1000n + 999_999_999n) / 1_000_000_000n;
  const result = points > BigInt(rates.minimumCharge) ? points : BigInt(rates.minimumCharge);
  if (result > 2_147_483_647n) throw new Error('RATE_OVERFLOW');
  return Number(result);
}
