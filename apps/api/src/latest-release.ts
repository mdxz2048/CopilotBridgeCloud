export function latestWindowsRelease<T extends { version: string; published: boolean; platform: string; arch: string; channel: string; createdAt: Date }>(entries: T[]): T | null {
  return entries.filter(r => r.published && r.channel === 'stable' && r.platform === 'windows' && r.arch === 'x64' && /^\d+\.\d+\.\d+$/.test(r.version))
    .sort((a, b) => {
      const x = a.version.split('.').map(Number), y = b.version.split('.').map(Number);
      for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return y[i] - x[i];
      return b.createdAt.getTime() - a.createdAt.getTime();
    })[0] ?? null;
}
