export type ApiError = { code: string; message: string; requestId?: string };
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'include', cache: 'no-store', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw (data.error ?? { code: 'NETWORK_ERROR', message: '暂时无法加载，请稍后重试。' }) as ApiError;
  return data as T;
}
export const post = <T>(path: string, body: unknown) => api<T>(path, { method: 'POST', body: JSON.stringify(body) });
export const patch = <T>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
export const put = <T>(path: string, body: unknown) => api<T>(path, { method: 'PUT', body: JSON.stringify(body) });
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' });
export type Plan = { id: string; code: string; name: string; description: string; monthlyPrice: string; currency: string; maxDevices: number; monthlyTokenLimit: number; monthlyUsageCreditLimit: string; maxConcurrentRequests: number; requestsPerMinute: number; monthlyPoints: number; rolloverPolicy: 'NONE' | 'UNLIMITED'; enabled: boolean };
export type Device = { id: string; deviceId: string; deviceName: string; platform: string; appVersion: string; status: string; activatedAt: string; lastSeenAt: string | null };
export type Subscription = { id: string; status: string; currentPeriodStart: string; currentPeriodEnd: string; cancelAtPeriodEnd: boolean; pendingPlanId: string | null };
export type Usage = { tokens: number; credit: number; requests: number; tokenLimit: number; creditLimit: number; percent: number; threshold: number };
export type Account = { user: { id: string; email: string; role: string; status: string }; plan: Plan | null; subscription: Subscription | null; devices: Device[]; usage: Usage | null };
export type Release = { id: string; version: string; channel: string; platform: string; arch: string; downloadUrl: string; sha256: string; releaseNotes: string; published: boolean };
