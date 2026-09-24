export type BillingMode = 'OFF' | 'SHADOW' | 'ENFORCED';

export function currentBillingMode(): BillingMode {
  // Preserve an explicitly enabled legacy deployment until it selects a V2 mode.
  const value = process.env.V2_BILLING_MODE ?? (process.env.V2_BILLING_ENABLED === 'true' ? 'ENFORCED' : 'OFF');
  if (value !== 'OFF' && value !== 'SHADOW' && value !== 'ENFORCED') throw new Error('INVALID_V2_BILLING_MODE');
  return value;
}
