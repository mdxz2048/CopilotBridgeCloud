export function latestWindowsRelease<T extends { version: string; published: boolean; platform: string; arch: string; channel: string; createdAt: Date }>(entries: T[]): T | null {
  return entries.filter(r => r.published && r.channel === 'stable' && r.platform === 'windows' && r.arch === 'x64' && /^\d+\.\d+\.\d+$/.test(r.version))
    .sort((a, b) => {
      const x = a.version.split('.').map(Number), y = b.version.split('.').map(Number);
      for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return y[i] - x[i];
      return b.createdAt.getTime() - a.createdAt.getTime();
    })[0] ?? null;
}
import { db, releases } from '@bridge/db';
import { ApiError } from './errors.js';

export async function latestClientRelease() {
  return latestWindowsRelease(await db.select().from(releases));
}
// Raise only for an incompatible protocol/security change, never for an ordinary release.
export const MINIMUM_COMPATIBLE_CLIENT_VERSION = '0.3.28';
export function requireCurrentClient(version: string, latest: string | undefined) {
  if (!latest) return;
  const parts = /^\d+\.\d+\.\d+$/.test(version) ? version.split('.').map(Number) : null;
  const minimum = MINIMUM_COMPATIBLE_CLIENT_VERSION.split('.').map(Number);
  const comparison = parts?.map((value, index) => value - minimum[index]).find(value => value !== 0) ?? 0;
  if (!parts || comparison < 0) throw new ApiError(426,'CLIENT_UPGRADE_REQUIRED',`请升级 Copilot Bridge 至 ${MINIMUM_COMPATIBLE_CLIENT_VERSION} 或更新版本后再使用云模型。`);
}
