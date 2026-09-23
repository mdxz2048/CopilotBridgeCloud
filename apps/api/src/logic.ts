export function subscriptionActive(status: string, end: Date, now = new Date()) {
  return ['ACTIVE', 'TRIAL', 'CANCELED'].includes(status) && end.getTime() > now.getTime();
}
export function modelAllowed(enabled: boolean, planAccess: boolean, override?: string) {
  return enabled && (override === 'DENY' ? false : override === 'ALLOW' ? true : planAccess);
}
export function usageState(used: number, limit: number) {
  const percent = limit > 0 ? Math.round(100 * used / limit) : 100;
  return { percent, threshold: percent >= 100 ? 100 : percent >= 90 ? 90 : percent >= 70 ? 70 : 0 };
}
export function usageCredit(tokens: number, weight: number) {
  return Math.round(tokens * weight * 10000) / 10000;
}
export function nextPeriod(start: Date) {
  const end = new Date(start);
  const day = end.getUTCDate();
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() + 1);
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  end.setUTCDate(Math.min(day, last));
  return end;
}
